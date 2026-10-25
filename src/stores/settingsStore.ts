import { create } from "zustand";
import { api, toAppError } from "../services/api";
import type { AnimSettings, CompressSettings, OutputOptions, Settings, UpscaleParams } from "../types";

export type AnimKey = "gif" | "clip";
export type CompressKey = "imageCompress" | "gifCompress" | "clipCompress" | "convert";

/** Compression settings behind a key ("convert" is nested in the Convert settings). */
export function compressOf(s: Settings, key: CompressKey): CompressSettings {
  return key === "convert" ? s.convert.compress : s[key];
}

const SAVE_DELAY_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

interface SettingsState {
  settings: Settings | null;
  error: string | null;
  load: () => Promise<void>;
  /** Optimistic update; persisted to disk shortly after the last change. */
  update: (patch: (s: Settings) => Settings) => void;
  setUpscale: (patch: Partial<UpscaleParams>) => void;
  setOutput: (patch: Partial<OutputOptions>) => void;
  setAnim: (key: AnimKey, patch: Partial<AnimSettings>) => void;
  setCompress: (key: CompressKey, patch: Partial<CompressSettings>) => void;
  flush: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  error: null,

  load: async () => {
    try {
      set({ settings: await api.getSettings(), error: null });
    } catch (e) {
      set({ error: toAppError(e).detail });
    }
  },

  update: (patch) => {
    const current = get().settings;
    if (!current) return;
    set({ settings: patch(current) });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  },

  setUpscale: (patch) => get().update((s) => ({ ...s, upscale: { ...s.upscale, ...patch } })),
  setOutput: (patch) => get().update((s) => ({ ...s, output: { ...s.output, ...patch } })),
  setAnim: (key, patch) => get().update((s) => ({ ...s, [key]: { ...s[key], ...patch } })),
  setCompress: (key, patch) =>
    get().update((s) =>
      key === "convert" ? { ...s, convert: { ...s.convert, compress: { ...s.convert.compress, ...patch } } } : { ...s, [key]: { ...s[key], ...patch } },
    ),

  flush: async () => {
    clearTimeout(saveTimer);
    const s = get().settings;
    if (!s) return;
    try {
      // The backend sanitises values; adopt its version only if it differs, to
      // avoid clobbering edits made while the save was in flight.
      const saved = await api.saveSettings(s);
      if (JSON.stringify(saved) !== JSON.stringify(s) && get().settings === s) set({ settings: saved });
      set({ error: null });
    } catch (e) {
      set({ error: toAppError(e).detail });
    }
  },
}));
