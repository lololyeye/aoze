import { Sparkles } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { fmt, useLocale, useMessages } from "../../i18n";
import { notesIn } from "../../services/releaseNotes";
import type { ReleaseNotes } from "../../types";
import { NotesList } from "./NotesList";
import s from "./Update.module.css";

/** Shown once after an update: the changes of the installed version. */
export function WhatsNewDialog({ notes, onClose }: { notes: ReleaseNotes | null; onClose: () => void }) {
  const t = useMessages();
  const locale = useLocale();
  const body = notes ? notesIn(notes, locale) : null;
  return (
    <Sheet variant="center" open={notes !== null} onClose={onClose} title={fmt(t.whatsNew.title, { version: notes?.version ?? "" })} closeLabel={t.titlebar.close}>
      {body && (
        <div className={s.body}>
          {body.summary && (
            <p className={s.summary}>
              <Sparkles size={15} />
              <span>{body.summary}</span>
            </p>
          )}
          <NotesList body={body} />
          <div className={s.actions}>
            <Button variant="primary" onClick={onClose}>
              {t.whatsNew.gotIt}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
