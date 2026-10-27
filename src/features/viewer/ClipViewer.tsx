import { CircleAlert, Columns2, Loader2, Pause, Play, SplitSquareHorizontal, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type SyntheticEvent } from "react";
import { IconButton } from "../../components/ui/Button";
import { fmt, useMessages } from "../../i18n";
import { fileUrl } from "../../services/api";
import { useUiStore } from "../../stores/uiStore";
import { formatClock } from "../../utils/format";
import { correction, timeMap } from "./clipSync";
import s from "./ClipViewer.module.css";

interface ClipViewerProps {
  clipKey: string;
  /** Playable source (original, or its light preview copy); null while the copy is being made. */
  original: string | null;
  usesPreviewCopy: boolean;
  poster: string | null;
  result: string | null;
  processing: boolean;
  /** 0..1 while processing. */
  progress?: number | null;
  /** Badge of a single clip (default: "Original"). */
  label?: string;
  /** Speed changes: [result time, original time] pairs, so both play the same moment. */
  timing?: [number, number][] | null;
  /** The result has another shape (Smart Reframe): only side by side makes sense. */
  reshaped?: boolean;
  /** Frame rates, for frame-by-frame steps (← →). */
  fps?: { original?: number; result?: number };
  /** The webview could not play a file: makes a light copy of it (true: of the result). */
  onUnplayable?: (result: boolean) => Promise<void>;
}

type Which = "orig" | "res";

/**
 * Plays the clip; with a result, compares both (split slider or side by side).
 *
 * One shared clock: the original drives playback (its sound is the one heard)
 * and the result follows it, corrected by small speed changes, or by a jump when
 * it is far off. With a speed change the result is the clock instead, since the
 * original's sound would not match. The position is kept in original time, so
 * a result arriving, a preview copy replacing a file or the clock changing
 * never restarts the clip. Before the result exists (while it is processed),
 * the original plays on its own, normally.
 *
 * The split never applies clip-path to a <video>: Chromium may move video into
 * a hardware overlay that ignores it, which shows black. The result is instead
 * shown through an overflow-hidden window, and the split position is a CSS
 * variable updated without re-rendering React: moving it never seeks or reloads.
 * The result stays invisible until its first frame is decoded, so the original
 * shows there instead of a black area.
 */
