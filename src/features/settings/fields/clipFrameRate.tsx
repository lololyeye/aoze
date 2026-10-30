import { RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field } from "../../../components/ui/Field";
import { Segmented, type SegmentOption } from "../../../components/ui/Segmented";
import { Slider } from "../../../components/ui/Slider";
import { fmt, useMessages } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useSystemStore } from "../../../stores/systemStore";
import type { HdrMode, Look, MediaInfo } from "../../../types";
import { useSettings } from "./shared";

const CLIP_FPS = [24, 30, 48, 60, 120];
/** Matches smooth::MAX_FACTOR in the backend. */
export const SMOOTH_MAX_FACTOR = 8;

/** Smooth Motion needs RIFE and a Vulkan GPU (the CPU fallback is far too slow for clips). */
export function useSmoothAvailable(): boolean {
  const status = useSystemStore((st) => st.status);
  const gpu = useSettingsStore((st) => st.settings?.upscale.gpu ?? null);
  return Boolean(status?.smoothMotion && status.vulkan.available && gpu !== -1);
}

/** A rate Smooth Motion will actually create from this source. */
function smoothTarget(fps: number | null, sourceFps?: number): boolean {
  return fps !== null && sourceFps !== undefined && fps > sourceFps + 0.5;
}

/**
 * Clip frame rate. Rates below the source drop frames; rates above it are only
 * offered when Smooth Motion can create the new frames.
 */
export function ClipFpsField({ sourceFps }: { sourceFps?: number }) {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const available = useSmoothAvailable();
  const src = sourceFps ?? 0;
  const original = sourceFps ? `${t.controls.fpsOriginal} · ${Math.round(sourceFps * 100) / 100}` : t.controls.fpsOriginal;
  const choices = CLIP_FPS.filter((f) => !sourceFps || Math.abs(f - src) > 0.5).filter((f) => !sourceFps || f < src || (available && f <= src * SMOOTH_MAX_FACTOR));
  const opts: SegmentOption<number>[] = [{ value: 0, label: original }, ...choices.map((f) => ({ value: f, label: String(f) }))];
  const value = a.fps !== null && choices.includes(a.fps) ? a.fps : 0;
  const pick = (f: number) => {
    const fps = f === 0 ? null : f;
    // Going above the source means making frames: switch Smooth Motion on.
    const smooth = smoothTarget(fps, sourceFps) && a.smooth === "off" ? "medium" : a.smooth;
    setAnim("clip", { fps, smooth });
  };
  const hint =
    value === 0 || !sourceFps
      ? available
        ? t.controls.fpsAboveNote
        : undefined
      : value > src
        ? fmt(t.controls.fpsSmoothSummary, { from: Math.round(src * 100) / 100, to: value })
        : t.controls.fpsDropNote;
  return (
    <Field label={t.controls.fps} help="fps" hint={hint}>
      <Segmented ariaLabel={t.controls.fps} size="sm" value={value} options={opts} onChange={pick} />
    </Field>
  );
}

export function HdrField({ media }: { media?: MediaInfo }) {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const available = useSmoothAvailable();
  const srcHdr = media?.transfer === "pq" || media?.transfer === "hlg";
  // Clean-up and Smooth Motion work on 8-bit images (see the backend).
  const frames = a.enhance === "light" || a.enhance === "medium" || a.enhance === "strong" || (available && a.smooth !== "off" && smoothTarget(a.fps, media?.fps));
  const n = t.controls.hdrNotes;
  let note: string | undefined;
  if (media) {
    if (a.hdr === "off") note = srcHdr ? n.offHdr : n.offSdr;
    else if (a.hdr === "auto") note = srcHdr ? (frames ? n.autoHdrFrames : n.autoHdr) : n.autoSdr;
    else note = srcHdr ? (frames ? n.enhancedHdrFrames : n.enhancedHdr) : n.enhancedSdr;
  }
  const source = media ? (srcHdr ? fmt(t.controls.hdrSourceHdr, { kind: media.transfer === "pq" ? "HDR10 / PQ" : "HLG" }) : t.controls.hdrSourceSdr) : undefined;
  const opts: SegmentOption<HdrMode>[] = [
    { value: "off", label: t.controls.hdrOff },
    { value: "auto", label: t.controls.hdrAuto },
    { value: "enhanced", label: t.controls.hdrEnhanced },
  ];
  return (
    <Field label={t.controls.hdr} help="hdr" aside={source} hint={note}>
      <Segmented ariaLabel={t.controls.hdr} size="sm" value={a.hdr} options={opts} onChange={(hdr) => setAnim("clip", { hdr })} />
    </Field>
  );
}

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

/** Exposure, contrast, saturation and sharpness: all at 0 keeps the original. */
export function LookFields() {
  const t = useMessages();
  const look = useSettings().clip.look;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const set = (p: Partial<Look>) => setAnim("clip", { look: { ...look, ...p } });
  const neutral = !look.exposure && !look.contrast && !look.saturation && !look.sharpness && !look.glow;
  const rows: [Exclude<keyof Look, "glow">, string, number][] = [
    ["exposure", t.controls.lookExposure, -100],
    ["contrast", t.controls.lookContrast, -100],
    ["saturation", t.controls.lookSaturation, -100],
    ["sharpness", t.controls.lookSharpness, 0],
  ];
  return (
    <>
      {rows.map(([key, label, min]) => (
        <Field key={key} label={label}>
          <Slider label={label} min={min} max={100} step={5} value={look[key]} format={(v) => (v === 0 ? t.controls.off : signed(v))} onChange={(v) => set({ [key]: v })} />
        </Field>
      ))}
      {!neutral && (
        <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => set({ exposure: 0, contrast: 0, saturation: 0, sharpness: 0, glow: 0 })}>
          {t.controls.lookReset}
        </Button>
      )}
    </>
  );
}
