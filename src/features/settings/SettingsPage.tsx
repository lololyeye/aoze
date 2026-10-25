import { Activity, FolderOpen, Play, RotateCcw } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Field, Section } from "../../components/ui/Field";
import { Page } from "../../components/ui/Page";
import { Segmented } from "../../components/ui/Segmented";
import { Slider } from "../../components/ui/Slider";
import { Toggle } from "../../components/ui/Toggle";
import { useMessages } from "../../i18n";
import { pickFolder, safely } from "../../services/actions";
import { playCompletion } from "../../services/sounds";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSystemStore } from "../../stores/systemStore";
import { useUiStore } from "../../stores/uiStore";
import type { Language, Settings, Theme } from "../../types";
import { ConflictField, DeviceField, SuffixField, ThreadsField, TileField } from "./fields";
import { PerformanceFields } from "./PerformanceSection";
import s from "./SettingsPage.module.css";

export function SettingsPage() {
  const t = useMessages();
  const settings = useSettingsStore((st) => st.settings);
  const update = useSettingsStore((st) => st.update);
  const refreshSystem = useSystemStore((st) => st.refresh);
  const openPanel = useUiStore((st) => st.openPanel);
  if (!settings) return null;

  const patch = (p: Partial<Settings>) => update((st) => ({ ...st, ...p }));
  const setEngineDir = async (engineDir: string | null) => {
    patch({ engineDir });
    await useSettingsStore.getState().flush();
    await refreshSystem();
  };
  const reset = async () =>
    update((st) => ({
      ...st,
      theme: "dark",
      language: "system",
      notifications: true,
      openFolderWhenDone: true,
      discord: null,
      convert: { gifOutput: "mp4", gifFps: 15, width: 480, frameMs: 500, compress: { level: "balanced", quality: 80, maxSize: null, unit: "mb" } },
      engineDir: null,
      keepTempFiles: false,
      startupAnimation: true,
      startupSound: true,
      completionSound: true,
      soundVolume: 40,
      performance: { mode: "balanced", autoOptimize: true },
      imageAction: "improve",
      upscale: { style: "artwork", scale: 2, noise: 1, gpu: null, tileSize: 0, tta: false, threads: { load: 1, proc: 2, save: 2 } },
      output: { format: "png", quality: 92, webpLossless: false, directory: null, suffix: "_{style}_{scale}x_noise{noise}", conflict: "rename" },
      imageCompress: { level: "balanced", quality: 80, maxSize: null, unit: "mb" },
      gif: { scale: 1, enhance: "off", style: "artworkFast", fps: null, fpsMode: "retime", motionBlur: 0, smooth: "off", hdr: "auto", look: { exposure: 0, contrast: 0, saturation: 0, sharpness: 0 } },
      gifCompress: { level: "best", quality: 80, maxSize: null, unit: "mb" },
      clip: { scale: 1, enhance: "off", style: "artworkFast", fps: null, fpsMode: "retime", motionBlur: 0, smooth: "off", hdr: "auto", look: { exposure: 0, contrast: 0, saturation: 0, sharpness: 0 } },
      clipCompress: { level: "balanced", quality: 80, maxSize: null, unit: "mb" },
      videoEncoder: "auto",
    }));

  return (
    <Page title={t.settings.title}>
      <Section title={t.settings.general}>
        <Field label={t.settings.theme}>
          <Segmented<Theme>
            ariaLabel={t.settings.theme}
            size="sm"
            value={settings.theme}
            onChange={(theme) => patch({ theme })}
            options={[
              { value: "system", label: t.settings.themeSystem },
              { value: "dark", label: t.settings.themeDark },
              { value: "light", label: t.settings.themeLight },
            ]}
          />
        </Field>
        <Field label={t.settings.language}>
          <Segmented<Language>
            ariaLabel={t.settings.language}
            size="sm"
            value={settings.language}
            onChange={(language) => patch({ language })}
            options={[
              { value: "system", label: t.settings.languageSystem },
              { value: "en", label: "English" },
              { value: "fr", label: "Français" },
            ]}
          />
        </Field>
        <Field label={t.settings.notifications} hint={t.settings.notificationsHint} inline>
          <Toggle label={t.settings.notifications} checked={settings.notifications} onChange={(notifications) => patch({ notifications })} />
        </Field>
        <Field label={t.settings.startupAnimation} hint={t.settings.startupAnimationHint} inline>
          <Toggle label={t.settings.startupAnimation} checked={settings.startupAnimation} onChange={(startupAnimation) => patch({ startupAnimation })} />
        </Field>
      </Section>

      <Section title={t.settings.sounds}>
        <Field label={t.settings.startupSound} hint={t.settings.startupSoundHint} inline>
          <Toggle label={t.settings.startupSound} checked={settings.startupSound} onChange={(startupSound) => patch({ startupSound })} />
        </Field>
        <Field label={t.settings.completionSound} hint={t.settings.completionSoundHint} inline>
          <Toggle label={t.settings.completionSound} checked={settings.completionSound} onChange={(completionSound) => patch({ completionSound })} />
        </Field>
        <Field label={t.settings.volume}>
          <div className={s.volume}>
            <Slider label={t.settings.volume} min={0} max={100} step={5} value={settings.soundVolume} onChange={(soundVolume) => patch({ soundVolume })} format={(v) => `${v} %`} />
            <IconButton label={t.settings.testSound} size="sm" onClick={() => playCompletion(settings.soundVolume)}>
              <Play />
            </IconButton>
          </div>
        </Field>
      </Section>

      <Section title={t.settings.sections.output}>
        <Field label={t.settings.openFolder} hint={t.settings.openFolderHint} inline>
          <Toggle label={t.settings.openFolder} checked={settings.openFolderWhenDone} onChange={(openFolderWhenDone) => patch({ openFolderWhenDone })} />
        </Field>
        <SuffixField />
        <ConflictField />
      </Section>

      <Section title={t.settings.performance}>
        <PerformanceFields />
        <DeviceField />
        <TileField />
        <ThreadsField />
      </Section>

      <Section title={t.settings.advanced}>
        <Field label={t.settings.engineDir} hint={t.settings.engineDirHint}>
          <div className={s.row}>
            <span className={s.path} title={settings.engineDir ?? undefined}>
              {settings.engineDir ?? t.settings.engineBundled}
            </span>
            {settings.engineDir && (
              <IconButton label={t.settings.engineBundled} size="sm" onClick={safely(() => setEngineDir(null))}>
                <RotateCcw />
              </IconButton>
            )}
            <Button
              size="sm"
              icon={<FolderOpen />}
              onClick={safely(async () => {
                const dir = await pickFolder();
                if (dir) await setEngineDir(dir);
              })}
            >
              {t.controls.folderChange}
            </Button>
          </div>
        </Field>
        <Field label={t.settings.keepTemp} hint={t.settings.keepTempHint} inline>
          <Toggle label={t.settings.keepTemp} checked={settings.keepTempFiles} onChange={(keepTempFiles) => patch({ keepTempFiles })} />
        </Field>
        <div className={s.footer}>
          <Button size="sm" icon={<Activity />} onClick={() => openPanel("diagnostics")}>
            {t.settings.diagnostics}
          </Button>
          <Button size="sm" variant="danger" onClick={safely(reset)}>
            {t.settings.reset}
          </Button>
        </div>
        <p className={s.saved}>{t.settings.saved}</p>
      </Section>
    </Page>
  );
}
