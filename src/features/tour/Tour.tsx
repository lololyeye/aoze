import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowRight, MousePointerClick, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogoMark } from "../../app/Logo";
import { Button } from "../../components/ui/Button";
import { fmt, useMessages } from "../../i18n";
import { playTourVoice } from "../../services/sounds";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { place, visible, type Rect } from "./layout";
import { STEPS } from "./steps";
import { useTourStore } from "./tourStore";
import s from "./Tour.module.css";

/** Space between the element and the highlight's outline. */
const PAD = 6;
const BUBBLE_W = 330;
/** No element after this long (a page without it): a centred card with "Next". */
const MISSING_MS = 900;
const BANNER_MS = 2600;
const EASE = [0.22, 1, 0.36, 1] as const;

/** The first-launch tutorial (and its replay from Help). */
export function Tour() {
  const active = useTourStore((st) => st.active);
  if (!active) return null;
  // Its own motion setting: the arrows and the highlight are information, not decoration.
  return createPortal(
    <MotionConfig reducedMotion="never">
      <TourOverlay />
    </MotionConfig>,
    document.body,
  );
}

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

/** Finds the step's element (the visible one) and follows it, gliding from the previous one. */
function useHole(target: string | undefined, vw: number, vh: number, stepKey: number) {
  // `key`: the step the state belongs to (the previous step's hole glides on).
  const [state, setState] = useState<{ key: number; hole: Rect | null; missing: boolean }>({ key: -1, hole: null, missing: false });
  const shown = useRef<Rect | null>(null);

  useEffect(() => {
    if (!target) {
      shown.current = null;
      return;
    }
    const started = performance.now();
    let raf = 0;
    let last = started;
    let scrolled = false;
    const tick = (now: number) => {
      let want: Rect | null = null;
      for (const el of document.querySelectorAll(`[data-tour="${target}"]`)) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        // Below the fold of a scrolling panel: brought into view once.
        if (!scrolled && (r.top < 0 || r.bottom > vh) && r.height < vh) {
          scrolled = true;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        want = visible({ x: r.left, y: r.top, w: r.width, h: r.height }, vw, vh, PAD);
        if (want) break;
      }
      if (!want) {
        if (now - started > MISSING_MS) setState((st) => (st.key === stepKey && st.missing ? st : { key: stepKey, hole: st.hole, missing: true }));
      } else {
        const cur = shown.current;
        // Exponential glide (about 0.25 s), framerate independent.
        const k = cur ? 1 - Math.exp(-(now - last) / 70) : 1;
        const next = cur ? { x: cur.x + (want.x - cur.x) * k, y: cur.y + (want.y - cur.y) * k, w: cur.w + (want.w - cur.w) * k, h: cur.h + (want.h - cur.h) * k } : want;
        const moved = !cur || Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y) + Math.abs(next.w - cur.w) + Math.abs(next.h - cur.h) > 0.3;
        if (moved) {
          shown.current = next;
          setState({ key: stepKey, hole: next, missing: false });
        } else setState((st) => (st.key === stepKey && !st.missing ? st : { key: stepKey, hole: next, missing: false }));
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, vw, vh, stepKey]);

  const missing = state.key === stepKey && state.missing;
  return { hole: target && !missing ? state.hole : null, missing };
}

function TourOverlay() {
  const t = useMessages();
  const index = useTourStore((st) => st.index);
  const next = useTourStore((st) => st.next);
  const end = useTourStore((st) => st.end);
  const setPage = useUiStore((st) => st.setPage);
  const voice = useSettingsStore((st) => st.settings?.startupSound ?? true);
  const volume = useSettingsStore((st) => st.settings?.soundVolume ?? 40);
  const step = STEPS[index]!;
  const text = t.tour.steps[step.id];
  const { w: vw, h: vh } = useViewport();
  const { hole, missing } = useHole(step.target, vw, vh, index);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bh, setBh] = useState(180);
  const [nudge, setNudge] = useState(0);
  // The chapter banner shows when a chapter starts (set while rendering, hidden by a timer).
  const [bannerChapter, setBannerChapter] = useState<string | null>(null);
  const [bannerOn, setBannerOn] = useState(false);
  if (bannerChapter !== step.chapter) {
    setBannerChapter(step.chapter);
    setBannerOn(step.chapter !== "intro" && step.chapter !== "outro");
  }
  const banner = bannerOn ? bannerChapter : null;
  const lastChapter = useRef<string | null>(null);
  const centred = !step.target || missing;

  // The page behind the step (a replay may start anywhere).
  useEffect(() => {
    if (useUiStore.getState().page !== step.page) setPage(step.page);
  }, [step.page, setPage]);

  // A new chapter: its voice line ("Tutorial of clips"…).
  useEffect(() => {
    if (lastChapter.current === step.chapter) return;
    lastChapter.current = step.chapter;
    if (voice) playTourVoice(step.chapter, volume);
    // The voice settings are read when the chapter starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.chapter]);

  useEffect(() => {
    if (!bannerOn) return;
    const timer = window.setTimeout(() => setBannerOn(false), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [bannerOn, bannerChapter]);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    // Called once right away, then on every size change.
    const ro = new ResizeObserver(() => setBh(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, centred]);

  const advance = useCallback(() => {
    if (step.go) setPage(step.go);
    next();
  }, [step.go, setPage, next]);

  // The tour has the keyboard: Esc skips, Enter continues; app shortcuts wait.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      else if (e.key === "Enter") advance();
      else if (e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [advance, end]);

  const p = hole && !centred ? place(hole, BUBBLE_W, bh, vw, vh) : null;
  const n = index + 1;
  const total = STEPS.length;
  const arrow = p?.arrow;
  const len = arrow ? Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1) || 1 : 1;

  return (
    <div className={s.root} role="dialog" aria-modal="true" aria-label={`${t.tour.chapter} · ${t.tour.chapters[step.chapter]}`}>
      <svg className={s.svg} width={vw} height={vh} aria-hidden="true">
        <defs>
          <mask id="tour-mask">
            <rect width={vw} height={vh} fill="white" />
            {hole && !centred && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={10} fill="black" />}
          </mask>
          <marker id="tour-head" viewBox="0 0 12 12" refX="7" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M1.5 1.5 L9 6 L1.5 10.5" className={s.head} />
          </marker>
        </defs>
        <rect className={s.scrim} width={vw} height={vh} mask="url(#tour-mask)" onClick={() => setNudge((v) => v + 1)} />
        {arrow && (
          <g
            key={index}
            className={s.arrowGroup}
            data-keep-motion
            style={{ ["--bx" as string]: `${((arrow.x2 - arrow.x1) / len) * 4}px`, ["--by" as string]: `${((arrow.y2 - arrow.y1) / len) * 4}px` }}
          >
            <path className={s.arrowGlow} d={`M${arrow.x1} ${arrow.y1} Q${arrow.cx} ${arrow.cy} ${arrow.x2} ${arrow.y2}`} />
            <path
              className={s.arrow}
              data-keep-motion
              pathLength={1}
              d={`M${arrow.x1} ${arrow.y1} Q${arrow.cx} ${arrow.cy} ${arrow.x2} ${arrow.y2}`}
              markerEnd="url(#tour-head)"
            />
          </g>
        )}
      </svg>

      {hole && !centred && (
        <>
          <div key={`ring-${nudge}`} className={`${s.ring} ${nudge ? s.nudge : ""}`} data-keep-motion style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />
          <button type="button" className={s.hit} style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} onClick={advance} aria-label={text.title} />
        </>
      )}

      {centred ? (
        <div className={s.centre}>
          <motion.div
            key={`c-${index}`}
            ref={bubbleRef}
            className={`${s.bubble} ${s.card}`}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {(step.id === "intro" || step.id === "outro") && (
              <div className={s.logo}>
                <span className={s.logoGlow} />
                <LogoMark size={40} />
              </div>
            )}
            {step.id !== "intro" && step.id !== "outro" && <Header chapter={t.tour.chapters[step.chapter]} label={t.tour.chapter} counter={fmt(t.tour.stepOf, { n, total })} />}
            <h2 className={s.cardTitle}>{text.title}</h2>
            <p className={s.body}>{text.body}</p>
            <div className={s.cardActions}>
              {step.id === "intro" && (
                <>
                  <Button variant="ghost" size="md" onClick={end}>
                    {t.tour.skip}
                  </Button>
                  <Button variant="primary" size="md" icon={<ArrowRight />} onClick={advance} autoFocus>
                    {t.tour.start}
                  </Button>
                </>
              )}
              {step.id === "outro" && (
                <Button variant="primary" size="md" icon={<Sparkles />} onClick={end} autoFocus>
                  {t.tour.finish}
                </Button>
              )}
              {step.id !== "intro" && step.id !== "outro" && (
                <>
                  <Button variant="ghost" size="sm" onClick={end}>
                    {t.tour.skip}
                  </Button>
                  <Button variant="primary" size="sm" icon={<ArrowRight />} onClick={advance}>
                    {t.tour.next}
                  </Button>
                </>
              )}
            </div>
            {step.id !== "intro" && <Progress n={n} total={total} />}
          </motion.div>
        </div>
      ) : (
        p && (
          <motion.div
            key={`b-${index}`}
            ref={bubbleRef}
            className={s.bubble}
            style={{ left: p.left, top: p.top, width: BUBBLE_W }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.08 }}
          >
            <Header chapter={t.tour.chapters[step.chapter]} label={t.tour.chapter} counter={fmt(t.tour.stepOf, { n, total })} />
            <h3 className={s.title}>{text.title}</h3>
            <p className={s.body}>{text.body}</p>
            <div className={s.hint} data-keep-motion>
              <MousePointerClick size={15} />
              {t.tour.clickHint}
            </div>
            <div className={s.footer}>
              <Progress n={n} total={total} />
              <button type="button" className={s.skip} onClick={end}>
                {t.tour.skip}
              </button>
            </div>
          </motion.div>
        )
      )}

      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner}
            className={s.banner}
            initial={{ opacity: 0, y: -14, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -10, x: "-50%" }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <Sparkles size={14} />
            <span className={s.bannerLabel}>{t.tour.chapter}</span>
            <span className={s.bannerSep} />
            {t.tour.chapters[banner as keyof typeof t.tour.chapters]}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Header({ chapter, label, counter }: { chapter: string; label: string; counter: string }) {
  return (
    <div className={s.header}>
      <span className={s.chip}>
        <span className={s.dot} />
        {label} · {chapter}
      </span>
      <span className={s.counter}>{counter}</span>
    </div>
  );
}

function Progress({ n, total }: { n: number; total: number }) {
  return (
    <div className={s.progress} aria-hidden="true">
      <span className={s.progressFill} style={{ width: `${(n / total) * 100}%` }} />
    </div>
  );
}
