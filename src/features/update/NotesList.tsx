import { useMessages } from "../../i18n";
import type { ReleaseNotesBody } from "../../types";
import s from "./Update.module.css";

/** The changes of a version, grouped New / Improved / Fixed (empty groups are left out). */
export function NotesList({ body }: { body: ReleaseNotesBody }) {
  const t = useMessages();
  const groups = (["changes", "improvements", "fixes"] as const).filter((k) => body[k].length > 0);
  return (
    <div className={s.notes}>
      {groups.map((k) => (
        <section key={k} className={s.group}>
          <h3 className={s.groupTitle}>{t.update.sections[k]}</h3>
          <ul className={s.list}>
            {body[k].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
