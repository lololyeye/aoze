import { describe, expect, it } from "vitest";
import type { Settings } from "../types";
import { en } from "../i18n/en";
import { activePreset, applyPreset, clipSummary } from "./presets";
import { outputSeconds, sourceTime } from "./speed";

const base: Settings = {
  version: 1,
  theme: "dark",
  language: "en",
  notifications: true,
  openFolderWhenDone: true,
  discord: null,
  convert: { gifOutput: "mp4", gifFps: 15, width: 480, frameMs: 500, compress: { level: "balanced", quality: 80, maxSize: null, unit: "mb" } },
  upscale: { style: "photo", scale: 4, noise: 3, gpu: null, tileSize: 0, tta: false, threads: { load: 1, proc: 2, save: 2 } },
  output: { format: "jpeg", quality: 92, webpLossless: false, directory: null, suffix: "_x", conflict: "rename" },
  engineDir: null,
  keepTempFiles: false,
  startupAnimation: true,
  startupSound: true,
  completionSound: true,
  soundVolume: 40,
  performance: { mode: "balanced", autoOptimize: true },
  imageAction: "improve",
  imageCompress: { level: "balanced", quality: 80, maxSize: null, unit: "mb" },
  gif: { scale: 1, enhance: "off", style: "artworkFast", fps: null, fpsMode: "retime", motionBlur: 0, smooth: "off", hdr: "auto", look: { exposure: 0, contrast: 0, saturation: 0, sharpness: 0, glow: 0 }, format: "original", reframe: true, focus: "auto", speed: { preset: "normal", curve: [1, 1, 0.5, 1.5, 1] }, lut: null, lutStrength: 100, beat: { on: false, zoom: true, shake: false } },
  gifCompress: { level: "best", quality: 80, maxSize: null, unit: "mb" },
  clip: { scale: 1, enhance: "off", style: "artworkFast", fps: null, fpsMode: "retime", motionBlur: 0, smooth: "off", hdr: "auto", look: { exposure: 0, contrast: 0, saturation: 0, sharpness: 0, glow: 0 }, format: "original", reframe: true, focus: "auto", speed: { preset: "normal", curve: [1, 1, 0.5, 1.5, 1] }, lut: null, lutStrength: 100, beat: { on: false, zoom: true, shake: false } },
  clipCompress: { level: "balanced", quality: 80, maxSize: null, unit: "mb" },
  videoEncoder: "auto",
  checkForUpdates: true,
  lastSeenReleaseNotes: null,
  tutorialDone: true,
};

describe("presets", () => {
  it("apply real settings and are recognised", () => {
    const s = applyPreset(base, "clip", "animeSmooth");
    expect(s.clip).toMatchObject({ fps: 60, smooth: "medium", enhance: "sharpen", motionBlur: 30 });
    expect(activePreset(s, "clip")).toBe("animeSmooth");
    const c = applyPreset(base, "clip", "cinematic");
    expect(c.clip).toMatchObject({ lut: "builtin:teal-orange", lutStrength: 60, smooth: "off" });
    expect(activePreset(c, "clip")).toBe("cinematic");
    const img = applyPreset(base, "image", "small");
    expect(img.imageAction).toBe("compress");
    expect(img.output.format).toBe("webp");
    expect(activePreset(img, "image")).toBe("small");
  });

  it("report Custom after a manual change", () => {
    const s = applyPreset(base, "gif", "anime");
    expect(activePreset(s, "gif")).toBe("anime");
    expect(activePreset({ ...s, gif: { ...s.gif, motionBlur: 10 } }, "gif")).toBeNull();
  });

  it("only touch their own kind", () => {
    const s = applyPreset(base, "gif", "small");
    expect(s.clip).toEqual(base.clip);
    expect(s.upscale).toEqual(base.upscale);
  });

  it("the plain clip defaults match no preset", () => {
    expect(activePreset(base, "clip")).toBeNull();
  });

  it("clip presets keep the shape, speed and Beat Sync", () => {
    const own = { ...base, clip: { ...base.clip, format: "portrait" as const, speed: { ...base.clip.speed, preset: "ramp" as const }, beat: { on: true, zoom: true, shake: true } } };
    const s = applyPreset(own, "clip", "tiktokSmooth");
    expect(s.clip.format).toBe("portrait");
    expect(s.clip.speed.preset).toBe("ramp");
    expect(s.clip.beat.on).toBe(true);
    expect(activePreset(s, "clip")).toBe("tiktokSmooth");
  });

  it("say what they switch on", () => {
    const lines = clipSummary(en, applyPreset(base, "clip", "cinematic").clip);
    expect(lines.some((l) => l.includes("Teal"))).toBe(true);
    expect(lines.some((l) => l.includes("Glow 20"))).toBe(true);
    expect(clipSummary(en, base.clip)).toEqual([]);
  });
});

describe("speed", () => {
  it("matches the backend's durations", () => {
    expect(outputSeconds({ preset: "slow", curve: [1, 1, 1, 1, 1] }, 4)).toBeCloseTo(8, 3);
    expect(outputSeconds({ preset: "fast", curve: [1, 1, 1, 1, 1] }, 4)).toBeCloseTo(2, 3);
    expect(outputSeconds({ preset: "normal", curve: [1, 1, 1, 1, 1] }, 4)).toBe(4);
    expect(outputSeconds({ preset: "custom", curve: [1, 1, 1, 1, 1] }, 4)).toBe(4);
  });

  it("maps result time to original time", () => {
    const timing: [number, number][] = [[0, 0], [1, 0.5], [2, 1]];
    expect(sourceTime(timing, 1.5)).toBeCloseTo(0.75);
    expect(sourceTime(timing, 9)).toBe(1);
  });
});
