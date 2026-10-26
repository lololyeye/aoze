import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, Download, RotateCcw, ShieldCheck } from "lucide-react";
import { Logo } from "../../app/Logo";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { Sheet } from "../../components/ui/Sheet";
import { fmt, useLocale, useMessages } from "../../i18n";
import { hasNotes, notesIn } from "../../services/releaseNotes";
import { useQueueStore } from "../../stores/queueStore";
import { useUpdateStore } from "../../stores/updateStore";
import { formatBytes } from "../../utils/format";
import { NotesList } from "./NotesList";
import s from "./Update.module.css";

/** A newer version: what it brings, then download, verify, install and reopen. */
export function UpdateDialog({ suppressed }: { suppressed: boolean }) {
  const t = useMessages();
  const locale = useLocale();
  const { phase, info, progress, error, open } = useUpdateStore();
  const { setOpen, download, cancel, install, retry } = useUpdateStore.getState();
  const busy = useQueueStore((st) => st.activeJob !== null);
  if (!info) return null;

  const body = info.notes ? notesIn(info.notes, locale) : null;
  const pct = progress?.total ? progress.received / progress.total : 0;
  const title = phase === "error" ? t.update.failedTitle : phase === "ready" ? t.update.readyTitle : t.update.title;

  let state;
  if (phase === "downloading") {
    state = (
      <div className={s.state}>
        <div className={s.stateHead}>
          <span>{t.update.downloading}</span>
          <span className={s.pct}>{Math.round(pct * 100)} %</span>
        </div>
        <ProgressBar value={pct} active />
        <div className={s.stateFoot}>
          <span className={s.muted}>
            {progress?.total ? fmt(t.update.downloaded, { received: formatBytes(progress.received), total: formatBytes(progress.total) }) : formatBytes(progress?.received ?? 0)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void cancel()}>
            {t.update.cancel}
          </Button>
        </div>
      </div>
    );
  } else if (phase === "installing") {
    state = (
      <div className={s.state}>
        <div className={s.stateHead}>
          <span>{t.update.installing}</span>
        </div>
        <ProgressBar value={1} active />
        <span className={s.muted}>{fmt(t.update.installingHint, { version: info.version })}</span>
      </div>
    );
  } else if (phase === "ready") {
    state = (
      <div className={s.state}>
        <p className={s.message}>
          <ShieldCheck size={15} className={s.ok} />
          <span>{busy ? t.update.busy : fmt(t.update.ready, { version: info.version })}</span>
        </p>
        <div className={s.actions}>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t.update.later}
          </Button>
          <Button variant="primary" icon={<RotateCcw />} disabled={busy} onClick={() => void install()}>
            {t.update.install}
          </Button>
        </div>
      </div>
    );
  } else if (phase === "error" && error) {
    state = (
      <div className={s.state}>
        <p className={`${s.message} ${s.error}`} title={error.detail}>
          <CircleAlert size={15} />
          <span>{t.update.errors[error.kind]}</span>
        </p>
        <div className={s.actions}>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t.update.later}
          </Button>
          <Button variant="primary" icon={<RotateCcw />} onClick={retry}>
            {t.update.retry}
          </Button>
        </div>
      </div>
    );
  } else {
    state = (
      <div className={s.actions}>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t.update.later}
        </Button>
        <Button variant="primary" icon={<Download />} onClick={() => void download()}>
          {t.update.updateNow}
        </Button>
      </div>
    );
  }

  return (
    <Sheet variant="center" open={open && !suppressed && phase !== "upToDate"} onClose={() => setOpen(false)} title={title} closeLabel={t.titlebar.close}>
      <div className={s.body}>
        <p className={s.lead}>{t.update.available}</p>
        <div className={s.brand}>
          <Logo size={40} />
          <div>
            <div className={s.version}>{fmt(t.update.version, { version: info.version })}</div>
            <div className={s.muted}>
              {fmt(t.update.current, { version: info.currentVersion })}
              {info.size ? ` · ${formatBytes(info.size)}` : ""}
            </div>
          </div>
        </div>
        {body && hasNotes(body) && (
          <div className={s.whatsNew}>
            <div className={s.label}>{t.update.whatsNew}</div>
            <NotesList body={body} />
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={phase} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            {state}
          </motion.div>
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
