import { create } from "zustand";
import { stopTourVoice } from "../../services/sounds";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { STEPS } from "./steps";

interface TourState {
  active: boolean;
  index: number;
  start: () => void;
  next: () => void;
  /** Finished or skipped: never shown again on its own (Help can replay it). */
  end: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  index: 0,
  start: () => set({ active: true, index: 0 }),
  next: () => {
    const { index } = get();
    if (index >= STEPS.length - 1) get().end();
    else set({ index: index + 1 });
  },
  end: () => {
    stopTourVoice();
    set({ active: false, index: 0 });
    useUiStore.getState().setPage("home");
    const settings = useSettingsStore.getState();
    if (settings.settings && !settings.settings.tutorialDone) {
      settings.update((s) => ({ ...s, tutorialDone: true }));
      void settings.flush();
    }
  },
}));
