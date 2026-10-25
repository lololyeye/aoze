import { useId } from "react";

/** Aoze mark: an "A" whose crossbar reaches past the right leg. */
export function Logo({ size = 20 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="64 64 896 896" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1e26" />
          <stop offset="1" stopColor="#0a0b0f" />
        </linearGradient>
        <linearGradient id={`${id}ac`} gradientUnits="userSpaceOnUse" x1="392" y1="0" x2="862" y2="0">
          <stop offset="0" stopColor="#2bb8d6" />
          <stop offset="1" stopColor="#5ff0d4" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="208" fill={`url(#${id}bg)`} />
      <path d="M292 772 L512 248 L732 772" fill="none" stroke="#eef1f5" strokeWidth="96" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M392 616 L800 616" fill="none" stroke={`url(#${id}ac)`} strokeWidth="76" strokeLinecap="round" />
      <circle cx="800" cy="616" r="62" fill={`url(#${id}ac)`} />
    </svg>
  );
}

/** The glyph alone (no tile) for the title bar: sits on the bar like text. */
export function LogoMark({ size = 18 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="250 210 600 600" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}ac`} gradientUnits="userSpaceOnUse" x1="392" y1="0" x2="862" y2="0">
          <stop offset="0" stopColor="#2bb8d6" />
          <stop offset="1" stopColor="#5ff0d4" />
        </linearGradient>
      </defs>
      <path d="M292 772 L512 248 L732 772" fill="none" stroke="currentColor" strokeWidth="96" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M392 616 L790 616" fill="none" stroke={`url(#${id}ac)`} strokeWidth="76" strokeLinecap="round" />
      <circle cx="790" cy="616" r="60" fill={`url(#${id}ac)`} />
    </svg>
  );
}
