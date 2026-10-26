// Speed curves, as the backend computes them (src-tauri/src/timemap.rs):
// points over the clip, eased in log space between them.
import type { SpeedSettings } from "../types";

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

type Point = [number, number];

/** (position 0..1 of the clip, speed) points, or null for normal speed. */
export function speedPoints(s: SpeedSettings): Point[] | null {
  switch (s.preset) {
    case "normal":
      return null;
    case "slow":
      return [[0, 0.5], [1, 0.5]];
    case "fast":
      return [[0, 2], [1, 2]];
    case "ramp":
      return [[0, 1], [0.3, 1], [0.42, 0.4], [0.58, 0.4], [0.68, 2], [0.86, 2], [1, 1]];
    case "custom": {
      if (s.curve.every((v) => Math.abs(v - 1) < 1e-3)) return null;
      return s.curve.map((v, i): Point => [i / (s.curve.length - 1), Math.min(SPEED_MAX, Math.max(SPEED_MIN, v))]);
    }
  }
}

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export function speedAt(points: Point[], p: number): number {
  const x = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i + 1 < points.length && points[i + 1]![0] <= x) i++;
  const a = points[i]!;
  const b = points[i + 1];
  if (!b) return a[1];
  const t = smoothstep((x - a[0]) / Math.max(1e-9, b[0] - a[0]));
  return Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * t);
}

/** Length of the result for a source of `seconds`. */
export function outputSeconds(s: SpeedSettings, seconds: number): number {
  const pts = speedPoints(s);
  if (!pts) return seconds;
  const steps = 400;
  let total = 0;
  for (let i = 0; i < steps; i++) total += seconds / steps / speedAt(pts, (i + 0.5) / steps);
  return total;
}

/** Slowest speed of the curve (1 when normal). */
export function slowest(s: SpeedSettings): number {
  const pts = speedPoints(s);
  return pts ? Math.min(...pts.map((p) => p[1])) : 1;
}

/** Result time -> original time, from the backend's timing pairs. */
export function sourceTime(timing: Point[], t: number): number {
  const first = timing[0];
  const last = timing[timing.length - 1];
  if (!first || !last) return t;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  let lo = 0;
  let hi = timing.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timing[mid]![0] <= t) lo = mid;
    else hi = mid;
  }
  const a = timing[lo]!;
  const b = timing[hi]!;
  const f = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * f;
}
