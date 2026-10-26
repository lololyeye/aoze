//! Convert section: a small converter, not an editor.
//!   clip   -> GIF   (frame rate, width, quality / size limit)
//!   GIF    -> MP4   (width, quality / size limit)
//!   GIF    -> PNG frames (one file per frame, in a folder)
//!   images -> animated GIF (each image shown for a set time)
//! Reuses the GIF / MP4 encoders of the animation pipeline.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tokio_util::sync::CancellationToken;

use crate::anim::{encode_gif, encode_mp4, ff_timed, frames_bytes, os, GifEncode, Mp4Encode, Phase};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fsutil::{file_size, sibling_temp};
use crate::imaging::{self, ImageInfo};
use crate::media::{Ffmpeg, HwEncoder, MediaInfo, MediaKind};
use crate::output::{base_output_path, resolve_conflict, Resolved};
use crate::pipeline::{blocking, destination, JobOutcome, LogSink, ProgressSink, Stage, StageSink, WorkDir};
use crate::settings::{ConvertSettings, GifOutput, OutputOptions};

/// What a convert job produces, decided from the input kind and the settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Conversion {
    ClipToGif,
    GifToMp4,
    GifToFrames,
    ImagesToGif,
}

pub fn conversion_for(kind: MediaKind, settings: &ConvertSettings) -> Conversion {
    match kind {
        MediaKind::Video => Conversion::ClipToGif,
        MediaKind::Gif => match settings.gif_output {
            GifOutput::Mp4 => Conversion::GifToMp4,
            GifOutput::Frames => Conversion::GifToFrames,
        },
        MediaKind::Image => Conversion::ImagesToGif,
    }
}

pub struct ConvertSpec<'a> {
    pub conversion: Conversion,
    pub source: &'a Path,
    /// Images -> GIF: every image, in order (the source first).
    pub images: &'a [PathBuf],
    pub image_info: &'a ImageInfo,
    pub media: Option<&'a MediaInfo>,
    pub settings: &'a ConvertSettings,
    pub output: &'a OutputOptions,
    pub encoder: Option<HwEncoder>,
    pub fallback_output_dir: &'a Path,
    pub work_dir: &'a Path,
    pub keep_temp: bool,
}

/// "scale=W:-2" when a smaller width is asked, never upscaling.
fn width_filter(width: Option<u32>, src_width: u32, even: bool) -> Option<String> {
    let w = width.filter(|w| *w < src_width)?;
    let w = if even { w & !1 } else { w };
    Some(format!("scale={w}:{}:flags=lanczos", if even { -2 } else { -1 }))
}

pub async fn run(
    ff: &Ffmpeg,
    spec: ConvertSpec<'_>,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<JobOutcome> {
    on_stage(Stage::Preparing);
    if !ff.found() {
        return Err(AppError::new(ErrorCode::FfmpegMissing, ff.dir().display().to_string()));
    }
    for p in std::iter::once(spec.source).chain(spec.images.iter().map(PathBuf::as_path)) {
        if !p.is_file() {
            return Err(AppError::new(ErrorCode::FileNotFound, p.display().to_string()));
        }
    }
    let work = WorkDir::create(spec.work_dir, spec.keep_temp)?;
    let outcome = match spec.conversion {
        Conversion::GifToFrames => to_frames(ff, &spec, on_stage, on_progress, on_log, cancel).await?,
        _ => to_file(ff, &spec, &work.path, on_stage, on_progress, on_log, cancel).await?,
    };
    on_progress(1.0, None);
    Ok(outcome)
}

