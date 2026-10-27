import { describe, expect, it } from "vitest";
import { correction, HARD_DRIFT, timeMap } from "./clipSync";

describe("timeMap", () => {
  it("is the identity without a speed change", () => {
    const m = timeMap(null);
    expect(m.toOriginal(3.2)).toBe(3.2);
    expect(m.toResult(3.2)).toBe(3.2);
    expect(m.rateAt(1)).toBe(1);
  });

  it("maps both ways with a speed change", () => {
    // Result 0-4 s plays original 0-2 s (slow 0.5×), then 4-5 s plays 2-4 s (fast 2×).
    const m = timeMap([
      [0, 0],
      [4, 2],
      [5, 4],
    ]);
    expect(m.toOriginal(2)).toBeCloseTo(1);
    expect(m.toOriginal(4.5)).toBeCloseTo(3);
    expect(m.toResult(1)).toBeCloseTo(2);
    expect(m.toResult(3)).toBeCloseTo(4.5);
    expect(m.toResult(m.toOriginal(3.7))).toBeCloseTo(3.7);
    expect(m.rateAt(1)).toBeCloseTo(0.5);
    expect(m.rateAt(4.2)).toBeCloseTo(2);
  });
});

describe("correction", () => {
  it("leaves a follower within a frame alone", () => {
    expect(correction(0.005, 1)).toEqual({ seek: false, rate: 1 });
  });

  it("catches up a small drift by speed, never by a seek", () => {
    const behind = correction(0.05, 1);
    const ahead = correction(-0.05, 1);
    expect(behind.seek).toBe(false);
    expect(behind.rate).toBeGreaterThan(1);
    expect(behind.rate).toBeLessThanOrEqual(1.1);
    expect(ahead.rate).toBeLessThan(1);
    expect(ahead.rate).toBeGreaterThanOrEqual(0.9);
  });

  it("jumps when far off", () => {
    expect(correction(HARD_DRIFT + 0.01, 1).seek).toBe(true);
    expect(correction(-2, 1).seek).toBe(true);
  });

  it("keeps the speed curve as the base and stays in a playable range", () => {
    expect(correction(0, 0.5).rate).toBe(0.5);
    expect(correction(0.1, 4).rate).toBe(4);
    expect(correction(0, Number.NaN).rate).toBe(1);
  });
});
