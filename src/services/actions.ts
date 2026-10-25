// User-level actions shared by several components (buttons, shortcuts, drag & drop).
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { fmt, messagesFor } from "../i18n";
import { groupOfJob, useQueueStore, type Group } from "../stores/queueStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import type { AddResult, AppError } from "../types";
import { fileName } from "../utils/format";
import { api, toAppError } from "./api";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif"];
export const CLIP_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];

const messages = () => messagesFor(useSettingsStore.getState().settings?.language);
const toast = (...a: Parameters<ReturnType<typeof useUiStore.getState>["toast"]>) => useUiStore.getState().toast(...a);

export function errorTitle(e: AppError): string {
  return messages().errors[e.code].title;
}

export function reportError(e: unknown) {
  const err = toAppError(e);
  toast({ kind: "error", title: errorTitle(err), body: err.detail });
}

/** Selects the new files and shows the workspace they belong to. */
function handleAddResult(r: AddResult, preferred?: Group) {
  const t = messages();
  const { jobs, select } = useQueueStore.getState();
  const added = r.added.map((id) => jobs.find((j) => j.id === id)).filter((j) => j !== undefined);
  if (added.length) {
    const groups = new Set(added.map((j) => groupOfJob(j)));
    const target: Group = preferred && groups.has(preferred) ? preferred : groupOfJob(added[added.length - 1]!);
    const last = [...added].reverse().find((j) => groupOfJob(j) === target);
    if (last) select(last.id, false);
    const ui = useUiStore.getState();
    if (ui.page !== target) ui.setPage(target);
    if (groups.size > 1 && target !== "convert") {
      const other: Group = target === "image" ? "clip" : "image";
      const count = added.filter((j) => groupOfJob(j) === other).length;
      toast({ kind: "info", title: fmt(t.toast.movedTo, { count, where: other === "image" ? t.nav.image : t.nav.clip }) });
    }
  }
  if (r.rejected.length) {
    const first = r.rejected[0]!;
    toast({
      kind: "error",
      title: fmt(t.toast.rejected, { count: r.rejected.length }),
      body: `${fileName(first.path)} — ${t.errors[first.error.code].title}`,
    });
  }
}

export async function addPaths(paths: string[], preferred?: Group) {
  try {
    const r = await api.addFiles(paths, preferred === "convert" ? "convert" : "process");
    // The snapshot event carrying the new jobs may arrive after the command returns.
    if (r.added.some((id) => !useQueueStore.getState().jobs.some((j) => j.id === id))) {
      useQueueStore.getState().applySnapshot(await api.getQueue());
    }
    handleAddResult(r, preferred);
  } catch (e) {
    reportError(e);
  }
}

export async function pickFiles(group?: Group) {
  const t = messages();
  const filters =
    group === "clip"
      ? [{ name: t.dropzone.filterClips, extensions: CLIP_EXTENSIONS }]
      : group === "convert"
        ? [{ name: `${t.dropzone.filterImages} / ${t.dropzone.filterClips}`, extensions: [...IMAGE_EXTENSIONS, ...CLIP_EXTENSIONS] }]
        : group === "image"
          ? [{ name: t.dropzone.filterImages, extensions: IMAGE_EXTENSIONS }]
          : [{ name: `${t.dropzone.filterImages} / ${t.dropzone.filterClips}`, extensions: [...IMAGE_EXTENSIONS, ...CLIP_EXTENSIONS] }];
  const picked = await open({ multiple: true, directory: false, title: t.dropzone.pickTitle, filters });
  if (picked && picked.length) await addPaths(picked, group);
}

export async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}

export async function addPastedBytes(bytes: Uint8Array) {
  try {
    const r = await api.addPastedImage(bytes);
    useQueueStore.getState().applySnapshot(await api.getQueue());
    handleAddResult(r, "image");
  } catch (e) {
    reportError(e);
  }
}

/**
 * Main button of a workspace: queue every file of this workspace that has not
 * been processed yet; if there is none, re-run the selected one with the
 * current settings.
 */
export async function startProcessing(group: Group) {
  const { jobs, selected, setFollowActive } = useQueueStore.getState();
  await useSettingsStore.getState().flush();
  try {
    setFollowActive(true);
    const idle = jobs.filter((j) => j.status === "idle" && groupOfJob(j) === group).map((j) => j.id);
    if (idle.length) {
      await api.enqueue(idle);
      return;
    }
    const current = jobs.find((j) => j.id === selected[group]);
    if (current && current.status !== "processing" && current.status !== "waiting") {
      const id = await api.duplicateJob(current.id);
      if (id) await api.enqueue([id]);
    }
  } catch (e) {
    reportError(e);
  }
}

export async function copyPath(path: string) {
  await writeText(path);
  toast({ kind: "success", title: messages().action.copied, body: path });
}

export const safely =
  <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
  (...a: A) => {
    fn(...a).catch(reportError);
  };
