import { Columns2, Maximize, Minus, Pause, Play, Plus, Scan, SplitSquareHorizontal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { IconButton } from "../../components/ui/Button";
import { fmt, useMessages } from "../../i18n";
import { fileUrl } from "../../services/api";
import { useSystemStore } from "../../stores/systemStore";
import { useUiStore, type ViewerMode } from "../../stores/uiStore";
import { useViewport, type View } from "./useViewport";
import s from "./BeforeAfterViewer.module.css";

/** Matches PREVIEW_PROXY_MAX_SIDE in the backend. */
const PROXY_MAX_SIDE = 4096;
/** Above this, the full-resolution file is never loaded in the webview
 *  (decoding 100 MP takes ~400 MB of memory; less on modest PCs). */
function fullResMaxMp(): number {
  return useSystemStore.getState().check?.profile?.memory === "low" ? 36 : 100;
}

export interface ViewerImage {
  path: string;
  /** Downscaled rendition for huge images, if any. */
  proxy: string | null;
  width: number;
  height: number;
}

interface ViewerProps {
  imageKey: string;
  original: ViewerImage;
  result: ViewerImage | null;
  processing: boolean;
  /** Logical output size shown before a result exists. */
  targetSize: { w: number; h: number };
  /** GIFs: offer play / pause. */
  animated?: boolean;
}

/** Chooses proxy or full file depending on how many screen pixels the image covers. */
function pickSource(img: ViewerImage, displayedWidthDevicePx: number): { url: string; limited: boolean } {
  if (!img.proxy) return { url: fileUrl(img.path), limited: false };
  const proxyWidth = Math.round(img.width * Math.min(1, PROXY_MAX_SIDE / Math.max(img.width, img.height)));
  const needsFull = displayedWidthDevicePx > proxyWidth * 1.05;
  const fullAllowed = (img.width * img.height) / 1e6 <= fullResMaxMp();
  if (needsFull && fullAllowed) return { url: fileUrl(img.path), limited: false };
  return { url: fileUrl(img.proxy), limited: needsFull };
}

/** Clip of the result layer, computed by the compositor from CSS variables so
 *  moving the split re-renders nothing: --split-px (canvas), --vx / --vz (world). */
const SPLIT_CLIP = "inset(0 0 0 max(0px, calc((var(--split-px, 0px) - var(--vx, 0px)) / var(--vz, 1))))";

function Layer({ img, world, view, dpr, split, hidden, paused, syncTag, onReady }: {
  img: ViewerImage;
  world: { w: number; h: number };
  view: View;
  dpr: number;
  /** Clip to the right of the split line. */
  split?: boolean;
  hidden?: boolean;
  /** Animated images: freeze the frame currently shown. */
  paused?: boolean;
  /** Changing it restarts an animated image (keeps two GIFs in step). */
  syncTag?: number;
  onReady?: () => void;
}) {
  const displayed = world.w * view.zoom * dpr;
  const source = pickSource(img, displayed).url;
  const url = syncTag ? `${source}?sync=${syncTag}` : source;
  const pixelSize = displayed / img.width;
  // Visible once the first rendition loaded; later swaps (proxy -> full, sync) never blank it.
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = imgRef.current;
    const canvas = canvasRef.current;
    if (!paused || !el || !canvas) return;
    // Drawing an animated image paints the frame on screen right now.
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    canvas.getContext("2d")?.drawImage(el, 0, 0);
  }, [paused]);
  const style: CSSProperties = {
    width: world.w,
    height: world.h,
    imageRendering: pixelSize >= 3 ? "pixelated" : "auto",
    clipPath: split ? SPLIT_CLIP : undefined,
    // A result with another aspect ratio (Discord crop) is compared with the same centred crop.
    objectFit: "cover",
    opacity: hidden ? 0 : ready ? 1 : 0.001,
  };
  return (
    <>
      <img
        ref={imgRef}
        src={url}
        alt=""
        draggable={false}
        className={s.layer}
        style={{ ...style, visibility: paused ? "hidden" : undefined }}
        onLoad={() => {
          setReady(true);
          onReady?.();
        }}
        decoding="async"
      />
      {paused && <canvas ref={canvasRef} className={s.layer} style={style} />}
    </>
  );
}

