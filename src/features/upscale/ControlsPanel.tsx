import { Collapsible } from "../../components/ui/Collapsible";
import { useMessages } from "../../i18n";
import { useSelectedJob, type Group } from "../../stores/queueStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Job } from "../../types";
import { targetDims } from "../../utils/format";
import type { PresetKind } from "../../utils/presets";
import {
  ActionField,
  AnimScaleField,
  BeatSyncField,
  CleanupStyleField,
  ClipEnhanceField,
  ClipBlurField,
  ClipFormatField,
  GlowField,
  LutField,
  SpeedField,
  DiscordField,
  EncoderField,
  EstimateRow,
  FolderField,
  FormatField,
  FpsField,
  GifEnhanceField,
  HdrField,
  LookFields,
  MaxSizeField,
  MotionBlurField,
  NoiseField,
  QualityField,
  ScaleField,
  SmoothMotionField,
  SmoothQualityField,
  StyleField,
  TtaField,
} from "../settings/fields";
import { PresetBar } from "./PresetBar";
import { ProcessButton } from "./ProcessButton";
import s from "./ControlsPanel.module.css";

export function kindFor(group: Group, job: Job | null): PresetKind {
  if (group === "clip") return "clip";
  return job?.source.kind === "gif" ? "gif" : "image";
}

function ImageControls({ job }: { job: Job | null }) {
  const t = useMessages();
  const settings = useSettingsStore((st) => st.settings)!;
  const action = settings.imageAction;
  const src = job ? { w: job.source.info.width, h: job.source.info.height } : undefined;
  const target = src && action !== "compress" ? (([w, h]) => ({ w, h }))(targetDims(src.w, src.h, settings.upscale.scale)) : src;
  // A Discord slot fixes size, format and file cap: only the clean-up options remain.
  if (settings.discord) {
    return (
      <>
        <div className={s.main}>
          <DiscordField source={src} />
          <StyleField />
          <NoiseField />
        </div>
        <Collapsible title={t.controls.output} defaultOpen>
          <FolderField />
        </Collapsible>
        <Collapsible title={t.controls.advanced}>
          <TtaField />
        </Collapsible>
      </>
    );
  }
  return (
    <>
      <div className={s.main}>
        <ActionField />
        {action !== "compress" && (
          <>
            <StyleField />
            <ScaleField sourceSize={src} />
            <NoiseField />
          </>
        )}
        {action !== "improve" && <QualityField which="imageCompress" />}
        {action === "compress" && job && job.source.kind === "image" && <EstimateRow job={job} />}
        <DiscordField source={src} />
      </div>
      <Collapsible title={t.controls.output} defaultOpen>
        <FormatField targetSize={target} showQuality={action === "improve"} />
        {action !== "improve" && settings.output.format === "png" && <p className={s.note}>{t.controls.pngNote}</p>}
        <MaxSizeField which="imageCompress" />
        <FolderField />
      </Collapsible>
      <Collapsible title={t.controls.advanced}>
        <TtaField />
      </Collapsible>
    </>
  );
}

function GifControls({ job }: { job: Job | null }) {
  const t = useMessages();
  const discord = useSettingsStore((st) => st.settings?.discord);
  const media = job?.source.media ?? undefined;
  const src = job ? { w: job.source.info.width, h: job.source.info.height } : undefined;
  return (
    <>
      <div className={s.main}>
        {!discord && <AnimScaleField which="gif" source={src} />}
        <GifEnhanceField />
        <FpsField which="gif" sourceFps={media?.fps} />
        <MotionBlurField which="gif" />
        <DiscordField source={src} />
      </div>
      <Collapsible title={t.controls.output} defaultOpen>
        <QualityField which="gifCompress" />
        <MaxSizeField which="gifCompress" />
        <FolderField />
      </Collapsible>
      <Collapsible title={t.controls.advanced}>
        <CleanupStyleField which="gif" />
      </Collapsible>
    </>
  );
}

/** A titled group of the main clip options (Motion, Color): always visible. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.group}>
      <h3 className={s.groupTitle}>{title}</h3>
      {children}
    </div>
  );
}

/**
 * Clips: the main choices stay visible in a few groups (Enhancement, Format,
 * Motion, Color); effects, fine colour and output details are folded away.
 */
function ClipControls({ job }: { job: Job | null }) {
  const t = useMessages();
  const clip = useSettingsStore((st) => st.settings!.clip);
  const media = job?.source.media ?? undefined;
  const src = job ? { w: job.source.info.width, h: job.source.info.height } : undefined;
  const smoothOn = clip.smooth !== "off" && clip.fps !== null;
  return (
    <>
      <div className={s.main}>
        <AnimScaleField which="clip" source={src} />
        <ClipEnhanceField />
        <ClipFormatField source={src} />
      </div>
      <Group title={t.controls.groupMotion}>
        <SmoothMotionField sourceFps={media?.fps} />
        {smoothOn && <SmoothQualityField />}
        <ClipBlurField />
        <SpeedField media={media} />
      </Group>
      <Group title={t.controls.groupColor}>
        <HdrField media={media} />
        <LutField />
      </Group>
      <Collapsible title={t.controls.groupEffects}>
        <BeatSyncField media={media} />
        <GlowField />
      </Collapsible>
      <Collapsible title={t.controls.look}>
        <LookFields />
      </Collapsible>
      <Collapsible title={t.controls.output} defaultOpen>
        <QualityField which="clipCompress" />
        <MaxSizeField which="clipCompress" allowGb />
        <FolderField />
      </Collapsible>
      <Collapsible title={t.controls.advanced}>
        <EncoderField />
        <CleanupStyleField which="clip" />
      </Collapsible>
    </>
  );
}

export function ControlsPanel({ group }: { group: Group }) {
  const settings = useSettingsStore((st) => st.settings);
  const job = useSelectedJob(group);
  if (!settings) return <aside className={s.panel} />;
  const kind = kindFor(group, job);
  return (
    <aside className={s.panel}>
      <div className={s.scroll}>
        <div className={s.presets}>
          <PresetBar kind={kind} />
        </div>
        {kind === "image" ? <ImageControls job={job} /> : kind === "gif" ? <GifControls job={job} /> : <ClipControls job={job} />}
      </div>
      <ProcessButton group={group} />
    </aside>
  );
}
