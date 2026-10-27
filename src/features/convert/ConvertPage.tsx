import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FileImage, Film, FolderOpen, Images, Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Collapsible } from "../../components/ui/Collapsible";
import { Field } from "../../components/ui/Field";
import { Segmented } from "../../components/ui/Segmented";
import { fmt, useMessages } from "../../i18n";
import { api, fileUrl } from "../../services/api";
import { pickFiles, safely } from "../../services/actions";
import { useGroupJobs, useSelectedJob } from "../../stores/queueStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import type { ConvertSettings, GifOutput, Job } from "../../types";
import { formatBytes, formatDims } from "../../utils/format";
import { ProcessingQueue } from "../queue/ProcessingQueue";
import { FolderField, MaxSizeField, QualityField } from "../settings/fields";
import { ErrorCard } from "../upscale/ErrorCard";
import { ProcessButton } from "../upscale/ProcessButton";
import { ResultBar } from "../upscale/ResultBar";
import { ClipViewer } from "../viewer/ClipViewer";
import s from "./ConvertPage.module.css";

const FPS = [10, 15, 24, 30];
const WIDTHS = [320, 480, 720, 1080];
const FRAME_MS = [100, 250, 500, 1000, 2000];

function useConvert(): [ConvertSettings, (patch: Partial<ConvertSettings>) => void] {
  const settings = useSettingsStore((st) => st.settings)!;
  const update = useSettingsStore((st) => st.update);
  return [settings.convert, (patch) => update((st) => ({ ...st, convert: { ...st.convert, ...patch } }))];
}

