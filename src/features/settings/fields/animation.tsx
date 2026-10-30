import { Field } from "../../../components/ui/Field";
import { Segmented, type SegmentOption } from "../../../components/ui/Segmented";
import { Slider } from "../../../components/ui/Slider";
import { fmt, useMessages } from "../../../i18n";
import { useSettingsStore, type AnimKey } from "../../../stores/settingsStore";
import { modelFor, useSystemStore } from "../../../stores/systemStore";
import type { Enhance, Style } from "../../../types";
import { formatScale } from "../../../utils/format";
import { useSettings } from "./shared";

const ANIM_SCALES = [1, 1.6, 2, 4];

export function AnimScaleField({ which, source }: { which: AnimKey; source?: { w: number; h: number } }) {
  const t = useMessages();
  const a = useSettings()[which];
  const setAnim = useSettingsStore((st) => st.setAnim);
  const opts: SegmentOption<number>[] = ANIM_SCALES.map((v) => ({ value: v, label: v === 1 ? t.controls.scaleOriginal : formatScale(v) }));
  const even = (n: number) => (which === "clip" ? Math.max(2, Math.floor(n / 2) * 2) : n);
  const aside =
    source && a.scale !== 1
      ? fmt(t.controls.resultSize, { from: `${source.w}×${source.h}`, to: `${even(Math.round(source.w * a.scale))}×${even(Math.round(source.h * a.scale))}` })
      : undefined;
  return (
    <Field label={t.controls.scale} aside={aside} help="scale">
      <Segmented ariaLabel={t.controls.scale} value={a.scale} options={opts} onChange={(scale) => setAnim(which, { scale })} />
    </Field>
  );
}

/** GIF: None (resize only) or waifu2x clean-up at three strengths. */
export function GifEnhanceField() {
  const t = useMessages();
  const a = useSettings().gif;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const value = a.enhance === "sharpen" ? "off" : a.enhance;
  const opts: SegmentOption<Enhance>[] = [
    { value: "off", label: t.controls.enhanceNone },
    { value: "light", label: t.controls.enhanceLow },
    { value: "medium", label: t.controls.enhanceMedium },
    { value: "strong", label: t.controls.enhanceHigh },
  ];
  return (
    <Field label={t.controls.enhance} help="enhance">
      <Segmented ariaLabel={t.controls.enhance} size="sm" value={value} options={opts} onChange={(enhance) => setAnim("gif", { enhance })} />
    </Field>
  );
}

/** Clip: Off / Sharpen (fast, FFmpeg) / Clean-up (waifu2x, slow) with a strength. */
export function ClipEnhanceField() {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const mode = a.enhance === "off" || a.enhance === "sharpen" ? a.enhance : "cleanup";
  return (
    <>
      <Field label={t.controls.enhance} help="enhance">
        <Segmented
          ariaLabel={t.controls.enhance}
          size="sm"
          value={mode}
          options={[
            { value: "off", label: t.controls.enhanceNone },
            { value: "sharpen", label: t.controls.enhanceSharpen },
            { value: "cleanup", label: t.controls.enhanceCleanup },
          ]}
          onChange={(m) => setAnim("clip", { enhance: m === "cleanup" ? "light" : (m as Enhance) })}
        />
      </Field>
      {mode === "cleanup" && (
        <Field label={t.controls.cleanupLevel} hint={t.controls.slowWarning}>
          <Segmented
            ariaLabel={t.controls.cleanupLevel}
            size="sm"
            value={a.enhance}
            options={[
              { value: "light", label: t.controls.enhanceLow },
              { value: "medium", label: t.controls.enhanceMedium },
              { value: "strong", label: t.controls.enhanceHigh },
            ]}
            onChange={(enhance) => setAnim("clip", { enhance })}
          />
        </Field>
      )}
    </>
  );
}

