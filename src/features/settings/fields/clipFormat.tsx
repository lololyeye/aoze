import { Field } from "../../../components/ui/Field";
import { Select } from "../../../components/ui/Select";
import { Toggle } from "../../../components/ui/Toggle";
import { useMessages } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { Focus, FrameFormat } from "../../../types";
import s from "../fields.module.css";
import { useSettings } from "./shared";

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
