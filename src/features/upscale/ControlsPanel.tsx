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
  CleanupStyleField,
  ClipEnhanceField,
  ClipBlurField,
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

function AnimControls({ which, job }: { which: "gif" | "clip"; job: Job | null }) {
  const t = useMessages();
  const discord = useSettingsStore((st) => (which === "gif" ? st.settings?.discord : null));
  const media = job?.source.media ?? undefined;
  const src = job ? { w: job.source.info.width, h: job.source.info.height } : undefined;
  const compress = which === "gif" ? "gifCompress" : "clipCompress";
  return (
    <>
      <div className={s.main}>
        {!discord && <AnimScaleField which={which} source={src} />}
        {which === "gif" ? <GifEnhanceField /> : <ClipEnhanceField />}
        {which === "gif" ? <FpsField which={which} sourceFps={media?.fps} /> : <SmoothMotionField sourceFps={media?.fps} />}
        {which === "gif" ? <MotionBlurField which={which} /> : <ClipBlurField />}
        {which === "clip" && <HdrField media={media} />}
        {which === "gif" && <DiscordField source={src} />}
      </div>
      {which === "clip" && (
        <Collapsible title={t.controls.look}>
          <LookFields />
        </Collapsible>
      )}
      <Collapsible title={t.controls.output} defaultOpen>
        <QualityField which={compress} />
        <MaxSizeField which={compress} allowGb={which === "clip"} />
        <FolderField />
      </Collapsible>
      <Collapsible title={t.controls.advanced}>
        {which === "clip" && <SmoothQualityField />}
        {which === "clip" && <EncoderField />}
        <CleanupStyleField which={which} />
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
        {kind === "image" ? <ImageControls job={job} /> : <AnimControls which={kind} job={job} />}
      </div>
      <ProcessButton group={group} />
    </aside>
  );
}
