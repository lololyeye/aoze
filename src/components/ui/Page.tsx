import { motion } from "motion/react";
import type { ReactNode } from "react";
import s from "./Page.module.css";

/** Scrollable content page (History, Settings, Help) with a title row. */
export function Page({ title, actions, children, narrow = true }: { title: ReactNode; actions?: ReactNode; children: ReactNode; narrow?: boolean }) {
  return (
    <motion.div className={s.page} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
      <div className={`${s.inner} ${narrow ? s.narrow : ""}`}>
        <header className={s.head}>
          <h1 className={s.title}>{title}</h1>
          {actions && <div className={s.actions}>{actions}</div>}
        </header>
        {children}
      </div>
    </motion.div>
  );
}
