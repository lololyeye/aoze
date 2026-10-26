// Setting controls bound to the settings store. Used both by the workspace
// panels and by the Settings page, so each option has a single implementation.
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Segmented, type SegmentOption } from "../../components/ui/Segmented";
import { Select } from "../../components/ui/Select";
import { Slider } from "../../components/ui/Slider";
import { Toggle } from "../../components/ui/Toggle";
import { fmt, useMessages } from "../../i18n";
import { api, toAppError } from "../../services/api";
import { pickFolder } from "../../services/actions";
import { compressOf, useSettingsStore, type AnimKey, type CompressKey } from "../../stores/settingsStore";
import { modelFor, useSystemStore } from "../../stores/systemStore";
import type { BeatSync, CompressLevel, CompressReport, ConflictPolicy, DiscordTarget, Enhance, Focus, FrameFormat, HdrMode, ImageAction, Job, Look, LutInfo, MediaInfo, OutputFormat, Settings, SizeUnit, SpeedPreset, Style } from "../../types";
import { comboUnavailable, formatUnavailable, NOISE_LEVELS, SCALES } from "../../utils/capabilities";
import { formatBytes, formatScale, renderSuffix } from "../../utils/format";
import { outputSeconds, slowest, speedAt, speedPoints } from "../../utils/speed";
import s from "./fields.module.css";

function useSettings(): Settings {
  const settings = useSettingsStore((st) => st.settings);
  if (!settings) throw new Error("settings not loaded");
  return settings;
}

/* ---------- Images ---------- */

export function ActionField() {
  const t = useMessages();
  const { imageAction } = useSettings();
  const update = useSettingsStore((st) => st.update);
  const opts: SegmentOption<ImageAction>[] = [
    { value: "improve", label: t.controls.actionImprove },
    { value: "compress", label: t.controls.actionCompress },
    { value: "both", label: t.controls.actionBoth },
  ];
  return (
    <Field label={t.controls.action} help="compress">
      <Segmented ariaLabel={t.controls.action} value={imageAction} options={opts} onChange={(a) => update((st) => ({ ...st, imageAction: a }))} />
    </Field>
  );
}

export function StyleField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const status = useSystemStore((st) => st.status);
  const opts: SegmentOption<Style>[] = (
    [
      ["artwork", t.controls.styleArtwork],
      ["artworkFast", t.controls.styleArtworkFast],
      ["photo", t.controls.stylePhoto],
    ] as const
  ).map(([value, label]) => ({ value, label, disabled: !modelFor(status, value)?.installed, disabledReason: t.controls.unavailableModel }));
  return (
    <Field label={t.controls.style} help="style">
      <Segmented ariaLabel={t.controls.style} value={upscale.style} options={opts} onChange={(style) => setUpscale({ style })} />
    </Field>
  );
}

export function ScaleField({ sourceSize }: { sourceSize?: { w: number; h: number } }) {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const caps = modelFor(useSystemStore((st) => st.status), upscale.style);
  const opts: SegmentOption<number>[] = SCALES.map((scale) => {
    const why = comboUnavailable(caps, scale, upscale.noise);
    return {
      value: scale,
      label: formatScale(scale),
      disabled: why !== null,
      disabledReason: why === "noop" ? t.controls.unavailable1x : t.controls.unavailableModel,
    };
  });
  const aside = sourceSize
    ? fmt(t.controls.resultSize, {
        from: `${sourceSize.w}×${sourceSize.h}`,
        to: `${Math.round(sourceSize.w * upscale.scale)}×${Math.round(sourceSize.h * upscale.scale)}`,
      })
    : undefined;
  return (
    <Field label={t.controls.scale} aside={aside} help="scale">
      <Segmented ariaLabel={t.controls.scale} value={upscale.scale} options={opts} onChange={(scale) => setUpscale({ scale })} />
    </Field>
  );
}

export function NoiseField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const caps = modelFor(useSystemStore((st) => st.status), upscale.style);
  const labels = [t.controls.noiseOff, t.controls.noiseLow, t.controls.noiseMedium, t.controls.noiseHigh, t.controls.noiseMax];
  const opts: SegmentOption<number>[] = NOISE_LEVELS.map((noise, i) => {
    const why = comboUnavailable(caps, upscale.scale, noise);
    return {
      value: noise,
      label: labels[i],
      disabled: why !== null,
      disabledReason: why === "noop" ? t.controls.unavailable1x : t.controls.unavailableModel,
    };
  });
  return (
    <Field label={t.controls.noise} help="noise">
      <Segmented ariaLabel={t.controls.noise} size="sm" value={upscale.noise} options={opts} onChange={(noise) => setUpscale({ noise })} />
    </Field>
  );
}

