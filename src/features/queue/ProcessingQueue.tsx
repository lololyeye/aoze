import { AnimatePresence, motion } from "motion/react";
import { Ban, Check, CircleAlert, Eraser, Loader2, Pause, Play, Plus, RotateCw, SkipForward, X } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { fmt, useMessages } from "../../i18n";
import { api, fileUrl } from "../../services/api";
import { pickFiles, safely } from "../../services/actions";
import { queueStats, useGroupJobs, useQueueStore, type Group } from "../../stores/queueStore";
import type { Job } from "../../types";
import { formatDuration, formatScale } from "../../utils/format";
import { Film } from "lucide-react";
import s from "./ProcessingQueue.module.css";

function StatusIcon({ job }: { job: Job }) {
  switch (job.status) {
    case "completed":
      return <Check size={13} strokeWidth={2.6} className={s.ok} />;
    case "processing":
      return <Loader2 size={13} className={s.spin} />;
    case "failed":
      return <CircleAlert size={13} className={s.bad} />;
    case "cancelled":
      return <Ban size={13} className={s.muted} />;
    case "skipped":
      return <SkipForward size={13} className={s.muted} />;
    default:
      return <span className={s.ring} />;
  }
}

function QueueItem({ job, selected }: { job: Job; selected: boolean }) {
  const t = useMessages();
  const select = useQueueStore((st) => st.select);
  const live = useQueueStore((st) => st.progress[job.id]);
  const progress = live?.progress ?? job.progress;

  let detail: string = t.queue[job.status];
  if (job.status === "completed" && job.result) detail = `${t.queue.completed} · ${formatDuration(job.result.durationMs)}`;
  else if (job.status === "processing") detail = `${t.progress[live?.stage ?? job.stage ?? "preparing"]} · ${Math.round(progress * 100)}%`;
  else if (job.status === "failed" && job.error) detail = t.errors[job.error.code].title;
  else if (job.status === "waiting" && job.params) detail = `${t.queue.waiting} · ${formatScale(job.task?.anim?.scale ?? job.params.scale)}`;

  const canRemove = job.status !== "processing";
  const canRetry = job.status === "failed" || job.status === "cancelled" || job.status === "skipped";
  const canCancel = job.status === "processing" || job.status === "waiting";

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={`${s.item} ${selected ? s.selected : ""} ${s[job.status]}`}
      onClick={() => select(job.id)}
    >
      <div className={s.thumb}>
        {job.source.thumb ? <img src={fileUrl(job.source.thumb)} alt="" draggable={false} /> : <span className={job.status === "failed" ? s.thumbEmpty : s.thumbPh} />}
        {job.source.kind !== "image" && <span className={s.kindBadge}>{job.source.kind === "gif" ? "GIF" : <Film size={10} />}</span>}
      </div>
      <div className={s.body}>
        <div className={s.name} title={job.source.path}>
          {job.source.name}
        </div>
        <div className={s.detail}>
          <StatusIcon job={job} />
          <span>{detail}</span>
        </div>
        {job.status === "processing" && (
          <div className={s.bar}>
            <ProgressBar value={progress} size="xs" active />
          </div>
        )}
      </div>
      <div className={s.itemActions} onClick={(e) => e.stopPropagation()}>
        {canRetry && (
          <IconButton label={t.action.retry} size="sm" onClick={safely(() => api.retryJobs([job.id]))}>
            <RotateCw />
          </IconButton>
        )}
        {canCancel && (
          <IconButton label={t.action.cancel} size="sm" onClick={safely(() => api.cancelJob(job.id))}>
            <X />
          </IconButton>
        )}
        {canRemove && !canCancel && (
          <IconButton label={t.action.remove} size="sm" onClick={safely(() => api.removeJobs([job.id]))}>
            <X />
          </IconButton>
        )}
      </div>
    </motion.li>
  );
}

export function ProcessingQueue({ group }: { group: Group }) {
  const t = useMessages();
  const jobs = useGroupJobs(group);
  const paused = useQueueStore((st) => st.paused);
  const selectedId = useQueueStore((st) => st.selected[group]);
  const eta = useQueueStore((st) => (st.activeJob ? st.progress[st.activeJob]?.queueRemainingMs : null));
  const stats = queueStats(jobs);
  const left = stats.waiting + stats.processing + stats.idle;
  const finished = stats.completed + stats.cancelled + stats.skipped;

  return (
    <aside className={s.rail}>
      <header className={s.head}>
        <div className={s.headTitle}>
          {t.queue.title}
          <span className={s.count}>{jobs.length}</span>
        </div>
        <div className={s.headActions}>
          {(stats.waiting > 0 || paused) && (
            <IconButton label={paused ? t.action.resume : t.action.pause} size="sm" active={paused} onClick={safely(() => api.setPaused(!paused))}>
              {paused ? <Play /> : <Pause />}
            </IconButton>
          )}
          {(stats.waiting > 0 || stats.processing > 0) && (
            <IconButton label={t.action.cancelAll} size="sm" onClick={safely(api.cancelAll)}>
              <Ban />
            </IconButton>
          )}
          {stats.failed > 0 && (
            <IconButton label={t.action.retryFailed} size="sm" onClick={safely(() => api.retryJobs())}>
              <RotateCw />
            </IconButton>
          )}
          {finished > 0 && (
            <IconButton label={t.action.clearDone} size="sm" onClick={safely(api.clearFinished)}>
              <Eraser />
            </IconButton>
          )}
          <IconButton label={t.action.addFiles} size="sm" onClick={safely(() => pickFiles(group))}>
            <Plus />
          </IconButton>
        </div>
      </header>
      {paused && <div className={s.paused}>{t.queue.pausedNote}</div>}
      <ul className={s.list}>
        <AnimatePresence initial={false}>
          {jobs.map((j) => (
            <QueueItem key={j.id} job={j} selected={j.id === selectedId} />
          ))}
        </AnimatePresence>
      </ul>
      <footer className={s.foot}>
        <span>{fmt(t.queue.summary, { done: stats.completed, left })}</span>
        {stats.failed > 0 && <span className={s.bad}>{fmt(t.queue.failedCount, { count: stats.failed })}</span>}
        {eta != null && eta > 0 && <span>{fmt(t.queue.eta, { time: formatDuration(eta) })}</span>}
      </footer>
    </aside>
  );
}
