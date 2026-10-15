// Load + failure test: N bot clients join one room and measure
//   1) control propagation latency (p50/p95/p99/max)
//   2) playback drift under clock skew and simulated buffering stalls, with the real correction policy
//   3) consistency: every bot ends with the same seq and state as the server
//
// Usage (from server/):
//   npm run loadtest -- --clients 12 --actions 200
//   npm run loadtest -- --clients 12 --actions 200 --delay 0-300 --disconnect-rate 0.05 --concurrent --label chaos
//   npm run loadtest -- --url http://localhost:4000      (test a separately running server instead of an in-process one)

import { io as connect, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, type StartedServer } from "../src/server";
import { correctionFor, estimateOffset, expectedPosition, isCountingDown, percentile, shouldApply, type ClockSample } from "../src/shared/syncMath";
import type { ClientToServerEvents, PlaybackState, ServerToClientEvents } from "../src/shared/protocol";

// ---------- CLI args ----------
const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? "true" : v;
};
const CLIENTS = Number(arg("clients", "12"));
const ACTIONS = Number(arg("actions", "200"));
const SOAK_SEC = Number(arg("soak", "30"));
const [DELAY_MIN, DELAY_MAX] = (arg("delay", "0-0") as string).split("-").map(Number);
const DISCONNECT_RATE = Number(arg("disconnect-rate", "0"));
const CONCURRENT = arg("concurrent") === "true";
const URL_ARG = arg("url");
const LABEL = arg("label", "baseline")!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const injectDelay = (fn: () => void) => (DELAY_MAX > 0 ? setTimeout(fn, rand(DELAY_MIN, DELAY_MAX)) : fn());

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

// ---------- a simulated viewer ----------
class Bot {
  id = randomUUID();
  socket: Sock;
  offset = 0;
  rtt: number | null = null;
  lastSeq = 0;
  state: PlaybackState | null = null;
  pos = 0;
  playing = false;
  rate = 1;
  skew = 1 + rand(-0.02, 0.02); // this bot's "hardware" plays 2% fast or slow
  stalledUntil = 0;
  nudging = false;
  lastTick = Date.now();
  latencies: number[] = [];
  drifts: number[] = [];
  settled: number[] = []; // drift samples outside recovery episodes
  recoveries: number[] = []; // ms from drift > 500 ms until back under 500 ms
  episodeStart = 0;
  resyncs: number[] = [];
  rejects = 0;
  corrections = { rate: 0, seek: 0 };
  connected = false;
  roomCode = "";
  private reconnectStartedAt = 0;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    url: string,
    public name: string,
  ) {
    this.socket = connect(url, { transports: ["websocket"], reconnection: false, forceNew: true });
    this.socket.on("playback:state", (s) => injectDelay(() => this.applyState(s, false)));
    this.socket.on("room:snapshot", (snap) =>
      injectDelay(() => {
        this.applyState(snap.playback, true);
        if (this.reconnectStartedAt) {
          this.resyncs.push(Date.now() - this.reconnectStartedAt);
          this.reconnectStartedAt = 0;
        }
      }),
    );
    this.socket.on("control:rejected", () => this.rejects++);
    this.socket.on("connect", () => {
      this.connected = true;
      if (this.roomCode) void this.join(this.roomCode); // reconnect → rejoin with the same id
    });
    this.socket.on("disconnect", () => (this.connected = false));
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  async syncClock() {
    const samples: ClockSample[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const r = await this.socket.timeout(3000).emitWithAck("time:ping", { t0 });
      samples.push({ t0, ts: r.ts, t1: Date.now() });
    }
    const est = estimateOffset(samples);
    this.offset = est.offset;
    this.rtt = est.rtt;
  }

  async join(code: string) {
    this.roomCode = code;
    await this.syncClock();
    const r = await this.socket.timeout(5000).emitWithAck("room:join", { roomCode: code, memberId: this.id, name: this.name });
    if (!r.ok) throw new Error(`join failed: ${r.error}`);
  }

  applyState(s: PlaybackState, force: boolean) {
    if (!force && !shouldApply(this.lastSeq, s.seq)) return;
    if (s.seq < this.lastSeq) return; // even a snapshot must not go backwards
    const recvAt = Date.now();
    if (!force && s.requestSentAt && s.causedBy !== this.id) this.latencies.push(recvAt - s.requestSentAt);
    this.lastSeq = s.seq;
    this.state = s;
    const exp = expectedPosition(s, this.serverNow());
    if (Math.abs(this.pos - exp) > 0.3) this.pos = exp + rand(0, 0.05); // a real seek lands a little late
    this.playing = s.isPlaying && !isCountingDown(s, this.serverNow());
    this.rate = 1;
    this.nudging = false;
  }

  /** Advance the fake player. */
  tick() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.state) this.playing = this.state.isPlaying && !isCountingDown(this.state, this.serverNow());
    if (this.playing && now >= this.stalledUntil) this.pos += dt * this.rate * this.skew;
  }

  /** The real drift loop: measure, record, correct. */
  driftCheck() {
    if (!this.state || !this.playing || !this.connected || Date.now() < this.stalledUntil) return;
    const exp = expectedPosition(this.state, this.serverNow());
    const drift = this.pos - exp;
    const absMs = Math.abs(drift) * 1000;
    this.drifts.push(absMs);
    // A "recovery episode" starts when drift exceeds the 500 ms target and ends when it is back under.
    if (absMs > 500) this.episodeStart ||= Date.now();
    else {
      if (this.episodeStart) this.recoveries.push(Date.now() - this.episodeStart);
      this.episodeStart = 0;
      this.settled.push(absMs);
    }
    const c = correctionFor(drift, "html5", exp, this.nudging, 0.03);
    if (c.type === "rate") {
      this.rate = c.rate;
      this.nudging = true;
      this.corrections.rate++;
    } else if (c.type === "seek") {
      this.pos = c.to;
      this.rate = 1;
      this.nudging = false;
      this.corrections.seek++;
    } else {
      this.rate = 1;
      this.nudging = false;
    }
    this.socket.emit("stats:report", { driftMs: drift * 1000, rttMs: this.rtt });
  }

  startLoops() {
    this.timers.push(setInterval(() => this.tick(), 50));
    // Stagger drift checks so bots don't all fire on the same millisecond.
    setTimeout(() => this.timers.push(setInterval(() => this.driftCheck(), 1000)), rand(0, 1000));
  }

  /** Simulate a buffering hiccup. */
  stall(ms: number) {
    this.stalledUntil = Date.now() + ms;
  }

  async flakyReconnect() {
    if (!this.connected) return;
    this.socket.disconnect();
    await sleep(rand(300, 1500));
    this.reconnectStartedAt = Date.now();
    this.socket.connect();
  }

  emitControl(action: "play" | "pause" | "seek" | "load", extra: Record<string, unknown> = {}) {
    const payload = { action, clientActionId: randomUUID(), sentAt: Date.now(), ...extra };
    injectDelay(() => this.socket.emit("control:request", payload as any));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.socket.disconnect();
  }
}

