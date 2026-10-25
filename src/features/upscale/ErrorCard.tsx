import { motion } from "motion/react";
import { CircleAlert, RotateCw, ScrollText } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useMessages } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { AppError } from "../../types";
import s from "./ErrorCard.module.css";

interface ErrorCardProps {
  error: AppError;
  onRetry?: () => void;
}

/** Human explanation of a backend error code, with the technical detail tucked away. */
export function ErrorCard({ error, onRetry }: ErrorCardProps) {
  const t = useMessages();
  const openPanel = useUiStore((st) => st.openPanel);
  const info = t.errors[error.code];
  return (
    <motion.div
      className={s.card}
      role="alert"
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={s.head}>
        <span className={s.icon}>
          <CircleAlert size={18} />
        </span>
        <div>
          <div className={s.kicker}>{t.errors.title}</div>
          <h3 className={s.title}>{info.title}</h3>
        </div>
      </div>
      {info.causes.length > 0 && (
        <div className={s.block}>
          <div className={s.label}>{t.errors.causes}</div>
          <ul className={s.causes}>
            {info.causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {info.fix && <p className={s.fix}>{info.fix}</p>}
      <details className={s.detail}>
        <summary>{error.code}</summary>
        <pre className="mono">{error.detail}</pre>
      </details>
      <div className={s.actions}>
        {onRetry && (
          <Button variant="primary" size="sm" icon={<RotateCw />} onClick={onRetry}>
            {t.action.retry}
          </Button>
        )}
        <Button size="sm" icon={<ScrollText />} onClick={() => openPanel("diagnostics")}>
          {t.action.showLogs}
        </Button>
      </div>
    </motion.div>
  );
}
