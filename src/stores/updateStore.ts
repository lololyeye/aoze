import { create } from "zustand";
import { api } from "../services/api";
import type { UpdateError, UpdateInfo, UpdateProgress } from "../types";
import { useQueueStore } from "./queueStore";

/**
 * idle: nothing known · checking · upToDate · available: a newer version, not downloaded ·
 * downloading · ready: downloaded and verified · installing: Aoze is about to close ·
 * error: the last step failed (`failedStep` says which, for Retry).
 */
export type UpdatePhase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "installing" | "error";

interface UpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: UpdateError | null;
  failedStep: "check" | "download" | "install" | null;
  /** The update dialog is shown. */
  open: boolean;
  /** Install as soon as the download is verified (the user is watching the dialog). */
  installWhenReady: boolean;
  check: (manual: boolean) => Promise<void>;
  download: () => Promise<void>;
  cancel: () => Promise<void>;
  install: () => Promise<void>;
  retry: () => void;
  setOpen: (open: boolean) => void;
  onProgress: (p: UpdateProgress) => void;
  onReady: () => void;
  onFailed: (e: UpdateError) => void;
}

function toUpdateError(e: unknown): UpdateError {
  if (typeof e === "object" && e !== null && "kind" in e && "detail" in e) return e as UpdateError;
  return { kind: "other", detail: e instanceof Error ? e.message : String(e) };
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: "idle",
  info: null,
  progress: null,
  error: null,
  failedStep: null,
  open: false,
  installWhenReady: false,

  check: async (manual) => {
    const { phase } = get();
    if (phase === "checking" || phase === "downloading" || phase === "installing") return;
    set({ phase: "checking", error: null, failedStep: null });
    try {
      const info = await api.updateCheck();
      if (!info) {
        set({ phase: "upToDate", info: null });
        return;
      }
      set({ phase: info.downloaded ? "ready" : "available", info, progress: null, open: true });
    } catch (e) {
      const error = toUpdateError(e);
      console.warn("update check failed:", error.detail);
      // At launch a failed check stays silent (offline, GitHub unavailable): nothing to act on.
      set(manual ? { phase: "error", error, failedStep: "check" } : { phase: "idle" });
    }
  },

  download: async () => {
    set({ phase: "downloading", progress: { received: 0, total: get().info?.size ?? null }, error: null, failedStep: null, installWhenReady: true });
    try {
      await api.updateDownload();
    } catch (e) {
      get().onFailed(toUpdateError(e));
    }
  },

  cancel: async () => {
    await api.updateCancel().catch(() => undefined);
    set({ phase: "available", progress: null, installWhenReady: false });
  },

  install: async () => {
    if (useQueueStore.getState().activeJob) {
      set({ phase: "ready" });
      return;
    }
    set({ phase: "installing", error: null, failedStep: null });
    try {
      // On success Aoze closes here and the installer reopens it on the new version.
      await api.updateInstall();
    } catch (e) {
      const error = toUpdateError(e);
      set(error.kind === "busy" ? { phase: "ready" } : { phase: "error", error, failedStep: "install" });
    }
  },

  retry: () => {
    const step = get().failedStep;
    if (step === "install") void get().install();
    else if (step === "download") void get().download();
    else void get().check(true);
  },

  // Closing the dialog during a download keeps it going; it will wait to be installed.
  setOpen: (open) => set(open ? { open } : { open, installWhenReady: false }),

  onProgress: (progress) => {
    if (get().phase === "downloading") set({ progress });
  },

  onReady: () => {
    if (get().phase !== "downloading") return;
    set({ phase: "ready" });
    if (get().open && get().installWhenReady) void get().install();
  },

  onFailed: (error) => set({ phase: "error", error, failedStep: "download", progress: null }),
}));
