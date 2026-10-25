import { Cpu, MemoryStick, MonitorCog } from "lucide-react";
import { useEffect } from "react";
import { Field } from "../../components/ui/Field";
import { Segmented } from "../../components/ui/Segmented";
import { Toggle } from "../../components/ui/Toggle";
import { fmt, useMessages } from "../../i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSystemStore } from "../../stores/systemStore";
import type { PerformanceMode, PerformanceSettings } from "../../types";
import { formatBytes } from "../../utils/format";
import s from "./SettingsPage.module.css";

/** Mode, Auto optimize, and what Aoze detected and chose. */
export function PerformanceFields() {
  const t = useMessages();
  const perf = useSettingsStore((st) => st.settings!.performance);
  const update = useSettingsStore((st) => st.update);
  const gpu = useSettingsStore((st) => st.settings!.upscale.gpu);
  const check = useSystemStore((st) => st.check);
  const set = (p: Partial<PerformanceSettings>) => update((st) => ({ ...st, performance: { ...st.performance, ...p } }));

  // The tuning shown below follows the mode and the device setting.
  useEffect(() => {
    const timer = setTimeout(() => {
      void useSettingsStore
        .getState()
        .flush()
        .then(() => useSystemStore.getState().loadCheck())
        .catch(() => undefined);
    }, 150);
    return () => clearTimeout(timer);
  }, [perf.mode, perf.autoOptimize, gpu]);

  const h = check?.profile?.hardware;
  const tuning = check?.tuning;
  const tier = (v: "low" | "medium" | "high" | undefined) => (v ? t.settings.tiers[v] : "");
  return (
    <>
      <Field label={t.settings.perfMode} hint={t.settings.perfModeHints[perf.mode]}>
        <Segmented<PerformanceMode>
          ariaLabel={t.settings.perfMode}
          size="sm"
          value={perf.mode}
          onChange={(mode) => set({ mode })}
          options={(["balanced", "quality", "performance"] as const).map((m) => ({ value: m, label: t.settings.perfModes[m] }))}
        />
      </Field>
      <Field label={t.settings.autoOptimize} hint={t.settings.autoOptimizeHint} inline>
        <Toggle label={t.settings.autoOptimize} checked={perf.autoOptimize} onChange={(autoOptimize) => set({ autoOptimize })} />
      </Field>
      {h && check?.profile && (
        <div className={s.hardware}>
          <div className={s.hwRow}>
            <MonitorCog size={14} />
            <span>{h.gpuName ? `${h.gpuName} · ${formatBytes(h.vramBytes)}` : t.splash.cpuOnly}</span>
            <span className={s.tier}>{tier(check.profile.gpu)}</span>
          </div>
          <div className={s.hwRow}>
            <MemoryStick size={14} />
            <span>{fmt(t.settings.ram, { total: formatBytes(h.ramTotalBytes), free: formatBytes(h.ramAvailableBytes) })}</span>
            <span className={s.tier}>{tier(check.profile.memory)}</span>
          </div>
          <div className={s.hwRow}>
            <Cpu size={14} />
            <span>{fmt(t.settings.cpuThreads, { n: h.cpuThreads })}</span>
            <span className={s.tier}>{tier(check.profile.cpu)}</span>
          </div>
          {tuning && (
            <p className={s.hwNote}>
              {fmt(tuning.automatic ? t.settings.tuningAuto : t.settings.tuningManual, {
                tile: tuning.tileSize === 0 ? t.controls.tileAuto : `${tuning.tileSize} px`,
                block: formatBytes(tuning.blockBytes),
              })}
              {tuning.backgroundPriority ? ` ${t.settings.tuningPriority}` : ""}
              {h.simulated ? " (simulated)" : ""}
            </p>
          )}
        </div>
      )}
    </>
  );
}
