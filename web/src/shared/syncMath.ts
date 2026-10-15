// Pure sync math shared by the browser, the server and the load test.
// No I/O here, so every rule can be unit-tested.

import type { MediaKind } from "./protocol";

/** Below this drift (seconds) we do nothing — too small to notice. */
export const DRIFT_IGNORE_SEC = 0.15;
/** Once nudging, keep going until drift is below this (avoids flip-flopping at the threshold). */
export const DRIFT_SETTLED_SEC = 0.05;
/** Above this drift an HTML5 player hard-seeks instead of nudging its speed. */
export const HTML5_SEEK_SEC = 1.0;
/** YouTube only offers coarse playback rates, so it seeks at a lower threshold and never nudges. */
export const YOUTUBE_SEEK_SEC = 0.5;
/** Largest playback-rate change we allow (±10% is close to imperceptible). */
export const MAX_RATE_DELTA = 0.1;
/** How strongly we react to drift: rate change per second of drift. */
export const RATE_GAIN = 0.5;

type Anchor = { isPlaying: boolean; position: number; anchorTime: number };

/** Where the video should be right now (seconds), given the server clock in ms. */
export function expectedPosition(s: Anchor, serverNow: number): number {
  if (!s.isPlaying || serverNow < s.anchorTime) return s.position;
  return s.position + (serverNow - s.anchorTime) / 1000;
}

/** True while a scheduled start (e.g. ready-check countdown) has not been reached yet. */
export function isCountingDown(s: Anchor, serverNow: number): boolean {
  return s.isPlaying && serverNow < s.anchorTime;
}

export interface ClockSample {
  t0: number; // client time when ping was sent
  ts: number; // server time when it answered
  t1: number; // client time when the answer arrived
}

/** NTP-style estimate: trust the sample with the smallest round trip. */
export function estimateOffset(samples: ClockSample[]): { offset: number; rtt: number } {
  if (samples.length === 0) throw new Error("estimateOffset needs at least one sample");
  let best = samples[0];
  for (const s of samples) if (s.t1 - s.t0 < best.t1 - best.t0) best = s;
  return { offset: best.ts - (best.t0 + best.t1) / 2, rtt: best.t1 - best.t0 };
}

export type Correction =
  | { type: "none" }
  | { type: "rate"; rate: number }
  | { type: "seek"; to: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Decide how to fix drift.
 * @param drift   actual − expected, in seconds (positive = we are ahead)
 * @param nudging whether we are currently running at a non-1.0 rate
 * @param seekLag average seconds a seek takes to land, added so we land where the room *will* be
 */
export function correctionFor(
  drift: number,
  kind: MediaKind,
  expected: number,
  nudging: boolean,
  seekLag = 0,
): Correction {
  const abs = Math.abs(drift);
  const seekAt = kind === "youtube" ? YOUTUBE_SEEK_SEC : HTML5_SEEK_SEC;
  if (abs > seekAt) return { type: "seek", to: round3(expected + seekLag) };
  if (kind === "youtube") return { type: "none" };
  const threshold = nudging ? DRIFT_SETTLED_SEC : DRIFT_IGNORE_SEC;
  if (abs < threshold) return { type: "none" };
  return { type: "rate", rate: round3(1 - clamp(drift * RATE_GAIN, -MAX_RATE_DELTA, MAX_RATE_DELTA)) };
}

/** Each playback state is complete, so we only need to drop stale/duplicate ones. */
export function shouldApply(lastSeq: number, incomingSeq: number): boolean {
  return incomingSeq > lastSeq;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}
