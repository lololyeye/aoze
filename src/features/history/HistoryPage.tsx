import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Film, FolderOpen, ImageIcon, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Page } from "../../components/ui/Page";
import { useMessages } from "../../i18n";
import { api } from "../../services/api";
import { addPaths, reportError, safely } from "../../services/actions";
import { groupOf, useQueueStore } from "../../stores/queueStore";
import type { HistoryEntry } from "../../types";
import { dayKey, fileName, formatBytes, formatDims, formatDuration, formatScale } from "../../utils/format";
import s from "./HistoryPage.module.css";

function groupByDay(entries: HistoryEntry[]): [number, HistoryEntry[]][] {
  const groups = new Map<number, HistoryEntry[]>();
  for (const e of entries) {
    const k = dayKey(e.finishedAt);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()];
}

export function HistoryPage() {
  const t = useMessages();
  const completed = useQueueStore((st) => st.jobs.filter((j) => j.status === "completed").length);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [today, setToday] = useState(() => dayKey(Date.now()));

  const reload = useCallback(() => {
    api
      .history()
      .then((list) => {
        setEntries(list);
        setToday(dayKey(Date.now()));
      })
      .catch(reportError);
  }, []);

  useEffect(() => {
    reload();
  }, [completed, reload]);

  const dayLabel = (k: number) =>
    k === today ? t.history.today : k === today - 86_400_000 ? t.history.yesterday : new Date(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <Page
      title={t.history.title}
      actions={
        entries.length > 0 && (
          <Button size="sm" variant="ghost" onClick={safely(async () => (await api.clearHistory(), reload()))}>
            {t.history.clearAll}
          </Button>
        )
      }
    >
      {entries.length === 0 ? (
        <div className={s.empty}>
          <ImageIcon size={22} />
          <span>{t.history.empty}</span>
        </div>
      ) : (
        groupByDay(entries).map(([day, items]) => (
          <section key={day} className={s.group}>
            <h4 className={s.day}>{dayLabel(day)}</h4>
            <ul className={s.list}>
              <AnimatePresence initial={false}>
                {items.map((e) => (
                  <motion.li key={e.id} className={s.item} layout exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.16 }}>
                    <span className={s.kind}>{e.kind === "video" ? <Film size={14} /> : e.kind === "gif" ? "GIF" : <ImageIcon size={14} />}</span>
                    <div className={s.main}>
                      <div className={s.name} title={e.outputPath}>
                        {fileName(e.sourcePath)}
                      </div>
                      <div className={s.meta}>
                        {e.params.scale !== 1 && <span className={s.scale}>{formatScale(e.params.scale)}</span>}
                        <span>
                          {formatDims(e.sourceWidth, e.sourceHeight)} → {formatDims(e.outputWidth, e.outputHeight)}
                        </span>
                        <span>
                          {formatBytes(e.sourceBytes)} → {formatBytes(e.outputBytes)}
                        </span>
                        <span>{formatDuration(e.durationMs)}</span>
                      </div>
                    </div>
                    <div className={s.actions}>
                      <IconButton label={t.action.open} size="sm" onClick={safely(() => api.openFile(e.outputPath))}>
                        <ExternalLink />
                      </IconButton>
                      <IconButton label={t.action.openFolder} size="sm" onClick={safely(() => api.revealFile(e.outputPath))}>
                        <FolderOpen />
                      </IconButton>
                      <IconButton label={t.history.redo} size="sm" onClick={safely(() => addPaths([e.sourcePath], groupOf(e.kind)))}>
                        <RotateCw />
                      </IconButton>
                      <IconButton label={t.history.delete} size="sm" onClick={safely(async () => (await api.removeHistory(e.id), reload()))}>
                        <Trash2 />
                      </IconButton>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))
      )}
    </Page>
  );
}
