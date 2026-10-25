// Mirrors the backend's engine planning rules (src-tauri/src/engine/plan.rs) so
// the UI can disable options that the installed models cannot execute.
import type { ModelCapabilities, OutputFormat } from "../types";

export const SCALES = [1, 1.6, 2, 4, 8] as const;
export const NOISE_LEVELS = [-1, 0, 1, 2, 3] as const;
export const WEBP_MAX_SIDE = 16383;

export type Unavailable = "model" | "noop" | "webp" | null;

function canScale2(caps: ModelCapabilities, noise: number): boolean {
  return noise < 0 ? caps.scale2 : Boolean(caps.noiseScale2[noise]);
}

/** Why this (scale, noise) pair cannot run, or null when it can. */
export function comboUnavailable(caps: ModelCapabilities | undefined, scale: number, noise: number): Unavailable {
  if (!caps?.installed) return "model";
  if (scale === 1) {
    if (noise < 0) return "noop";
    return caps.noiseScale1[noise] || canScale2(caps, noise) ? null : "model";
  }
  return canScale2(caps, noise) ? null : "model";
}

export function formatUnavailable(format: OutputFormat, width: number, height: number): Unavailable {
  return format === "webp" && Math.max(width, height) > WEBP_MAX_SIDE ? "webp" : null;
}
