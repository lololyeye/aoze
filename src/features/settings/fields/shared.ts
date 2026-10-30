import { useSettingsStore } from "../../../stores/settingsStore";
import type { Settings } from "../../../types";

export function useSettings(): Settings {
  const settings = useSettingsStore((st) => st.settings);
  if (!settings) throw new Error("settings not loaded");
  return settings;
}