/** Empty state: the four conversions, each opening the file picker. */
function Start() {
  const t = useMessages();
  const [, setConvert] = useConvert();
  const hover = useUiStore((st) => st.dragHover);
  const entries: { label: string; icon: typeof Film; gifOutput?: GifOutput }[] = [
    { label: t.convert.clipToGif, icon: Film },
    { label: t.convert.gifToVideo, icon: FileImage, gifOutput: "mp4" },
    { label: t.convert.imagesToGif, icon: Images },
    { label: t.convert.gifToFrames, icon: FolderOpen, gifOutput: "frames" },
  ];
  return (
    <div className={`${s.start} ${hover ? s.hover : ""}`} data-tour="convert-start">
      <h1 className={s.title}>{t.convert.title}</h1>
      <p className={s.subtitle}>{t.convert.subtitle}</p>
      <button type="button" className={s.drop} onClick={safely(() => pickFiles("convert"))}>
        <span className={s.dropTitle}>{hover ? t.dropzone.dropNow : t.convert.drop}</span>
        <span className={s.dropHint}>{t.convert.browse}</span>
      </button>
      <div className={s.kinds} data-tour="convert-kinds">
        {entries.map(({ label, icon: Icon, gifOutput }) => (
          <button
            key={label}
            type="button"
            className={s.kind}
            onClick={safely(async () => {
              if (gifOutput) setConvert({ gifOutput });
              await pickFiles("convert");
            })}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Input facts, as plain rows. */
function InputCard({ job }: { job: Job }) {
  const t = useMessages();
  const m = job.source.media;
  const rows: [string, string][] = [[t.convert.resolution, formatDims(job.source.info.width, job.source.info.height)]];
  if (m) {
    rows.unshift([t.convert.duration, `${(m.durationMs / 1000).toFixed(1)} s`]);
    rows.push([t.convert.fps, String(Math.round(m.fps * 100) / 100)], [t.convert.frames, String(m.frames)]);
  }
  rows.push([t.convert.size, formatBytes(job.source.info.sizeBytes)]);
  const preview = job.source.kind === "video" ? job.source.thumb : job.source.path;
  return (
    <div className={s.card}>
      <div className={s.cardLabel}>{t.convert.input}</div>
      <div className={s.thumb}>{preview && <img src={fileUrl(preview)} alt="" draggable={false} />}</div>
      <div className={s.name} title={job.source.path}>
        {job.source.name}
      </div>
      <dl className={s.facts}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OutputPreview({ job }: { job: Job }) {
  const t = useMessages();
  const r = job.result;
  if (!r) return null;
  const conv = job.task?.convert?.conversion;
  if (conv === "gifToFrames") {
    return (
      <button type="button" className={s.folder} onClick={safely(() => api.revealFile(r.outputPath))}>
        <FolderOpen size={26} />
        <span>{fmt(t.media.frames, { count: r.media?.frames ?? 0 })}</span>
      </button>
    );
  }
  if (conv === "gifToMp4") {
    return <ClipViewer key={r.outputPath} clipKey={r.outputPath} original={r.outputPath} usesPreviewCopy={false} poster={null} result={null} processing={false} label={t.convert.output} />;
  }
  return <img className={s.outputImg} src={fileUrl(r.outputPath)} alt="" draggable={false} />;
}

function ConvertStage({ job, count }: { job: Job; count: number }) {
  const t = useMessages();
  const images = useGroupJobs("convert").filter((j) => j.source.kind === "image" && j.status === "idle").length;
  return (
    <section className={s.stage}>
      <header className={s.header}>
        <div className={s.headerTitle}>
          {conversionLabel(t, job)}
          {job.source.kind === "image" && images > 1 && <span className={s.count}>{images}</span>}
        </div>
        <div className={s.headerActions}>
          {count <= 1 && job.status !== "processing" && (
            <IconButton label={t.action.remove} size="sm" onClick={safely(() => api.removeJobs([job.id]))}>
              <Trash2 />
            </IconButton>
          )}
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={safely(() => pickFiles("convert"))}>
            {t.action.addFiles}
          </Button>
        </div>
      </header>
      <div className={s.body}>
        <InputCard job={job} />
        <ArrowRight className={s.arrow} size={18} />
        <div className={`${s.card} ${s.outputCard}`}>
          <div className={s.cardLabel}>{t.convert.output}</div>
          <div className={s.outputArea}>
            {job.result ? <OutputPreview job={job} /> : <div className={s.placeholder}>{outputName(t, job)}</div>}
          </div>
        </div>
        <AnimatePresence>
          {job.status === "failed" && job.error && (
            <motion.div className={s.overlay} key="err" exit={{ opacity: 0 }}>
              <ErrorCard error={job.error} onRetry={safely(() => api.retryJobs([job.id]))} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {job.result && <ResultBar job={job} group="convert" />}
    </section>
  );
}

type T = ReturnType<typeof useMessages>;

function conversionLabel(t: T, job: Job): string {
  const conv = job.task?.convert?.conversion;
  if (conv) return { clipToGif: t.convert.clipToGif, gifToMp4: t.convert.gifToVideo, gifToFrames: t.convert.gifToFrames, imagesToGif: t.convert.imagesToGif }[conv];
  if (job.source.kind === "video") return t.convert.clipToGif;
  if (job.source.kind === "image") return t.convert.imagesToGif;
  return useSettingsStore.getState().settings?.convert.gifOutput === "frames" ? t.convert.gifToFrames : t.convert.gifToVideo;
}

function outputName(t: T, job: Job): string {
  const settings = useSettingsStore.getState().settings;
  if (job.source.kind === "gif") return settings?.convert.gifOutput === "frames" ? t.convert.outputFrames : t.convert.outputMp4;
  return t.convert.outputGif;
}

function ConvertControls({ job }: { job: Job | null }) {
  const t = useMessages();
  const [c, setConvert] = useConvert();
  const kind = job?.source.kind;
  const toGif = kind === "video" || kind === "image";
  const srcFps = job?.source.media?.fps;
  return (
    <aside className={s.panel} data-tour="convert-options">
      <div className={s.scroll}>
        <div className={s.main}>
          <Field label={t.convert.output}>
            {kind === "gif" ? (
              <Segmented<GifOutput>
                ariaLabel={t.convert.output}
                size="sm"
                value={c.gifOutput}
                onChange={(gifOutput) => setConvert({ gifOutput })}
                options={[
                  { value: "mp4", label: t.convert.outputMp4 },
                  { value: "frames", label: t.convert.outputFrames },
                ]}
              />
            ) : (
              <div className={s.fixed}>{t.convert.outputGif}</div>
            )}
          </Field>
          {kind === "gif" && c.gifOutput === "mp4" && <p className={s.note}>{t.convert.transparencyNote}</p>}
          {kind === "gif" && c.gifOutput === "frames" && <p className={s.note}>{t.convert.framesNote}</p>}
          {kind === "image" && <p className={s.note}>{t.convert.imagesNote}</p>}
          {kind === "video" && (
            <Field label={t.convert.frameRate} help="fps">
              <Segmented<number>
                ariaLabel={t.convert.frameRate}
                size="sm"
                value={c.gifFps ?? 0}
                onChange={(f) => setConvert({ gifFps: f === 0 ? null : f })}
                options={[
                  { value: 0, label: srcFps ? `${t.convert.original} · ${Math.round(srcFps)}` : t.convert.original },
                  ...FPS.map((f) => ({ value: f, label: String(f), disabled: !!srcFps && f > srcFps + 0.01 })),
                ]}
              />
            </Field>
          )}
          {kind === "image" && (
            <Field label={t.convert.frameTime}>
              <Segmented<number>
                ariaLabel={t.convert.frameTime}
                size="sm"
                value={c.frameMs}
                onChange={(frameMs) => setConvert({ frameMs })}
                options={FRAME_MS.map((ms) => ({ value: ms, label: `${ms / 1000}s` }))}
              />
            </Field>
          )}
          {!(kind === "gif" && c.gifOutput === "frames") && (
            <Field label={t.convert.width} hint={t.convert.neverUpscale}>
              <Segmented<number>
                ariaLabel={t.convert.width}
                size="sm"
                value={c.width ?? 0}
                onChange={(w) => setConvert({ width: w === 0 ? null : w })}
                options={[{ value: 0, label: t.convert.original }, ...WIDTHS.map((w) => ({ value: w, label: String(w) }))]}
              />
            </Field>
          )}
          {(toGif || c.gifOutput === "mp4" || !kind) && <QualityField which="convert" />}
          {(toGif || c.gifOutput === "mp4" || !kind) && <MaxSizeField which="convert" />}
        </div>
        <Collapsible title={t.controls.advanced}>
          <FolderField />
        </Collapsible>
      </div>
      <ProcessButton group="convert" />
    </aside>
  );
}

export function ConvertPage() {
  const jobs = useGroupJobs("convert");
  const job = useSelectedJob("convert");
  return (
    <div className={s.page}>
      {jobs.length > 1 && <ProcessingQueue group="convert" />}
      {job ? <ConvertStage job={job} count={jobs.length} /> : <Start />}
      <ConvertControls job={job} />
    </div>
  );
}

