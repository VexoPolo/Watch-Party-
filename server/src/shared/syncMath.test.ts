import { describe, it, expect } from "vitest";
import {
  expectedPosition,
  estimateOffset,
  correctionFor,
  shouldApply,
  isCountingDown,
  percentile,
  DRIFT_IGNORE_SEC,
  DRIFT_SETTLED_SEC,
} from "./syncMath";

describe("expectedPosition", () => {
  it("returns the stored position when paused, no matter how much time passed", () => {
    expect(expectedPosition({ isPlaying: false, position: 42, anchorTime: 1000 }, 99_000)).toBe(42);
  });

  it("advances by elapsed seconds since the anchor when playing", () => {
    expect(expectedPosition({ isPlaying: true, position: 10, anchorTime: 1000 }, 3500)).toBeCloseTo(12.5);
  });

  it("holds at the position during a countdown (anchor in the future)", () => {
    expect(expectedPosition({ isPlaying: true, position: 10, anchorTime: 5000 }, 3000)).toBe(10);
  });
});

describe("isCountingDown", () => {
  it("is true only while playing with a future anchor", () => {
    expect(isCountingDown({ isPlaying: true, position: 0, anchorTime: 5000 }, 4000)).toBe(true);
    expect(isCountingDown({ isPlaying: true, position: 0, anchorTime: 5000 }, 5000)).toBe(false);
    expect(isCountingDown({ isPlaying: false, position: 0, anchorTime: 5000 }, 4000)).toBe(false);
  });
});

describe("estimateOffset", () => {
  it("uses the sample with the lowest round-trip time", () => {
    const samples = [
      { t0: 1000, ts: 6100, t1: 1200 }, // rtt 200, offset 5000
      { t0: 2000, ts: 7020, t1: 2040 }, // rtt 40,  offset 5000
      { t0: 3000, ts: 8300, t1: 3400 }, // rtt 400, offset 5100 (skewed by slow path)
    ];
    const r = estimateOffset(samples);
    expect(r.rtt).toBe(40);
    expect(r.offset).toBe(5000);
  });

  it("produces a negative offset when the client clock is ahead of the server", () => {
    const r = estimateOffset([{ t0: 10_000, ts: 7_010, t1: 10_020 }]);
    expect(r.offset).toBe(-3000);
  });

  it("throws on no samples", () => {
    expect(() => estimateOffset([])).toThrow();
  });
});

describe("correctionFor (html5)", () => {
  const exp = 100;
  it("does nothing just below the ignore threshold", () => {
    expect(correctionFor(0.149, "html5", exp, false)).toEqual({ type: "none" });
    expect(correctionFor(-0.149, "html5", exp, false)).toEqual({ type: "none" });
  });

  it("nudges the rate at the ignore threshold; ahead → slower, behind → faster", () => {
    const ahead = correctionFor(0.15, "html5", exp, false);
    const behind = correctionFor(-0.15, "html5", exp, false);
    expect(ahead.type).toBe("rate");
    expect(behind.type).toBe("rate");
    if (ahead.type === "rate" && behind.type === "rate") {
      expect(ahead.rate).toBeLessThan(1);
      expect(behind.rate).toBeGreaterThan(1);
    }
  });

  it("clamps the rate change to ±10%", () => {
    const c = correctionFor(0.9, "html5", exp, false);
    expect(c).toEqual({ type: "rate", rate: 0.9 });
  });

  it("hard-seeks just above the seek threshold, adding the measured seek lag", () => {
    expect(correctionFor(1.01, "html5", exp, false, 0.08)).toEqual({ type: "seek", to: 100.08 });
  });

  it("keeps nudging below the ignore threshold until drift is settled (hysteresis)", () => {
    expect(correctionFor(0.1, "html5", exp, true).type).toBe("rate");
    expect(correctionFor(DRIFT_SETTLED_SEC - 0.001, "html5", exp, true)).toEqual({ type: "none" });
    expect(DRIFT_SETTLED_SEC).toBeLessThan(DRIFT_IGNORE_SEC);
  });
});

describe("correctionFor (youtube)", () => {
  it("never nudges rate and seeks above 0.5 s", () => {
    expect(correctionFor(0.4, "youtube", 50, false)).toEqual({ type: "none" });
    expect(correctionFor(-0.51, "youtube", 50, false)).toEqual({ type: "seek", to: 50 });
  });
});

describe("shouldApply", () => {
  it("drops stale and duplicate states, accepts newer ones", () => {
    expect(shouldApply(5, 4)).toBe(false);
    expect(shouldApply(5, 5)).toBe(false);
    expect(shouldApply(5, 6)).toBe(true);
    expect(shouldApply(5, 9)).toBe(true); // gaps are fine: every state is complete
  });
});

describe("percentile", () => {
  it("computes nearest-rank percentiles", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 99)).toBe(99);
    expect(percentile([], 50)).toBeNaN();
  });
});
