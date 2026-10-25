import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import s from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, block, className, children, ...rest },
  ref,
) {
  const cls = [s.button, s[variant], s[size], block && s.block, className].filter(Boolean).join(" ");
  return (
    <button ref={ref} type="button" className={cls} {...rest}>
      {icon && <span className={s.icon}>{icon}</span>}
      {children && <span className={s.label}>{children}</span>}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  active?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active, className, children, tooltipSide = "bottom", ...rest },
  ref,
) {
  const cls = [s.iconButton, s[`icon_${size}`], active && s.active, className].filter(Boolean).join(" ");
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button ref={ref} type="button" aria-label={label} className={cls} {...rest}>
        {children}
      </button>
    </Tooltip>
  );
});