async fn to_file(
    ff: &Ffmpeg,
    spec: &ConvertSpec<'_>,
    work: &Path,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<JobOutcome> {
    let (ext, suffix) = match spec.conversion {
        Conversion::GifToMp4 => ("mp4", ""),
        Conversion::ImagesToGif => ("gif", "_animated"),
        _ => ("gif", ""),
    };
    let dest = match destination(spec.source, spec.fallback_output_dir, spec.output, suffix, ext)? {
        Resolved::Skip(path) => {
            on_log(format!("output already exists, skipped: {}", path.display()));
            return Ok(JobOutcome::skipped(path));
        }
        Resolved::Write(path) => path,
    };
    let tmp = sibling_temp(&dest).with_extension(ext);
    on_stage(Stage::Encoding);
    let result = encode(ff, spec, work, &tmp, on_progress, on_log, cancel).await;
    let report = match result {
        Ok(r) => r,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    };
    std::fs::rename(&tmp, &dest).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    let kind = if ext == "gif" { MediaKind::Gif } else { MediaKind::Video };
    let media = blocking({
        let (d, dir) = (dest.clone(), ff.dir().to_path_buf());
        move || Ffmpeg::new(dir).probe(&d, kind)
    })
    .await?;
    on_log(format!("saved {} ({} bytes)", dest.display(), media.size_bytes));
    Ok(JobOutcome {
        output_info: Some(ImageInfo { width: media.width, height: media.height, size_bytes: media.size_bytes, format: ext.to_ascii_uppercase() }),
        output_path: dest,
        skipped: false,
        work_mp: 0.0,
        engine_ms: 0,
        compression: Some(report),
        media: Some(media),
        notices: Vec::new(),
        timing: None,
    })
}

async fn encode(
    ff: &Ffmpeg,
    spec: &ConvertSpec<'_>,
    work: &Path,
    tmp: &Path,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<crate::compress::CompressReport> {
    let s = spec.settings;
    let limit = s.compress.limit_bytes();
    match spec.conversion {
        Conversion::ClipToGif => {
            let media = spec.media.ok_or_else(|| AppError::new(ErrorCode::DecodeFailed, "no media info"))?;
            let mut input = os(&["-i"]);
            input.push(spec.source.into());
            let mut filters = Vec::new();
            if let Some(f) = s.gif_fps.filter(|f| (*f as f64) < media.fps - 0.01) {
                filters.push(format!("fps={f}"));
            }
            filters.extend(width_filter(s.width, media.width, false));
            let g = GifEncode {
                input: &input,
                filters: &filters,
                compress: &s.compress,
                limit,
                allow_shrink: true,
                duration_ms: media.duration_ms,
                dest: tmp,
                final_delay_cs: None,
                frames_bytes: {
                    let fps = s.gif_fps.map(f64::from).unwrap_or(media.fps).min(media.fps);
                    let w = s.width.map_or(media.width, |w| w.min(media.width));
                    let h = (media.height as f64 * w as f64 / media.width.max(1) as f64).round() as u32;
                    frames_bytes(media.duration_ms, fps, w, h)
                },
            };
            encode_gif(ff, &g, 0.0, on_progress, on_log, cancel).await
        }
        Conversion::GifToMp4 => {
            let media = spec.media.ok_or_else(|| AppError::new(ErrorCode::DecodeFailed, "no media info"))?;
            let mut input = os(&["-i"]);
            input.push(spec.source.into());
            // H.264 4:2:0 needs even sizes; transparency becomes black.
            let mut vf: Vec<String> = width_filter(s.width, media.width, true).into_iter().collect();
            if vf.is_empty() {
                vf.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
            }
            vf.push("format=yuv420p".into());
            let e = Mp4Encode {
                hdr: None,
                input: &input,
                audio_input: None,
                audio_codec: None,
                vf: &vf.join(","),
                duration_ms: media.duration_ms,
                compress: &s.compress,
                encoder: spec.encoder,
                work,
                dest: tmp,
            };
            encode_mp4(ff, &e, 0.0, on_progress, on_log, cancel).await
        }
        Conversion::ImagesToGif => {
            // Every image becomes one frame of `frame_ms`, letterboxed to the first image's size.
            let first = spec.image_info;
            let (w, h) = match s.width.filter(|w| *w < first.width) {
                Some(w) => (w, ((first.height as f64 * w as f64 / first.width as f64).round() as u32).max(1)),
                None => (first.width, first.height),
            };
            // Frames are normalised in Rust (fit + centre on a transparent canvas):
            // FFmpeg's concat input cannot change size between images.
            let frames_dir = work.join("frames");
            std::fs::create_dir_all(&frames_dir)?;
            let frames = blocking({
                let (images, dir) = (spec.images.to_vec(), frames_dir.clone());
                move || {
                    images
                        .iter()
                        .enumerate()
                        .map(|(i, p)| {
                            let img = imaging::decode(p)?;
                            let fitted = imaging::contain_on_canvas(&img, crate::engine::plan::Dimensions { width: w, height: h })?;
                            let out = dir.join(format!("{i:05}.png"));
                            fitted.save(&out).map_err(|e| AppError::new(ErrorCode::EncodeFailed, e.to_string()))?;
                            Ok(out)
                        })
                        .collect::<AppResult<Vec<PathBuf>>>()
                }
            })
            .await?;
            // A numbered sequence at 1 / frame_ms FPS: every image gets exactly frame_ms.
            let rate = format!("{}/{}", 1000, s.frame_ms.max(1));
            let mut input = os(&["-framerate", &rate, "-i"]);
            input.push(frames_dir.join("%05d.png").into());
            let filters: Vec<String> = vec![];
            let total = s.frame_ms as f64 / 1000.0 * frames.len() as f64;
            let g = GifEncode {
                input: &input,
                filters: &filters,
                compress: &s.compress,
                limit,
                allow_shrink: true,
                duration_ms: (total * 1000.0) as u64,
                dest: tmp,
                final_delay_cs: Some((s.frame_ms + 5) / 10),
                frames_bytes: frames.len() as u64 * w as u64 * h as u64 * 4,
            };
            encode_gif(ff, &g, 0.0, on_progress, on_log, cancel).await
        }
        Conversion::GifToFrames => unreachable!("handled by to_frames"),
    }
}

/// GIF -> a folder of PNG frames next to the source.
async fn to_frames(
    ff: &Ffmpeg,
    spec: &ConvertSpec<'_>,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<JobOutcome> {
    let media = spec.media.ok_or_else(|| AppError::new(ErrorCode::DecodeFailed, "no media info"))?;
    let base = base_output_path(spec.source, spec.fallback_output_dir, spec.output.directory.as_deref(), "_frames", "x").with_extension("");
    let dir = match resolve_conflict(base, spec.source, spec.output.conflict)? {
        Resolved::Skip(path) => return Ok(JobOutcome::skipped(path)),
        Resolved::Write(path) => path,
    };
    // Written to a temporary folder, then renamed: a cancelled run leaves nothing.
    let tmp = sibling_temp(&dir);
    std::fs::create_dir_all(&tmp)?;
    on_stage(Stage::Encoding);
    let mut args: Vec<OsString> = os(&["-i"]);
    args.push(spec.source.into());
    args.extend(os(&["-fps_mode", "passthrough"]));
    if let Some(f) = width_filter(spec.settings.width, media.width, false) {
        args.extend(os(&["-vf", &f]));
    }
    args.push(tmp.join("frame_%04d.png").into());
    if let Err(e) = ff_timed(ff, &args, media.duration_ms, Phase { start: 0.0, span: 1.0 }, on_progress, on_log, cancel).await {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, &dir).inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&tmp);
    })?;
    let mut frames: Vec<PathBuf> = std::fs::read_dir(&dir)?.flatten().map(|e| e.path()).collect();
    frames.sort();
    let first = frames.first().ok_or_else(|| AppError::new(ErrorCode::MediaFailed, "no frame written"))?;
    let info = imaging::probe(first)?;
    let bytes: u64 = frames.iter().map(|f| file_size(f)).sum();
    on_log(format!("saved {} frames in {}", frames.len(), dir.display()));
    let mut out_media = media.clone();
    out_media.frames = frames.len() as u64;
    out_media.size_bytes = bytes;
    out_media.width = info.width;
    out_media.height = info.height;
    Ok(JobOutcome {
        output_info: Some(ImageInfo { width: info.width, height: info.height, size_bytes: bytes, format: "PNG".into() }),
        output_path: dir,
        skipped: false,
        work_mp: 0.0,
        engine_ms: 0,
        compression: None,
        media: Some(out_media),
        notices: Vec::new(),
        timing: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversions_follow_input_kind() {
        let mut s = ConvertSettings::default();
        assert_eq!(conversion_for(MediaKind::Video, &s), Conversion::ClipToGif);
        assert_eq!(conversion_for(MediaKind::Gif, &s), Conversion::GifToMp4);
        s.gif_output = GifOutput::Frames;
        assert_eq!(conversion_for(MediaKind::Gif, &s), Conversion::GifToFrames);
        assert_eq!(conversion_for(MediaKind::Image, &s), Conversion::ImagesToGif);
    }

    #[test]
    fn width_never_upscales() {
        assert_eq!(width_filter(Some(480), 1920, true).as_deref(), Some("scale=480:-2:flags=lanczos"));
        assert_eq!(width_filter(Some(480), 320, true), None);
        assert_eq!(width_filter(None, 320, false), None);
    }
}
