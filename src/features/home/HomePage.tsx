import { motion } from "motion/react";
import { ArrowLeftRight, ArrowRight, CircleHelp, Film, Images } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "../../app/Logo";
import { Button } from "../../components/ui/Button";
import { useMessages } from "../../i18n";
import { pickFiles, safely } from "../../services/actions";
import { useGroupJobs, type Group } from "../../stores/queueStore";
import { useUiStore } from "../../stores/uiStore";
import s from "./HomePage.module.css";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Light streak and a few sparks: pictures. */
function ImageArt() {
  return (
    <svg className={s.art} viewBox="0 0 300 200" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
      <defs>
        <linearGradient id="home-streak" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="0.55" stopColor="#6fb6ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#9a8cff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="home-glow">
          <stop offset="0" stopColor="#7fb7ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7fb7ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="225" cy="58" rx="56" ry="26" fill="url(#home-glow)" transform="rotate(-35 225 58)" />
      <path d="M150 150 C 200 115, 240 75, 300 15" stroke="url(#home-streak)" strokeWidth="1.6" fill="none" />
      <path d="M175 160 C 215 125, 255 90, 300 50" stroke="url(#home-streak)" strokeWidth="0.8" fill="none" opacity="0.6" />
      <g fill="#cfe4ff">
        <circle cx="226" cy="56" r="2.2" opacity="0.9" />
        <circle cx="256" cy="34" r="1" opacity="0.6" />
        <circle cx="200" cy="96" r="1.2" opacity="0.5" />
        <circle cx="272" cy="80" r="0.8" opacity="0.5" />
      </g>
    </svg>
  );
}

/** A small night scene: clips. */
function ClipArt() {
  return (
    <svg className={s.art} viewBox="0 0 300 200" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="home-moon">
          <stop offset="0" stopColor="#8fb3d9" stopOpacity="0.28" />
          <stop offset="1" stopColor="#8fb3d9" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="250" cy="38" r="42" fill="url(#home-moon)" />
      <circle cx="250" cy="38" r="5" fill="#cfe0f2" opacity="0.55" />
      <path d="M150 120 L196 96 L232 110 L268 88 L300 100 L300 200 L150 200 Z" fill="#142235" opacity="0.75" />
      <g fill="#0a1019">
        <path d="M222 128 L222 108 L238 95 L254 108 L254 128 Z" />
        <path d="M258 128 L268 72 L278 128 Z" />
        <path d="M274 128 L286 56 L298 128 Z" />
        <path d="M206 128 L214 90 L222 128 Z" />
        <rect x="150" y="126" width="150" height="74" />
      </g>
      <rect x="235" y="113" width="5" height="5" fill="#f3c36b" opacity="0.85" />
    </svg>
  );
}

/** Flowing lines: one format becoming another. */
function ConvertArt() {
  return (
    <svg className={s.art} viewBox="0 0 400 110" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="home-wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--accent)" stopOpacity="0.45" />
          <stop offset="1" stopColor="#6fb6ff" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={`M60 ${92 - i * 4} C 160 ${100 - i * 6}, 210 ${20 + i * 8}, 300 ${30 + i * 6} S 400 ${70 - i * 5}, 430 ${50 - i * 3}`}
          stroke="url(#home-wave)"
          strokeWidth={i === 2 ? 1.4 : 0.8}
          fill="none"
          opacity={1 - i * 0.14}
        />
      ))}
    </svg>
  );
}

function Card({ group, index, icon, art }: { group: Group; index: number; icon: ReactNode; art: ReactNode }) {
  const t = useMessages();
  const setPage = useUiStore((st) => st.setPage);
  const count = useGroupJobs(group).length;
  const clip = group === "clip";
  const formats = (clip ? t.home.formatsClip : t.home.formatsImage).split("·").map((f) => f.trim());
  return (
    <motion.div className={s.cardWrap} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 + index * 0.06, ease: EASE }}>
      <button type="button" data-tour={`home-${group}`} className={s.card} onClick={safely(() => pickFiles(group))}>
        {art}
        <span className={s.icon}>{icon}</span>
        <span className={s.cardTitle}>{clip ? t.home.clipTitle : t.home.imageTitle}</span>
        <span className={s.cardBody}>{clip ? t.home.clipBody : t.home.imageBody}</span>
        <span className={s.chips}>
          {formats.map((f) => (
            <span key={f} className={s.chip}>
              {f}
            </span>
          ))}
        </span>
        <span className={s.cta}>
          {t.home.browse}
          <ArrowRight size={14} />
        </span>
      </button>
      {count > 0 && (
        <button type="button" className={s.resume} onClick={() => setPage(group)}>
          {count} · {clip ? t.nav.clip : t.nav.image}
          <ArrowRight size={12} />
        </button>
      )}
    </motion.div>
  );
}

export function HomePage() {
  const t = useMessages();
  const setPage = useUiStore((st) => st.setPage);
  const hover = useUiStore((st) => st.dragHover);
  return (
    <div className={`${s.home} ${hover ? s.hover : ""}`}>
      <div className={s.center}>
        <motion.div className={s.brand} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
          <LogoMark size={46} />
        </motion.div>
        <h1 className={s.title}>{t.home.title}</h1>
        <div className={s.grid}>
          <Card group="image" index={0} icon={<Images size={22} strokeWidth={1.7} />} art={<ImageArt />} />
          <Card group="clip" index={1} icon={<Film size={22} strokeWidth={1.7} />} art={<ClipArt />} />
          <motion.div data-tour="home-convert" className={s.convert} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.17, ease: EASE }}>
            <ConvertArt />
            <span className={s.icon}>
              <ArrowLeftRight size={22} strokeWidth={1.7} />
            </span>
            <div className={s.convertText}>
              <span className={s.convertTitle}>{t.nav.convert}</span>
              <span className={s.cardBody}>{t.home.convertBody}</span>
            </div>
            <Button size="md" icon={<ArrowRight />} className={s.convertButton} onClick={() => setPage("convert")}>
              {t.home.openConvert}
            </Button>
          </motion.div>
        </div>
        <div className={s.footer} data-tour="home-drop">
          <span>{t.home.drop}</span>
          <span className={s.dot} />
          <button type="button" className={s.how} onClick={() => setPage("help")}>
            <CircleHelp size={13} />
            {t.home.howItWorks}
          </button>
        </div>
      </div>
      <footer className={s.signature}>{t.app.signature}</footer>
    </div>
  );
}