export function FormatField({ targetSize, showQuality = true }: { targetSize?: { w: number; h: number }; showQuality?: boolean }) {
  const t = useMessages();
  const { output } = useSettings();
  const setOutput = useSettingsStore((st) => st.setOutput);
  const opts: SegmentOption<OutputFormat>[] = (["png", "jpeg", "webp"] as const).map((f) => ({
    value: f,
    label: f === "jpeg" ? "JPEG" : f.toUpperCase(),
    disabled: targetSize ? formatUnavailable(f, targetSize.w, targetSize.h) !== null : false,
    disabledReason: t.controls.unavailableWebp,
  }));
  const lossy = output.format === "jpeg" || (output.format === "webp" && !output.webpLossless);
  return (
    <>
      <Field label={t.controls.format} help="format">
        <Segmented ariaLabel={t.controls.format} size="sm" value={output.format} options={opts} onChange={(format) => setOutput({ format })} />
      </Field>
      {output.format === "webp" && (
        <Field label={t.controls.lossless} inline>
          <Toggle label={t.controls.lossless} checked={output.webpLossless} onChange={(webpLossless) => setOutput({ webpLossless })} />
        </Field>
      )}
      {showQuality && lossy && (
        <Field label={t.controls.quality}>
          <Slider label={t.controls.quality} min={50} max={100} value={output.quality} onChange={(quality) => setOutput({ quality })} />
        </Field>
      )}
    </>
  );
}

/* ---------- Compression (all kinds) ---------- */

export function QualityField({ which }: { which: CompressKey }) {
  const t = useMessages();
  const c = compressOf(useSettings(), which);
  const setCompress = useSettingsStore((st) => st.setCompress);
  const opts: SegmentOption<CompressLevel>[] = [
    { value: "best", label: t.controls.qualityBest },
    { value: "balanced", label: t.controls.qualityBalanced },
    { value: "small", label: t.controls.qualitySmall },
    { value: "custom", label: t.controls.qualityCustom },
  ];
  return (
    <>
      <Field label={t.controls.quality} help="quality">
        <Segmented ariaLabel={t.controls.quality} size="sm" value={c.level} options={opts} onChange={(level) => setCompress(which, { level })} />
      </Field>
      {c.level === "custom" && (
        <Slider label={t.controls.quality} min={10} max={100} value={c.quality} format={(v) => `${v}%`} onChange={(quality) => setCompress(which, { quality })} />
      )}
    </>
  );
}

const UNITS: { value: SizeUnit; label: string }[] = [
  { value: "kb", label: "KB" },
  { value: "mb", label: "MB" },
  { value: "gb", label: "GB" },
];

export function MaxSizeField({ which, allowGb = false }: { which: CompressKey; allowGb?: boolean }) {
  const t = useMessages();
  const c = compressOf(useSettings(), which);
  const setCompress = useSettingsStore((st) => st.setCompress);
  const limited = c.maxSize !== null;
  // Text being typed; follows the stored value when it changes elsewhere (presets, reset).
  const [draft, setDraft] = useState({ value: c.maxSize, text: limited ? String(c.maxSize) : "5" });
  if (c.maxSize !== null && c.maxSize !== draft.value && Number(draft.text.replace(",", ".")) !== c.maxSize) {
    setDraft({ value: c.maxSize, text: String(c.maxSize) });
  }
  const commit = (raw: string) => {
    const v = Number(raw.replace(",", "."));
    if (Number.isFinite(v) && v > 0) setCompress(which, { maxSize: v });
  };
  return (
    <Field label={t.controls.maxSize} help="limit" hint={limited ? t.controls.limitNote : undefined}>
      <div className={s.limitRow}>
        <Segmented
          ariaLabel={t.controls.maxSize}
          size="sm"
          value={limited ? "on" : "off"}
          options={[
            { value: "off", label: t.controls.noLimit },
            { value: "on", label: t.controls.limit },
          ]}
          onChange={(v) => setCompress(which, { maxSize: v === "on" ? Number(draft.text.replace(",", ".")) || 5 : null })}
        />
        {limited && (
          <>
            <input
              type="text"
              inputMode="decimal"
              className={s.number}
              value={draft.text}
              aria-label={t.controls.maxSize}
              onChange={(e) => {
                setDraft({ value: c.maxSize, text: e.target.value });
                commit(e.target.value);
              }}
            />
            <div className={s.unit}>
              <Select
                ariaLabel="unit"
                value={c.unit}
                options={UNITS.filter((u) => allowGb || u.value !== "gb")}
                onChange={(unit) => setCompress(which, { unit: unit as SizeUnit })}
              />
            </div>
          </>
        )}
      </div>
    </Field>
  );
}

