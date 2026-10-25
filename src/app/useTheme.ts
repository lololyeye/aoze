import { useEffect, useSyncExternalStore } from "react";
import { useSettingsStore } from "../stores/settingsStore";

const query = () => window.matchMedia("(prefers-color-scheme: light)");

function useSystemLight(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = query();
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => query().matches,
  );
}

export function useResolvedTheme(): "dark" | "light" {
  const theme = useSettingsStore((s) => s.settings?.theme ?? "dark");
  const systemLight = useSystemLight();
  if (theme === "system") return systemLight ? "light" : "dark";
  return theme;
}

/** Applies the resolved theme to <html data-theme>. */
export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
