// Browser side of the sync design:
//  - estimates the clock offset to the server
//  - applies authoritative playback states (dropping stale ones by seq)
//  - runs the 1 s drift loop (rate nudge for small drift, hard seek for large)
//  - reports drift + RTT so the room can show sync health

import type { PlaybackState } from "@/shared/protocol";
import { correctionFor, estimateOffset, expectedPosition, isCountingDown, shouldApply, type ClockSample } from "@/shared/syncMath";
import type { PlayerAdapter } from "./adapters";
import type { RoomSocket } from "@/lib/socket";

export interface EngineStatus {
  driftMs: number | null;
  rttMs: number | null;
  offsetMs: number;
  needsGesture: boolean;
  countdownMs: number | null;
  correcting: "none" | "rate" | "seek";
}

/** Re-seek on apply only when further than this from where we should be. */
const APPLY_TOLERANCE_SEC = 0.3;

export class SyncEngine {
  offset = 0;
  rtt: number | null = null;
  lastSeq = 0;
  state: PlaybackState | null = null;
  private adapter: PlayerAdapter | null = null;
  private nudging = false;
  private driftMs: number | null = null;
  private needsGesture = false;
  private correcting: EngineStatus["correcting"] = "none";
  private timers: ReturnType<typeof setInterval>[] = [];
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: EngineStatus) => void>();

  constructor(private socket: RoomSocket) {
    this.timers.push(setInterval(() => this.driftCheck(), 1000));
    this.timers.push(setInterval(() => this.report(), 2000));
    this.timers.push(setInterval(() => void this.syncClock(), 30_000));
    this.timers.push(setInterval(() => this.emit(), 250)); // keeps countdown UI fresh
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  async syncClock(samples = 5) {
    if (!this.socket.connected) return;
    const got: ClockSample[] = [];
    for (let i = 0; i < samples; i++) {
      try {
        const t0 = Date.now();
        const r = await this.socket.timeout(2000).emitWithAck("time:ping", { t0 });
        got.push({ t0, ts: r.ts, t1: Date.now() });
      } catch {
        /* lost ping — skip */
      }
    }
    if (!got.length) return;
    const est = estimateOffset(got);
    this.offset = est.offset;
    this.rtt = est.rtt;
  }

  setAdapter(a: PlayerAdapter | null) {
    this.adapter = a;
    this.nudging = false;
    if (a) this.enforce();
  }

  /** Apply a state from the server. `force` is used for snapshots (join/reconnect). */
  applyState(s: PlaybackState, force = false) {
    if (!force && !shouldApply(this.lastSeq, s.seq)) return;
    if (s.seq < this.lastSeq) return;
    this.lastSeq = s.seq;
    this.state = s;
    this.nudging = false;
    this.enforce();
  }

  /** Make the local player match `state` right now. */
  async enforce() {
    const a = this.adapter;
    const s = this.state;
    if (!a || !s || !s.media) return;
    a.setRate(1);
    const now = this.serverNow();
    if (isCountingDown(s, now)) {
      a.pause();
      if (Math.abs(a.getTime() - s.position) > APPLY_TOLERANCE_SEC) a.seek(s.position);
      if (this.countdownTimer) clearTimeout(this.countdownTimer);
      this.countdownTimer = setTimeout(() => void this.enforce(), s.anchorTime - now);
      this.emit();
      return;
    }
    const exp = expectedPosition(s, now);
    if (Math.abs(a.getTime() - exp) > APPLY_TOLERANCE_SEC) a.seek(exp + (s.isPlaying ? a.seekLagSec() : 0));
    if (s.isPlaying) {
      if (a.isPaused()) {
        const ok = await a.play();
        this.needsGesture = !ok;
      }
    } else a.pause();
    this.emit();
  }

  /** Optimistic local apply so the clicker's own action feels instant; the server's state confirms it. */
  local(action: "play" | "pause" | "seek", position?: number) {
    const a = this.adapter;
    if (!a) return;
    if (action === "pause") a.pause();
    else if (action === "play") void a.play();
    else if (position !== undefined) a.seek(position);
  }

  /** Called from a user click on the "tap to join playback" overlay. */
  async unlock() {
    this.needsGesture = false;
    await this.enforce();
  }

  private driftCheck() {
    const a = this.adapter;
    const s = this.state;
    if (!a || !s?.media || !s.isPlaying || isCountingDown(s, this.serverNow()) || a.isStalled() || this.needsGesture) {
      this.driftMs = null;
      this.correcting = "none";
      return;
    }
    if (a.isPaused()) {
      // Someone paused us outside the app (e.g. OS media key) — snap back to the room.
      void this.enforce();
      return;
    }
    const exp = expectedPosition(s, this.serverNow());
    const drift = a.getTime() - exp;
    this.driftMs = drift * 1000;
    const c = correctionFor(drift, a.kind, exp, this.nudging, a.seekLagSec());
    if (c.type === "rate") {
      a.setRate(c.rate);
      this.nudging = true;
    } else if (c.type === "seek") {
      a.seek(c.to);
      a.setRate(1);
      this.nudging = false;
    } else {
      a.setRate(1);
      this.nudging = false;
    }
    this.correcting = c.type;
    this.emit();
  }

  private report() {
    if (this.socket.connected) this.socket.emit("stats:report", { driftMs: this.driftMs, rttMs: this.rtt });
  }

  status(): EngineStatus {
    const s = this.state;
    const now = this.serverNow();
    return {
      driftMs: this.driftMs,
      rttMs: this.rtt,
      offsetMs: this.offset,
      needsGesture: this.needsGesture,
      countdownMs: s && isCountingDown(s, now) ? s.anchorTime - now : null,
      correcting: this.correcting,
    };
  }

  /** Where the room is right now (seconds), for UI like the progress bar. */
  roomPosition() {
    return this.state ? expectedPosition(this.state, this.serverNow()) : 0;
  }

  subscribe(fn: (s: EngineStatus) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    const st = this.status();
    this.listeners.forEach((l) => l(st));
  }

  destroy() {
    this.timers.forEach(clearInterval);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.listeners.clear();
  }
}
