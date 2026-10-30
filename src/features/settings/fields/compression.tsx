import { useEffect, useState } from "react";
import { Field } from "../../../components/ui/Field";
import { Segmented, type SegmentOption } from "../../../components/ui/Segmented";
import { Select } from "../../../components/ui/Select";
import { Slider } from "../../../components/ui/Slider";
import { useMessages } from "../../../i18n";
import { api } from "../../../services/api";
import { compressOf, useSettingsStore, type CompressKey } from "../../../stores/settingsStore";
import type { CompressLevel, CompressReport, Job, SizeUnit } from "../../../types";
import { formatBytes } from "../../../utils/format";
import s from "../fields.module.css";
import { useSettings } from "./shared";

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
