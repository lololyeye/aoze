import { CircleAlert, Columns2, Loader2, Pause, Play, SplitSquareHorizontal, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { IconButton } from "../../components/ui/Button";
import { useMessages } from "../../i18n";
import { fileUrl } from "../../services/api";
import { useUiStore } from "../../stores/uiStore";
import { formatClock } from "../../utils/format";
import s from "./ClipViewer.module.css";

interface ClipViewerProps {
  clipKey: string;
  /** Playable source (original, or its H.264 preview copy); null while the copy is being made. */
  original: string | null;
  usesPreviewCopy: boolean;
  poster: string | null;
  result: string | null;
  processing: boolean;
  /** Badge of a single clip (default: "Original"). */
  label?: string;
}

/**
 * Plays the clip; with a result, compares both (split slider or side by side).
 * The result drives playback and the original follows it.
 *
 * The split never applies clip-path to a <video>: Chromium may move video into
 * a hardware overlay that ignores it, which shows black. The result is instead
 * shown through an overflow-hidden window, and the split position is a CSS
 * variable updated without re-rendering React.
 */
export function ClipViewer({ clipKey, original, usesPreviewCopy, poster, result, processing, label }: ClipViewerProps) {
  const t = useMessages();
  const mode = useUiStore((st) => st.viewerMode);
  const setMode = useUiStore((st) => st.setViewerMode);
  const stageRef = useRef<HTMLDivElement>(null);
  const origRef = useRef<HTMLVideoElement>(null);
  const resRef = useRef<HTMLVideoElement>(null);
  const split = useRef(0.5);
  const dragging = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const side = Boolean(result) && mode === "side";

  // Width of the stage and split position as CSS variables (px).
  const applySplit = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const w = el.clientWidth;
    el.style.setProperty("--stage-w", `${w}px`);
    el.style.setProperty("--split-px", `${Math.round(split.current * w)}px`);
  }, []);

  useLayoutEffect(() => {
    split.current = 0.5;
    applySplit();
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(applySplit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applySplit, clipKey, side]);

  const master = useCallback(() => (result ? resRef.current : origRef.current), [result]);
  const follower = useCallback(() => (result ? origRef.current : null), [result]);

  // Keep the original aligned with the result.
  useEffect(() => {
    const m = master();
    if (!m) return;
    const onTime = () => {
      setTime(m.currentTime);
      const f = follower();
      if (f && Math.abs(f.currentTime - m.currentTime) > 0.12) f.currentTime = m.currentTime;
    };
    const onMeta = () => setDuration(m.duration || 0);
    const onPlay = () => {
      setPlaying(true);
      void follower()?.play().catch(() => undefined);
    };
    const onPause = () => {
      setPlaying(false);
      follower()?.pause();
    };
    m.addEventListener("timeupdate", onTime);
    m.addEventListener("loadedmetadata", onMeta);
    m.addEventListener("play", onPlay);
    m.addEventListener("pause", onPause);
    if (m.readyState >= 1) onMeta();
    return () => {
      m.removeEventListener("timeupdate", onTime);
      m.removeEventListener("loadedmetadata", onMeta);
      m.removeEventListener("play", onPlay);
      m.removeEventListener("pause", onPause);
    };
  }, [master, follower, clipKey, result, original]);

  const toggle = () => {
    const m = master();
    if (!m) return;
    if (m.paused) void m.play().catch(() => undefined);
    else m.pause();
  };

  const seek = (v: number) => {
    const m = master();
    if (!m) return;
    m.currentTime = v;
    const f = follower();
    if (f) f.currentTime = v;
    setTime(v);
  };

  // Space toggles playback (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement)?.closest("input, textarea, [role=dialog]")) return;
      e.preventDefault();
      const m = result ? resRef.current : origRef.current;
      if (!m) return;
      if (m.paused) void m.play().catch(() => undefined);
      else m.pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    split.current = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    applySplit();
  };
  const endDrag = () => {
    dragging.current = false;
  };

  const onError = (which: string) => () => setFailed(which);

  return (
    <div className={s.root}>
      <div ref={stageRef} className={`${s.stage} ${side ? s.side : ""}`}>
        <div className={s.pane}>
          {original ? (
            <video
              ref={origRef}
              key={`o-${clipKey}-${original}`}
              src={fileUrl(original)}
              poster={poster ? fileUrl(poster) : undefined}
              className={s.video}
              muted={result ? true : muted}
              playsInline
              preload="auto"
              loop
              onClick={toggle}
              onError={onError(original)}
            />
          ) : (
            <div className={s.pending}>
              {poster && <img src={fileUrl(poster)} alt="" className={s.posterImg} />}
              <div className={s.pendingLabel}>
                <Loader2 size={15} className={s.spin} />
                {t.viewer.preparing}
              </div>
            </div>
          )}
          {(side || !result) && <span className={`${s.badge} ${s.left}`}>{label ?? t.viewer.original}</span>}
        </div>
        {result &&
          (side ? (
            <div className={s.pane}>
              <video ref={resRef} key={`r-${result}`} src={fileUrl(result)} className={s.video} muted={muted} playsInline preload="auto" loop onClick={toggle} onError={onError(result)} />
              <span className={`${s.badge} ${s.left}`}>{t.viewer.upscaled}</span>
            </div>
          ) : (
            <div className={s.window}>
              <video
                ref={resRef}
                key={`r-${result}`}
                src={fileUrl(result)}
                className={`${s.video} ${s.windowVideo}`}
                muted={muted}
                playsInline
                preload="auto"
                loop
                onClick={toggle}
                onError={onError(result)}
              />
            </div>
          ))}
        {result && !side && (
          <>
            <div className={s.handle} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
              <div className={s.line} />
              <div className={s.knob}>
                <SplitSquareHorizontal size={14} />
              </div>
            </div>
            <span className={`${s.badge} ${s.left}`}>{t.viewer.original}</span>
            <span className={`${s.badge} ${s.right}`}>{t.viewer.upscaled}</span>
          </>
        )}
        {processing && <div className={s.scan} />}
        {failed && (
          <div className={s.error}>
            <CircleAlert size={16} />
            {t.viewer.cannotPlay}
          </div>
        )}
      </div>

      {usesPreviewCopy && !result && original && <div className={s.notice}>{t.viewer.previewCopy}</div>}

      <div className={s.controls}>
        <IconButton label={playing ? t.viewer.pause : t.viewer.play} size="sm" onClick={toggle} tooltipSide="top" disabled={!original}>
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <span className={s.time}>{formatClock(time * 1000)}</span>
        <input
          type="range"
          className={s.timeline}
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(time, duration || 0)}
          aria-label="timeline"
          style={{ ["--pct" as string]: `${duration ? (time / duration) * 100 : 0}%` }}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className={s.time}>{formatClock(duration * 1000)}</span>
        <IconButton label={muted ? t.viewer.unmute : t.viewer.mute} size="sm" onClick={() => setMuted((m) => !m)} tooltipSide="top">
          {muted ? <VolumeX /> : <Volume2 />}
        </IconButton>
        {result && (
          <>
            <span className={s.sep} />
            <IconButton label={t.viewer.split} size="sm" active={mode === "split"} onClick={() => setMode("split")} tooltipSide="top">
              <SplitSquareHorizontal />
            </IconButton>
            <IconButton label={t.viewer.sideBySide} size="sm" active={mode === "side"} onClick={() => setMode("side")} tooltipSide="top">
              <Columns2 />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
