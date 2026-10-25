import s from "./Slider.module.css";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  format?: (v: number) => string;
}

export function Slider({ value, min, max, step = 1, onChange, label, format }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={s.root}>
      <input
        type="range"
        aria-label={label}
        className={s.input}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={s.value}>{format ? format(value) : value}</span>
    </div>
  );
}
