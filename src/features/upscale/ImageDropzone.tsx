import { motion } from "motion/react";
import { Film, ImagePlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Kbd } from "../../components/ui/Kbd";
import { useMessages } from "../../i18n";
import { pickFiles, safely } from "../../services/actions";
import type { Group } from "../../stores/queueStore";
import { useUiStore } from "../../stores/uiStore";
import s from "./ImageDropzone.module.css";

export function ImageDropzone({ group }: { group: Group }) {
  const t = useMessages();
  const hover = useUiStore((st) => st.dragHover);
  const pick = safely(() => pickFiles(group));
  const Icon = group === "clip" ? Film : ImagePlus;
  return (
    <motion.div
      className={`${s.zone} ${hover ? s.hover : ""}`}
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      onClick={pick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick()}
    >
      <div className={s.inner}>
        <div className={s.iconWrap}>
          <Icon size={26} strokeWidth={1.6} />
        </div>
        <h2 className={s.title}>{hover ? t.dropzone.dropNow : group === "clip" ? t.dropzone.titleClip : t.dropzone.titleImage}</h2>
        <Button variant="ghost" size="sm" className={s.browse} onClick={(e) => (e.stopPropagation(), pick())}>
          {t.dropzone.browse}
        </Button>
        <div className={s.meta}>
          <span>{group === "clip" ? t.home.formatsClip : t.home.formatsImage}</span>
        </div>
        {group === "image" && (
          <div className={s.paste}>
            <Kbd>Ctrl</Kbd>
            <Kbd>V</Kbd>
            <span>{t.dropzone.paste}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
