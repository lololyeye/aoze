import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { fmt, useMessages } from "../i18n";
import type { Messages } from "../i18n/en";
import { api } from "../services/api";
import { playChime, playWelcome } from "../services/sounds";
import { useSettingsStore } from "../stores/settingsStore";
import { useSystemStore } from "../stores/systemStore";
import type { SystemCheck } from "../types";
import { formatBytes } from "../utils/format";
import { Logo } from "./Logo";
import s from "./Splash.module.css";

/** Logo and light before the check starts. */
const INTRO_MS = 650;
/** Each check line stays at least this long so it can be read. */
const STEP_MS = 230;
/** With the voice, the lines are spread over what it says. */
const VOICE_STEP_MS = 420;
const READY_MS = 420;
/** The voice starts as the logo settles. */
const VOICE_DELAY_MS = 350;
/** Never hold the app longer than this, whatever the backend does. */
const CHECK_TIMEOUT_MS = 4000;
const MAX_SPLASH_MS = 12000;
/** Fade revealing the app; it ends as the voice ends. */
const FADE_S = 0.8;

type Step = { label: string; value: string | null };

function stepsFor(t: Messages, check: SystemCheck | null, mode: string): Step[] {
  const h = check?.profile?.hardware;
  const gpu = h ? (h.gpuName ? `${h.gpuName}${h.vramBytes ? ` · ${formatBytes(h.vramBytes)}` : ""}` : t.splash.cpuOnly) : null;
  const resources = h ? fmt(t.splash.resources, { ram: formatBytes(h.ramTotalBytes), threads: h.cpuThreads }) : null;
  return [
    { label: t.splash.system, value: null },
    { label: t.splash.gpu, value: gpu },
    { label: t.splash.resourcesLabel, value: resources },
    { label: t.splash.optimizing, value: mode },
  ];
}

/**
 * Launch sequence: logo, a soft light, a quick local system check (no
 * benchmark), then the welcome voice as the app appears. Click to skip.
 */
export function Splash({ sound, onDone }: { sound: boolean; onDone: () => void }) {
  const t = useMessages();
  const volume = useSettingsStore((st) => st.settings?.soundVolume ?? 40);
  const perf = useSettingsStore((st) => st.settings?.performance);
  const [visible, setVisible] = useState(true);
  const [check, setCheck] = useState<SystemCheck | null>(null);
  const [shown, setShown] = useState(0);
  const [ready, setReady] = useState(false);

  const modeName = perf ? `${t.settings.perfModes[perf.mode]}${perf.autoOptimize ? ` · ${t.splash.auto}` : ""}` : "";
  const steps = stepsFor(t, check, modeName);

  useEffect(() => {
    if (sound) playChime(volume);
    let alive = true;
    const started = performance.now();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), CHECK_TIMEOUT_MS));
    // The splash lasts as long as the welcome voice; without it, as long as the check.
    const voice: Promise<boolean> = sound
      ? wait(VOICE_DELAY_MS).then(() => (alive ? playWelcome(volume, FADE_S).then(() => true) : false)).catch(() => false)
      : Promise.resolve(false);
    let voiceDone = false;
    void voice.then(() => (voiceDone = true));
    void (async () => {
      await wait(INTRO_MS);
      if (!alive) return;
      setShown(1);
      const result = await Promise.race([api.systemCheck().catch(() => null), timeout]);
      if (!alive) return;
      setCheck(result);
      if (result) useSystemStore.setState({ check: result });
      // Detection may have finished meanwhile: refresh the GPU pill too.
      void useSystemStore.getState().load().catch(() => undefined);
      const step = sound && !voiceDone ? VOICE_STEP_MS : STEP_MS;
      const spent = performance.now() - started - INTRO_MS;
      if (spent < step) await wait(step - spent);
      for (let i = 2; i <= 4 && alive; i++) {
        setShown(i);
        await wait(step);
      }
      if (!alive) return;
      setReady(true);
      await wait(READY_MS);
      await Promise.race([voice, wait(Math.max(0, MAX_SPLASH_MS - (performance.now() - started)))]);
      if (alive) setVisible(false);
    })();
    return () => {
      alive = false;
    };
    // Runs once: the volume is read at launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          className={s.splash}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.01, transition: { duration: FADE_S, ease: [0.4, 0, 0.2, 1] } }}
          onClick={() => setVisible(false)}
        >
          <div className={s.center}>
            <div className={s.mark}>
              <span className={s.glow} />
              <motion.div
                initial={{ opacity: 0, scale: 0.82, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              >
                <Logo size={72} />
              </motion.div>
            </div>
            <motion.div
              className={s.name}
              initial={{ opacity: 0, y: 6, letterSpacing: "0.34em" }}
              animate={{ opacity: 1, y: 0, letterSpacing: "0.12em" }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              AOZE
            </motion.div>
            <div className={s.check} aria-live="polite">
              {steps.slice(0, shown).map((step, i) => {
                const done = ready || i < shown - 1 || (i === 0 && check !== null);
                return (
                  <motion.div key={i} className={s.row} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                    <span className={`${s.tick} ${done ? s.done : ""}`}>{done ? <Check size={11} strokeWidth={3} /> : <span className={s.dot} />}</span>
                    <span className={s.label}>{step.label}</span>
                    {step.value && <span className={s.value}>{step.value}</span>}
                  </motion.div>
                );
              })}
            </div>
            <div className={s.status}>
              <AnimatePresence mode="wait">
                <motion.span key={ready ? "ready" : "start"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className={ready ? s.ready : ""}>
                  {ready ? t.splash.ready : t.splash.starting}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
          <motion.div className={s.signature} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.45 }}>
            {t.app.signature}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
