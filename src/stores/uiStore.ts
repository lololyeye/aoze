import { create } from "zustand";

export type Page = "home" | "image" | "clip" | "convert" | "history" | "settings" | "help";
export type Panel = "diagnostics" | "about" | null;
export type ViewerMode = "split" | "side";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  title: string;
  body?: string;
}

interface UiState {
  page: Page;
  panel: Panel;
  viewerMode: ViewerMode;
  dragHover: boolean;
  toasts: Toast[];
  setPage: (p: Page) => void;
  openPanel: (p: Panel) => void;
  setViewerMode: (m: ViewerMode) => void;
  setDragHover: (v: boolean) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let nextToast = 1;

export const useUiStore = create<UiState>((set, get) => ({
  page: "home",
  panel: null,
  viewerMode: "split",
  dragHover: false,
  toasts: [],
  setPage: (page) => set({ page, panel: null }),
  openPanel: (panel) => set({ panel }),
  setViewerMode: (viewerMode) => set({ viewerMode }),
  setDragHover: (dragHover) => set({ dragHover }),
  toast: (t) => {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 7000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