/**
 * Size of the output. For "Compress" on a still image this is a real encode of
 * the selected file with the current settings, so the number is exact.
 */
export function EstimateRow({ job }: { job: Job }) {
  const t = useMessages();
  const settings = useSettings();
  const [state, setState] = useState<{ key: string; report: CompressReport | null }>({ key: "", report: null });
  const key = JSON.stringify([job.id, settings.imageCompress, settings.output.format, settings.output.webpLossless]);
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .estimateCompression(job.id)
        .then((report) => setState({ key, report }))
        .catch(() => setState({ key, report: null }));
    }, 450);
    return () => clearTimeout(timer);
  }, [key, job.id]);
  const report = state.key === key ? state.report : null;
  const loading = state.key !== key;
  return (
    <div className={s.estimate}>
      <span className={s.estimateLabel}>{t.controls.estimated}</span>
      <span className={s.estimateValue}>
        {formatBytes(job.source.info.sizeBytes)} →{" "}
        {loading || !report ? (
          <span className={s.muted}>{t.controls.estimating}</span>
        ) : (
          <strong className={report.met ? undefined : s.over}>{formatBytes(report.bytes)}</strong>
        )}
      </span>
      {report && !report.met && <span className={s.over}>{t.controls.estimateOver}</span>}
    </div>
  );
}

/* ---------- GIFs and clips ---------- */

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

/* ---------- Common ---------- */

export function FolderField() {
  const t = useMessages();
  const { output } = useSettings();
  const setOutput = useSettingsStore((st) => st.setOutput);
  const choose = async () => {
    const directory = await pickFolder();
    if (directory) setOutput({ directory });
  };
  return (
    <Field label={t.controls.folder}>
      <div className={s.folder}>
        <span className={s.folderPath} title={output.directory ?? undefined}>
          {output.directory ?? t.controls.folderBeside}
        </span>
        {output.directory && (
          <IconButton label={t.controls.folderReset} size="sm" onClick={() => setOutput({ directory: null })}>
            <RotateCcw />
          </IconButton>
        )}
        <Button size="sm" icon={<FolderOpen />} onClick={() => void choose()}>
          {t.controls.folderChange}
        </Button>
      </div>
    </Field>
  );
}

export function DeviceField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const vk = useSystemStore((st) => st.status?.vulkan);
  const defaultName = vk?.gpus.find((g) => g.index === vk.defaultGpu)?.name;
  const options = [
    { value: "auto", label: t.controls.deviceAuto, description: defaultName ?? t.controls.deviceCpu },
    ...(vk?.gpus ?? []).map((g) => ({ value: String(g.index), label: g.name, description: `GPU ${g.index} · ${Math.round(g.vramBytes / 1024 ** 3)} GB` })),
    { value: "-1", label: t.controls.deviceCpu },
  ];
  const value = upscale.gpu === null ? "auto" : String(upscale.gpu);
  return (
    <Field label={t.controls.device} help="gpu">
      <Select ariaLabel={t.controls.device} value={value} options={options} onChange={(v) => setUpscale({ gpu: v === "auto" ? null : Number(v) })} />
    </Field>
  );
}

const TILES = [0, 32, 64, 100, 128, 200, 256, 400, 512, 800];

/** With Auto optimize on, tiles and threads are chosen by Aoze: show them read-only. */
function useAutoTuning() {
  const auto = useSettingsStore((st) => st.settings?.performance.autoOptimize ?? false);
  const tuning = useSystemStore((st) => st.check?.tuning);
  return auto && tuning?.automatic ? tuning : null;
}