// ---------- the test ----------
async function main() {
  let server: StartedServer | undefined;
  let url = URL_ARG;
  if (!url) {
    server = await startServer(0);
    url = `http://localhost:${server.port}`;
  }
  console.log(`▶ ${LABEL}: ${CLIENTS} clients, ${ACTIONS} actions, soak ${SOAK_SEC}s, delay ${DELAY_MIN}-${DELAY_MAX}ms, disconnect-rate ${DISCONNECT_RATE}, concurrent=${CONCURRENT}, server=${server ? "in-process" : url}`);

  const bots = Array.from({ length: CLIENTS }, (_, i) => new Bot(url!, `bot${i}`));
  await Promise.all(bots.map((b) => new Promise<void>((r) => (b.connected ? r() : b.socket.once("connect", () => r())))));
  const host = bots[0];
  const { roomCode } = await host.socket.timeout(5000).emitWithAck("room:create", { name: host.name, memberId: host.id });
  await host.join(roomCode);
  await Promise.all(bots.slice(1).map((b) => b.join(roomCode)));
  bots.forEach((b) => b.startLoops());

  // Chaos: random disconnects for guests (the host stays so actions keep flowing).
  const chaos = DISCONNECT_RATE
    ? setInterval(() => bots.slice(1).forEach((b) => Math.random() < DISCONNECT_RATE && void b.flakyReconnect()), 1000)
    : undefined;

  host.emitControl("load", { media: { kind: "html5", src: "https://example.org/test.mp4", title: "Test" } });
  await sleep(300);
  host.emitControl("play");
  await sleep(500);

  // Phase 1: propagation latency.
  console.log("  phase 1: control actions…");
  let position = 0;
  for (let i = 0; i < ACTIONS; i++) {
    await sleep(rand(300, 800));
    const kind = ["play", "pause", "seek"][Math.floor(Math.random() * 3)] as "play" | "pause" | "seek";
    if (CONCURRENT && i % 5 === 4) {
      // Three guests click at the same instant: the server must serialise them.
      const [a, b, c] = bots.slice(1, 4);
      a.emitControl("pause");
      b.emitControl("play");
      c.emitControl("seek", { position: rand(0, 500) });
      continue;
    }
    position = kind === "seek" ? rand(0, 500) : position;
    host.emitControl(kind, kind === "seek" ? { position } : {});
  }

  // Phase 2: drift soak — play continuously with skewed clocks + random buffering stalls.
  console.log(`  phase 2: drift soak ${SOAK_SEC}s…`);
  bots.forEach((b) => {
    b.drifts = [];
    b.settled = [];
    b.recoveries = [];
    b.episodeStart = 0;
  });
  host.emitControl("play");
  const stalls = setInterval(() => {
    const b = bots[1 + Math.floor(Math.random() * (bots.length - 1))];
    b.stall(rand(300, 2500));
  }, 1500);
  await sleep(SOAK_SEC * 1000);
  clearInterval(stalls);
  if (chaos) clearInterval(chaos);

  // Phase 3: consistency check.
  await sleep(2500 + DELAY_MAX * 2);
  const reconnectsPending = bots.filter((b) => !b.connected);
  await Promise.all(reconnectsPending.map((b) => new Promise<void>((r) => b.socket.once("connect", () => r()))));
  await sleep(1500 + DELAY_MAX * 2);

  const finalSeqs = new Set(bots.map((b) => b.lastSeq));
  const serverSeq = server?.rooms.get(roomCode)?.playback.seq;
  const consistent = finalSeqs.size === 1 && (serverSeq === undefined || finalSeqs.has(serverSeq));
  const now = Date.now();
  const positions = bots.map((b) => b.pos + (b.playing ? ((now - b.lastTick) / 1000) * b.rate * b.skew : 0));
  const spreadMs = (Math.max(...positions) - Math.min(...positions)) * 1000;

  // ---------- report ----------
  const lat = bots.flatMap((b) => b.latencies);
  const drift = bots.flatMap((b) => b.drifts);
  const settled = bots.flatMap((b) => b.settled);
  const recov = bots.flatMap((b) => b.recoveries);
  const resync = bots.flatMap((b) => b.resyncs);
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "–");
  const mx = (xs: number[]) => (xs.length ? f(Math.max(...xs)) : "–");
  const latP95 = percentile(lat, 95);
  const driftP95 = percentile(settled, 95);
  // The 250 ms target is for a local network. With injected delay we deliberately exceed it,
  // so only drift + consistency are judged in that scenario.
  const latencyJudged = DELAY_MAX === 0;
  const pass = (!latencyJudged || latP95 <= 250) && driftP95 <= 500 && consistent;

  const cpu = os.cpus()[0]?.model.trim() ?? "unknown CPU";
  const md = `## ${LABEL} — ${new Date().toISOString()}

**Conditions:** ${CLIENTS} clients in one room · ${ACTIONS} control actions · ${SOAK_SEC}s drift soak (±2% clock skew per bot, random 0.3–2.5 s buffering stalls every 1.5 s) · injected delay ${DELAY_MIN}–${DELAY_MAX} ms each way · disconnect rate ${DISCONNECT_RATE}/bot/s · concurrent conflicts ${CONCURRENT ? "on" : "off"} · server ${server ? "in-process, localhost" : url}
**Machine:** ${cpu}, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ${os.type()} ${os.release()}, Node ${process.version}

| Metric | p50 | p95 | p99 | max | samples |
|---|---|---|---|---|---|
| Propagation latency (ms) | ${f(percentile(lat, 50))} | **${f(latP95)}** | ${f(percentile(lat, 99))} | ${mx(lat)} | ${lat.length} |
| Drift after correction (ms, abs, settled samples) | ${f(percentile(settled, 50))} | **${f(driftP95)}** | ${f(percentile(settled, 99))} | ${mx(settled)} | ${settled.length} |
| Drift, all samples incl. right after stalls (ms) | ${f(percentile(drift, 50))} | ${f(percentile(drift, 95))} | ${f(percentile(drift, 99))} | ${mx(drift)} | ${drift.length} |
| Recovery time back to ≤ 500 ms (ms) | ${f(percentile(recov, 50))} | ${f(percentile(recov, 95))} | ${f(percentile(recov, 99))} | ${mx(recov)} | ${recov.length} |
| Resync after reconnect (ms) | ${f(percentile(resync, 50))} | ${f(percentile(resync, 95))} | ${f(percentile(resync, 99))} | ${mx(resync)} | ${resync.length} |

- Corrections: ${bots.reduce((a, b) => a + b.corrections.rate, 0)} rate nudges, ${bots.reduce((a, b) => a + b.corrections.seek, 0)} hard seeks
- Rejected control requests (host priority): ${bots.reduce((a, b) => a + b.rejects, 0)}
- Final state consistent across all bots${serverSeq !== undefined ? " and server" : ""}: **${consistent ? "yes" : "NO"}** (seq ${[...finalSeqs].join(", ")}${serverSeq !== undefined ? `, server ${serverSeq}` : ""}); position spread at end ${f(spreadMs)} ms
- Targets: ${latencyJudged ? "latency p95 ≤ 250 ms" : `latency n/a (≈${((DELAY_MIN + DELAY_MAX) / 2) * 2} ms average delay injected on purpose)`}, drift-after-correction p95 ≤ 500 ms, consistent → **${pass ? "PASS ✅" : "FAIL ❌"}**
`;
  console.log("\n" + md);
  const dir = path.resolve(import.meta.dirname, "../../docs/results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${LABEL}.md`);
  writeFileSync(file, md);
  console.log(`saved → ${file}`);

  bots.forEach((b) => b.stop());
  await server?.close();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
