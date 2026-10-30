import { Field } from "../../../components/ui/Field";
import { Segmented, type SegmentOption } from "../../../components/ui/Segmented";
import { Slider } from "../../../components/ui/Slider";
import { Toggle } from "../../../components/ui/Toggle";
import { fmt, useMessages } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import { modelFor, useSystemStore } from "../../../stores/systemStore";
import type { ImageAction, OutputFormat, Style } from "../../../types";
import { comboUnavailable, formatUnavailable, NOISE_LEVELS, SCALES } from "../../../utils/capabilities";
import { formatScale } from "../../../utils/format";
import { useSettings } from "./shared";

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