export function TileField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const auto = useAutoTuning();
  if (auto) {
    return (
      <Field label={t.controls.tile} hint={t.settings.autoManaged} inline>
        <span className={s.autoValue}>{auto.tileSize === 0 ? t.controls.tileAuto : `${auto.tileSize} px`}</span>
      </Field>
    );
  }
  return (
    <Field label={t.controls.tile}>
      <Select
        ariaLabel={t.controls.tile}
        value={String(upscale.tileSize)}
        options={TILES.map((v) => ({ value: String(v), label: v === 0 ? t.controls.tileAuto : `${v} px` }))}
        onChange={(v) => setUpscale({ tileSize: Number(v) })}
      />
    </Field>
  );
}

export function TtaField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  return (
    <Field label={t.controls.tta} inline>
      <Toggle label={t.controls.tta} checked={upscale.tta} onChange={(tta) => setUpscale({ tta })} />
    </Field>
  );
}

export function ThreadsField() {
  const t = useMessages();
  const { upscale } = useSettings();
  const setUpscale = useSettingsStore((st) => st.setUpscale);
  const keys = ["load", "proc", "save"] as const;
  const auto = useAutoTuning();
  if (auto) {
    return (
      <Field label={t.controls.threads} hint={t.settings.autoManaged} inline>
        <span className={s.autoValue}>{`${auto.threads.load} : ${auto.threads.proc} : ${auto.threads.save}`}</span>
      </Field>
    );
  }
  return (
    <Field label={t.controls.threads}>
      <div className={s.threads}>
        {keys.map((k) => (
          <Select
            key={k}
            ariaLabel={k}
            value={String(upscale.threads[k])}
            options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => setUpscale({ threads: { ...upscale.threads, [k]: Number(v) } })}
          />
        ))}
      </div>
    </Field>
  );
}

export function SuffixField() {
  const t = useMessages();
  const { output, upscale } = useSettings();
  const setOutput = useSettingsStore((st) => st.setOutput);
  const ext = output.format === "jpeg" ? "jpg" : output.format;
  return (
    <Field label={t.controls.suffix} hint={t.controls.suffixHint}>
      <input type="text" className={s.input} value={output.suffix} spellCheck={false} onChange={(e) => setOutput({ suffix: e.target.value })} />
      <p className={s.example}>
        {fmt(t.controls.suffixExample, { from: "image.png", to: `image${renderSuffix(output.suffix, upscale)}.${ext}` })}
        <span>{t.controls.suffixTokens}</span>
      </p>
    </Field>
  );
}

export function ConflictField() {
  const t = useMessages();
  const { output } = useSettings();
  const setOutput = useSettingsStore((st) => st.setOutput);
  const opts: SegmentOption<ConflictPolicy>[] = [
    { value: "rename", label: t.controls.conflictRename },
    { value: "overwrite", label: t.controls.conflictOverwrite },
    { value: "skip", label: t.controls.conflictSkip },
  ];
  return (
    <Field label={t.controls.conflict}>
      <Segmented ariaLabel={t.controls.conflict} size="sm" value={output.conflict} options={opts} onChange={(conflict) => setOutput({ conflict })} />
    </Field>
  );
}

/* ---------- Discord ---------- */

const DISCORD: Record<DiscordTarget, { w: number; h: number; maxMb: number | null; minimum: boolean }> = {
  profilePicture: { w: 512, h: 512, maxMb: 8, minimum: false },
  profileBanner: { w: 680, h: 240, maxMb: 10, minimum: true },
  serverBanner: { w: 960, h: 540, maxMb: null, minimum: false },
};

