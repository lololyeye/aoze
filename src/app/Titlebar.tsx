import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info, Minus, Moon, Square, Sun, X } from "lucide-react";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { IconButton } from "../components/ui/Button";
import { Tooltip } from "../components/ui/Tooltip";
import { fmt, useMessages } from "../i18n";
import { queueStats, useQueueStore } from "../stores/queueStore";
import { useSettingsStore } from "../stores/settingsStore";
import { activeGpu, useSystemStore } from "../stores/systemStore";
import { useUiStore } from "../stores/uiStore";
import { LogoMark } from "./Logo";
import { useResolvedTheme } from "./useTheme";
import s from "./Titlebar.module.css";

type Tone = "ok" | "busy" | "warn" | "bad" | "idle";

function useStatus(): { tone: Tone; label: string; detail: string } {
  const t = useMessages();
  const status = useSystemStore((st) => st.status);
  const detecting = useSystemStore((st) => st.detecting);
  const gpuSetting = useSettingsStore((st) => st.settings?.upscale.gpu ?? null);
  const jobs = useQueueStore((st) => st.jobs);
  const paused = useQueueStore((st) => st.paused);
  if (!status || detecting) return { tone: "idle", label: t.status.checking, detail: "" };
  if (!status.engine.found) return { tone: "bad", label: t.status.noEngine, detail: status.engine.dir };
  const stats = queueStats(jobs);
  const gpu = activeGpu(status, gpuSetting);
  const device = gpuSetting === -1 ? t.status.cpuMode : gpu?.name ?? t.status.noGpu;
  const vk = status.vulkan.instanceVersion ? fmt(t.status.vulkan, { version: status.vulkan.instanceVersion }) : "";
  if (!status.vulkan.available && gpuSetting !== -1) return { tone: "warn", label: t.status.noGpu, detail: status.vulkan.error ?? "" };
  if (stats.processing > 0) return { tone: "busy", label: `${t.status.busy} · ${stats.processing + stats.waiting}`, detail: device };
  if (paused && stats.waiting > 0) return { tone: "warn", label: t.status.paused, detail: device };
  // Short label ("GPU · Ready"); the device name stays in the tooltip.
  const unit = gpuSetting === -1 || !gpu ? "CPU" : "GPU";
  return { tone: "ok", label: `${unit} · ${t.status.ready}`, detail: [device, vk].filter(Boolean).join(" · ") };
}

export function Titlebar() {
  const t = useMessages();
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  const openPanel = useUiStore((st) => st.openPanel);
  const theme = useResolvedTheme();
  const update = useSettingsStore((st) => st.update);
  const status = useStatus();

  useEffect(() => {
    const sync = () => void win.isMaximized().then(setMaximized);
    sync();
    const un = win.onResized(sync);
    return () => void un.then((f) => f());
  }, [win]);

  // The whole bar moves the window, except its buttons. One handler instead of
  // data-tauri-drag-region: that attribute does not cover child elements (logo,
  // name, gaps), and its built-in double-click would toggle twice with ours.
  const onBarMouseDown = (e: ReactMouseEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, [role=button]")) return;
    e.preventDefault();
    if (e.detail === 2) void win.toggleMaximize();
    else void win.startDragging();
  };

  return (
    <header className={s.bar} onMouseDown={onBarMouseDown}>
      <div className={s.brand}>
        <LogoMark size={17} />
        <span className={s.name}>Aoze</span>
      </div>

      <div className={s.right}>
        <Tooltip content={status.detail || null} side="bottom">
          <button type="button" data-tour="gpu" className={`${s.status} ${s[status.tone]}`} onClick={() => openPanel("diagnostics")}>
            <span className={s.dot} />
            <span className={s.statusText}>{status.label}</span>
          </button>
        </Tooltip>
        <span className={s.divider} />
        <IconButton
          label={theme === "dark" ? t.titlebar.themeDark : t.titlebar.themeLight}
          size="sm"
          onClick={() => update((st) => ({ ...st, theme: theme === "dark" ? "light" : "dark" }))}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </IconButton>
        <IconButton label={t.titlebar.about} size="sm" onClick={() => openPanel("about")}>
          <Info />
        </IconButton>
        <span className={s.divider} />
        <button type="button" className={s.winBtn} aria-label={t.titlebar.minimize} onClick={() => void win.minimize()}>
          <Minus size={15} />
        </button>
        <button type="button" className={s.winBtn} aria-label={t.titlebar.maximize} onClick={() => void win.toggleMaximize()}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="3.5" width="7" height="7" rx="1" />
              <path d="M3.5 3.5V2.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
            </svg>
          ) : (
            <Square size={12} />
          )}
        </button>
        <button type="button" className={`${s.winBtn} ${s.close}`} aria-label={t.titlebar.close} onClick={() => void win.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