/** Mount it with `key` = the clip, so another clip starts from a clean state. */
export function ClipViewer({ clipKey, original, usesPreviewCopy, poster, result, processing, progress, label, timing, reshaped, fps, onUnplayable }: ClipViewerProps) {
  const t = useMessages();
  const mode = useUiStore((st) => st.viewerMode);
  const setMode = useUiStore((st) => st.setViewerMode);
  const stageRef = useRef<HTMLDivElement>(null);
  const origRef = useRef<HTMLVideoElement>(null);
  const resRef = useRef<HTMLVideoElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const clockLabel = useRef<HTMLSpanElement>(null);
  const split = useRef(0.5);
  const dragging = useRef(false);
  const scrubbing = useRef(false);
  /** Wanted state (the elements may pause briefly to wait for each other). */
  const wantPlay = useRef(false);
  /** Current position, in original time. */
  const pos = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  // Duration of each file, by path.
  const [durations, setDurations] = useState<Record<string, number>>({});
  // Files that failed to play, and files whose first frame is decoded.
  const [failed, setFailed] = useState<string[]>([]);
  const [ready, setReady] = useState<string[]>([]);
  const [repairing, setRepairing] = useState<Which | null>(null);
  const repaired = useRef(new Set<string>());

  const map = useMemo(() => timeMap(timing), [timing]);
  const origOk = Boolean(original) && !failed.includes(original!);
  const resOk = Boolean(result) && !failed.includes(result!);
  const resShown = resOk && ready.includes(result!);
  // The result is the clock with a speed change, or when the original can't play.
  const clockIsRes = resShown && (Boolean(timing?.length) || !origOk);
  const side = Boolean(result) && (mode === "side" || Boolean(reshaped));
  const duration = (clockIsRes ? durations[result!] : original ? durations[original] : 0) ?? 0;
  const live = useRef({ clockIsRes, resShown, origOk, map });
  useLayoutEffect(() => {
    live.current = { clockIsRes, resShown, origOk, map };
  });

  const els = useCallback(() => {
    const { clockIsRes, resShown, origOk } = live.current;
    const o = origOk ? origRef.current : null;
    const r = resShown ? resRef.current : null;
    return clockIsRes ? { clock: r, follower: o, followerIs: "orig" as Which } : { clock: o, follower: r, followerIs: "res" as Which };
  }, []);

  // Clock time <-> original time.
  const clockToPos = useCallback((ct: number) => (live.current.clockIsRes ? live.current.map.toOriginal(ct) : ct), []);
  const posToClock = useCallback((p: number) => (live.current.clockIsRes ? live.current.map.toResult(p) : p), []);

  /** Timeline and clock label, written to the DOM directly (no React render per frame). */
  const paint = useCallback(
    (ct: number) => {
      const range = rangeRef.current;
      if (range && !scrubbing.current) {
        range.value = String(ct);
        const max = Number(range.max) || 0;
        range.style.setProperty("--pct", `${max ? Math.min(100, (ct / max) * 100) : 0}%`);
      }
      if (clockLabel.current) clockLabel.current.textContent = formatClock(ct * 1000);
    },
    [],
  );

  /** Brings the follower to the clock: a jump when `hard` or far off, otherwise a speed nudge. */
  const align = useCallback((hard: boolean) => {
    const { clock, follower, followerIs } = els();
    if (!clock) return;
    const ct = clock.currentTime;
    if (!follower || follower.readyState < 1) return;
    const { map } = live.current;
    const end = Math.max(0, (follower.duration || 0) - 0.04);
    const want = Math.min(end, followerIs === "orig" ? map.toOriginal(ct) : map.toResult(ct));
    const base = followerIs === "orig" ? map.rateAt(ct) : 1 / map.rateAt(map.toResult(ct));
    const c = correction(want - follower.currentTime, base);
    if (hard || c.seek) {
      if (Math.abs(follower.currentTime - want) > 0.001 && !(follower.seeking && !hard)) follower.currentTime = want;
    }
    if (Math.abs(follower.playbackRate - c.rate) > 0.004) follower.playbackRate = c.rate;
    const clockRuns = wantPlay.current && !clock.paused;
    if (clockRuns && follower.paused && want < end) void follower.play().catch(() => undefined);
    if (!clockRuns && !follower.paused) follower.pause();
  }, [els]);

  // Playback loop: follows the clock every frame while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const { clock } = els();
      // A file being (re)loaded reads 0: the position is kept until it has a frame.
      if (clock && clock.readyState >= 2) {
        const ct = clock.currentTime;
        // A loop back to the start: the follower jumps with it.
        align(ct < last - 0.5);
        last = ct;
        pos.current = clockToPos(ct);
        paint(ct);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, els, align, clockToPos, paint]);

  const play = useCallback(() => {
    const { clock } = els();
    if (!clock) return;
    wantPlay.current = true;
    setPlaying(true);
    align(true);
    void clock.play().catch(() => undefined);
  }, [els, align]);

  const pause = useCallback(() => {
    wantPlay.current = false;
    setPlaying(false);
    const { clock, follower } = els();
    clock?.pause();
    follower?.pause();
    if (clock) {
      pos.current = clockToPos(clock.currentTime);
      paint(clock.currentTime);
    }
    // Same frame on both sides once stopped.
    align(true);
  }, [els, align, clockToPos, paint]);

  const toggle = useCallback(() => (wantPlay.current ? pause() : play()), [play, pause]);

  /** Seek, in clock time. */
  const seek = useCallback(
    (ct: number) => {
      const { clock } = els();
      if (!clock) return;
      const v = Math.max(0, Math.min(ct, clock.duration || ct));
      clock.currentTime = v;
      pos.current = clockToPos(v);
      paint(v);
      align(true);
    },
    [els, align, clockToPos, paint],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const { clock } = els();
      if (!clock) return;
      if (wantPlay.current) pause();
      // With a result, its frames: the in-between frames of Smooth Motion show one by one.
      const rate = (live.current.resShown ? Math.max(fps?.result ?? 0, fps?.original ?? 0) : fps?.original) || 30;
      // Aim at the middle of the next frame, so rounding never lands on the same one.
      const frame = Math.floor(clock.currentTime * rate + 1e-3) + dir;
      seek(Math.max(0, (frame + 0.5) / rate));
    },
    [els, pause, seek, fps],
  );

  // A new clock (result ready, a file replaced, the clock changing side):
  // it takes over the position and the play state, and only it is heard.
  useEffect(() => {
    const { clock, follower } = els();
    for (const el of [origRef.current, resRef.current]) if (el) el.muted = el !== clock || muted;
    if (!clock) return;
    if (clock.readyState >= 1) {
      const want = posToClock(pos.current);
      if (Math.abs(clock.currentTime - want) > 0.05) clock.currentTime = want;
      clock.playbackRate = 1;
      paint(clock.currentTime);
    }
    if (follower) follower.loop = false;
    clock.loop = true;
    if (wantPlay.current && clock.paused) void clock.play().catch(() => undefined);
    align(true);
  }, [clockIsRes, resShown, origOk, original, result, muted, els, align, posToClock, paint]);

  // The clock waiting for data holds the follower; the follower waiting holds the clock.
  useEffect(() => {
    const o = origRef.current;
    const r = resRef.current;
    const stall = { on: false, timer: 0 };
    const release = () => {
      window.clearTimeout(stall.timer);
      if (!stall.on) return;
      stall.on = false;
      const { clock } = els();
      if (wantPlay.current && clock?.paused) void clock.play().catch(() => undefined);
    };
    const onWaiting = (e: Event) => {
      if (!wantPlay.current) return;
      const { clock, follower } = els();
      if (e.target === clock) follower?.pause();
      else if (e.target === follower && clock && !clock.paused) {
        clock.pause();
        stall.on = true;
        // Never wait forever: the clock goes on, the follower catches up later.
        stall.timer = window.setTimeout(release, 2500);
      }
    };
    const onPlaying = (e: Event) => {
      const { clock, follower } = els();
      if (e.target === follower) release();
      if (e.target === clock) align(false);
    };
    const list: [string, EventListener][] = [
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["canplay", onPlaying],
    ];
    for (const el of [o, r]) for (const [n, f] of list) el?.addEventListener(n, f);
    return () => {
      window.clearTimeout(stall.timer);
      for (const el of [o, r]) for (const [n, f] of list) el?.removeEventListener(n, f);
    };
  }, [original, result, els, align]);

  // The element says which file it plays (data-which, data-path).
  const onLoaded = useCallback((e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const { which, path } = el.dataset as { which: Which; path: string };
    // Start where the comparison is, in this file's own time.
    const want = which === "orig" ? pos.current : live.current.map.toResult(pos.current);
    if (Math.abs(el.currentTime - want) > 0.05 && want < (el.duration || 0)) el.currentTime = want;
    setReady((r) => (r.includes(path) ? r : [...r, path]));
    setDurations((d) => ({ ...d, [path]: el.duration || 0 }));
  }, []);

  const onError = useCallback(
    (e: SyntheticEvent<HTMLVideoElement>) => {
      const { which, path } = e.currentTarget.dataset as { which: Which; path: string };
      setFailed((f) => (f.includes(path) ? f : [...f, path]));
      // Once per side: a light copy the webview surely plays.
      if (onUnplayable && !repaired.current.has(which)) {
        repaired.current.add(which);
        setRepairing(which);
        onUnplayable(which === "res")
          .catch(() => undefined)
          .finally(() => setRepairing((w) => (w === which ? null : w)));
      }
    },
    [onUnplayable],
  );

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

  // Space plays / pauses, ← → step one frame (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [role=dialog]")) return;
      if (e.code === "Space") toggle();
      else if (e.code === "ArrowRight") step(1);
      else if (e.code === "ArrowLeft") step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step]);

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

  const pct = Math.round((progress ?? 0) * 100);
  const resultLabel = !result && processing ? fmt(t.viewer.processingPct, { pct }) : null;
  const resProblem = result && !resOk ? (repairing === "res" ? t.viewer.preparing : t.viewer.afterUnavailable) : null;
  const origProblem = original && !origOk ? (repairing === "orig" ? t.viewer.preparing : t.viewer.cannotPlay) : null;
  const canPlay = origOk || resShown;

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
              muted
              playsInline
              preload="auto"
              onClick={toggle}
              data-which="orig"
              data-path={original}
              onLoadedData={onLoaded}
              onError={onError}
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
          {resultLabel && (
            <span className={`${s.badge} ${s.right} ${s.working}`}>
              <Loader2 size={11} className={s.spin} />
              {resultLabel}
            </span>
          )}
        </div>
        {result && (
          // Same element in both modes: switching never reloads the result.
          <div className={side ? s.pane : s.window}>
            {resOk && (
              <video
                ref={resRef}
                key={`r-${result}`}
                src={fileUrl(result)}
                className={`${s.video} ${side ? "" : s.windowVideo} ${resShown ? "" : s.hidden}`}
                muted
                playsInline
                preload="auto"
                onClick={toggle}
                data-which="res"
                data-path={result}
                onLoadedData={onLoaded}
                onError={onError}
              />
            )}
            {side && <span className={`${s.badge} ${s.left}`}>{t.viewer.upscaled}</span>}
            {(resProblem || (resOk && !resShown)) && (
              <div className={s.paneNote}>
                <span className={s.pendingLabel}>
                  {resProblem && repairing !== "res" ? <CircleAlert size={14} /> : <Loader2 size={14} className={s.spin} />}
                  {resProblem ?? t.viewer.preparing}
                </span>
              </div>
            )}
          </div>
        )}
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
        {origProblem && (
          <div className={s.error}>
            {repairing === "orig" ? <Loader2 size={16} className={s.spin} /> : <CircleAlert size={16} />}
            {origProblem}
          </div>
        )}
      </div>

      {usesPreviewCopy && !result && original && <div className={s.notice}>{t.viewer.previewCopy}</div>}

      <div className={s.controls}>
        <IconButton label={playing ? t.viewer.pauseClip : t.viewer.playClip} size="sm" onClick={toggle} tooltipSide="top" disabled={!canPlay}>
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <span ref={clockLabel} className={s.time}>
          {formatClock(0)}
        </span>
        <input
          ref={rangeRef}
          type="range"
          className={s.timeline}
          min={0}
          max={duration || 0}
          step={0.001}
          defaultValue={0}
          aria-label="timeline"
          disabled={!canPlay}
          onPointerDown={() => (scrubbing.current = true)}
          onPointerUp={() => (scrubbing.current = false)}
          onPointerCancel={() => (scrubbing.current = false)}
          onInput={(e) => {
            const v = Number(e.currentTarget.value);
            e.currentTarget.style.setProperty("--pct", `${duration ? (v / duration) * 100 : 0}%`);
            seek(v);
          }}
        />
        <span className={s.time}>{formatClock(duration * 1000)}</span>
        <IconButton label={muted ? t.viewer.unmute : t.viewer.mute} size="sm" onClick={() => setMuted((m) => !m)} tooltipSide="top">
          {muted ? <VolumeX /> : <Volume2 />}
        </IconButton>
        {result && (
          <>
            <span className={s.sep} />
            <IconButton
              label={reshaped ? t.viewer.splitReshaped : t.viewer.split}
              size="sm"
              active={!side}
              disabled={reshaped}
              onClick={() => setMode("split")}
              tooltipSide="top"
            >
              <SplitSquareHorizontal />
            </IconButton>
            <IconButton label={t.viewer.sideBySide} size="sm" active={side} onClick={() => setMode("side")} tooltipSide="top">
              <Columns2 />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
