import { motion } from "motion/react";
import { ArrowRight, Check, Copy, ExternalLink, FolderOpen, Plus, TriangleAlert } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Tooltip } from "../../components/ui/Tooltip";
import { fmt, useMessages } from "../../i18n";
import { api } from "../../services/api";
import { copyPath, pickFiles, safely } from "../../services/actions";
import type { Group } from "../../stores/queueStore";
import type { Job } from "../../types";
import { formatBytes, formatDims, formatDuration } from "../../utils/format";
import { ResultDetails } from "./ResultDetails";
import s from "./ResultBar.module.css";

export function ResultBar({ job, group }: { job: Job; group: Group }) {
  const t = useMessages();
  const r = job.result;
  if (!r) return null;
  const src = job.source.info;
  const c = r.compression;
  const limitNote =
    c?.limitBytes != null
      ? [
          fmt(c.met ? t.result.limitMet : t.result.limitMissed, { limit: formatBytes(c.limitBytes) }),
          c.quality != null && c.quality < 95 ? fmt(t.result.qualityUsed, { q: c.quality }) : null,
          c.scale < 0.999 ? fmt(t.result.scaled, { pct: Math.round(c.scale * 100) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  const fpsChanged = job.task?.anim?.fps != null && r.media && job.source.media && Math.abs(r.media.fps - job.source.media.fps) > 0.5;
  const fps = fpsChanged && r.media && job.source.media ? `${Math.round(job.source.media.fps * 100) / 100} → ${Math.round(r.media.fps * 100) / 100} FPS` : null;
  return (
    <motion.div className={s.bar} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
      <span className={`${s.done} ${c && !c.met ? s.warn : ""}`}>{c && !c.met ? <TriangleAlert size={13} /> : <Check size={14} strokeWidth={2.6} />}</span>
      <div className={s.stats}>
        <div className={s.stat}>
          <span className={s.from}>{formatDims(src.width, src.height)}</span>
          <ArrowRight size={12} className={s.arrow} />
          <span className={s.to}>{formatDims(r.info.width, r.info.height)}</span>
        </div>
        <Tooltip content={limitNote} wide>
          <div className={s.stat}>
            <span className={s.from}>{formatBytes(src.sizeBytes)}</span>
            <ArrowRight size={12} className={s.arrow} />
            <span className={`${s.to} ${c && !c.met ? s.missed : ""}`}>{formatBytes(r.info.sizeBytes)}</span>
          </div>
        </Tooltip>
        {fps && <div className={`${s.stat} ${s.time}`}>{fps}</div>}
        <div className={`${s.stat} ${s.time}`}>{formatDuration(r.durationMs)}</div>
      </div>
      <span className={s.path} title={r.outputPath}>
        {limitNote ?? r.outputPath}
      </span>
      <div className={s.actions}>
        <ResultDetails job={job} />
        <IconButton label={t.action.copyPath} size="sm" onClick={safely(() => copyPath(r.outputPath))} tooltipSide="top">
          <Copy />
        </IconButton>
        <Button size="sm" icon={<FolderOpen />} onClick={safely(() => api.revealFile(r.outputPath))}>
          {t.action.openFolder}
        </Button>
        <Button size="sm" icon={<ExternalLink />} onClick={safely(() => api.openFile(r.outputPath))}>
          {t.action.open}
        </Button>
        <Tooltip content={t.action.another} side="top">
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={safely(() => pickFiles(group))} aria-label={t.action.another} />
        </Tooltip>
      </div>
    </motion.div>
  );
}
