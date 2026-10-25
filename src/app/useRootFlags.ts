import { useEffect } from "react";
import { useQueueStore } from "../stores/queueStore";
import { useSystemStore } from "../stores/systemStore";

/**
 * `data-busy` while a job runs and `data-lite` on modest graphics cards: CSS
 * uses them to drop GPU-heavy effects so the interface stays smooth.
 */
export function useRootFlags() {
  const busy = useQueueStore((st) => st.activeJob !== null);
  const lite = useSystemStore((st) => st.check?.profile?.gpu === "low");
  useEffect(() => {
    document.documentElement.toggleAttribute("data-busy", busy);
  }, [busy]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-lite", lite);
  }, [lite]);
}
