import { AnimatePresence, motion } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { Tooltip } from "../../components/ui/Tooltip";
import { fmt, useMessages } from "../../i18n";
import type { Messages } from "../../i18n/en";
import { api } from "../../services/api";
import { safely, startProcessing } from "../../services/actions";
import { groupOfJob, queueStats, useGroupJobs, useQueueStore, useSelectedJob, type Group } from "../../stores/queueStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { modelFor, useSystemStore } from "../../stores/systemStore";
import type { Job, ProgressDetail } from "../../types";
import { comboUnavailable } from "../../utils/capabilities";
import { formatClock, formatDuration, formatScale } from "../../utils/format";
import s from "./ProcessButton.module.css";

/** Why the main button is disabled ("" = nothing to process), or null. */
function useBlocker(group: Group): string | null {
  const t = useMessages();
  const status = useSystemStore((st) => st.status);
  const settings = useSettingsStore((st) => st.settings);
  const jobs = useGroupJobs(group);
  const selected = useSelectedJob(group);
  if (!status || !settings) return t.status.checking;
  const runnable = jobs.some((j) => j.status === "idle") || (selected && selected.status !== "processing" && selected.status !== "waiting");
  if (!runnable) return "";
  const kinds = new Set(jobs.filter((j) => j.status === "idle").map((j) => j.source.kind));
  if (selected) kinds.add(selected.source.kind);
  if ((kinds.has("gif") || kinds.has("video")) && !status.ffmpeg.found) return t.errors.ffmpegMissing.title;
  if (kinds.has("image") && settings.imageAction !== "compress") {
    if (!status.engine.found) return t.errors.engineMissing.title;
    const why = comboUnavailable(modelFor(status, settings.upscale.style), settings.upscale.scale, settings.upscale.noise);
    if (why === "noop") return t.controls.unavailable1x;
    if (why) return t.controls.unavailableModel;
  }
  return null;
}

function detailText(t: Messages, d: ProgressDetail | null | undefined): string | null {
  if (!d) return null;
  if (d.type === "frames") return fmt(t.progress.frame, { done: d.done, total: d.total });
  return `${formatClock(d.doneMs)} / ${formatClock(d.totalMs)}`;
}

/** "2× · Medium" style summary of what a running job does. */
function summary(t: Messages, job: Job): string {
  const task = job.task;
  if (!task) return "";
  if (task.anim) {
    const a = task.anim;
    const parts = [a.scale !== 1 ? formatScale(a.scale) : null];
    const enh = { off: null, sharpen: t.controls.enhanceSharpen, light: t.controls.enhanceLow, medium: t.controls.enhanceMedium, strong: t.controls.enhanceHigh }[a.enhance];
    const smooth = a.fps && a.smooth !== "off" && job.source.media && a.fps > job.source.media.fps + 0.5;
    parts.push(enh, a.fps ? `${a.fps} FPS${smooth ? ` · ${t.controls.smooth}` : ""}` : null, a.motionBlur ? `${t.controls.motionBlur} ${a.motionBlur}%` : null);
    if (job.source.kind === "video" && a.hdr === "enhanced") parts.push("HDR");
    return parts.filter(Boolean).join(" · ");
  }
  if (task.action === "compress") return t.controls.actionCompress;
  const p = job.params;
  const noise = p && p.noise >= 0 ? [t.controls.noiseLow, t.controls.noiseMedium, t.controls.noiseHigh, t.controls.noiseMax][p.noise] : null;
  return [p ? formatScale(p.scale) : null, noise, task.action === "both" ? t.controls.actionCompress : null].filter(Boolean).join(" · ");
}

export function ProcessButton({ group }: { group: Group }) {
  const t = useMessages();
  const jobs = useGroupJobs(group);
  const activeId = useQueueStore((st) => st.activeJob);
  const progress = useQueueStore((st) => (st.activeJob ? st.progress[st.activeJob] : undefined));
  const action = useSettingsStore((st) => (st.settings?.discord ? "improve" : (st.settings?.imageAction ?? "improve")));
  const blocker = useBlocker(group);
  const stats = queueStats(jobs);
  const active = jobs.find((j) => j.id === activeId && groupOfJob(j) === group);

  const many = stats.idle > 1;
  // Convert: all images queued together make a single GIF, so count outputs.
  const idleConvert = jobs.filter((j) => j.status === "idle");
  const outputs = idleConvert.filter((j) => j.source.kind !== "image").length + (idleConvert.some((j) => j.source.kind === "image") ? 1 : 0);
  const label =
    group === "convert"
      ? outputs > 1
        ? fmt(t.convert.convertMany, { count: outputs })
        : t.convert.convert
      :
    group === "clip" || jobs.some((j) => j.status === "idle" && j.source.kind === "gif")
      ? many
        ? fmt(t.action.processMany, { count: stats.idle })
        : stats.idle === 1
          ? t.action.processOne
          : jobs.length
            ? t.action.again
            : t.action.processOne
      : action === "compress"
        ? many
          ? fmt(t.action.compressMany, { count: stats.idle })
          : t.action.compressOne
        : many
          ? fmt(t.action.improveMany, { count: stats.idle })
          : stats.idle === 0 && jobs.length
            ? t.action.again
            : action === "both"
              ? t.action.bothOne
              : t.action.improveOne;

  const value = progress?.progress ?? active?.progress ?? 0;
  const detail = detailText(t, progress?.detail);

  return (
    <div className={s.root}>
      <AnimatePresence mode="wait" initial={false}>
        {active ? (
          <motion.div
            key="busy"
            className={s.busy}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={s.busyHead}>
              <div className={s.busyText}>
                <span className={s.stage}>{t.progress[progress?.stage ?? active.stage ?? "preparing"]}</span>
                <span className={s.file} title={active.source.path}>
                  {active.source.name}
                </span>
                <span className={s.summary}>{summary(t, active)}</span>
              </div>
              <Tooltip content={progress?.measured === false ? t.progress.estimated : null} wide>
                <span className={s.pct}>{Math.round(value * 100)}%</span>
              </Tooltip>
            </div>
            <ProgressBar value={value} active />
            <div className={s.busyFoot}>
              <span>{detail ?? fmt(t.progress.elapsed, { time: formatDuration(progress?.elapsedMs ?? 0) })}</span>
              {progress?.remainingMs != null && progress.remainingMs > 0 && <span>{fmt(t.progress.remaining, { time: formatDuration(progress.remainingMs) })}</span>}
              {stats.waiting > 0 && <span>+{stats.waiting}</span>}
            </div>
            <Button variant="secondary" size="md" block icon={<X />} onClick={safely(() => api.cancelJob(active.id))}>
              {t.action.cancel}
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Tooltip content={blocker || null} wide>
              <span className={s.wrap}>
                <Button variant="primary" size="lg" block icon={<Sparkles />} disabled={blocker !== null} onClick={safely(() => startProcessing(group))}>
                  {label}
                </Button>
              </span>
            </Tooltip>
            <div className={s.hint}>Ctrl + Enter</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