export function CleanupStyleField({ which }: { which: AnimKey }) {
  const t = useMessages();
  const a = useSettings()[which];
  const setAnim = useSettingsStore((st) => st.setAnim);
  const status = useSystemStore((st) => st.status);
  const opts: SegmentOption<Style>[] = (
    [
      ["artworkFast", t.controls.styleArtworkFast],
      ["artwork", t.controls.styleArtwork],
      ["photo", t.controls.stylePhoto],
    ] as const
  ).map(([value, label]) => ({ value, label, disabled: !modelFor(status, value)?.installed, disabledReason: t.controls.unavailableModel }));
  return (
    <Field label={t.controls.cleanupStyle} help="style">
      <Segmented ariaLabel={t.controls.cleanupStyle} size="sm" value={a.style} options={opts} onChange={(style) => setAnim(which, { style })} />
    </Field>
  );
}

const FPS_CHOICES: Record<AnimKey, number[]> = { gif: [15, 24, 30, 50], clip: [24, 30, 60] };

export function FpsField({ which, sourceFps }: { which: AnimKey; sourceFps?: number }) {
  const t = useMessages();
  const a = useSettings()[which];
  const setAnim = useSettingsStore((st) => st.setAnim);
  const original = sourceFps ? `${t.controls.fpsOriginal} · ${Math.round(sourceFps * 100) / 100}` : t.controls.fpsOriginal;
  const opts: SegmentOption<number>[] = [{ value: 0, label: original }, ...FPS_CHOICES[which].map((f) => ({ value: f, label: String(f) }))];
  const changes = a.fps !== null && (!sourceFps || Math.abs(a.fps - sourceFps) > 0.01);
  return (
    <>
      <Field label={t.controls.fps} help="fps" hint={which === "gif" ? t.controls.fpsGifMax : undefined}>
        <Segmented ariaLabel={t.controls.fps} size="sm" value={a.fps ?? 0} options={opts} onChange={(f) => setAnim(which, { fps: f === 0 ? null : f })} />
      </Field>
      {changes && (
        <Field
          label={t.controls.fpsMode}
          aside={sourceFps ? fmt(t.controls.fpsSummary, { from: Math.round(sourceFps * 100) / 100, to: a.fps ?? "" }) : undefined}
          hint={a.fpsMode === "retime" ? t.controls.fpsRetimeNote : t.controls.fpsSmoothNote}
        >
          <Segmented
            ariaLabel={t.controls.fpsMode}
            size="sm"
            value={a.fpsMode}
            options={[
              { value: "retime", label: t.controls.fpsRetime },
              { value: "interpolate", label: t.controls.fpsSmooth },
            ]}
            onChange={(fpsMode) => setAnim(which, { fpsMode })}
          />
        </Field>
      )}
    </>
  );
}

export function MotionBlurField({ which }: { which: AnimKey }) {
  const t = useMessages();
  const a = useSettings()[which];
  const setAnim = useSettingsStore((st) => st.setAnim);
  return (
    <Field label={t.controls.motionBlur} help="blur">
      <Slider
        label={t.controls.motionBlur}
        min={0}
        max={100}
        step={5}
        value={a.motionBlur}
        format={(v) => (v === 0 ? t.controls.off : `${v}%`)}
        onChange={(motionBlur) => setAnim(which, { motionBlur })}
      />
    </Field>
  );
}

export function EncoderField() {
  const t = useMessages();
  const { videoEncoder, clipCompress } = useSettings();
  const update = useSettingsStore((st) => st.update);
  const ff = useSystemStore((st) => st.status?.ffmpeg);
  const names = { nvenc: "NVIDIA NVENC", amf: "AMD AMF", qsv: "Intel Quick Sync" } as const;
  const hw = ff?.encoders[0];
  const hint =
    clipCompress.maxSize !== null
      ? t.controls.encoderLimit
      : videoEncoder === "auto"
        ? hw
          ? fmt(t.controls.encoderUsing, { name: names[hw] })
          : ff?.detected
            ? t.controls.encoderNone
            : undefined
        : undefined;
  return (
    <Field label={t.controls.encoder} hint={hint}>
      <Segmented
        ariaLabel={t.controls.encoder}
        size="sm"
        value={videoEncoder}
        options={[
          { value: "auto", label: t.controls.encoderAuto },
          { value: "cpu", label: t.controls.encoderCpu },
        ]}
        onChange={(v) => update((st) => ({ ...st, videoEncoder: v }))}
      />
    </Field>
  );
}
