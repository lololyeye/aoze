import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { resolveLocale } from "../../i18n";
import { events } from "../../services/api";
import { bundledNotes, hasNotes, notesIn } from "../../services/releaseNotes";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUpdateStore } from "../../stores/updateStore";
import { useTourStore } from "../tour/tourStore";
import type { ReleaseNotes } from "../../types";
import { UpdateDialog } from "./UpdateDialog";
import { WhatsNewDialog } from "./WhatsNewDialog";

function markSeen(version: string) {
  const store = useSettingsStore.getState();
  store.update((s) => ({ ...s, lastSeenReleaseNotes: version }));
  void store.flush();
}

/**
 * Once the app is on screen: the tutorial the first time (new install, or the
 * first update that has it; "What's new" is then skipped), otherwise "What's new"
 * if this version's notes were never shown; then the update check (its dialog
 * waits for both to be closed).
 */
export function UpdateFlow({ started }: { started: boolean }) {
  const [whatsNew, setWhatsNew] = useState<ReleaseNotes | null>(null);
  const touring = useTourStore((st) => st.active);

  useEffect(() => {
    const st = useUpdateStore.getState();
    const unlisten = [events.onUpdateProgress(st.onProgress), events.onUpdateReady(st.onReady), events.onUpdateFailed(st.onFailed)];
    return () => unlisten.forEach((p) => void p.then((f) => f()));
  }, []);

  useEffect(() => {
    if (!started) return;
    void (async () => {
      const settings = useSettingsStore.getState().settings;
      if (!settings) return;
      const version = await getVersion();
      if (!settings.tutorialDone) {
        markSeen(version);
        useTourStore.getState().start();
      } else if (settings.lastSeenReleaseNotes !== version) {
        const notes = bundledNotes(version);
        if (notes && hasNotes(notesIn(notes, resolveLocale(settings.language)))) setWhatsNew(notes);
        else markSeen(version);
      }
      if (settings.checkForUpdates) await useUpdateStore.getState().check(false);
    })();
  }, [started]);

  const closeWhatsNew = () => {
    if (whatsNew) markSeen(whatsNew.version);
    setWhatsNew(null);
  };

  return (
    <>
      <WhatsNewDialog notes={whatsNew} onClose={closeWhatsNew} />
      <UpdateDialog suppressed={whatsNew !== null || touring} />
    </>
  );
}
