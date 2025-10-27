// LAN WebSocket relay with rooms, roles (X/O), and Tic-Tac-Toe game relay
// Usage: node server.js 0.0.0.0 8080
import { createServer } from "http";
import { WebSocketServer } from "ws";
import os from "os";

const HOST = process.argv[2] || "0.0.0.0";
const PORT = Number(process.argv[3] || 8080);

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("LAN relay running.\n");
});

const wss = new WebSocketServer({ server: httpServer });

const clients = new Map(); // ws -> { id, room }
const rooms   = new Map(); // room -> { players:Set<ws>, spectators:Set<ws>, roles:Map<ws,'X'|'O'> }

function lanIPs() {
  const list = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === "IPv4" && !i.internal) list.push(i.address);
    }
  }
  return list;
}

function ensureRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, { players: new Set(), spectators: new Set(), roles: new Map() });
  }
  return rooms.get(name);
}

function rosterPacket(roomName) {
  const r = rooms.get(roomName);
  const players = [];
  for (const ws of r.players) players.push(r.roles.get(ws) || "?");
  return { t: "roster", room: roomName, players, spectators: r.spectators.size };
}

function send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
function broadcastRoom(roomName, obj) {
  const r = rooms.get(roomName);
  if (!r) return;
  const raw = JSON.stringify(obj);
  for (const ws of [...r.players, ...r.spectators]) {
    if (ws.readyState === ws.OPEN) ws.send(raw);
  }
}

wss.on("connection", (ws, req) => {
  const id = Math.random().toString(36).slice(2, 8);
  clients.set(ws, { id, room: "default" });
  send(ws, { t: "hello", id, ips: lanIPs() });

  ws.on("message", (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw); } catch { return; }

    const meta = clients.get(ws);
    if (!meta) return;

    if (msg.t === "join" && typeof msg.room === "string") {
      // remove from previous room
      const prev = rooms.get(meta.room);
      if (prev) {
        prev.players.delete(ws);
        prev.spectators.delete(ws);
        prev.roles.delete(ws);
        broadcastRoom(meta.room, rosterPacket(meta.room));
      }
      // add to new room
      meta.room = msg.room.trim() || "default";
      clients.set(ws, meta);

      const r = ensureRoom(meta.room);
      // assign role: first player X, second O, others spectators
      if (r.players.size < 2) {
        r.players.add(ws);
        const role = r.players.size === 1 ? "X" : "O";
        r.roles.set(ws, role);
        send(ws, { t: "role", role, room: meta.room });
      } else {
        r.spectators.add(ws);
        send(ws, { t: "role", role: "S", room: meta.room });
      }
      broadcastRoom(meta.room, rosterPacket(meta.room));
      return;
    }

    if (msg.t === "say" && typeof msg.text === "string") {
      const packet = { t: "msg", from: meta.id, room: meta.room, text: msg.text, at: Date.now() };
      broadcastRoom(meta.room, packet);
      return;
    }

    // Game packets are forwarded to everyone in the room (including sender).
    if (msg.t === "game") {
      msg.at = Date.now();
      broadcastRoom(meta.room, msg);
      return;
    }
  });

  ws.on("close", () => {
    const meta = clients.get(ws);
    if (meta) {
      const r = rooms.get(meta.room);
      if (r) {
        r.players.delete(ws);
        r.spectators.delete(ws);
        r.roles.delete(ws);
        broadcastRoom(meta.room, rosterPacket(meta.room));
      }
    }
    clients.delete(ws);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`WebSocket relay listening on ws://${HOST}:${PORT}`);
  console.log(`LAN IPs: ${lanIPs().join(", ")}`);
});
