// Socket.IO wiring: turns network events into Room method calls and broadcasts the results.

import { createServer, type Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { Room } from "./room";
import { percentile } from "./shared/syncMath";
import type { ClientToServerEvents, ServerToClientEvents } from "./shared/protocol";

const HOST_GRACE_MS = 10_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const OFFLINE_MEMBER_TTL_MS = 2 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, { roomCode?: string; memberId?: string }>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, {}, { roomCode?: string; memberId?: string }>;

export interface StartedServer {
  io: IO;
  http: HttpServer;
  rooms: Map<string, Room>;
  port: number;
  close: () => Promise<void>;
}

export function startServer(port: number, corsOrigin: string | undefined = process.env.CORS_ORIGIN): Promise<StartedServer> {
  const rooms = new Map<string, Room>();
  const driftLog: { at: number; room: string; driftMs: number; rttMs: number | null }[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const allowedOrigins = corsOrigin ? corsOrigin.split(",").map((s) => s.trim()) : true;

  const http = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptimeSec: Math.round(process.uptime()) }));
      return;
    }
    if (req.url?.startsWith("/stats")) {
      const abs = driftLog.map((d) => Math.abs(d.driftMs));
      const rtts = driftLog.map((d) => d.rttMs).filter((x): x is number => x !== null);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          samples: abs.length,
          driftMs: { p50: percentile(abs, 50), p95: percentile(abs, 95), p99: percentile(abs, 99), max: Math.max(0, ...abs) },
          rttMs: { p50: percentile(rtts, 50), p95: percentile(rtts, 95) },
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io: IO = new Server(http, { cors: { origin: allowedOrigins }, pingInterval: 10_000, pingTimeout: 8_000 });

  const newCode = () => {
    let code = "";
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    } while (rooms.has(code));
    return code;
  };

  const broadcastMembers = (room: Room) =>
    io.to(room.code).emit("room:members", { members: room.membersView(), hostId: room.hostId, controlMode: room.controlMode });

  const say = (room: Room, text: string) => io.to(room.code).emit("chat:new", room.systemChat(text, Date.now()));

  const closePoll = (room: Room) => {
    const seq = room.playback.seq;
    const playlistLen = room.playlist.length;
    const poll = room.closePoll(Date.now());
    if (!poll) return;
    io.to(room.code).emit("poll:update", poll);
    const winner = poll.options.find((o) => o.id === poll.winnerId);
    say(room, winner ? `Poll "${poll.question}" → ${winner.label}` : `Poll "${poll.question}" ended with no winner`);
    if (room.playback.seq !== seq) io.to(room.code).emit("playback:state", room.playback);
    if (room.playlist.length !== playlistLen) io.to(room.code).emit("playlist:update", { playlist: room.sortedPlaylist() });
  };

  const launch = (room: Room) => {
    const state = room.launchCountdown(Date.now());
    io.to(room.code).emit("ready:update", room.readyView());
    io.to(room.code).emit("playback:state", state);
  };

  io.on("connection", (socket: Sock) => {
    /** Wrap a handler so a malformed payload can never crash the server. */
    const on = <E extends keyof ClientToServerEvents>(event: E, fn: (room: Room, memberId: string, ...args: Parameters<ClientToServerEvents[E]>) => void) => {
      socket.on(event as any, (...args: any[]) => {
        try {
          const { roomCode, memberId } = socket.data;
          const room = roomCode ? rooms.get(roomCode) : undefined;
          if (!room || !memberId) return;
          fn(room, memberId, ...(args as Parameters<ClientToServerEvents[E]>));
        } catch (err) {
          console.error(`handler ${String(event)} failed`, err);
        }
      });
    };

    socket.on("time:ping", (p, ack) => {
      if (typeof ack === "function") ack({ t0: p?.t0, ts: Date.now() });
    });

    socket.on("room:create", (_p, ack) => {
      if (typeof ack !== "function") return;
      const code = newCode();
      const room = new Room(code, Date.now());
      room.emptySince = Date.now(); // until someone joins
      rooms.set(code, room);
      ack({ roomCode: code });
    });

    socket.on("room:join", (p, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const code = String(p?.roomCode ?? "").toUpperCase().trim();
      const memberId = String(p?.memberId ?? "").slice(0, 64);
      const room = rooms.get(code);
      if (!room) return reply({ ok: false, error: "Room not found. Check the code, or it may have expired." });
      if (!memberId) return reply({ ok: false, error: "Missing member id" });

      // Leave a previous room if this socket was elsewhere.
      if (socket.data.roomCode && socket.data.roomCode !== code) socket.leave(socket.data.roomCode);

      const now = Date.now();
      const firstEver = room.members.size === 0;
      const { member, isNew, isReturning } = room.join(memberId, String(p?.name ?? "Guest"), now);
      member.socketId = socket.id;
      socket.data = { roomCode: code, memberId };
      socket.join(code);

      const catchUp = isReturning ? room.catchUp(memberId, now, true) : isNew && !firstEver ? room.catchUp(memberId, now, false) : null;
      reply({ ok: true });
      socket.emit("room:snapshot", room.snapshot(memberId, now, catchUp));
      broadcastMembers(room);
      if (isNew) say(room, `${member.name} joined`);
      else if (isReturning) say(room, `${member.name} reconnected`);
    });

    socket.on("disconnect", () => {
      const { roomCode, memberId } = socket.data;
      const room = roomCode ? rooms.get(roomCode) : undefined;
      if (!room || !memberId) return;
      const member = room.members.get(memberId);
      if (!member || member.socketId !== socket.id) return; // a newer socket already took over
      room.leave(memberId, Date.now());
      broadcastMembers(room);
      if (room.allReady()) launch(room);
      if (memberId === room.hostId) {
        later(HOST_GRACE_MS, () => {
          const m = room.members.get(memberId);
          if (room.hostId !== memberId || (m && m.online)) return; // came back in time
          const next = room.pickNewHost();
          if (!next) return; // nobody online; keep host until someone returns
          room.hostId = next;
          say(room, `${room.members.get(next)!.name} is now the host`);
          broadcastMembers(room);
        });
      }
    });

    on("control:request", (room, memberId, req) => {
      const res = room.applyControl(memberId, req, Date.now());
      if (res.ok) io.to(room.code).emit("playback:state", res.state);
      else socket.emit("control:rejected", { clientActionId: req?.clientActionId ?? "", reason: res.reason });
    });

    on("host:transfer", (room, memberId, p) => {
      if (room.transferHost(memberId, p?.toMemberId)) {
        say(room, `${room.members.get(room.hostId)!.name} is now the host`);
        broadcastMembers(room);
      }
    });

    on("room:setMode", (room, memberId, p) => {
      if (memberId !== room.hostId || (p?.controlMode !== "host" && p?.controlMode !== "everyone")) return;
      room.controlMode = p.controlMode;
      broadcastMembers(room);
      say(room, p.controlMode === "host" ? "Only the host can control playback now" : "Everyone can control playback now");
    });

    on("chat:send", (room, memberId, p) => {
      const msg = room.addChat(memberId, String(p?.text ?? ""), Date.now());
      if (msg) io.to(room.code).emit("chat:new", msg);
      else socket.emit("toast", { text: "Slow down a little 🙂" });
    });

    on("reaction:send", (room, memberId, p) => {
      const r = room.addReaction(memberId, String(p?.emoji ?? ""), Date.now());
      if (r) io.to(room.code).emit("reaction:new", r);
    });

    const playlistChanged = (room: Room) => io.to(room.code).emit("playlist:update", { playlist: room.sortedPlaylist() });
    on("playlist:add", (room, memberId, p) => room.addToPlaylist(memberId, p?.media) && playlistChanged(room));
    on("playlist:vote", (room, memberId, p) => {
      room.voteItem(memberId, p?.itemId);
      playlistChanged(room);
    });
    on("playlist:remove", (room, memberId, p) => room.removeItem(memberId, p?.itemId) && playlistChanged(room));
    on("playlist:playNext", (room, memberId) => {
      if (!room.canDirect(memberId)) return void socket.emit("toast", { text: "Only the host can do that" });
      const state = room.playNext(Date.now());
      if (!state) return;
      io.to(room.code).emit("playback:state", state);
      playlistChanged(room);
    });

    on("poll:create", (room, memberId, p) => {
      if (!p || !room.createPoll(memberId, p, Date.now())) return void socket.emit("toast", { text: "A poll is already running" });
      io.to(room.code).emit("poll:update", room.poll);
      const pollId = room.poll!.id;
      later(room.poll!.endsAt - Date.now(), () => room.poll?.id === pollId && closePoll(room));
    });

    on("poll:vote", (room, memberId, p) => {
      if (!room.votePoll(memberId, p?.optionId)) return;
      io.to(room.code).emit("poll:update", room.poll);
      if (room.everyoneVoted()) closePoll(room);
    });

    on("ready:start", (room, memberId) => {
      if (!room.startReady(memberId)) return void socket.emit("toast", { text: "Load a video first (and be host if the room is host-only)" });
      io.to(room.code).emit("ready:update", room.readyView());
      say(room, `${room.members.get(memberId)!.name} started a ready check`);
    });

    on("ready:toggle", (room, memberId, p) => {
      room.toggleReady(memberId, !!p?.ready);
      io.to(room.code).emit("ready:update", room.readyView());
      if (room.allReady()) launch(room);
    });

    on("ready:force", (room, memberId) => {
      if (room.ready.active && room.canDirect(memberId)) launch(room);
    });

    on("ready:cancel", (room, memberId) => {
      if (!room.canDirect(memberId)) return;
      room.ready = { active: false, ready: new Set() };
      io.to(room.code).emit("ready:update", room.readyView());
    });

    on("stats:report", (room, memberId, p) => {
      const m = room.members.get(memberId);
      if (!m) return;
      m.driftMs = typeof p?.driftMs === "number" ? Math.round(p.driftMs) : null;
      m.rttMs = typeof p?.rttMs === "number" ? Math.round(p.rttMs) : null;
      if (m.driftMs !== null && room.playback.isPlaying) {
        driftLog.push({ at: Date.now(), room: room.code, driftMs: m.driftMs, rttMs: m.rttMs });
        if (driftLog.length > 50_000) driftLog.splice(0, 10_000);
      }
    });
  });

  // Push everyone's drift/RTT to their room every 2 s (powers the Sync-Health panel).
  const healthTimer = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.onlineMembers().length === 0) continue;
      io.to(room.code).emit("room:health", {
        entries: room.onlineMembers().map((m) => ({ id: m.id, driftMs: m.driftMs, rttMs: m.rttMs })),
      });
    }
  }, 2000);

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) rooms.delete(code);
      else room.pruneMembers(now, OFFLINE_MEMBER_TTL_MS);
    }
  }, 60_000);

  return new Promise((resolve) => {
    http.listen(port, () => {
      const addr = http.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        io,
        http,
        rooms,
        port: actualPort,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(healthTimer);
            clearInterval(cleanupTimer);
            timers.forEach(clearTimeout);
            io.close(() => done());
          }),
      });
    });
  });
}
