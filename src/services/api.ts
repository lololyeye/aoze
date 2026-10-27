// The only module that talks to the Rust backend. Components and stores call
// these typed functions instead of `invoke` / `listen` directly.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type {
  AddResult,
  AppError,
  BatchSummary,
  CompressReport,
  Purpose,
  HistoryEntry,
  LutInfo,
  ProgressEvent,
  QueueSnapshot,
  Settings,
  SystemCheck,
  SystemStatus,
  UpdateError,
  UpdateInfo,
  UpdateProgress,
} from "../types";

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "code" in e && "detail" in e;
}

export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  return { code: "internal", detail: e instanceof Error ? e.message : String(e) };
}

export const api = {
  systemStatus: () => invoke<SystemStatus>("get_system_status"),
  refreshSystemStatus: () => invoke<SystemStatus>("refresh_system_status"),
  systemCheck: () => invoke<SystemCheck>("system_check"),

  getSettings: () => invoke<Settings>("get_settings"),
  lutList: () => invoke<LutInfo[]>("lut_list"),
  lutImport: (path: string) => invoke<LutInfo>("lut_import", { path }),
  lutRemove: (id: string) => invoke<void>("lut_remove", { id }),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),

  addFiles: (paths: string[], purpose: Purpose = "process") => invoke<AddResult>("add_files", { paths, purpose }),
  addPastedImage: (bytes: Uint8Array) => invoke<AddResult>("add_pasted_image", bytes),
  estimateCompression: (id: string) => invoke<CompressReport>("estimate_compression", { id }),
  startupSound: () => invoke<string | null>("startup_sound_path"),

  getQueue: () => invoke<QueueSnapshot>("get_queue"),
  enqueue: (ids?: string[]) => invoke<number>("enqueue", { ids: ids ?? null }),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  cancelAll: () => invoke<void>("cancel_all"),
  setPaused: (paused: boolean) => invoke<void>("set_paused", { paused }),
  retryJobs: (ids?: string[]) => invoke<void>("retry_jobs", { ids: ids ?? null }),
  removeJobs: (ids: string[]) => invoke<void>("remove_jobs", { ids }),
  clearFinished: () => invoke<void>("clear_finished"),
  duplicateJob: (id: string) => invoke<string | null>("duplicate_job", { id }),
  /** Light preview copy of a clip (or its result) the viewer could not play. */
  repairPreview: (id: string, result: boolean) => invoke<void>("repair_preview", { id, result }),
  jobLog: (id: string) => invoke<string[]>("get_job_log", { id }),

  history: () => invoke<HistoryEntry[]>("get_history"),
  removeHistory: (id: string) => invoke<void>("remove_history", { id }),
  clearHistory: () => invoke<void>("clear_history"),

  openFile: (path: string) => invoke<void>("open_file", { path }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openLogsDir: () => invoke<void>("open_logs_dir"),
  diagnostics: () => invoke<string>("get_diagnostics"),

  updateCheck: () => invoke<UpdateInfo | null>("update_check"),
  updateDownload: () => invoke<void>("update_download"),
  updateCancel: () => invoke<void>("update_cancel"),
  /** Runs the installer and closes Aoze when it succeeds. */
  updateInstall: () => invoke<void>("update_install"),
};

/** URL the webview can load for a local file the backend has allowed. */
export const fileUrl = (path: string) => convertFileSrc(path);

export interface DragDropHandlers {
  onHover: (hovering: boolean) => void;
  onDrop: (paths: string[]) => void;
}

export const events = {
  onQueue: (cb: (s: QueueSnapshot) => void) => listen<QueueSnapshot>("queue://updated", (e) => cb(e.payload)),
  onProgress: (cb: (p: ProgressEvent) => void) => listen<ProgressEvent>("queue://progress", (e) => cb(e.payload)),
  onLog: (cb: (l: { id: string; line: string }) => void) =>
    listen<{ id: string; line: string }>("queue://log", (e) => cb(e.payload)),
  onBatchFinished: (cb: (b: BatchSummary) => void) =>
    listen<BatchSummary>("queue://batch-finished", (e) => cb(e.payload)),
  onSystem: (cb: (s: SystemStatus) => void) => listen<SystemStatus>("system://updated", (e) => cb(e.payload)),
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => listen<UpdateProgress>("update://progress", (e) => cb(e.payload)),
  onUpdateReady: (cb: () => void) => listen("update://ready", () => cb()),
  onUpdateFailed: (cb: (e: UpdateError) => void) => listen<UpdateError>("update://failed", (e) => cb(e.payload)),
  onDragDrop: ({ onHover, onDrop }: DragDropHandlers): Promise<UnlistenFn> =>
    getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") onHover(true);
      else if (p.type === "leave") onHover(false);
      else if (p.type === "drop") {
        onHover(false);
        if (p.paths.length) onDrop(p.paths);
      }
    }),
};
