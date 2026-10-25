import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Cpu, FolderOpen, MonitorCog, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Section } from "../../components/ui/Field";
import { Sheet } from "../../components/ui/Sheet";
import { useMessages } from "../../i18n";
import { api } from "../../services/api";
import { reportError, safely } from "../../services/actions";
import { useQueueStore } from "../../stores/queueStore";
import { useSystemStore } from "../../stores/systemStore";
import { useUiStore } from "../../stores/uiStore";
import { formatBytes } from "../../utils/format";
import s from "./DiagnosticsSheet.module.css";

export function DiagnosticsSheet() {
  const t = useMessages();
  const open = useUiStore((st) => st.panel === "diagnostics");
  const openPanel = useUiStore((st) => st.openPanel);
  const toast = useUiStore((st) => st.toast);
  const status = useSystemStore((st) => st.status);
  const refreshing = useSystemStore((st) => st.refreshing);
  const refresh = useSystemStore((st) => st.refresh);
  const lastJob = useQueueStore((st) => [...st.jobs].filter((j) => j.startedAt).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]);
  const [log, setLog] = useState<string[]>([]);

  const loadLog = useCallback(() => {
    if (lastJob) api.jobLog(lastJob.id).then(setLog).catch(reportError);
  }, [lastJob]);

  useEffect(() => {
    if (open) loadLog();
  }, [open, loadLog, lastJob?.status]);

  const copy = async () => {
    await writeText(await api.diagnostics());
    toast({ kind: "success", title: t.diagnostics.copiedToast });
  };

  const vk = status?.vulkan;
  return (
    <Sheet
      open={open}
      onClose={() => openPanel(null)}
      title={t.diagnostics.title}
      closeLabel={t.titlebar.close}
      actions={
        <Button size="sm" variant="primary" icon={<Copy />} onClick={safely(copy)}>
          {t.diagnostics.copy}
        </Button>
      }
    >
      <Section title={t.diagnostics.gpu} aside={<Button size="sm" variant="ghost" icon={<RefreshCw className={refreshing ? s.spin : ""} />} onClick={safely(refresh)} disabled={refreshing}>{t.diagnostics.refresh}</Button>}>
        {vk?.gpus.length ? (
          vk.gpus.map((g) => (
            <div key={g.index} className={s.device}>
              <MonitorCog size={16} className={s.deviceIcon} />
              <div className={s.deviceText}>
                <div className={s.deviceName}>
                  {g.name}
                  {vk.defaultGpu === g.index && <span className={s.tag}>default</span>}
                </div>
                <div className={s.kv}>
                  #{g.index} · {g.kind} · {formatBytes(g.vramBytes)} VRAM · Vulkan {g.apiVersion} · driver {g.driverVersion}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className={s.problem}>
            <Cpu size={16} />
            <div>
              <div className={s.deviceName}>{t.errors.vulkanUnavailable.title}</div>
              <div className={s.kv}>{vk?.error ?? "—"}</div>
              <div className={s.kv}>{t.errors.vulkanUnavailable.fix}</div>
            </div>
          </div>
        )}
        <div className={s.kv}>Vulkan loader: {vk?.instanceVersion ?? "—"}</div>
      </Section>

      <Section title={t.diagnostics.engine}>
        <div className={s.kv}>
          {status?.engine.name} · {status?.engine.version ?? "?"} · {status?.engine.found ? t.diagnostics.installed : t.diagnostics.missing}
        </div>
        <div className={`${s.kv} ${s.path}`}>{status?.engine.dir}</div>
        <div className={s.models}>
          {status?.engine.models.map((m) => (
            <div key={m.dir} className={s.model}>
              <span className={`${s.badge} ${m.installed ? s.ok : s.bad}`}>{m.installed ? t.diagnostics.installed : t.diagnostics.missing}</span>
              <span className="mono">{m.dir}</span>
              <span className={s.size}>{formatBytes(m.sizeBytes)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t.diagnostics.video}>
        <div className={s.kv}>
          FFmpeg {status?.ffmpeg.version ?? ""} · {status?.ffmpeg.found ? t.diagnostics.installed : t.diagnostics.missing}
        </div>
        <div className={s.kv}>
          {t.diagnostics.encoders}: {status?.ffmpeg.detected ? (status.ffmpeg.encoders.length ? status.ffmpeg.encoders.map((e) => e.toUpperCase()).join(", ") : "—") : "…"} · x264
        </div>
      </Section>

      <Section
        title={t.diagnostics.lastLog}
        aside={
          <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={safely(api.openLogsDir)}>
            {t.diagnostics.openLogs}
          </Button>
        }
      >
        {lastJob ? (
          <>
            <div className={s.kv}>
              {lastJob.source.name} — {t.queue[lastJob.status]}
            </div>
            <pre className={`mono ${s.log}`}>{log.join("\n") || "…"}</pre>
          </>
        ) : (
          <div className={s.kv}>{t.diagnostics.noLog}</div>
        )}
        <div className={s.kv}>Aoze {status?.appVersion}</div>
      </Section>
    </Sheet>
  );
}
