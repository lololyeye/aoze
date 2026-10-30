import type { PointerEvent as ReactPointerEvent } from "react";
import { Field } from "../../../components/ui/Field";
import { Select } from "../../../components/ui/Select";
import { useMessages } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { MediaInfo, SpeedPreset } from "../../../types";
import { outputSeconds, slowest, speedAt, speedPoints } from "../../../utils/speed";
import s from "../fields.module.css";
import { useSmoothAvailable } from "./clipFrameRate";
import { useSettings } from "./shared";

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
