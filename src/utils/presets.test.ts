import { describe, expect, it } from "vitest";
import type { Settings } from "../types";
import { activePreset, applyPreset } from "./presets";

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
  gif: { scale: 1, enhance: "off", style: "artworkFast", fps: null, fpsMode: "retime", motionBlur: 0, smooth: "off", hdr: "auto", look: { exposure: 0, contrast: 0, saturation: 0, sharpness: 0 } },
  gifCompress: { level: "best", quality: 80, maxSize: null, unit: "mb" },
  clip: { scale: 1, enhance: "off", style: "artworkFast", fps: null, fpsMode: "retime", motionBlur: 0, smooth: "off", hdr: "auto", look: { exposure: 0, contrast: 0, saturation: 0, sharpness: 0 } },
  clipCompress: { level: "balanced", quality: 80, maxSize: null, unit: "mb" },
  videoEncoder: "auto",
  checkForUpdates: true,
  lastSeenReleaseNotes: null,
};

describe("presets", () => {
  it("apply real settings and are recognised", () => {
    const s = applyPreset(base, "clip", "edit");
    expect(s.clip).toMatchObject({ fps: 60, smooth: "medium", enhance: "sharpen", motionBlur: 25 });
    expect(s.clip.look.saturation).toBeLessThanOrEqual(20);
    expect(activePreset(s, "clip")).toBe("edit");
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

  it("the plain clip defaults match Small file only when compression is small", () => {
    expect(activePreset(base, "clip")).toBeNull();
  });
});
