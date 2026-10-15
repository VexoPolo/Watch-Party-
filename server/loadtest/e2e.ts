// End-to-end feature check against a running server (default http://localhost:4000).
// Exercises the same events the browser uses. Run: npm run e2e [-- --url http://host:port]

import { io as connect, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import type { ClientToServerEvents, PlaybackState, Poll, ServerToClientEvents, Snapshot } from "../src/shared/protocol";

const i = process.argv.indexOf("--url");
const URL = i > -1 ? process.argv[i + 1] : "http://localhost:4000";
type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

class Client {
  s: Sock;
  id = randomUUID();
  snap: Snapshot | null = null;
  state: PlaybackState | null = null;
  poll: Poll | null = null;
  chats: string[] = [];
  hostId = "";
  constructor(public name: string) {
    this.s = connect(URL, { transports: ["websocket"], forceNew: true });
    this.s.on("room:snapshot", (s) => {
      this.snap = s;
      this.state = s.playback;
      this.hostId = s.hostId;
    });
    this.s.on("playback:state", (p) => (this.state = p));
    this.s.on("poll:update", (p) => (this.poll = p));
    this.s.on("chat:new", (m) => this.chats.push(m.text));
    this.s.on("room:members", (m) => (this.hostId = m.hostId));
  }
  join(code: string) {
    return this.s.timeout(5000).emitWithAck("room:join", { roomCode: code, memberId: this.id, name: this.name });
  }
  control(action: "play" | "pause" | "seek" | "load", extra: object = {}) {
    this.s.emit("control:request", { action, clientActionId: randomUUID(), sentAt: Date.now(), ...extra } as never);
  }
}

async function main() {
  const [a, b, c] = ["Ana", "Ben", "Cy"].map((n) => new Client(n));
  await sleep(500);
  const { roomCode } = await a.s.timeout(5000).emitWithAck("room:create", { name: "Ana", memberId: a.id });
  check("create room", /^[A-Z0-9]{6}$/.test(roomCode), roomCode);
  await a.join(roomCode);
  await b.join(roomCode.toLowerCase());
  const bad = await c.join("ZZZZZZ");
  check("unknown room is rejected", !bad.ok);
  await c.join(roomCode);
  await sleep(300);
  check("first joiner is host", a.hostId === a.id && b.hostId === a.id);

  a.control("load", { media: { kind: "html5", src: "https://example.org/x.mp4", title: "X" } });
  await sleep(200);
  b.control("play"); // within 400 ms of host action → rejected
  await sleep(200);
  check("host priority blocks guest right after host", c.state?.isPlaying === false);
  await sleep(400);
  b.control("play");
  await sleep(300);
  check("guest play propagates to everyone", [a, b, c].every((x) => x.state?.isPlaying && x.state.seq === a.state!.seq), `seq ${a.state?.seq}`);

  b.s.emit("chat:send", { text: "hello room" });
  for (let k = 0; k < 3; k++) c.s.emit("reaction:send", { emoji: "🔥" });
  await sleep(300);
  check("chat reaches everyone", a.chats.includes("hello room") && c.chats.includes("hello room"));

  // Vote-to-skip: 2 of 3 say yes → seek +30 s.
  const before = a.state!;
  b.s.emit("poll:create", { kind: "skip", question: "Skip 30s?", options: ["Yes", "No"], durationSec: 15, action: { type: "seekBy", seconds: 30 } });
  await sleep(300);
  const p = a.poll!;
  a.s.emit("poll:vote", { pollId: p.id, optionId: p.options[0].id });
  b.s.emit("poll:vote", { pollId: p.id, optionId: p.options[0].id });
  c.s.emit("poll:vote", { pollId: p.id, optionId: p.options[1].id });
  await sleep(400);
  const elapsed = (a.state!.anchorTime - before.anchorTime) / 1000;
  check("vote-to-skip passes and seeks +30s", a.poll?.closed === true && Math.abs(a.state!.position - (before.position + elapsed + 30)) < 0.5, `pos ${a.state!.position.toFixed(2)}`);

  // Playlist + play next.
  b.s.emit("playlist:add", { media: { kind: "youtube", src: "aqz-KE-bpKQ", title: "BBB" } });
  await sleep(200);
  a.s.emit("playlist:playNext");
  await sleep(300);
  check("playlist play-next loads for everyone", c.state?.media?.src === "aqz-KE-bpKQ" && c.state.isPlaying);

  // Ready check → synchronized countdown.
  a.control("pause");
  await sleep(500);
  a.s.emit("ready:start");
  await sleep(200);
  for (const x of [a, b, c]) x.s.emit("ready:toggle", { ready: true });
  await sleep(300);
  const anchorLead = c.state!.anchorTime - Date.now();
  check("ready-check launches a shared future start", c.state!.isPlaying && anchorLead > 2000 && anchorLead <= 3000, `starts in ${anchorLead} ms`);

  // Host leaves → after 10 s grace, longest-present member (Ben) becomes host.
  a.s.disconnect();
  console.log("   …waiting out the 10 s host grace period");
  await sleep(10_800);
  check("auto host transfer after grace", b.hostId === b.id && c.hostId === b.id);

  // Ana returns → catch-up card.
  c.s.emit("chat:send", { text: "you missed the best part" });
  await sleep(200);
  a.s.connect();
  await sleep(300);
  await a.join(roomCode);
  await sleep(300);
  check("returning member gets snapshot + catch-up", !!a.snap?.catchUp?.isReturning && a.snap.catchUp.chatCount >= 1, `missed ${a.snap?.catchUp?.missedMs} ms`);
  check("returning member is in sync (same seq)", a.state?.seq === b.state?.seq);

  [a, b, c].forEach((x) => x.s.disconnect());
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
