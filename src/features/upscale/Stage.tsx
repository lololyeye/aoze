import { AnimatePresence, motion } from "motion/react";
import { Plus, SkipForward, Trash2 } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { fmt, useMessages } from "../../i18n";
import type { Messages } from "../../i18n/en";
import { api } from "../../services/api";
import { pickFiles, safely } from "../../services/actions";
import { useGroupJobs, useSelectedJob, type Group } from "../../stores/queueStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Job, MediaInfo, Settings } from "../../types";
import { formatBytes, formatClock, formatDims, targetDims } from "../../utils/format";
import { BeforeAfterViewer } from "../viewer/BeforeAfterViewer";
import { ClipViewer } from "../viewer/ClipViewer";
import { ErrorCard } from "./ErrorCard";
import { ImageDropzone } from "./ImageDropzone";
import { ResultBar } from "./ResultBar";
import s from "./Stage.module.css";

export function mediaMeta(t: Messages, m: MediaInfo): string[] {
  return [fmt(t.media.frames, { count: m.frames }), fmt(t.media.fps, { fps: Math.round(m.fps * 100) / 100 }), formatClock(m.durationMs)];
}

/** Output size the viewer reserves before a result exists. */
function plannedSize(job: Job, settings: Settings | null): { w: number; h: number } {
  const { width, height } = job.source.info;
  if (job.task?.anim) {
    const [w, h] = targetDims(width, height, job.task.anim.scale);
    return { w, h };
  }
  if (job.source.kind === "gif") {
    const [w, h] = targetDims(width, height, settings?.gif.scale ?? 1);
    return { w, h };
  }
  const action = job.task?.action ?? settings?.imageAction ?? "improve";
  const scale = action === "compress" ? 1 : (job.params?.scale ?? settings?.upscale.scale ?? 2);
  const [w, h] = targetDims(width, height, scale);
  return { w, h };
}

export function Stage({ group }: { group: Group }) {
  const t = useMessages();
  const job = useSelectedJob(group);
  const jobCount = useGroupJobs(group).length;
  const settings = useSettingsStore((st) => st.settings);
  const dragHover = useUiStore((st) => st.dragHover);

  if (!job) {
    return (
      <section className={s.stage}>
        <ImageDropzone group={group} />
      </section>
    );
  }

  const src = job.source;
  const result = job.status === "completed" && job.result ? job.result : null;
  const processing = job.status === "processing" || job.status === "waiting";
  const target = plannedSize(job, settings);
  const meta = [src.info.format, formatDims(src.info.width, src.info.height), ...(src.media ? mediaMeta(t, src.media) : []), formatBytes(src.info.sizeBytes)];

  return (
    <section className={s.stage}>
      <header className={s.header}>
        <div className={s.title}>
          <span className={s.name} title={src.path}>
            {src.name}
          </span>
          <span className={s.meta}>{meta.join(" · ")}</span>
        </div>
        <div className={s.headerActions}>
          {jobCount <= 1 && job.status !== "processing" && (
            <IconButton label={t.action.remove} size="sm" onClick={safely(() => api.removeJobs([job.id]))}>
              <Trash2 />
            </IconButton>
          )}
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={safely(() => pickFiles(group))}>
            {t.action.addFiles}
          </Button>
        </div>
      </header>

      <div className={s.viewport}>
        {src.kind === "video" ? (
          <ClipViewer
            clipKey={job.id}
            original={src.media?.playable && !src.preview ? src.path : src.preview}
            usesPreviewCopy={!src.media?.playable || Boolean(src.preview)}
            poster={src.thumb}
            // HDR / HEVC results play through their tone-mapped preview copy.
            result={result ? (result.media?.playable === false && result.preview ? result.preview : result.outputPath) : null}
            processing={processing}
            timing={result?.timing ?? null}
            reshaped={Boolean(result && Math.abs(result.info.width / result.info.height - src.info.width / src.info.height) > 0.01)}
          />
        ) : (
          <BeforeAfterViewer
            imageKey={job.id}
            original={{ path: src.path, proxy: src.kind === "image" ? src.preview : null, width: src.info.width, height: src.info.height }}
            result={result && { path: result.outputPath, proxy: result.preview, width: result.info.width, height: result.info.height }}
            processing={processing}
            targetSize={target}
            animated={src.kind === "gif"}
          />
        )}
        <AnimatePresence>
          {job.status === "failed" && job.error && (
            <motion.div className={s.overlay} key="err" exit={{ opacity: 0 }}>
              <ErrorCard error={job.error} onRetry={safely(() => api.retryJobs([job.id]))} />
            </motion.div>
          )}
        </AnimatePresence>
        {job.status === "skipped" && (
          <div className={s.notice}>
            <SkipForward size={14} />
            {t.result.skipped}
          </div>
        )}
        {job.status === "idle" && src.kind !== "video" && <div className={s.hintPill}>{t.viewer.waiting}</div>}
        {dragHover && <div className={s.dropHint}>{t.dropzone.dropNow}</div>}
      </div>

      {result && <ResultBar job={job} group={group} />}
    </section>
  );
}
