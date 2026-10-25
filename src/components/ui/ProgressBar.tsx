import s from "./ProgressBar.module.css";

interface ProgressBarProps {
  value: number;
  /** Moving sheen while work is running, even when the value stalls. */
  active?: boolean;
  tone?: "accent" | "success" | "danger" | "muted";
  size?: "xs" | "sm";
}

/**
 * Only `transform` and `opacity` change, so the browser animates the bar on
 * its compositor without layout or repaint: it keeps moving while the GPU
 * and the CPU are busy with an upscale.
 */
export function ProgressBar({ value, active, tone = "accent", size = "sm" }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`${s.track} ${s[size]}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`${s.fill} ${s[tone]}`} style={{ transform: `translateX(${pct - 100}%)` }} />
      {active && <div className={s.sheen} />}
    </div>
  );
}
