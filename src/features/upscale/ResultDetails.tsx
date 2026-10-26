import * as RP from "@radix-ui/react-popover";
import { ListChecks } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { fmt, useMessages } from "../../i18n";
import type { Messages } from "../../i18n/en";
import type { Job, MediaInfo } from "../../types";
import { clipSummary } from "../../utils/presets";
import { formatBytes, formatDims, formatScale } from "../../utils/format";
import s from "./ResultDetails.module.css";

const MODEL: Record<string, string> = { artwork: "CUnet", artworkFast: "UpConv7 anime", photo: "UpConv7 photo" };

/** A result notice code ("beatNotFound", "beat:128") in words. */
export function noticeText(t: Messages, code: string): string {
  const [key, value] = code.split(":");
  if (key === "beat" && value) return fmt(t.details.notices.beat ?? "", { bpm: value });
  return t.details.notices[key ?? ""] ?? code;
}

/**
 * Objective before/after facts. No "quality score": there is no reliable
 * no-reference metric for upscaled art, so Aoze only reports what it measured
 * and what it did.
 */
export function ResultDetails({ job }: { job: Job }) {
  const t = useMessages();
  const r = job.result;
  if (!r) return null;
  const src = job.source.info;
  const ratio = (r.info.width * r.info.height) / Math.max(1, src.width * src.height);
  const noiseNames = [t.controls.noiseLow, t.controls.noiseMedium, t.controls.noiseHigh, t.controls.noiseMax];
  const task = job.task;
  const steps: string[] = [];
  if (task?.convert) {
    steps.push({ clipToGif: t.convert.clipToGif, gifToMp4: t.convert.gifToVideo, gifToFrames: t.convert.gifToFrames, imagesToGif: t.convert.imagesToGif }[task.convert.conversion]);
  } else if (task?.anim) {
    const a = task.anim;
    if (job.source.kind === "video") {
      steps.push(...clipSummary(t, a));
      const formatName = { original: null, landscape: t.controls.formatLandscape, portrait: t.controls.formatPortrait, square: t.controls.formatSquare, feed: t.controls.formatFeed }[a.format];
      const reshaped = Math.abs(r.info.width / r.info.height - src.width / src.height) > 0.01;
      if (formatName && reshaped) steps.push(a.reframe ? `${formatName} · ${t.controls.smartReframe}` : formatName);
      const speedName = { normal: null, slow: t.controls.speedSlow, fast: t.controls.speedFast, ramp: t.controls.speedRamp, custom: t.controls.speedCurve }[a.speed.preset];
      if (speedName) steps.push(`${t.controls.speed} · ${speedName}`);
    } else {
      if (a.scale !== 1) steps.push(formatScale(a.scale));
      if (a.motionBlur) steps.push(`${t.controls.motionBlur} ${a.motionBlur}%`);
    }
    if (job.params && job.params.noise >= 0) steps.push(fmt(t.details.noise, { level: noiseNames[job.params.noise] ?? "" }), fmt(t.details.model, { model: MODEL[a.style] ?? a.style }));
  } else if (job.params && task?.action !== "compress") {
    steps.push(formatScale(job.params.scale));
    if (job.params.noise >= 0) steps.push(fmt(t.details.noise, { level: noiseNames[job.params.noise] ?? "" }));
    steps.push(fmt(t.details.model, { model: MODEL[job.params.style] ?? job.params.style }));
  }
  if (task?.discord) steps.push({ profilePicture: t.discord.profilePicture, profileBanner: t.discord.profileBanner, serverBanner: t.discord.serverBanner }[task.discord]);
  const c = r.compression;
  const compression = c
    ? [c.quality != null ? fmt(t.details.quality, { q: c.quality }) : r.info.format === "PNG" ? t.details.lossless : null, c.limitBytes != null ? fmt(c.met ? t.result.limitMet : t.result.limitMissed, { limit: formatBytes(c.limitBytes) }) : null]
        .filter(Boolean)
        .join(" · ")
    : r.info.format === "PNG"
      ? t.details.lossless
      : null;
  const rows: [string, string][] = [
    [t.details.resolution, `${formatDims(src.width, src.height)} → ${formatDims(r.info.width, r.info.height)}`],
    ["", ratio >= 1.01 ? fmt(t.details.pixels, { n: Math.round(ratio * 10) / 10 }) : ratio <= 0.99 ? fmt(t.details.fewerPixels, { n: Math.round((1 / ratio) * 10) / 10 }) : ""],
    [t.details.size, `${formatBytes(src.sizeBytes)} → ${formatBytes(r.info.sizeBytes)}`],
    [t.details.format, `${src.format} → ${r.info.format}`],
  ];
  if (steps.length) rows.push([t.details.processing, steps.join(" · ")]);
  if (r.notices?.length) rows.push([t.details.notes, r.notices.map((n) => noticeText(t, n)).join(" ")]);
  if (compression) rows.push([t.details.compression, compression]);
  if (job.source.media && r.media) {
    rows.push([t.details.frames, `${job.source.media.frames} → ${r.media.frames}`]);
    rows.push([t.details.fps, `${Math.round(job.source.media.fps * 100) / 100} → ${Math.round(r.media.fps * 100) / 100}`]);
    if (job.source.kind === "video") {
      const range = (m: MediaInfo) => (m.transfer === "pq" ? "HDR10" : m.transfer === "hlg" ? "HLG" : "SDR");
      rows.push(["HDR", `${range(job.source.media)} → ${range(r.media)}`]);
    }
  }
  return (
    <RP.Root>
      <RP.Trigger asChild>
        <Button size="sm" variant="ghost" icon={<ListChecks />}>
          {t.details.title}
        </Button>
      </RP.Trigger>
      <RP.Portal>
        <RP.Content className={s.content} side="top" align="end" sideOffset={8} collisionPadding={12}>
          <div className={s.title}>{t.details.title}</div>
          <dl className={s.rows}>
            {rows
              .filter(([, v]) => v)
              .map(([k, v], i) => (
                <div key={i}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          <p className={s.note}>{t.details.honest}</p>
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