/** Prepares an image or GIF for a Discord slot (sizes from Discord's help center). */
export function DiscordField({ source }: { source?: { w: number; h: number } }) {
  const t = useMessages();
  const { discord } = useSettings();
  const update = useSettingsStore((st) => st.update);
  const spec = discord ? DISCORD[discord] : null;
  const smaller = spec && source && (source.w < spec.w || source.h < spec.h);
  return (
    <Field label={t.discord.title}>
      <div className={s.chips} role="radiogroup" aria-label={t.discord.title}>
        {(
          [
            ["off", t.discord.off],
            ["profilePicture", t.discord.profilePicture],
            ["profileBanner", t.discord.profileBanner],
            ["serverBanner", t.discord.serverBanner],
          ] as const
        ).map(([value, label]) => {
          const active = (discord ?? "off") === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${s.chip} ${active ? s.chipOn : ""}`}
              onClick={() => update((st) => ({ ...st, discord: value === "off" ? null : value }))}
            >
              {label}
            </button>
          );
        })}
      </div>
      {discord && spec && (
        <div className={s.target}>
          <div className={s.targetTitle}>{t.discord.recommended}</div>
          <dl>
            <div>
              <dt>{t.discord.resolution}</dt>
              <dd>
                {spec.w} × {spec.h}
                {spec.minimum && ` ${t.discord.minimum}`}
                {discord === "profilePicture" && ` · ${t.discord.square}`}
                {discord === "serverBanner" && ` · ${t.discord.ratio}`}
              </dd>
            </div>
            <div>
              <dt>{t.discord.maxSize}</dt>
              <dd>{spec.maxMb ? `${spec.maxMb} MB` : t.discord.noLimit}</dd>
            </div>
            <div>
              <dt>{t.discord.format}</dt>
              <dd>{discord === "profilePicture" ? t.discord.formatsAvatar : t.discord.formatsBanner}</dd>
            </div>
          </dl>
          <p>{t.discord.crop}</p>
          {discord === "profilePicture" && <p>{t.discord.circle}</p>}
          {discord === "profileBanner" && <p>{t.discord.nitro}</p>}
          {smaller && <p className={s.targetNote}>{t.discord.enlarge}</p>}
          <p>{t.discord.output}</p>
        </div>
      )}
    </Field>
  );
}

/* ---------- Clips: frame rate, Smooth Motion, HDR, Look ---------- */

const CLIP_FPS = [24, 30, 48, 60, 120];
/** Matches smooth::MAX_FACTOR in the backend. */
const SMOOTH_MAX_FACTOR = 8;

/** Smooth Motion needs RIFE and a Vulkan GPU (the CPU fallback is far too slow for clips). */
function useSmoothAvailable(): boolean {
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

/* ---------- Clips: simple Smooth Motion / motion blur ---------- */

type SmoothChoice = "off" | "60" | "120" | "custom";

/**
 * Smooth Motion in one row: Off, 60 FPS, 120 FPS or a custom rate. The engine
 * (RIFE, model, sub-frames) is Aoze's business, not the user's.
 */
export function SmoothMotionField({ sourceFps }: { sourceFps?: number }) {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const available = useSmoothAvailable();
  const [custom, setCustom] = useState(false);
  const src = sourceFps ?? 0;
  const reachable = (f: number) => available && (!sourceFps || (f > src + 0.5 && f <= src * SMOOTH_MAX_FACTOR));
  const on = a.smooth !== "off" && a.fps !== null;
  const value: SmoothChoice = custom ? "custom" : !on ? (a.fps !== null ? "custom" : "off") : a.fps === 60 ? "60" : a.fps === 120 ? "120" : "custom";
  const level = a.smooth === "off" || a.smooth === "low" ? "medium" : a.smooth;
  const reason = available ? t.controls.smoothNotAbove : t.controls.smoothUnavailable;
  const opts: SegmentOption<SmoothChoice>[] = [
    { value: "off", label: t.controls.smoothOff },
    { value: "60", label: "60 FPS", disabled: !reachable(60), disabledReason: reason },
    { value: "120", label: "120 FPS", disabled: !reachable(120), disabledReason: reason },
    { value: "custom", label: t.controls.smoothCustom },
  ];
  const pick = (v: SmoothChoice) => {
    setCustom(v === "custom");
    if (v === "off") setAnim("clip", { smooth: "off", fps: null });
    else if (v === "custom") setAnim("clip", { smooth: a.fps !== null && a.fps > src + 0.5 ? level : a.smooth });
    else setAnim("clip", { smooth: level, fps: Number(v) });
  };
  const hint = !available
    ? t.controls.smoothUnavailable
    : on && a.fps && sourceFps && a.fps > sourceFps + 0.5
      ? fmt(t.controls.fpsSmoothSummary, { from: Math.round(src * 100) / 100, to: a.fps })
      : value === "off"
        ? undefined
        : t.controls.smoothHints.medium;
  return (
    <>
      <Field label={t.controls.smooth} help="smooth" hint={value === "custom" ? undefined : hint}>
        <Segmented ariaLabel={t.controls.smooth} size="sm" value={value} options={opts} onChange={pick} />
      </Field>
      {value === "custom" && <ClipFpsField sourceFps={sourceFps} />}
    </>
  );
}

/** Weak hardware (startup check): heavy options are offered but not suggested. */
function useLowGpu(): boolean {
  const tier = useSystemStore((st) => st.check?.profile?.gpu ?? null);
  return tier === "low";
}

/** Smooth Motion quality: Fast (half-resolution motion), Balanced, High quality (heavier model / second pass). */
export function SmoothQualityField() {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const low = useLowGpu();
  const value = a.smooth === "off" ? "medium" : a.smooth;
  return (
    <Field label={t.controls.quality} help="smoothQuality" hint={low && value === "high" ? t.controls.lowGpuHint : t.controls.smoothQualityHints[value]}>
      <Segmented<"low" | "medium" | "high">
        ariaLabel={t.controls.smoothQuality}
        size="sm"
        value={value}
        options={[
          { value: "low", label: t.controls.qualityFast },
          { value: "medium", label: t.controls.qualityBalanced },
          { value: "high", label: t.controls.qualityHigh },
        ]}
        onChange={(smooth) => setAnim("clip", { smooth })}
      />
    </Field>
  );
}

/** Clips: motion blur as a virtual shutter (from the motion, when RIFE is there). */
export function ClipBlurField() {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const available = useSmoothAvailable();
  const on = a.motionBlur > 0;
  return (
    <>
      <Field label={t.controls.motionBlur} help="blur" inline>
        <Toggle label={t.controls.motionBlur} checked={on} onChange={(v) => setAnim("clip", { motionBlur: v ? 40 : 0 })} />
      </Field>
      {on && (
        <Field label={t.controls.intensity} hint={available ? t.controls.blurFromMotion : t.controls.blurFallback}>
          <Slider
            label={t.controls.intensity}
            min={5}
            max={100}
            step={5}
            value={a.motionBlur}
            format={(v) => `${v}%`}
            onChange={(motionBlur) => setAnim("clip", { motionBlur })}
          />
        </Field>
      )}
    </>
  );
}

/* ---------- Clips: shape (Smart Reframe) ---------- */

const FORMATS: FrameFormat[] = ["original", "landscape", "portrait", "square", "feed"];
const FORMAT_RATIO: Record<FrameFormat, number | null> = { original: null, landscape: 16 / 9, portrait: 9 / 16, square: 1, feed: 4 / 5 };

/** What the backend does for this shape: nothing, a moving crop, or a fill (reframe.rs). */
export function reframeMode(format: FrameFormat, source?: { w: number; h: number }): "none" | "crop" | "fill" {
  const target = FORMAT_RATIO[format];
  if (target === null) return "none";
  if (!source) return "crop";
  const src = source.w / source.h;
  if (Math.abs(src / target - 1) < 0.01) return "none";
  const kept = src > target ? target / src : src / target;
  return target > src && kept < 0.45 ? "fill" : "crop";
}

export function ClipFormatField({ source }: { source?: { w: number; h: number } }) {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const mode = reframeMode(a.format, source);
  const names: Record<FrameFormat, string> = {
    original: t.controls.formatOriginal,
    landscape: t.controls.formatLandscape,
    portrait: t.controls.formatPortrait,
    square: t.controls.formatSquare,
    feed: t.controls.formatFeed,
  };
  const focusNames: Record<Focus, string> = {
    auto: t.controls.focusAuto,
    subject: t.controls.focusSubject,
    screen: t.controls.focusScreen,
    center: t.controls.focusCenter,
  };
  const hint = mode === "none" && a.format !== "original" ? t.controls.formatSame : mode === "fill" ? t.controls.formatFill : undefined;
  return (
    <>
      <Field label={t.controls.frameFormat} help="reframe" hint={hint}>
        <Select ariaLabel={t.controls.frameFormat} value={a.format} options={FORMATS.map((f) => ({ value: f, label: names[f] }))} onChange={(v) => setAnim("clip", { format: v as FrameFormat })} />
      </Field>
      {mode === "crop" && (
        <>
          <Field label={t.controls.smartReframe} inline>
            <Toggle label={t.controls.smartReframe} checked={a.reframe} onChange={(reframe) => setAnim("clip", { reframe })} />
          </Field>
          {a.reframe ? (
            <Field label={t.controls.focus} hint={t.controls.focusHints[a.focus]}>
              <Select
                ariaLabel={t.controls.focus}
                value={a.focus}
                options={(["auto", "subject", "screen", "center"] as Focus[]).map((f) => ({ value: f, label: focusNames[f] }))}
                onChange={(v) => setAnim("clip", { focus: v as Focus })}
              />
            </Field>
          ) : (
            <p className={s.note}>{t.controls.reframeOff}</p>
          )}
        </>
      )}
    </>
  );
}

/* ---------- Clips: speed ---------- */

const SPEED_PRESETS: SpeedPreset[] = ["normal", "slow", "fast", "ramp", "custom"];

export function SpeedField({ media }: { media?: MediaInfo }) {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const available = useSmoothAvailable();
  const names: Record<SpeedPreset, string> = {
    normal: t.controls.speedNormal,
    slow: t.controls.speedSlow,
    fast: t.controls.speedFast,
    ramp: t.controls.speedRamp,
    custom: t.controls.smoothCustom,
  };
  const src = media ? media.durationMs / 1000 : null;
  const out = src !== null ? outputSeconds(a.speed, src) : null;
  const aside = src !== null && out !== null && a.speed.preset !== "normal" ? `${src.toFixed(1)} s → ${out.toFixed(1)} s` : undefined;
  const slows = slowest(a.speed) < 0.999;
  const hint = a.speed.preset === "normal" ? undefined : slows ? (available ? t.controls.speedSlowSmooth : t.controls.speedSlowRepeat) : t.controls.speedAudio;
  return (
    <>
      <Field label={t.controls.speed} help="speed" aside={aside} hint={hint}>
        <Select
          ariaLabel={t.controls.speed}
          value={a.speed.preset}
          options={SPEED_PRESETS.map((p) => ({ value: p, label: names[p], description: t.controls.speedHints[p] }))}
          onChange={(preset) => setAnim("clip", { speed: { ...a.speed, preset: preset as SpeedPreset } })}
        />
      </Field>
      {a.speed.preset === "custom" && <SpeedCurveEditor />}
    </>
  );
}

const CURVE_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Five speed points over the clip; drag a point up or down. Eased between points. */
export function SpeedCurveEditor() {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const curve = a.speed.curve;
  const W = 260;
  const H = 84;
  const pad = 10;
  const yOf = (v: number) => pad + (1 - (Math.log2(v) + 2) / 4) * (H - 2 * pad);
  const vOf = (y: number) => {
    const raw = 2 ** ((1 - (y - pad) / (H - 2 * pad)) * 4 - 2);
    return CURVE_STEPS.reduce((best, c) => (Math.abs(Math.log2(c) - Math.log2(raw)) < Math.abs(Math.log2(best) - Math.log2(raw)) ? c : best), 1);
  };
  const xOf = (i: number) => pad + (i / (curve.length - 1)) * (W - 2 * pad);
  const set = (i: number, v: number) => {
    // Read the latest curve: a drag fires many updates before React re-renders.
    const st = useSettingsStore.getState().settings;
    const cur = st ? st.clip.speed : a.speed;
    setAnim("clip", { speed: { ...cur, curve: cur.curve.map((c, k) => (k === i ? v : c)) } });
  };
  const pts = speedPoints({ preset: "custom", curve }) ?? curve.map((c, i) => [i / (curve.length - 1), c] as [number, number]);
  const path = Array.from({ length: 61 }, (_, i) => {
    const p = i / 60;
    return `${i ? "L" : "M"}${(pad + p * (W - 2 * pad)).toFixed(1)},${yOf(speedAt(pts, p)).toFixed(1)}`;
  }).join(" ");
  const drag = (i: number) => (e: ReactPointerEvent<SVGCircleElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const move = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      set(i, vOf(((ev.clientY - r.top) / r.height) * H));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={s.curve}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t.controls.speedCurve}>
        <line x1={pad} x2={W - pad} y1={yOf(1)} y2={yOf(1)} className={s.curveMid} />
        <path d={path} className={s.curveLine} />
        {curve.map((v, i) => (
          <circle
            key={i}
            cx={xOf(i)}
            cy={yOf(v)}
            r={6}
            className={s.curvePoint}
            tabIndex={0}
            role="slider"
            aria-label={`${t.controls.speed} ${i * 25}%`}
            aria-valuenow={v}
            aria-valuemin={0.25}
            aria-valuemax={4}
            onPointerDown={drag(i)}
            onKeyDown={(e) => {
              const k = CURVE_STEPS.indexOf(v);
              if (e.key === "ArrowUp") set(i, CURVE_STEPS[Math.min(CURVE_STEPS.length - 1, k + 1)] ?? 1);
              if (e.key === "ArrowDown") set(i, CURVE_STEPS[Math.max(0, k - 1)] ?? 1);
            }}
          />
        ))}
      </svg>
      <div className={s.curveLabels}>
        {curve.map((v, i) => (
          <span key={i}>{`${v}×`}</span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Clips: colour (LUT) ---------- */

const IMPORT_LUT = "__import__";

export function LutField() {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.lutList().then(setLuts).catch(() => setLuts([]));
  }, []);
  const builtinNames: Record<string, string> = t.controls.lutBuiltins;
  const options = [
    { value: "none", label: t.controls.lutNone },
    ...luts.map((l) => ({ value: l.id, label: l.builtin ? (builtinNames[l.name] ?? l.name) : l.name })),
    { value: IMPORT_LUT, label: t.controls.lutImport },
  ];
  const pick = async (v: string) => {
    setError(null);
    if (v === IMPORT_LUT) {
      const path = await open({ multiple: false, directory: false, filters: [{ name: "LUT", extensions: ["cube"] }] });
      if (typeof path !== "string") return;
      try {
        const info = await api.lutImport(path);
        setLuts(await api.lutList());
        setAnim("clip", { lut: info.id });
      } catch (e) {
        setError(fmt(t.controls.lutInvalid, { detail: toAppError(e).detail }));
      }
      return;
    }
    setAnim("clip", { lut: v === "none" ? null : v });
  };
  const selected = luts.find((l) => l.id === a.lut);
  const remove = async () => {
    if (!selected || selected.builtin) return;
    await api.lutRemove(selected.id).catch(() => undefined);
    setLuts(await api.lutList());
    setAnim("clip", { lut: null });
  };
  return (
    <>
      <Field label={t.controls.lut} help="lut" hint={error ?? undefined}>
        <div className={s.folder}>
          <div className={s.grow}>
            <Select ariaLabel={t.controls.lut} value={a.lut ?? "none"} options={options} onChange={(v) => void pick(v)} />
          </div>
          {selected && !selected.builtin && (
            <IconButton label={t.controls.lutRemove} size="sm" onClick={() => void remove()}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </Field>
      {a.lut && (
        <Field label={t.controls.intensity}>
          <Slider label={t.controls.intensity} min={5} max={100} step={5} value={a.lutStrength} format={(v) => `${v}%`} onChange={(lutStrength) => setAnim("clip", { lutStrength })} />
        </Field>
      )}
    </>
  );
}

/* ---------- Clips: effects ---------- */

export function BeatSyncField({ media }: { media?: MediaInfo }) {
  const t = useMessages();
  const a = useSettings().clip;
  const setAnim = useSettingsStore((st) => st.setAnim);
  const set = (p: Partial<BeatSync>) => setAnim("clip", { beat: { ...a.beat, ...p } });
  const noAudio = media !== undefined && !media.hasAudio;
  return (
    <>
      <Field label={t.controls.beatSync} help="beat" inline>
        <Toggle label={t.controls.beatSync} checked={a.beat.on} onChange={(on) => set({ on })} />
      </Field>
      {a.beat.on && (
        <>
          <p className={noAudio ? s.warn : s.note}>{noAudio ? t.controls.beatNoAudio : t.controls.beatHint}</p>
          <Field label={t.controls.beatZoom} inline>
            <Toggle label={t.controls.beatZoom} checked={a.beat.zoom} onChange={(zoom) => set({ zoom })} />
          </Field>
          <Field label={t.controls.beatShake} inline>
            <Toggle label={t.controls.beatShake} checked={a.beat.shake} onChange={(shake) => set({ shake })} />
          </Field>
        </>
      )}
    </>
  );
}

export function GlowField() {
  const t = useMessages();
  const look = useSettings().clip.look;
  const setAnim = useSettingsStore((st) => st.setAnim);
  return (
    <Field label={t.controls.glow} help="glow">
      <Slider label={t.controls.glow} min={0} max={100} step={5} value={look.glow} format={(v) => (v === 0 ? t.controls.off : `${v}%`)} onChange={(glow) => setAnim("clip", { look: { ...look, glow } })} />
    </Field>
  );
}
