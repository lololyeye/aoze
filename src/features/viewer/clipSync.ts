// Time mapping and drift correction for the Before / After clip comparison.
// One video is the clock (it carries the sound); the other follows it.
import { sourceTime } from "../../utils/speed";

type Pairs = [number, number][];

/** Maps between result time and original time (identical unless the speed changed). */
export interface TimeMap {
  toOriginal: (resultTime: number) => number;
  toResult: (originalTime: number) => number;
  /** Original seconds per result second around a result time (1 without a speed change). */
  rateAt: (resultTime: number) => number;
}

export function timeMap(timing: Pairs | null | undefined): TimeMap {
  if (!timing?.length) return { toOriginal: (t) => t, toResult: (t) => t, rateAt: () => 1 };
  const inverse = timing.map(([r, o]) => [o, r] as [number, number]);
  const toOriginal = (t: number) => sourceTime(timing, t);
  return {
    toOriginal,
    toResult: (t) => sourceTime(inverse, t),
    rateAt: (t) => (toOriginal(t + 0.25) - toOriginal(t)) / 0.25 || 1,
  };
}

/** Beyond this, the follower jumps instead of catching up. */
export const HARD_DRIFT = 0.3;
/** Under this (about a frame at 60 FPS), nothing is corrected. */
export const SOFT_DRIFT = 0.016;

/**
 * Correction of a follower `drift` seconds behind (negative: ahead) when its
 * normal speed is `base`: a jump for a large drift, otherwise a speed a few
 * percent off so it catches up without a visible seek.
 */
export function correction(drift: number, base: number): { seek: boolean; rate: number } {
  if (Math.abs(drift) > HARD_DRIFT) return { seek: true, rate: clampRate(base) };
  if (Math.abs(drift) < SOFT_DRIFT) return { seek: false, rate: clampRate(base) };
  const nudge = Math.max(-0.1, Math.min(0.1, drift * 2));
  return { seek: false, rate: clampRate(base * (1 + nudge)) };
}

/** Speeds HTMLMediaElement plays smoothly (and keeps the sound pitch for). */
export function clampRate(r: number): number {
  return Math.min(4, Math.max(0.25, Number.isFinite(r) ? r : 1));
}
