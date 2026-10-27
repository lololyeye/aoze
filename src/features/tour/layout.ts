// Where the tour's bubble goes around the highlighted element, and the arrow
// drawn from the bubble to it. Pure geometry, in viewport pixels.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "right" | "left" | "bottom" | "top";

export interface Placement {
  left: number;
  top: number;
  side: Side;
  /** Quadratic curve from the bubble (x1, y1) to the element (x2, y2). */
  arrow: { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number };
}

/** Room left between the bubble and the element, for the arrow. */
export const GAP = 64;
/** Kept clear around the window's edges. */
export const MARGIN = 14;
/** The arrow stops this far from the element's outline. */
const TIP = 12;

/** Within [lo, hi]; `lo` wins when the range is empty (a bubble wider than the window). */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Picks the side with room for the bubble (right, left, below, above, in that
 * order of preference; else the roomiest), aligns it with the element and keeps
 * it inside the window.
 */
export function place(hole: Rect, bw: number, bh: number, vw: number, vh: number): Placement {
  const room: Record<Side, number> = {
    right: vw - (hole.x + hole.w) - MARGIN,
    left: hole.x - MARGIN,
    bottom: vh - (hole.y + hole.h) - MARGIN,
    top: hole.y - MARGIN,
  };
  const need: Record<Side, number> = { right: bw + GAP, left: bw + GAP, bottom: bh + GAP, top: bh + GAP };
  const cx = hole.x + hole.w / 2;
  const cy = hole.y + hole.h / 2;
  // Beside the element, unless it hugs the top or bottom edge: a bubble beside
  // it would be pushed away from it, so it goes below (or above).
  const order: Side[] =
    cy - bh / 2 < MARGIN ? ["bottom", "right", "left", "top"] : cy + bh / 2 > vh - MARGIN ? ["top", "right", "left", "bottom"] : ["right", "left", "bottom", "top"];
  const side = order.find((s) => room[s] >= need[s]) ?? order.reduce((a, b) => (room[b] - need[b] > room[a] - need[a] ? b : a));
  let left: number;
  let top: number;
  if (side === "right" || side === "left") {
    left = side === "right" ? hole.x + hole.w + GAP : hole.x - GAP - bw;
    top = cy - bh / 2;
  } else {
    left = cx - bw / 2;
    top = side === "bottom" ? hole.y + hole.h + GAP : hole.y - GAP - bh;
  }
  left = clamp(left, MARGIN, vw - MARGIN - bw);
  top = clamp(top, MARGIN, vh - MARGIN - bh);

  // From the middle of the bubble's facing edge (as close to the element as the
  // edge allows) to the element's facing edge.
  let x1: number, y1: number, x2: number, y2: number;
  if (side === "right" || side === "left") {
    x1 = side === "right" ? left : left + bw;
    y1 = clamp(cy, top + 22, top + bh - 22);
    x2 = side === "right" ? hole.x + hole.w + TIP : hole.x - TIP;
    y2 = clamp(y1, hole.y + 10, hole.y + hole.h - 10);
  } else {
    y1 = side === "bottom" ? top : top + bh;
    x1 = clamp(cx, left + 28, left + bw - 28);
    y2 = side === "bottom" ? hole.y + hole.h + TIP : hole.y - TIP;
    x2 = clamp(x1, hole.x + 10, hole.x + hole.w - 10);
  }
  // A gentle bend: the control point is pushed sideways by a fifth of the length.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const bend = 0.2;
  const arrow = { x1, y1, cx: (x1 + x2) / 2 - dy * bend, cy: (y1 + y2) / 2 + dx * bend, x2, y2 };
  return { left, top, side, arrow };
}

/** The part of `r` inside the window, grown by `pad` (null when off screen). */
export function visible(r: Rect, vw: number, vh: number, pad: number): Rect | null {
  const x0 = Math.max(r.x - pad, 2);
  const y0 = Math.max(r.y - pad, 2);
  const x1 = Math.min(r.x + r.w + pad, vw - 2);
  const y1 = Math.min(r.y + r.h + pad, vh - 2);
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
