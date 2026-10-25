import { describe, expect, it } from "vitest";
import type { ModelCapabilities } from "../types";
import { comboUnavailable, formatUnavailable } from "./capabilities";
import { dirName, fileName, formatBytes, formatDuration, formatScale, targetDims } from "./format";

const caps = (scale1: boolean): ModelCapabilities => ({
  style: "photo",
  dir: "models-upconv_7_photo",
  installed: true,
  scale2: true,
  noiseScale2: [true, true, true, true],
  noiseScale1: [scale1, scale1, scale1, scale1],
  sizeBytes: 0,
});

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatBytes(150 * 1024)).toBe("150 KB");
  });

  it("formats durations", () => {
    expect(formatDuration(480)).toBe("0.5s");
    expect(formatDuration(4800)).toBe("4.8s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(125_000)).toBe("2m 05s");
    expect(formatDuration(3_900_000)).toBe("1h 05m");
  });

  it("computes target dimensions and scales", () => {
    expect(targetDims(1920, 1080, 2)).toEqual([3840, 2160]);
    expect(targetDims(2048, 1365, 1.6)).toEqual([3277, 2184]);
    expect(formatScale(1.6)).toBe("1.6×");
    expect(formatScale(2)).toBe("2×");
  });

  it("splits Windows paths", () => {
    expect(fileName("C:\\My Pics\\a b.png")).toBe("a b.png");
    expect(dirName("C:\\My Pics\\a b.png")).toBe("C:\\My Pics");
  });
});

describe("capabilities", () => {
  it("rejects 1x without denoise", () => {
    expect(comboUnavailable(caps(true), 1, -1)).toBe("noop");
  });

  it("allows 1x denoise via 2x fallback", () => {
    expect(comboUnavailable(caps(false), 1, 2)).toBeNull();
  });

  it("flags missing models", () => {
    const c = caps(true);
    c.noiseScale2[3] = false;
    expect(comboUnavailable(c, 2, 3)).toBe("model");
    expect(comboUnavailable(undefined, 2, 0)).toBe("model");
  });

  it("limits WebP size", () => {
    expect(formatUnavailable("webp", 20000, 10)).toBe("webp");
    expect(formatUnavailable("png", 20000, 10)).toBeNull();
  });
});

describe("suffix", () => {
  it("renders like the backend", async () => {
    const { renderSuffix } = await import("./format");
    expect(renderSuffix("_{style}_{scale}x_noise{noise}", { style: "artwork", scale: 1.6, noise: -1 })).toBe("_art_1.6x_noiseoff");
    expect(renderSuffix("_a:b*?{scale}", { style: "photo", scale: 2, noise: 1 })).toBe("_ab2");
  });
});
