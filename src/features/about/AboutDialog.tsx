import { openUrl } from "@tauri-apps/plugin-opener";
import { Coffee, ExternalLink, ShieldCheck } from "lucide-react";
import { Logo } from "../../app/Logo";
import { KOFI_URL } from "../../app/Sidebar";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { fmt, useMessages } from "../../i18n";
import { safely } from "../../services/actions";
import { useSystemStore } from "../../stores/systemStore";
import { useUiStore } from "../../stores/uiStore";
import s from "./AboutDialog.module.css";

export function AboutDialog() {
  const t = useMessages();
  const open = useUiStore((st) => st.panel === "about");
  const openPanel = useUiStore((st) => st.openPanel);
  const status = useSystemStore((st) => st.status);
  return (
    <Sheet variant="center" open={open} onClose={() => openPanel(null)} title={t.about.title} closeLabel={t.titlebar.close}>
      <div className={s.body}>
        <div className={s.brand}>
          <Logo size={44} />
          <div>
            <div className={s.name}>Aoze</div>
            <div className={s.version}>
              {fmt(t.about.version, { version: status?.appVersion ?? "" })} · {t.app.tagline}
            </div>
          </div>
        </div>
        <p className={s.privacy}>
          <ShieldCheck size={15} />
          <span>{t.about.body}</span>
        </p>
        <div className={s.credits}>
          <div className={s.creditsTitle}>{t.about.credits}</div>
          <ul>
            <li>{t.about.waifu2x}</li>
            <li>{t.about.ncnn}</li>
            <li>{t.about.ffmpeg}</li>
            <li>{t.about.rife}</li>
            <li>{t.about.esrgan}</li>
            <li>{t.about.voice}</li>
          </ul>
        </div>
        <div className={s.actions}>
          <Button size="sm" icon={<ExternalLink />} onClick={safely(() => openUrl("https://github.com/nihui/waifu2x-ncnn-vulkan"))}>
            {t.about.source}
          </Button>
          <Button size="sm" icon={<Coffee />} onClick={safely(() => openUrl(KOFI_URL))}>
            {t.app.support}
          </Button>
        </div>
        <div className={s.signature}>{t.app.signature}</div>
      </div>
    </Sheet>
  );
}
