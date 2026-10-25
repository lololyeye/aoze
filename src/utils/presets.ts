// One-click presets. Each one rewrites real settings; the UI shows "Custom"
// whenever the current settings match none of them.
import type { Settings } from "../types";

export type PresetKind = "image" | "gif" | "clip";
export type PresetId = "anime" | "edit" | "quality" | "small";

const NEUTRAL = { exposure: 0, contrast: 0, saturation: 0, sharpness: 0 };

interface Preset {
  id: PresetId;
  apply: (s: Settings) => Settings;
}

const IMAGE: Preset[] = [
  {
    id: "anime",
    apply: (s) => ({
      ...s,
      imageAction: "improve",
      upscale: { ...s.upscale, style: "artwork", scale: 2, noise: 1, tta: false },
      output: { ...s.output, format: "png" },
    }),
  },
  {
    id: "quality",
    apply: (s) => ({
      ...s,
      imageAction: "improve",
      upscale: { ...s.upscale, scale: 2, noise: 1, tta: true },
      output: { ...s.output, format: "png" },
    }),
  },
  {
    id: "small",
    apply: (s) => ({
      ...s,
      imageAction: "compress",
      output: { ...s.output, format: "webp", webpLossless: false },
      imageCompress: { ...s.imageCompress, level: "small" },
    }),
  },
];

const GIF: Preset[] = [
  {
    id: "anime",
    apply: (s) => ({
      ...s,
      gif: { ...s.gif, scale: 2, enhance: "medium", style: "artworkFast", fps: null, motionBlur: 0 },
      gifCompress: { ...s.gifCompress, level: "best" },
    }),
  },
  {
    id: "quality",
    apply: (s) => ({
      ...s,
      gif: { ...s.gif, scale: 2, enhance: "medium", style: "artwork", fps: null, motionBlur: 0 },
      gifCompress: { ...s.gifCompress, level: "best" },
    }),
  },
  {
    id: "small",
    apply: (s) => ({
      ...s,
      gif: { ...s.gif, scale: 1, enhance: "off", fps: 15, fpsMode: "retime", motionBlur: 0 },
      gifCompress: { ...s.gifCompress, level: "small" },
    }),
  },
];

const CLIP: Preset[] = [
  {
    id: "anime",
    apply: (s) => ({
      ...s,
      clip: { ...s.clip, scale: 2, enhance: "light", style: "artworkFast", fps: null, smooth: "off", motionBlur: 0, look: NEUTRAL },
      clipCompress: { ...s.clipCompress, level: "balanced" },
    }),
  },
  {
    // Edits: crisp, real 60 FPS, a touch of blur and colour. Nothing pushed far.
    id: "edit",
    apply: (s) => ({
      ...s,
      clip: { ...s.clip, scale: 1, enhance: "sharpen", fps: 60, smooth: "medium", motionBlur: 25, look: { exposure: 0, contrast: 6, saturation: 10, sharpness: 0 } },
      clipCompress: { ...s.clipCompress, level: "balanced" },
    }),
  },
  {
    id: "quality",
    apply: (s) => ({
      ...s,
      clip: { ...s.clip, scale: 2, enhance: "sharpen", fps: null, smooth: "off", motionBlur: 0, look: NEUTRAL },
      clipCompress: { ...s.clipCompress, level: "best" },
    }),
  },
  {
    id: "small",
    apply: (s) => ({
      ...s,
      clip: { ...s.clip, scale: 1, enhance: "off", fps: null, smooth: "off", motionBlur: 0, look: NEUTRAL },
      clipCompress: { ...s.clipCompress, level: "small" },
    }),
  },
];

export const PRESETS: Record<PresetKind, Preset[]> = { image: IMAGE, gif: GIF, clip: CLIP };

/** The part of the settings presets of this kind act on. */
function slice(s: Settings, kind: PresetKind): unknown {
  if (kind === "image") return [s.imageAction, s.upscale, s.output.format, s.output.webpLossless, s.imageCompress.level];
  if (kind === "gif") return [s.gif, s.gifCompress.level];
  return [s.clip, s.clipCompress.level];
}

export function applyPreset(s: Settings, kind: PresetKind, id: PresetId): Settings {
  const p = PRESETS[kind].find((x) => x.id === id);
  return p ? p.apply(s) : s;
}

/** The preset the current settings correspond to, or null ("Custom"). */
export function activePreset(s: Settings, kind: PresetKind): PresetId | null {
  const current = JSON.stringify(slice(s, kind));
  return PRESETS[kind].find((p) => JSON.stringify(slice(p.apply(s), kind)) === current)?.id ?? null;
}
