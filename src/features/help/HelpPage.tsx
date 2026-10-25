import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Page } from "../../components/ui/Page";
import type { HelpTopic } from "../../components/ui/HelpTip";
import { useMessages } from "../../i18n";
import s from "./HelpPage.module.css";

const TOPICS: HelpTopic[] = ["scale", "noise", "enhance", "compress", "limit", "fps", "smooth", "blur", "hdr", "look", "format", "style", "quality", "gpu"];

export function HelpPage() {
  const t = useMessages();
  const [open, setOpen] = useState<HelpTopic | null>("scale");
  return (
    <Page title={t.help.title}>
      <section className={s.section}>
        <h2 className={s.h2}>{t.help.howTitle}</h2>
        <ol className={s.steps}>
          {t.help.steps.map((step, i) => (
            <li key={step} className={s.step}>
              <span className={s.num}>{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className={s.section}>
        <h2 className={s.h2}>{t.help.faqTitle}</h2>
        <div className={s.faq}>
          {TOPICS.map((k) => {
            const item = t.help[k];
            const expanded = open === k;
            return (
              <div key={k} className={`${s.item} ${expanded ? s.open : ""}`}>
                <button type="button" className={s.q} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : k)}>
                  <ChevronRight size={14} className={s.chevron} />
                  {item.q}
                </button>
                {expanded && <p className={s.a}>{item.a}</p>}
              </div>
            );
          })}
        </div>
      </section>
    </Page>
  );
}