export function BeforeAfterViewer({ imageKey, original, result, processing, targetSize, animated }: ViewerProps) {
  const t = useMessages();
  const mode = useUiStore((st) => st.viewerMode);
  const setMode = useUiStore((st) => st.setViewerMode);
  const effectiveMode: ViewerMode = result ? mode : "split";
  const panes = effectiveMode === "side" && result ? 2 : 1;
  const world = result ? { w: result.width, h: result.height } : targetSize;

  // Keyed by the image only: zoom and pan survive the result appearing.
  const { ref: canvasRef, view, pane, dpr, fitToScreen, actualPixels, zoomBy, panBy, isFitted } = useViewport(world, panes, imageKey);
  // Split as a fraction in a ref + a CSS variable: dragging never re-renders.
  const split = useRef(0.5);
  const frame = useRef(0);
  const applySplit = useCallback(() => {
    canvasRef.current?.style.setProperty("--split-px", `${split.current * pane.w}px`);
  }, [canvasRef, pane.w]);
  useLayoutEffect(() => {
    split.current = 0.5;
  }, [imageKey]);
  useLayoutEffect(applySplit, [applySplit, imageKey, result]);
  // Two animated GIFs restart together once both are loaded, then stay in step.
  const [syncTag, setSyncTag] = useState({ key: "", tag: 0 });
  const readyCount = useRef(0);
  const syncKey = `${imageKey}|${result?.path ?? ""}`;
  useLayoutEffect(() => {
    readyCount.current = 0;
  }, [syncKey]);
  const onLayerReady = useCallback(() => {
    readyCount.current += 1;
    if (animated && result && readyCount.current === 2) setSyncTag({ key: syncKey, tag: Date.now() });
  }, [animated, result, syncKey]);
  const tag = syncTag.key === syncKey ? syncTag.tag : 0;
  const [holdOriginal, setHoldOriginal] = useState(false);
  const [paused, setPaused] = useState(false);
  const drag = useRef<{ kind: "pan" | "split"; x: number; y: number } | null>(null);
  const pendingPan = useRef({ x: 0, y: 0 });
  const panFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(panFrame.current), []);

  // Keyboard: F fit, 1 actual pixels, +/- zoom, hold Space for the original.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest("input, textarea, [role=dialog]");
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") fitToScreen();
      else if (e.key === "1") actualPixels();
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
      else if (e.code === "Space" && result) {
        e.preventDefault();
        setHoldOriginal(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setHoldOriginal(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [fitToScreen, actualPixels, zoomBy, result]);

  const onPointerDown = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const kind = (e.target as HTMLElement).closest(`.${s.handle}`) ? "split" : "pan";
    drag.current = { kind, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      if (d.kind === "split") {
        const r = e.currentTarget.getBoundingClientRect();
        split.current = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(applySplit);
      } else {
        // Pan once per frame with the movement accumulated since the last one.
        pendingPan.current.x += e.clientX - d.x;
        pendingPan.current.y += e.clientY - d.y;
        d.x = e.clientX;
        d.y = e.clientY;
        if (!panFrame.current)
          panFrame.current = requestAnimationFrame(() => {
            panFrame.current = 0;
            const p = pendingPan.current;
            pendingPan.current = { x: 0, y: 0 };
            panBy(p.x, p.y);
          });
      }
    },
    [panBy, applySplit],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const worldStyle: CSSProperties = {
    width: world.w,
    height: world.h,
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
    ["--inv-zoom" as string]: 1 / view.zoom,
    ["--vx" as string]: `${view.x}px`,
    ["--vz" as string]: view.zoom,
  };
  const limited = result ? pickSource(result, world.w * view.zoom * dpr).limited : false;
  const zoomPct = Math.round(view.zoom * dpr * 100);

  const renderPane = (content: "original" | "result" | "split", key: string) => (
    <div className={s.pane} key={key}>
      <div className={s.world} style={worldStyle}>
        {(content === "original" || content === "split") && (
          <Layer key={original.path} img={original} world={world} view={view} dpr={dpr} paused={animated && paused} syncTag={tag} onReady={onLayerReady} />
        )}
        {result && (content === "result" || content === "split") && (
          <Layer
            key={result.path}
            img={result}
            world={world}
            view={view}
            dpr={dpr}
            split={content === "split"}
            hidden={holdOriginal}
            paused={animated && paused}
            syncTag={tag}
            onReady={onLayerReady}
          />
        )}
        {processing && <div className={s.scan} />}
      </div>
      {content !== "split" && <span className={`${s.badge} ${s.badgeLeft}`}>{content === "original" ? t.viewer.original : t.viewer.upscaled}</span>}
    </div>
  );

  return (
    <div className={s.root}>
      <div
        ref={canvasRef}
        className={`${s.canvas} ${panes === 2 ? s.twoPanes : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => (isFitted ? actualPixels() : fitToScreen())}
      >
        {panes === 2 ? [renderPane("original", "o"), renderPane("result", "r")] : renderPane("split", "s")}

        {panes === 1 && result && !holdOriginal && (
          <div className={s.handle}>
            <div className={s.handleLine} />
            <div className={s.handleKnob}>
              <SplitSquareHorizontal size={14} />
            </div>
          </div>
        )}
        {panes === 1 && (
          <>
            <span className={`${s.badge} ${s.badgeLeft}`}>{t.viewer.original}</span>
            {result && !holdOriginal && <span className={`${s.badge} ${s.badgeRight}`}>{t.viewer.upscaled}</span>}
          </>
        )}
      </div>

      {limited && <div className={s.notice}>{fmt(t.viewer.previewLimited, { size: PROXY_MAX_SIDE })}</div>}

      <div className={s.toolbar} onPointerDown={(e) => e.stopPropagation()}>
        {animated && (
          <>
            <IconButton label={paused ? t.viewer.play : t.viewer.pause} size="sm" onClick={() => setPaused((p) => !p)} tooltipSide="top">
              {paused ? <Play /> : <Pause />}
            </IconButton>
            <span className={s.sep} />
          </>
        )}
        {result && (
          <>
            <IconButton label={t.viewer.split} size="sm" active={mode === "split"} onClick={() => setMode("split")} tooltipSide="top">
              <SplitSquareHorizontal />
            </IconButton>
            <IconButton label={t.viewer.sideBySide} size="sm" active={mode === "side"} onClick={() => setMode("side")} tooltipSide="top">
              <Columns2 />
            </IconButton>
            <span className={s.sep} />
          </>
        )}
        <IconButton label={t.viewer.zoomOut} size="sm" onClick={() => zoomBy(0.8)} tooltipSide="top">
          <Minus />
        </IconButton>
        <button type="button" className={s.zoomLabel} onClick={actualPixels} title={t.viewer.actual}>
          {zoomPct}%
        </button>
        <IconButton label={t.viewer.zoomIn} size="sm" onClick={() => zoomBy(1.25)} tooltipSide="top">
          <Plus />
        </IconButton>
        <span className={s.sep} />
        <IconButton label={t.viewer.fit} size="sm" onClick={fitToScreen} tooltipSide="top">
          <Maximize />
        </IconButton>
        <IconButton label={t.viewer.actual} size="sm" onClick={actualPixels} tooltipSide="top">
          <Scan />
        </IconButton>
      </div>
    </div>
  );
}
