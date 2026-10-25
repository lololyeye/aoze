import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

const FIT_MARGIN = 0.92;
const MAX_PIXEL_ZOOM = 32;

export function fitView(pane: Size, world: Size): View {
  if (!pane.w || !pane.h || !world.w || !world.h) return { zoom: 1, x: 0, y: 0 };
  const zoom = Math.min(pane.w / world.w, pane.h / world.h) * FIT_MARGIN;
  return { zoom, x: (pane.w - world.w * zoom) / 2, y: (pane.h - world.h * zoom) / 2 };
}

/** Zooms by `factor` keeping the point (cx, cy) of the pane fixed. */
export function zoomAt(view: View, factor: number, cx: number, cy: number, min: number, max: number): View {
  const zoom = Math.min(max, Math.max(min, view.zoom * factor));
  const k = zoom / view.zoom;
  return { zoom, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
}

/**
 * Pan / zoom state for a pane showing a `world`-sized image. Stays "fitted"
 * (recomputed on every resize) until the user zooms or pans.
 */
export function useViewport(world: Size, paneCount: 1 | 2, worldKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState(true);
  const [fittedKey, setFittedKey] = useState(`${worldKey}|${paneCount}`);
  const dpr = window.devicePixelRatio || 1;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setPane({ w: paneCount === 2 ? (r.width - 1) / 2 : r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paneCount]);

  // A new image (or layout) starts fitted.
  const key = `${worldKey}|${paneCount}`;
  if (key !== fittedKey) {
    setFittedKey(key);
    setFitted(true);
  }
  const fittedView = useMemo(() => fitView(pane, { w: world.w, h: world.h }), [pane, world.w, world.h]);
  const shown = fitted ? fittedView : view;

  const minZoom = Math.min(fittedView.zoom * 0.5, 0.05);
  const maxZoom = MAX_PIXEL_ZOOM / dpr;

  // Leaving the fitted state starts from the view currently on screen.
  const fromShown = useCallback(
    (update: (v: View) => View) => {
      setFitted(false);
      setView((v) => update(fitted ? fittedView : v));
    },
    [fitted, fittedView],
  );

  const fitToScreen = useCallback(() => setFitted(true), []);

  const actualPixels = useCallback(
    () => fromShown((v) => zoomAt(v, 1 / dpr / v.zoom, pane.w / 2, pane.h / 2, 0.01, 1000)),
    [fromShown, pane, dpr],
  );

  const zoomBy = useCallback(
    (factor: number, cx = pane.w / 2, cy = pane.h / 2) => fromShown((v) => zoomAt(v, factor, cx, cy, minZoom, maxZoom)),
    [fromShown, pane, minZoom, maxZoom],
  );

  const panBy = useCallback((dx: number, dy: number) => fromShown((v) => ({ ...v, x: v.x + dx, y: v.y + dy })), [fromShown]);

  // Wheel must be non-passive to prevent the page from scrolling. Events are
  // merged per frame: fast wheels and touchpads fire far more often than 60 Hz.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let factor = 1;
    let at = { x: 0, y: 0 };
    let frame = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      let cx = e.clientX - r.left;
      if (paneCount === 2 && cx > pane.w) cx -= pane.w + 1;
      factor *= Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      at = { x: cx, y: e.clientY - r.top };
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          zoomBy(factor, at.x, at.y);
          factor = 1;
        });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, [zoomBy, paneCount, pane.w]);

  return { ref, pane, view: shown, dpr, fitToScreen, actualPixels, zoomBy, panBy, isFitted: fitted };
}
