import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import s from "./Collapsible.module.css";

interface CollapsibleProps {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Collapsible({ title, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.root}>
      <button type="button" className={s.head} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} className={`${s.chevron} ${open ? s.open : ""}`} />
        <span>{title}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={s.body}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={s.inner}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
