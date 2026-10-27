import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Toaster } from "../components/ui/Toaster";
import { TooltipProvider } from "../components/ui/Tooltip";
import { AboutDialog } from "../features/about/AboutDialog";
import { ConvertPage } from "../features/convert/ConvertPage";
import { DiagnosticsSheet } from "../features/diagnostics/DiagnosticsSheet";
import { HelpPage } from "../features/help/HelpPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { HomePage } from "../features/home/HomePage";
import { Tour } from "../features/tour/Tour";
import { SettingsPage } from "../features/settings/SettingsPage";
import { UpdateFlow } from "../features/update/UpdateFlow";
import { Workspace } from "../features/workspace/Workspace";
import { playWelcome } from "../services/sounds";
import { useSettingsStore } from "../stores/settingsStore";
import { useSystemStore } from "../stores/systemStore";
import { useUiStore, type Page } from "../stores/uiStore";
import { Backdrop } from "./Backdrop";
import { Sidebar } from "./Sidebar";
import { Splash } from "./Splash";
import { Titlebar } from "./Titlebar";
import { useAppEvents } from "./useAppEvents";
import { useRootFlags } from "./useRootFlags";
import { useApplyTheme } from "./useTheme";
import s from "./App.module.css";

function PageView({ page }: { page: Page }) {
  switch (page) {
    case "home":
      return <HomePage />;
    case "image":
      return <Workspace group="image" />;
    case "clip":
      return <Workspace group="clip" />;
    case "convert":
      return <ConvertPage />;
    case "history":
      return <HistoryPage />;
    case "settings":
      return <SettingsPage />;
    case "help":
      return <HelpPage />;
  }
}

export function App() {
  const loaded = useSettingsStore((st) => st.settings !== null);
  const startupAnimation = useSettingsStore((st) => st.settings?.startupAnimation ?? true);
  const startupSound = useSettingsStore((st) => st.settings?.startupSound ?? false);
  const page = useUiStore((st) => st.page);
  // Captured once: toggling the settings later must not replay the launch.
  const [launch, setLaunch] = useState<{ animation: boolean; sound: boolean } | null>(null);
  const [splashDone, setSplashDone] = useState(false);
  useApplyTheme();
  useAppEvents();
  useRootFlags();

  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  if (loaded && launch === null) setLaunch({ animation: startupAnimation, sound: startupSound });

  // Without the animation: the voice alone, and the system check in the background.
  useEffect(() => {
    if (!launch || launch.animation) return;
    void useSystemStore.getState().loadCheck().catch(() => undefined);
    if (launch.sound) void playWelcome(useSettingsStore.getState().settings?.soundVolume ?? 40).catch(() => undefined);
  }, [launch]);

  // The window starts hidden to avoid a white flash; show it once styled.
  useEffect(() => {
    if (loaded) requestAnimationFrame(() => void getCurrentWindow().show());
  }, [loaded]);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={350} skipDelayDuration={150}>
        <div className={s.app}>
          <Titlebar />
          {loaded && (
            <main className={s.body}>
              <Backdrop />
              <Sidebar />
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={page}
                  className={s.page}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  <PageView page={page} />
                </motion.div>
              </AnimatePresence>
            </main>
          )}
        </div>
        {loaded && (
          <>
            <DiagnosticsSheet />
            <AboutDialog />
            <UpdateFlow started={launch !== null && (!launch.animation || splashDone)} />
            <Tour />
          </>
        )}
        {launch?.animation && <Splash sound={launch.sound} onDone={() => setSplashDone(true)} />}
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}
