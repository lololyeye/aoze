import { useState } from "react";
import { Field } from "../../../components/ui/Field";
import { Segmented, type SegmentOption } from "../../../components/ui/Segmented";
import { Slider } from "../../../components/ui/Slider";
import { Toggle } from "../../../components/ui/Toggle";
import { fmt, useMessages } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useSystemStore } from "../../../stores/systemStore";
import { ClipFpsField, SMOOTH_MAX_FACTOR, useSmoothAvailable } from "./clipFrameRate";
import { useSettings } from "./shared";

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
