import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";
import { fmt, messagesFor } from "../i18n";
import { api, events } from "../services/api";
import { addPastedBytes, addPaths, pickFiles, reportError, startProcessing } from "../services/actions";
import { playCompletion } from "../services/sounds";
import { useQueueStore } from "../stores/queueStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSystemStore } from "../stores/systemStore";
import { useUiStore } from "../stores/uiStore";
import type { BatchSummary } from "../types";

async function onBatchFinished(b: BatchSummary) {
  const settings = useSettingsStore.getState().settings;
  if (!settings || b.completed + b.failed === 0) return;
  const t = messagesFor(settings.language);
  const body = fmt(t.toast.batchBody, { completed: b.completed, failed: b.failed });
  useUiStore.getState().toast({ kind: b.failed ? "error" : "success", title: t.toast.batchDone, body });
  // One sound per run (the batch event fires once, however many files).
  if (settings.completionSound && b.completed > 0) playCompletion(settings.soundVolume);

  // One Explorer window per run, with the last result selected.
  if (settings.openFolderWhenDone && b.lastOutput) await api.revealFile(b.lastOutput);
  if (settings.notifications && !(await getCurrentWindow().isFocused())) {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title: t.toast.batchDone, body });
  }
}

/** Wires backend events, drag & drop, clipboard paste and global shortcuts. */
export function useAppEvents() {
  useEffect(() => {
    const unlisten = [
      events.onQueue((s) => useQueueStore.getState().applySnapshot(s)),
      events.onProgress((p) => useQueueStore.getState().applyProgress(p)),
      events.onSystem((s) => useSystemStore.getState().set(s)),
      events.onBatchFinished((b) => void onBatchFinished(b).catch(reportError)),
      events.onDragDrop({
        onHover: (h) => useUiStore.getState().setDragHover(h),
        onDrop: (paths) => {
          const page = useUiStore.getState().page;
          void addPaths(paths, page === "clip" || page === "image" || page === "convert" ? page : undefined);
        },
      }),
    ];
    // Initial state, in case events fired before the listeners were attached.
    api.getQueue().then((s) => useQueueStore.getState().applySnapshot(s)).catch(reportError);
    void useSystemStore.getState().load().catch(reportError);
    return () => unlisten.forEach((p) => void p.then((f) => f()));
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void file.arrayBuffer().then((b) => addPastedBytes(new Uint8Array(b)));
    };
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        const page = useUiStore.getState().page;
        void pickFiles(page === "clip" || page === "image" || page === "convert" ? page : undefined).catch(reportError);
      } else if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        const page = useUiStore.getState().page;
        if (page === "clip" || page === "image" || page === "convert") void startProcessing(page);
      } else if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        ui.setPage("settings");
      } else if (e.key === "Escape" && !ui.panel) {
        const active = useQueueStore.getState().activeJob;
        if (active) void api.cancelJob(active).catch(reportError);
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
