import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import s from "./Toaster.module.css";

const icons = { info: Info, success: CheckCircle2, error: CircleAlert };

export function Toaster() {
  const toasts = useUiStore((st) => st.toasts);
  const dismiss = useUiStore((st) => st.dismiss);
  return (
    <div className={s.stack} aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`${s.toast} ${s[t.kind]}`}
            >
              <Icon size={16} className={s.icon} />
              <div className={s.text}>
                <div className={s.title}>{t.title}</div>
                {t.body && <div className={s.body}>{t.body}</div>}
              </div>
              <button type="button" className={s.close} onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
