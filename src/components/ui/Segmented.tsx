import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import s from "./Segmented.module.css";

export interface SegmentOption<T> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** Shown instead of `hint` when disabled. */
  disabledReason?: ReactNode;
}

interface SegmentedProps<T> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}

export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel, size = "md" }: SegmentedProps<T>) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`${s.root} ${s[size]}`}>
      {options.map((o) => {
        const selected = o.value === value;
        const tip = o.disabled ? o.disabledReason : o.hint;
        return (
          <Tooltip key={String(o.value)} content={tip} wide>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={o.disabled}
              className={`${s.item} ${selected ? s.selected : ""} ${o.disabled ? s.disabled : ""}`}
              onClick={() => !o.disabled && onChange(o.value)}
            >
              {selected && (
                <motion.span
                  layoutId={`seg-${group}`}
                  className={s.indicator}
                  transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.6 }}
                />
              )}
              <span className={s.text}>{o.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
