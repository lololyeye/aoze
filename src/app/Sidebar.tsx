import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowDownToLine, ArrowLeftRight, CircleHelp, Coffee, Film, History, House, Images, Settings2 } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Tooltip } from "../components/ui/Tooltip";
import { fmt, useMessages } from "../i18n";
import { safely } from "../services/actions";
import { useGroupJobs, useQueueStore, type Group } from "../stores/queueStore";
import { useSystemStore } from "../stores/systemStore";
import { useUpdateStore } from "../stores/updateStore";
import { useUiStore, type Page } from "../stores/uiStore";
import s from "./Sidebar.module.css";

export const KOFI_URL = "https://ko-fi.com/aoze_support";

function Item({ page, icon, label, badge }: { page: Page; icon: ReactNode; label: string; badge?: ReactNode }) {
  const current = useUiStore((st) => st.page);
  const setPage = useUiStore((st) => st.setPage);
  const active = current === page;
  return (
    <Tooltip content={label} side="right">
      <button type="button" data-tour={`nav-${page}`} className={`${s.item} ${active ? s.active : ""}`} aria-current={active ? "page" : undefined} onClick={() => setPage(page)}>
        {/* One shared highlight that glides to the selected section. */}
        {active && (
          <motion.span layoutId="sidebar-active" className={s.highlight} transition={{ type: "spring", stiffness: 480, damping: 38, mass: 0.8 }}>
            <span className={s.line} />
          </motion.span>
        )}
        <span className={s.icon}>{icon}</span>
        <span className={s.label}>{label}</span>
        {badge}
      </button>
    </Tooltip>
  );
}

function CountBadge({ group }: { group: Group }) {
  const jobs = useGroupJobs(group);
  const active = useQueueStore((st) => st.activeJob);
  if (!jobs.length) return null;
  const busy = jobs.some((j) => j.id === active);
  return <span className={`${s.badge} ${busy ? s.busy : ""}`}>{jobs.length}</span>;
}

/** The installed version, or the pending update (opens its dialog). */
function VersionItem() {
  const t = useMessages();
  const version = useSystemStore((st) => st.status?.appVersion);
  const phase = useUpdateStore((st) => st.phase);
  const info = useUpdateStore((st) => st.info);
  const progress = useUpdateStore((st) => st.progress);
  const setOpen = useUpdateStore((st) => st.setOpen);
  if (info && phase !== "idle" && phase !== "checking" && phase !== "upToDate") {
    const label =
      phase === "downloading"
        ? fmt(t.update.sidebarDownloading, { percent: progress?.total ? Math.round((progress.received / progress.total) * 100) : 0 })
        : phase === "ready"
          ? t.update.sidebarReady
          : fmt(t.update.sidebarAvailable, { version: info.version });
    return (
      <Tooltip content={label} side="right">
        <button type="button" className={`${s.item} ${s.update}`} onClick={() => setOpen(true)}>
          <span className={s.icon}>
            <ArrowDownToLine />
          </span>
          <span className={s.label}>{label}</span>
        </button>
      </Tooltip>
    );
  }
  return version ? <div className={s.version}>Aoze {version}</div> : null;
}

export function Sidebar() {
  const t = useMessages();
  return (
    <nav className={s.sidebar} aria-label="Main">
      <div className={s.group}>
        <Item page="home" icon={<House />} label={t.nav.home} />
        <Item page="image" icon={<Images />} label={t.nav.image} badge={<CountBadge group="image" />} />
        <Item page="clip" icon={<Film />} label={t.nav.clip} badge={<CountBadge group="clip" />} />
        <Item page="convert" icon={<ArrowLeftRight />} label={t.nav.convert} badge={<CountBadge group="convert" />} />
      </div>
      <div className={s.divider} />
      <div className={s.group}>
        <Item page="history" icon={<History />} label={t.nav.history} />
        <Item page="settings" icon={<Settings2 />} label={t.nav.settings} />
        <Item page="help" icon={<CircleHelp />} label={t.nav.help} />
      </div>
      <div className={s.spacer} />
      <Tooltip content="ko-fi.com/aoze_support" side="right">
        <button type="button" className={`${s.item} ${s.support}`} onClick={safely(() => openUrl(KOFI_URL))}>
          <span className={s.icon}>
            <Coffee />
          </span>
          <span className={s.label}>{t.app.support}</span>
        </button>
      </Tooltip>
      <VersionItem />
    </nav>
  );
}
