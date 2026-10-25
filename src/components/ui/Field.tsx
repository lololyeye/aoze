import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { HelpTip, type HelpTopic } from "./HelpTip";
import { Tooltip } from "./Tooltip";
import s from "./Field.module.css";

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Explanation shown in a tooltip next to the label. */
  info?: ReactNode;
  /** Plain-language answer behind a "?" button. */
  help?: HelpTopic;
  aside?: ReactNode;
  inline?: boolean;
  children: ReactNode;
}

/** Label + control layout shared by the controls panel and the settings sheet. */
export function Field({ label, hint, info, help, aside, inline, children }: FieldProps) {
  return (
    <div className={`${s.field} ${inline ? s.inline : ""}`}>
      <div className={s.head}>
        <span className={s.label}>
          {label}
          {info && (
            <Tooltip content={info} wide>
              <span className={s.info} tabIndex={0} role="img" aria-label="info">
                <Info size={12} />
              </span>
            </Tooltip>
          )}
          {help && <HelpTip topic={help} />}
        </span>
        {aside && <span className={s.aside}>{aside}</span>}
        {inline && children}
      </div>
      {!inline && children}
      {hint && <p className={s.hint}>{hint}</p>}
    </div>
  );
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.sectionTitle}>{title}</h3>
        {aside}
      </div>
      <div className={s.sectionBody}>{children}</div>
    </section>
  );
}
