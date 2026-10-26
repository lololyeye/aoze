// One-click presets. Each one rewrites real settings; the UI shows "Custom"
// whenever the current settings match none of them.
import type { Messages } from "../i18n/en";
import type { AnimSettings, Settings } from "../types";

export type PresetKind = "image" | "gif" | "clip";
export type PresetId = "anime" | "edit" | "quality" | "small" | "animeSmooth" | "tiktokSmooth" | "cinematic" | "clean";

const NEUTRAL = { exposure: 0, contrast: 0, saturation: 0, sharpness: 0, glow: 0 };

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

// Clip presets only switch existing options on (the tooltip lists them). They
// leave the shape, speed and Beat Sync alone: those depend on the clip.
const CLIP: Preset[] = [
  {
    // Anime edits: real 60 FPS between the drawings, a light smear, crisp lines.
    id: "animeSmooth",
    apply: (s) => ({
      ...s,
      clip: { ...s.clip, scale: 1, enhance: "sharpen", style: "artworkFast", fps: 60, smooth: "medium", motionBlur: 30, look: NEUTRAL, lut: null },
      clipCompress: { ...s.clipCompress, level: "balanced" },
    }),
  },
  {
    // TikTok / Shorts: 60 FPS and a stronger blur that suits speed ramps.
    id: "tiktokSmooth",
    apply: (s) => ({
      ...s,
      clip: { ...s.clip, scale: 1, enhance: "sharpen", fps: 60, smooth: "medium", motionBlur: 50, look: { ...NEUTRAL, contrast: 6, saturation: 10 }, lut: null },
      clipCompress: { ...s.clipCompress, level: "balanced" },
    }),
  },
  {
    // Film look: teal & orange grade, more contrast, a soft glow. Timing untouched.
    id: "cinematic",
    apply: (s) => ({
      ...s,
      clip: {
        ...s.clip,
        enhance: "off",
        fps: null,
        smooth: "off",
        motionBlur: 0,
        look: { exposure: 0, contrast: 15, saturation: -5, sharpness: 0, glow: 20 },
        lut: "builtin:teal-orange",
        lutStrength: 60,
      },
      clipCompress: { ...s.clipCompress, level: "best" },
    }),
  },
  {
    // Clean: noise and compression removed (Clean-up), a little sharpness.
    id: "clean",
    apply: (s) => ({
      ...s,
      clip: { ...s.clip, scale: 1, enhance: "light", fps: null, smooth: "off", motionBlur: 0, look: { ...NEUTRAL, sharpness: 20 }, lut: null },
      clipCompress: { ...s.clipCompress, level: "best" },
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

/** What a clip setup switches on, in words ("Smooth Motion 60 FPS", "Motion blur 30 %", ...). */
export function clipSummary(t: Messages, c: AnimSettings): string[] {
  const out: string[] = [];
  const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
  if (c.scale !== 1) out.push(`${t.controls.scale} ×${c.scale}`);
  if (c.enhance === "sharpen") out.push(t.controls.enhanceSharpen);
  else if (c.enhance !== "off") out.push(`${t.controls.enhanceCleanup} (${t.controls.cleanupLevel.toLowerCase()} ${({ light: t.controls.enhanceLow, medium: t.controls.enhanceMedium, strong: t.controls.enhanceHigh } as Record<string, string>)[c.enhance] ?? ""})`);
  if (c.smooth !== "off" && c.fps) out.push(`${t.controls.smooth} ${c.fps} FPS`);
  if (c.motionBlur) out.push(`${t.controls.motionBlur} ${c.motionBlur} %`);
  if (c.lut) out.push(`${t.controls.lut}: ${(t.controls.lutBuiltins as Record<string, string>)[c.lut.replace(/^builtin:/, "")] ?? c.lut.replace(/^user:/, "").replace(/\.cube$/, "")} ${c.lutStrength} %`);
  if (c.look.contrast) out.push(`${t.controls.lookContrast} ${signed(c.look.contrast)}`);
  if (c.look.saturation) out.push(`${t.controls.lookSaturation} ${signed(c.look.saturation)}`);
  if (c.look.exposure) out.push(`${t.controls.lookExposure} ${signed(c.look.exposure)}`);
  if (c.look.sharpness) out.push(`${t.controls.lookSharpness} ${c.look.sharpness}`);
  if (c.look.glow) out.push(`${t.controls.glow} ${c.look.glow} %`);
  return out;
}
