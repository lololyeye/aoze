//! GIF and clip pipelines.
//!
//! GIF : [frames -> waifu2x (folder mode)] -> FFmpeg filters -> palette GIF, re-encoded
//!       with fewer colours / smaller size until it fits the size limit.
//! Clip: [frames -> waifu2x per block -> high-quality segments -> concat]
//!       -> FFmpeg filters -> H.264 (CRF / hardware encoder, or x264 2-pass for a size limit)
//!       + original audio.
//! Blocks bound the disk space used by enhanced clips; every step is cancellable
//! and reports real progress (frames or media time).

use std::ffi::OsString;
use std::future::Future;
use std::path::Path;

use tokio_util::sync::CancellationToken;

use crate::compress::CompressReport;
use crate::engine::plan::{final_dimensions, plan, Dimensions, EnginePlan};
use crate::reframe::{self, Plan};
use crate::timemap::{self, SpeedCurve, TimeWarp};
use crate::{analysis, beat, looks};
use crate::engine::{EngineJob, UpscaleEngine};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fsutil::{file_size, sibling_temp};
use crate::media::{Ffmpeg, HwEncoder, MediaInfo, MediaKind};
use crate::output::{anim_suffix, Resolved};
use crate::pipeline::{blocking, check, destination, run_engine, JobOutcome, LogSink, ProgressDetail, ProgressSink, Stage, StageSink, WorkDir};
use crate::color::{self, ColorPlan, Transfer};
use crate::settings::{AnimSettings, CompressLevel, CompressSettings, Enhance, FpsMode, HdrMode, OutputOptions, SmoothMotion, TargetSpec, UpscaleParams};
use crate::smooth::{self, Rife};

/// Upper bound for the PNG frames an enhanced clip keeps on disk at once.
const MAX_GIF_ATTEMPTS: usize = 7;

pub struct AnimSpec<'a> {
    pub kind: MediaKind,
    pub source: &'a Path,
    pub info: &'a MediaInfo,
    pub anim: &'a AnimSettings,
    /// Engine settings (device, tiles, threads, TTA); scale/noise come from `anim`.
    pub params: &'a UpscaleParams,
    pub compress: &'a CompressSettings,
    pub output: &'a OutputOptions,
    /// Hardware encoder to use for clips, None = x264.
    pub encoder: Option<HwEncoder>,
    pub fallback_output_dir: &'a Path,
    pub work_dir: &'a Path,
    pub keep_temp: bool,
    /// GIFs prepared for a Discord slot: exact size (cover + centred crop) and size cap.
    pub target: Option<(TargetSpec, &'static str)>,
    /// Frame interpolation engine for Smooth Motion (clips), when installed.
    pub rife: Option<&'a Rife>,
    /// Anime clean-up engine for clips, when installed.
    pub esrgan: Option<&'a crate::esrgan::Esrgan>,
    /// VRAM of the processing GPU (0 = unknown), to pick models that fit.
    pub vram_bytes: u64,
    /// Folder of the user's imported LUTs.
    pub luts_dir: Option<&'a Path>,
}

/// How the frames reach the output size.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Resize {
    /// Stretch-free resize to exactly this size (same aspect ratio).
    Exact(Dimensions),
    /// Scale to cover this size, then crop the centre.
    Cover(Dimensions),
    /// Whole picture on a blurred copy of itself, at this size (Smart Reframe).
    Fill(Dimensions),
}

impl Resize {
    pub fn filter(self) -> String {
        match self {
            Resize::Exact(t) => format!("scale={}:{}:flags=lanczos", t.width, t.height),
            Resize::Cover(t) => format!(
                "scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h}",
                w = t.width,
                h = t.height
            ),
            Resize::Fill(t) => reframe::fill_filter(t.width, t.height),
        }
    }
}

/// Engine parameters for an animation: None when no waifu2x pass is needed.
pub fn engine_params(anim: &AnimSettings, base: &UpscaleParams) -> Option<UpscaleParams> {
    let noise = anim.enhance.engine_noise()?;
    Some(UpscaleParams { style: anim.style, scale: anim.scale, noise, ..base.clone() })
}

pub fn engine_plan(engine: &dyn UpscaleEngine, params: &UpscaleParams) -> AppResult<EnginePlan> {
    plan(params.scale, params.noise, &engine.capabilities(params.style))
}

/// Output size. H.264 with 4:2:0 chroma needs even dimensions.
pub fn target_dims(info: &MediaInfo, scale: f32, kind: MediaKind) -> Dimensions {
    let d = final_dimensions(Dimensions { width: info.width, height: info.height }, scale);
    if kind == MediaKind::Video {
        Dimensions { width: (d.width & !1).max(2), height: (d.height & !1).max(2) }
    } else {
        d
    }
}

fn changes_fps(anim: &AnimSettings, src_fps: f64) -> Option<f32> {
    anim.fps.filter(|f| (*f as f64 - src_fps).abs() > 0.01)
}

fn blur_filter(strength: u8) -> Option<String> {
    if strength == 0 {
        return None;
    }
    // 2..=5 neighbouring frames, centre-weighted.
    let weights = match 2 + (strength as u32 * 3 + 50) / 100 {
        2 => "1 1",
        3 => "1 2 1",
        4 => "1 2 2 1",
        _ => "1 2 3 2 1",
    };
    let frames = weights.split(' ').count();
    Some(format!("tmix=frames={frames}:weights='{weights}'"))
}

/// FFmpeg filters applied after the (optional) engine pass.
pub fn post_filters(anim: &AnimSettings, src_fps: f64, resize: Option<Resize>) -> Vec<String> {
    let mut f = Vec::new();
    if let Some(r) = resize {
        f.push(r.filter());
    }
    // Sharpen (enhancement) and the Look's sharpness share one CAS pass.
    let sharpen = if anim.enhance == Enhance::Sharpen { 0.6f32 } else { 0.0 }.max(anim.look.sharpness as f32 / 100.0 * 0.8);
    if sharpen > 0.0 {
        f.push(format!("cas=strength={sharpen:.2}"));
    }
    if let Some(fps) = changes_fps(anim, src_fps) {
        f.push(match anim.fps_mode {
            FpsMode::Retime => format!("fps={fps}"),
            FpsMode::Interpolate => format!("minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"),
        });
    }
    f.extend(blur_filter(anim.motion_blur));
    f
}

pub(crate) fn os(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}

fn count_files(dir: &Path) -> u64 {
    std::fs::read_dir(dir).map(|d| d.count() as u64).unwrap_or(0)
}

/// Runs `fut` (an engine pass writing into `dir`) while reporting how many files exist.
async fn with_frame_poll<F: Future<Output = AppResult<u64>>>(fut: F, dir: &Path, report: impl Fn(u64)) -> AppResult<u64> {
    let done = CancellationToken::new();
    let poll = async {
        loop {
            tokio::select! {
                _ = done.cancelled() => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(350)) => report(count_files(dir)),
            }
        }
    };
    let work = async {
        let r = fut.await;
        done.cancel();
        r
    };
    let (r, _) = tokio::join!(work, poll);
    r
}

/// Maps a sub-step's 0..1 progress into [start, start + span] of the whole job.
#[derive(Clone, Copy)]
pub(crate) struct Phase {
    pub start: f32,
    pub span: f32,
}

impl Phase {
    fn at(self, frac: f64) -> f32 {
        self.start + self.span * (frac.clamp(0.0, 1.0) as f32)
    }
}

/// Identifies a clip run: same source file and same frame-affecting settings
/// resume in the same folder.
fn resume_key(spec: &AnimSpec<'_>) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    spec.source.hash(&mut h);
    if let Ok(m) = std::fs::metadata(spec.source) {
        m.len().hash(&mut h);
        m.modified().ok().hash(&mut h);
    }
    serde_json::to_string(spec.anim).unwrap_or_default().hash(&mut h);
    serde_json::to_string(spec.params).unwrap_or_default().hash(&mut h);
    format!("{:?}", spec.encoder).hash(&mut h);
    env!("CARGO_PKG_VERSION").hash(&mut h);
    format!("{:016x}", h.finish())
}

pub async fn run(
    engine: &dyn UpscaleEngine,
    ff: &Ffmpeg,
    spec: AnimSpec<'_>,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<JobOutcome> {
    on_stage(Stage::Preparing);
    if !ff.found() {
        return Err(AppError::new(ErrorCode::FfmpegMissing, ff.dir().display().to_string()));
    }
    if !spec.source.is_file() {
        return Err(AppError::new(ErrorCode::FileNotFound, spec.source.display().to_string()));
    }
    let ext = if spec.kind == MediaKind::Gif { "gif" } else { "mp4" };
    let suffix = match spec.target {
        Some((_, slug)) => slug.to_string(),
        None => {
            let mut s = anim_suffix(spec.anim.scale, changes_fps(spec.anim, spec.info.fps));
            // A new shape is part of the name: "clip_aoze_9x16.mp4".
            if spec.kind == MediaKind::Video {
                if let Some((w, h)) = spec.anim.format.ratio().filter(|_| reframe::crop_size(spec.info.width, spec.info.height, spec.anim.format).is_some()) {
                    s.push_str(&format!("_{w}x{h}"));
                }
            }
            s
        }
    };
    let dest = match destination(spec.source, spec.fallback_output_dir, spec.output, &suffix, ext)? {
        Resolved::Skip(path) => {
            on_log(format!("output already exists, skipped: {}", path.display()));
            return Ok(JobOutcome::skipped(path));
        }
        Resolved::Write(path) => path,
    };
    // Clips keep their work folder when interrupted: a retry resumes there.
    let work = if spec.kind == MediaKind::Video {
        WorkDir::resumable(spec.work_dir, &resume_key(&spec), spec.keep_temp)?
    } else {
        WorkDir::create(spec.work_dir, spec.keep_temp)?
    };
    let tmp_dest = sibling_temp(&dest).with_extension(ext);

    let result = match spec.kind {
        MediaKind::Gif => run_gif(engine, ff, &spec, &work.path, &tmp_dest, on_stage, on_progress, on_log, cancel)
            .await
            .map(|(engine_ms, work_mp, report)| ClipDone { engine_ms, work_mp, report, notices: Vec::new(), timing: None }),
        _ => run_clip(engine, ff, &spec, &work.path, &tmp_dest, on_stage, on_progress, on_log, cancel).await,
    };
    let ClipDone { engine_ms, work_mp, report, notices, timing } = match result {
        Ok(r) => r,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_dest);
            return Err(e);
        }
    };
    std::fs::rename(&tmp_dest, &dest).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp_dest);
    })?;
    work.finish();
    let media = blocking({
        let (d, k) = (dest.clone(), spec.kind);
        let ff_dir = ff.dir().to_path_buf();
        move || Ffmpeg::new(ff_dir).probe(&d, k)
    })
    .await?;
    on_progress(1.0, None);
    on_log(format!("saved {} ({} bytes)", dest.display(), media.size_bytes));
    let output_info = crate::imaging::ImageInfo {
        width: media.width,
        height: media.height,
        size_bytes: media.size_bytes,
        format: ext.to_ascii_uppercase(),
    };
    Ok(JobOutcome {
        output_path: dest,
        output_info: Some(output_info),
        skipped: false,
        work_mp,
        engine_ms,
        compression: Some(report),
        media: Some(media),
        notices,
        timing,
    })
}

/// Runs the engine over a folder of frames, reporting frame progress.
#[allow(clippy::too_many_arguments)]
async fn upscale_frames(
    engine: &dyn UpscaleEngine,
    params: &UpscaleParams,
    eplan: EnginePlan,
    input: &Path,
    output: &Path,
    expected: u64,
    frames_before: u64,
    frames_total: u64,
    phase: Phase,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<u64> {
    std::fs::create_dir_all(output)?;
    let job = |tile_size: u32| EngineJob {
        input,
        output,
        style: params.style,
        plan: eplan,
        gpu: params.gpu,
        tile_size,
        tta: params.tta,
        threads: params.threads,
        expect_outputs: Some(expected as usize),
    };
    let fut = run_engine(engine, &job, params, on_stage, on_log, cancel);
    with_frame_poll(fut, output, |n| {
        let done = frames_before + n.min(expected);
        on_progress(phase.at(done as f64 / frames_total.max(1) as f64), Some(ProgressDetail::Frames { done, total: frames_total }));
    })
    .await
}

/// FFmpeg run whose progress is the output timestamp over `total_ms`.
pub(crate) async fn ff_timed(
    ff: &Ffmpeg,
    args: &[OsString],
    total_ms: u64,
    phase: Phase,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<()> {
    let total = total_ms.max(1);
    let progress = |ms: u64| {
        on_progress(phase.at(ms as f64 / total as f64), Some(ProgressDetail::Time { done_ms: ms.min(total), total_ms: total }));
    };
    ff.run(args, cancel, &progress, on_log).await
}

/// Frames as PNG (GIF, keeps alpha and variable timing) or JPEG (clips, compact).
#[allow(clippy::too_many_arguments)]
async fn extract_frames(
    ff: &Ffmpeg,
    spec: &AnimSpec<'_>,
    dir: &Path,
    vf: Option<&[String]>,
    phase: Phase,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<u64> {
    on_stage(Stage::Extracting);
    std::fs::create_dir_all(dir)?;
    let mut args: Vec<OsString> = os(&["-i"]);
    args.push(spec.source.into());
    if spec.kind == MediaKind::Gif {
        args.extend(os(&["-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "rgba"]));
        args.push(dir.join("%08d.png").into());
    } else {
        args.extend(os(&["-map", "0:v:0", "-fps_mode", "cfr", "-q:v", "2"]));
        if let Some(vf) = vf {
            args.extend(os(&["-vf", &vf.join(",")]));
        }
        args.push(dir.join("%08d.jpg").into());
    }
    ff_timed(ff, &args, spec.info.duration_ms, phase, on_progress, on_log, cancel).await?;
    let n = count_files(dir);
    if n == 0 {
        return Err(AppError::new(ErrorCode::DecodeFailed, format!("no frames decoded from {}", spec.source.display())));
    }
    Ok(n)
}

fn gif_palette(compress: &CompressSettings) -> (u32, &'static str) {
    match compress.level {
        CompressLevel::Best => (256, "sierra2_4a"),
        CompressLevel::Balanced => (256, "bayer:bayer_scale=4"),
        CompressLevel::Small => (128, "bayer:bayer_scale=2"),
        CompressLevel::Custom => {
            let q = compress.quality() as u32;
            (32 + q * 224 / 100, if q >= 80 { "sierra2_4a" } else { "bayer:bayer_scale=3" })
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_gif(
    engine: &dyn UpscaleEngine,
    ff: &Ffmpeg,
    spec: &AnimSpec<'_>,
    work: &Path,
    tmp_dest: &Path,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<(u64, f64, CompressReport)> {
    let fit = |d: Dimensions| match spec.target {
        Some((t, _)) => Resize::Cover(Dimensions { width: t.width, height: t.height }),
        None => Resize::Exact(d),
    };
    let target = target_dims(spec.info, spec.anim.scale, MediaKind::Gif);
    let mut engine_ms = 0;
    let mut work_mp = 0.0;
    let encode_phase_start;
    let mut trim_end = None;
    let mut final_delay = None;
    let (input, resize_to): (Vec<OsString>, Option<Resize>) = match engine_params(spec.anim, spec.params) {
        Some(params) => {
            let eplan = engine_plan(engine, &params)?;
            let frames_dir = work.join("frames");
            let up_dir = work.join("up");
            let n = extract_frames(ff, spec, &frames_dir, None, Phase { start: 0.0, span: 0.08 }, on_stage, on_progress, on_log, cancel).await?;
            let durations = blocking({
                let (d, src) = (ff.dir().to_path_buf(), spec.source.to_path_buf());
                move || Ffmpeg::new(d).frame_durations(&src)
            })
            .await?;
            check(cancel)?;
            on_stage(Stage::Initializing);
            engine_ms = upscale_frames(engine, &params, eplan, &frames_dir, &up_dir, n, 0, n, Phase { start: 0.08, span: 0.72 }, on_stage, on_progress, on_log, cancel).await?;
            work_mp = n as f64 * crate::engine::plan::work_megapixels(Dimensions { width: spec.info.width, height: spec.info.height }, &eplan, params.tta);
            // Concat list keeps each frame's own duration (variable GIF timing).
            let mut list = String::new();
            let mut names: Vec<String> = std::fs::read_dir(&up_dir)?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
            names.sort();
            for (i, name) in names.iter().enumerate() {
                let d = durations.get(i).copied().unwrap_or(1.0 / spec.info.fps.max(1.0));
                list.push_str(&format!("file 'up/{name}'\nduration {d:.4}\n"));
            }
            if let Some(last) = names.last() {
                // The concat demuxer ignores the last duration unless the file is repeated.
                list.push_str(&format!("file 'up/{last}'\n"));
            }
            let list_path = work.join("frames.txt");
            std::fs::write(&list_path, list)?;
            let _ = std::fs::remove_dir_all(&frames_dir);
            encode_phase_start = 0.8;
            let mut input = os(&["-f", "concat", "-safe", "0", "-i"]);
            input.push(list_path.into());
            // The repeated last entry starts exactly at the end: trim it away.
            let total: f64 = durations.iter().take(names.len()).sum();
            trim_end = Some(total);
            // Retiming changes frame lengths; only keep the source's last delay otherwise.
            if changes_fps(spec.anim, spec.info.fps).is_none() {
                final_delay = durations.get(names.len().saturating_sub(1)).map(|d| (d * 100.0).round() as u32);
            }
            (input, (eplan.needs_resize || spec.target.is_some()).then(|| fit(target)))
        }
        None => {
            encode_phase_start = 0.0;
            let mut input = os(&["-i"]);
            input.push(spec.source.into());
            let same = target.width == spec.info.width && target.height == spec.info.height;
            (input, (!same || spec.target.is_some()).then(|| fit(target)))
        }
    };

    on_stage(Stage::Encoding);
    let mut base_filters: Vec<String> = trim_end.map(|t| format!("trim=end={t:.4}")).into_iter().collect();
    base_filters.extend(post_filters(spec.anim, spec.info.fps, resize_to));
    // A Discord slot has a fixed size: fit its cap with fewer colours, never smaller.
    let limit = match (spec.compress.limit_bytes(), spec.target.and_then(|(t, _)| t.max_bytes)) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };
    let gif = GifEncode {
        input: &input,
        filters: &base_filters,
        compress: spec.compress,
        limit,
        allow_shrink: spec.target.is_none(),
        duration_ms: spec.info.duration_ms,
        dest: tmp_dest,
        final_delay_cs: final_delay,
        frames_bytes: {
            let (w, h) = spec.target.map(|(t, _)| (t.width, t.height)).unwrap_or((target.width, target.height));
            frames_bytes(spec.info.duration_ms, changes_fps(spec.anim, spec.info.fps).map(f64::from).unwrap_or(spec.info.fps), w, h)
        },
    };
    let report = encode_gif(ff, &gif, encode_phase_start, on_progress, on_log, cancel).await?;
    Ok((engine_ms, work_mp, report))
}

/// One palette-GIF encode job (shared by the GIF pipeline and Convert).
pub(crate) struct GifEncode<'a> {
    pub input: &'a [OsString],
    pub filters: &'a [String],
    pub compress: &'a CompressSettings,
    pub limit: Option<u64>,
    /// Reduce the resolution when fewer colours are not enough for the limit.
    pub allow_shrink: bool,
    pub duration_ms: u64,
    pub dest: &'a Path,
    /// How long the last frame stays, in 1/100 s (the muxer cannot know it).
    pub final_delay_cs: Option<u32>,
    /// Decoded size of every output frame together (see [`frames_bytes`]).
    pub frames_bytes: u64,
}

/// Memory needed to hold all decoded RGBA frames of a GIF at once.
pub(crate) fn frames_bytes(duration_ms: u64, fps: f64, width: u32, height: u32) -> u64 {
    let frames = (duration_ms as f64 / 1000.0 * fps.max(1.0)).ceil() as u64;
    frames.max(1) * width as u64 * height as u64 * 4
}

/// Frames a one-pass GIF encode may hold in memory (twice a clip block).
fn gif_memory_budget() -> u64 {
    crate::tuning::block_bytes() * 2
}

/// Encodes a GIF with a per-file palette; with a size limit, retries with fewer
/// colours, then (if allowed) a smaller size, until it fits.
pub(crate) async fn encode_gif(
    ff: &Ffmpeg,
    g: &GifEncode<'_>,
    progress_start: f32,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<CompressReport> {
    let (mut colors, mut dither) = gif_palette(g.compress);
    let mut shrink = 1.0f64;
    let mut progress_start = progress_start;
    let mut last_size = 0;
    for attempt in 0..MAX_GIF_ATTEMPTS {
        check(cancel)?;
        let mut filters = g.filters.to_vec();
        if shrink < 0.999 {
            filters.push(format!("scale=trunc(iw*{shrink:.4}/2)*2:trunc(ih*{shrink:.4}/2)*2:flags=lanczos"));
        }
        let pre = if filters.is_empty() { String::new() } else { format!("{},", filters.join(",")) };
        let palettegen = format!("palettegen=max_colors={colors}:reserve_transparent=1:stats_mode=diff");
        let paletteuse = format!("paletteuse=dither={dither}:alpha_threshold=128:diff_mode=rectangle");
        let mut args = g.input.to_vec();
        // `split` into palettegen keeps every frame in memory until the palette
        // is known. Above the memory budget, write the palette to a file first
        // and read the frames a second time instead.
        let two_pass = g.frames_bytes > gif_memory_budget();
        if two_pass {
            let palette = g.dest.with_extension("palette.png");
            let mut pass1 = g.input.to_vec();
            pass1.extend(os(&["-vf", &format!("{pre}{palettegen}"), "-frames:v", "1", "-update", "1"]));
            pass1.push(palette.as_os_str().into());
            if attempt == 0 {
                on_log(format!("GIF frames need ~{} MB: two-pass palette to save memory", g.frames_bytes / 1_000_000));
            }
            let half = (1.0 - progress_start) * 0.35;
            ff_timed(ff, &pass1, g.duration_ms, Phase { start: progress_start, span: half }, on_progress, on_log, cancel).await?;
            progress_start += half;
            args.push("-i".into());
            args.push(palette.into_os_string());
            args.extend(os(&["-filter_complex", &format!("[0:v]{pre}null[x];[x][1:v]{paletteuse}"), "-loop", "0"]));
        } else {
            let graph = format!("[0:v]{pre}split[a][b];[a]{palettegen}[p];[b][p]{paletteuse}");
            args.extend(os(&["-filter_complex", &graph, "-loop", "0"]));
        }
        if let Some(cs) = g.final_delay_cs {
            args.extend(os(&["-final_delay", &cs.to_string()]));
        }
        args.extend(os(&["-f", "gif"]));
        args.push(g.dest.into());
        let span = (1.0 - progress_start) * if g.limit.is_some() && attempt + 1 < MAX_GIF_ATTEMPTS { 0.6 } else { 1.0 };
        ff_timed(ff, &args, g.duration_ms, Phase { start: progress_start, span }, on_progress, on_log, cancel).await?;
        progress_start += span;
        last_size = file_size(g.dest);
        let Some(limit) = g.limit else { break };
        if last_size <= limit {
            break;
        }
        on_log(format!("GIF is {last_size} bytes, above the {limit} byte limit (colours {colors}, scale {shrink:.2}): trying smaller"));
        if colors > 32 && (colors > 64 || !g.allow_shrink) {
            colors /= 2;
            dither = "bayer:bayer_scale=2";
        } else if g.allow_shrink {
            shrink *= ((limit as f64 / last_size as f64).sqrt() * 0.95).clamp(0.3, 0.92);
        } else {
            break;
        }
    }
    let _ = std::fs::remove_file(g.dest.with_extension("palette.png"));
    Ok(CompressReport {
        limit_bytes: g.limit,
        met: g.limit.is_none_or(|l| last_size <= l),
        quality: None,
        scale: shrink as f32,
        bytes: last_size,
    })
}

/// Visually lossless intermediate encode for clip segments.
fn intermediate_codec(encoder: Option<HwEncoder>) -> Vec<OsString> {
    match encoder {
        Some(HwEncoder::Nvenc) => os(&["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "constqp", "-qp", "14"]),
        _ => os(&["-c:v", "libx264", "-preset", "veryfast", "-crf", "12"]),
    }
}

/// Quality mode trades encoding time for slightly better compression.
fn x264_preset() -> &'static str {
    if crate::tuning::quality_presets() {
        "slow"
    } else {
        "medium"
    }
}

fn crf_for(compress: &CompressSettings) -> u32 {
    match compress.level {
        CompressLevel::Best => 17,
        CompressLevel::Balanced => 21,
        CompressLevel::Small => 27,
        CompressLevel::Custom => (51.0 - compress.quality() as f64 * 0.36).round().clamp(14.0, 40.0) as u32,
    }
}

fn quality_codec(encoder: Option<HwEncoder>, crf: u32) -> Vec<OsString> {
    let q = crf.to_string();
    match encoder {
        Some(HwEncoder::Nvenc) => {
            let preset = if crate::tuning::quality_presets() { "p7" } else { "p5" };
            os(&["-c:v", "h264_nvenc", "-preset", preset, "-tune", "hq", "-rc", "vbr", "-cq", &q, "-b:v", "0"])
        }
        Some(HwEncoder::Amf) => os(&["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", &q, "-qp_p", &q]),
        Some(HwEncoder::Qsv) => os(&["-c:v", "h264_qsv", "-preset", "slower", "-global_quality", &q]),
        None => os(&["-c:v", "libx264", "-preset", x264_preset(), "-crf", &q]),
    }
}

/// Motion blur as a virtual shutter: `(sub-frame spacing as 1/m of a frame,
/// sub-frames averaged k)`. The shutter spans (k-1)/m of a frame interval,
/// from ~90° (light) to 300° (strong).
pub fn blur_shutter(strength: u8) -> Option<(u32, u32)> {
    if strength == 0 {
        return None;
    }
    let s = strength.min(100) as f64;
    let angle = 60.0 + 2.4 * s;
    let m: u32 = if strength <= 50 { 4 } else { 6 };
    let k = ((angle / 360.0 * m as f64).round() as u32 + 1).clamp(2, m);
    Some((m, k))
}

/// Clean-up engines for clips.
#[derive(Clone, Copy, PartialEq)]
enum Cleanup {
    /// waifu2x (live action, or when Real-ESRGAN is missing).
    Waifu2x(EnginePlan),
    /// realesr-animevideov3 at this native scale.
    Esrgan(u32),
}

/// Links (or copies) a frame: frames shared by two blocks stay in place.
fn link_or_copy(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::hard_link(src, dst).or_else(|_| std::fs::copy(src, dst).map(|_| ()))
}

/// Writes `src` (JPEG or PNG) as the PNG `dst`.
fn copy_as_png(src: &Path, dst: &Path) -> AppResult<()> {
    if src.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        let _ = std::fs::remove_file(dst);
        return link_or_copy(src, dst).map_err(Into::into);
    }
    let img = image::open(src).map_err(|e| AppError::new(ErrorCode::DecodeFailed, format!("{}: {e}", src.display())))?;
    img.save(dst).map_err(|e| AppError::new(ErrorCode::EncodeFailed, format!("{}: {e}", dst.display())))
}

/// Scene change score above which two frames belong to different shots.
const CUT_SCORE: f64 = 0.32;

/// Indices (0-based) of the frames starting a new shot, from FFmpeg's
/// `metadata=print` output of the scene branch (one score per frame, whose
/// pts_time is the frame index).
pub(crate) fn parse_cuts(text: &str) -> std::collections::HashSet<usize> {
    let mut cuts = std::collections::HashSet::new();
    let mut frame = None;
    for line in text.lines() {
        if let Some(t) = line.split_whitespace().find_map(|w| w.strip_prefix("pts_time:")) {
            frame = t.parse::<f64>().ok().map(|t| t.round() as usize);
        } else if let Some(score) = line.trim().strip_prefix("lavfi.scene_score=").and_then(|v| v.parse::<f64>().ok()) {
            if let Some(i) = frame.filter(|&i| i > 0 && score > CUT_SCORE) {
                cuts.insert(i);
            }
        }
    }
    cuts
}

/// FFmpeg global options for a Vulkan device (libplacebo).
fn vulkan_device(gpu: Option<i32>) -> Vec<OsString> {
    let dev = match gpu {
        Some(g) if g >= 0 => format!("vulkan=vk:{g}"),
        _ => "vulkan=vk".to_string(),
    };
    os(&["-init_hw_device", &dev, "-filter_hw_device", "vk"])
}

/// Shape of a processed clip.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClipGeometry {
    /// Source pixels kept by Smart Reframe's moving window, None = whole frame.
    pub crop: Option<(u32, u32)>,
    /// New shape reached by filling around the whole picture (portrait to landscape).
    pub fill: bool,
    /// Size of the frames processed (after the crop).
    pub work: Dimensions,
    /// Output size.
    pub out: Dimensions,
}

pub fn clip_geometry(info: &MediaInfo, a: &AnimSettings) -> ClipGeometry {
    clip_geometry_with(info, a, None)
}

/// Same, once the clip has been analysed (black bars are left out of a new shape).
pub fn clip_geometry_with(info: &MediaInfo, a: &AnimSettings, analysis: Option<&analysis::Analysis>) -> ClipGeometry {
    let (w, h) = (info.width, info.height);
    let even = |d: Dimensions| Dimensions { width: (d.width & !1).max(2), height: (d.height & !1).max(2) };
    let src = Dimensions { width: w, height: h };
    if reframe::fills(w, h, a.format) {
        let (fw, fh) = reframe::fill_size(w, h, a.format);
        return ClipGeometry { crop: None, fill: true, work: src, out: even(final_dimensions(Dimensions { width: fw, height: fh }, a.scale)) };
    }
    match reframe::window(w, h, a.format, analysis).map(|(_, _, cw, ch)| (cw, ch)) {
        Some((cw, ch)) => {
            let work = Dimensions { width: cw, height: ch };
            ClipGeometry { crop: Some((cw, ch)), fill: false, work, out: even(final_dimensions(work, a.scale)) }
        }
        None => ClipGeometry { crop: None, fill: false, work: src, out: target_dims(info, a.scale, MediaKind::Video) },
    }
}

/// Output rate for a target FPS as ("num/den", value). NTSC sources (x/1001)
/// go to the matching NTSC rate (23.976 -> 59.94 for "60"), as editors expect.
fn out_rate(src_rational: &str, src_fps: f64, target: Option<f32>) -> (String, f64) {
    match target {
        None => (src_rational.to_string(), src_fps),
        Some(t) => {
            let ntsc = smooth::parse_rational(src_rational).is_some_and(|(_, d)| d == 1001);
            let t = (t as f64).round() as u64;
            if ntsc {
                (format!("{}/1001", t * 1000), (t * 1000) as f64 / 1001.0)
            } else {
                (format!("{t}/1"), t as f64)
            }
        }
    }
}

/// `n / d` times `k`, as "num/den".
fn rate_times(rate: &str, k: u32) -> String {
    let (n, d) = smooth::parse_rational(rate).unwrap_or((30, 1));
    format!("{}/{}", n * k as u64, d)
}

/// Extra time Smooth Motion, Speed, motion blur and Smart Reframe add to a
/// clip (ms): RIFE costs about 20 ms per rendered megapixel, the analysis
/// decode about 1.5 ms per frame.
pub fn timing_estimate_ms(info: &MediaInfo, a: &AnimSettings, rife: bool) -> u64 {
    let geo = clip_geometry(info, a);
    let curve = SpeedCurve::from_settings(&a.speed);
    let target_fps = changes_fps(a, info.fps);
    let smooth_up = a.smooth != SmoothMotion::Off && target_fps.is_some_and(|f| f as f64 > info.fps + 0.01);
    let slows = curve.as_ref().is_some_and(|c| c.min() < 0.999);
    let shutter = blur_shutter(a.motion_blur);
    let use_rife = rife && (smooth_up || slows || shutter.is_some());
    let src_dur = info.duration_ms as f64 / 1000.0;
    let out_dur = curve.map_or(src_dur, |c| TimeWarp::new(c, src_dur.max(0.04)).out_duration());
    let out_fps = target_fps.map_or(info.fps, |f| f as f64);
    let mut ms = 0.0;
    if use_rife {
        let density = shutter.map_or(1.0, |(m, _)| m as f64);
        let rendered = out_dur * out_fps * density;
        let factor = if a.smooth == SmoothMotion::High { 1.6 } else if a.smooth == SmoothMotion::Low { 0.7 } else { 1.0 };
        ms += rendered * geo.out.megapixels() / (a.scale.max(1.0) as f64).powi(2) * 20.0 * factor + 1500.0;
    }
    if use_rife || geo.crop.is_some() {
        ms += info.frames as f64 * 1.5;
    }
    ms as u64
}

/// Adds a notice for the result card (once).
fn notice(code: &str, notices: &mut Vec<String>) {
    if !notices.iter().any(|n| n == code) {
        notices.push(code.to_string());
    }
}

/// What run_clip hands back.
pub(crate) struct ClipDone {
    engine_ms: u64,
    work_mp: f64,
    report: CompressReport,
    notices: Vec<String>,
    timing: Option<Vec<[f64; 2]>>,
}

#[allow(clippy::too_many_arguments)]
async fn run_clip(
    engine: &dyn UpscaleEngine,
    ff: &Ffmpeg,
    spec: &AnimSpec<'_>,
    work: &Path,
    tmp_dest: &Path,
    on_stage: StageSink<'_>,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<ClipDone> {
    let info = spec.info;
    let a = spec.anim;
    // Shape before the analysis (the exact crop leaves black bars out, below).
    let geo0 = clip_geometry(info, a);
    let anime = a.style != crate::settings::Style::Photo;
    let mut engine_ms = 0;
    let mut work_mp = 0.0;
    let mut notices: Vec<String> = Vec::new();

    // ---- Timing: frame rate, speed, motion blur ----
    let curve = SpeedCurve::from_settings(&a.speed);
    let target_fps = changes_fps(a, info.fps);
    let smooth_up = a.smooth != SmoothMotion::Off && target_fps.is_some_and(|f| f as f64 > info.fps + 0.01);
    let slows = curve.as_ref().is_some_and(|c| c.min() < 0.999);
    let shutter = blur_shutter(a.motion_blur);
    let use_rife = spec.rife.is_some() && (smooth_up || slows || shutter.is_some());
    if spec.rife.is_none() && (smooth_up || slows) {
        on_log("Smooth Motion engine unavailable: frames are repeated instead of interpolated".into());
        notice("smoothUnavailable", &mut notices);
    }
    // Speed changes and RIFE renders go through the time map (timemap.rs).
    let timed = use_rife || curve.is_some();
    let rife_shutter = if use_rife { shutter } else { None };
    // Anime on twos: spread the motion between drawings when making new frames.
    let dedup = use_rife && (smooth_up || slows);

    // ---- Clean-up: Real-ESRGAN's anime video model for anime, waifu2x otherwise ----
    let eparams = engine_params(a, spec.params);
    let cleanup = match &eparams {
        Some(_) if anime && spec.esrgan.is_some() => Some(Cleanup::Esrgan(crate::esrgan::native_scale(a.scale))),
        Some(p) => Some(Cleanup::Waifu2x(engine_plan(engine, p)?)),
        None => None,
    };
    let frames_path = cleanup.is_some() || timed;

    // ---- Smart Reframe ----
    // Any new shape is analysed: black bars are found even for a still crop.
    let need_analysis = geo0.crop.is_some() || use_rife;

    // ---- Dynamic range ----
    // Clean-up and Smooth Motion work on 8-bit images, so an HDR source going
    // through them is tone mapped first.
    let src_hdr = info.transfer.is_hdr();
    let output_transfer = match a.hdr {
        HdrMode::Off => Transfer::Sdr,
        HdrMode::Auto if src_hdr && !frames_path => info.transfer,
        HdrMode::Auto => Transfer::Sdr,
        HdrMode::Enhanced if src_hdr && !frames_path => info.transfer,
        HdrMode::Enhanced => Transfer::Pq,
    };
    if src_hdr && frames_path && a.hdr != HdrMode::Off {
        on_log("HDR source: Clean-up / Smooth Motion process 8-bit frames, the clip is tone mapped to SDR first".into());
    }
    let placebo = src_hdr && output_transfer == Transfer::Sdr && ff.libplacebo();
    on_log(format!("colour: {:?} -> {:?}{}", info.transfer, output_transfer, if placebo { " (libplacebo tone mapping)" } else { "" }));

    // ---- Analysis (one low-resolution decode) ----
    let mut progress_at = 0.0f32;
    let analysis = if need_analysis {
        on_stage(Stage::Extracting);
        let total = info.frames.max(1);
        let report = |f: usize| on_progress(0.05 * (f as f32 / total as f32).min(1.0), Some(ProgressDetail::Frames { done: f.min(total as usize) as u64, total }));
        let an = analysis::analyze(ff, spec.source, info, work, cancel, &report, on_log).await?;
        progress_at = 0.05;
        Some(an)
    } else {
        None
    };

    let geo = clip_geometry_with(info, a, analysis.as_ref());
    let target = geo.out;
    // The moving crop runs on the decoded frames, before any processing (fewer pixels to process).
    let mut crop_vf: Vec<String> = Vec::new();
    if let Some(Plan::Crop { w, h, path }) = geo.crop.and_then(|_| reframe::plan(info.width, info.height, info.fps, a.format, a.reframe, a.focus, analysis.as_ref())) {
        let first = path.first().copied().unwrap_or(((info.width - w) / 2, (info.height - h) / 2));
        if path.iter().all(|p| *p == first) {
            crop_vf.push(format!("crop={w}:{h}:{}:{}", first.0, first.1));
            on_log(format!("Smart Reframe: {w}x{h} window, still at {},{}", first.0, first.1));
        } else {
            let cmd = work.join("reframe.cmd");
            std::fs::write(&cmd, reframe::crop_commands("rf", &path, info.fps))?;
            let moves = path.windows(2).filter(|p| p[0] != p[1]).count();
            on_log(format!("Smart Reframe: {w}x{h} window following the content ({moves} moving frames)"));
            crop_vf.push(format!("sendcmd=f='{}'", color::escape_filter_path(&cmd)));
            crop_vf.push(reframe::crop_filter("rf", w, h, first));
        }
    } else if geo.fill {
        on_log(format!("Smart Reframe: whole picture on a blurred background, {}x{}", target.width, target.height));
    }

    let (out_rate_s, out_fps) = out_rate(&info.fps_rational, info.fps, if timed { target_fps } else { None });
    let mut warp: Option<TimeWarp> = None;
    let mut out_frames = 0usize;

    let final_start;
    // (video input args, index of the input carrying the audio, resize still needed, rate after this stage)
    let (mut video_input, audio_input, resize_to, stage_fps): (Vec<OsString>, usize, Option<Resize>, f64) = if frames_path {
        let frames_dir = work.join("frames");
        let done_marker = work.join("frames.done");
        // Resume: frames already extracted by an interrupted run.
        let n = match std::fs::read_to_string(&done_marker).ok().and_then(|t| t.trim().parse::<usize>().ok()) {
            Some(n) => {
                on_log(format!("resuming: {n} frames already extracted"));
                n
            }
            None => {
                let _ = std::fs::remove_dir_all(&frames_dir);
                std::fs::create_dir_all(&frames_dir)?;
                on_stage(Stage::Extracting);
                let mut args: Vec<OsString> = Vec::new();
                // Frame i at i / fps: the crop commands are timed on that.
                let mut vf = vec![format!("fps={}", info.fps_rational), "setpts=N/FRAME_RATE/TB".to_string()];
                if src_hdr {
                    if placebo {
                        args.extend(vulkan_device(spec.params.gpu));
                        vf.extend(color::placebo_to_sdr());
                    } else {
                        let plan = ColorPlan { input: info.transfer, output: Transfer::Sdr, look: Default::default(), creative: None };
                        vf.extend(color::prepare(&plan, work, "tonemap", &info.color_matrix)?.unwrap_or_default());
                    }
                }
                vf.extend(crop_vf.iter().cloned());
                args.push("-i".into());
                args.push(spec.source.into());
                args.extend(os(&["-vf", &vf.join(","), "-q:v", "2"]));
                args.push(frames_dir.join("%08d.jpg").into());
                ff_timed(ff, &args, info.duration_ms, Phase { start: progress_at, span: 0.06 }, on_progress, on_log, cancel).await?;
                let n = count_files(&frames_dir) as usize;
                if n == 0 {
                    return Err(AppError::new(ErrorCode::DecodeFailed, format!("no frames decoded from {}", spec.source.display())));
                }
                std::fs::write(&done_marker, n.to_string())?;
                n
            }
        };
        let frame_path = |i: usize| frames_dir.join(format!("{:08}.jpg", i + 1));
        let body_start = progress_at + 0.06;

        // Distinct pictures, cuts, and where each output sample comes from.
        let (held, cuts) = match &analysis {
            Some(an) => {
                if an.frames != n {
                    on_log(format!("analysis saw {} frames, extraction {n}", an.frames));
                }
                let mut h = an.held.clone();
                h.resize(n, false);
                (dedup.then_some(h), an.cuts.clone())
            }
            None => (None, Default::default()),
        };
        let keys = timemap::Keys::new(n, held.as_deref(), &cuts);
        if keys.deduplicated(n) {
            on_log(format!("held drawings: {} distinct pictures in {n} frames, motion spread between them", keys.len()));
        }
        if use_rife {
            on_log(format!("{} scene cut(s): no interpolation across them", cuts.len()));
        }
        warp = curve.clone().map(|c| TimeWarp::new(c, n as f64 / info.fps));
        let output = timemap::Output { fps: out_fps, shutter_div: rife_shutter.map_or(1, |s| s.0), subs: rife_shutter.map_or(1, |s| s.1) };
        let picks: Vec<timemap::Pick> =
            if timed { timemap::plan_samples(n, info.fps, output, warp.as_ref(), &keys) } else { (0..keys.len()).map(timemap::Pick::Key).collect() };
        let subs = output.subs.max(1) as usize;
        out_frames = picks.len() / subs;

        let es = match cleanup {
            Some(Cleanup::Esrgan(s)) => s as u64,
            Some(Cleanup::Waifu2x(p)) => p.engine_scale as u64,
            None => 1,
        };
        let (ww, wh) = (geo.work.width as u64, geo.work.height as u64);
        let frame_bytes = (ww * es) * (wh * es) * 4;
        let block = (crate::tuning::block_bytes() / frame_bytes.max(1)).clamp(8, 240) as usize;
        let blocks = timemap::plan_blocks(&picks, subs, block, (block * 8).max(64), use_rife);

        let level = if a.smooth == SmoothMotion::Off { SmoothMotion::Medium } else { a.smooth };
        let mut choice = smooth::choose_model(level, anime, spec.vram_bytes, target.width as u64 * target.height as u64);
        if use_rife {
            let rendered: usize = blocks.iter().map(|b| b.render).sum();
            on_log(format!(
                "Smooth Motion: {}{}{} -> {out_frames} frames at {out_rate_s}, {rendered} rendered{}{}",
                choice.model,
                if choice.tta { " +TTA" } else { "" },
                if choice.uhd { " (half-resolution flow)" } else { "" },
                rife_shutter.map(|(m, k)| format!(", motion blur from {k} sub-frames (1/{m} frame apart)")).unwrap_or_default(),
                warp.as_ref().map(|w| format!(", speed curve: {:.2}s -> {:.2}s", n as f64 / info.fps, w.out_duration())).unwrap_or_default(),
            ));
        } else if let Some(w) = &warp {
            on_log(format!("Speed: {:.2}s -> {:.2}s, {out_frames} frames (real frames, no interpolation)", n as f64 / info.fps, w.out_duration()));
        }
        match cleanup {
            Some(Cleanup::Esrgan(s)) => on_log(format!("Clean-up: {} x{s}", crate::esrgan::MODEL)),
            Some(Cleanup::Waifu2x(_)) => on_log("Clean-up: waifu2x".into()),
            None => {}
        }
        on_log(format!("{n} frames, {} block(s)", blocks.len()));
        let seg_w = (ww * es) as u32;
        let seg_h = (wh * es) as u32;
        let needs_resize = !geo.fill && (matches!(cleanup, Some(Cleanup::Waifu2x(p)) if p.needs_resize) || target.width != seg_w || target.height != seg_h);

        // Progress: Clean-up per input, RIFE per rendered frame, encoding per sample.
        let w_clean = if cleanup.is_some() { 1.0 } else { 0.0 };
        let units = |b: &timemap::Block| b.inputs() as f64 * w_clean + b.render as f64 * 0.3 + b.samples.len() as f64 * 0.03;
        let total_units = blocks.iter().map(units).sum::<f64>().max(1e-9);
        let units_done = std::sync::Mutex::new(0.0f64);
        let span = 0.8 - body_start;
        let report = |extra: f64, src_done: u64| {
            let u = *units_done.lock().unwrap() + extra;
            on_progress(body_start + span * (u / total_units).min(1.0) as f32, Some(ProgressDetail::Frames { done: src_done.min(n as u64), total: n as u64 }));
        };

        let mut segments = String::new();
        let mut resumed = 0;
        let mut rife_ok = use_rife;
        let seg_rate = rate_times(&out_rate_s, subs as u32);
        for (bi, b) in blocks.iter().enumerate() {
            check(cancel)?;
            let seg = work.join(format!("seg_{bi:05}.mkv"));
            segments.push_str(&format!("file '{}'\n", seg.file_name().unwrap_or_default().to_string_lossy()));
            if seg.is_file() {
                // Finished by an interrupted run.
                resumed += 1;
                *units_done.lock().unwrap() += units(b);
                continue;
            }
            if resumed > 0 && bi == resumed {
                on_log(format!("resuming: {resumed} of {} blocks already done", blocks.len()));
            }
            let src_at = keys.idx[b.first_key] as u64;
            let in_dir = work.join("block_in");
            let up_dir = work.join("block_up");
            let mid_dir = work.join("block_mid");
            let sel_dir = work.join("block_sel");
            for d in [&in_dir, &up_dir, &mid_dir, &sel_dir] {
                let _ = std::fs::remove_dir_all(d);
            }
            std::fs::create_dir_all(&in_dir)?;
            for (k, key) in (b.first_key..=b.last_key).enumerate() {
                link_or_copy(&frame_path(keys.idx[key]), &in_dir.join(format!("{:08}.jpg", k + 1)))?;
            }
            let mut current = in_dir.clone();
            let mut ext = "jpg";

            if let Some(c) = cleanup {
                on_stage(Stage::Initializing);
                std::fs::create_dir_all(&up_dir)?;
                let params = eparams.as_ref().expect("clean-up has params");
                let fut = async {
                    match c {
                        Cleanup::Waifu2x(ep) => {
                            let job = |tile_size: u32| EngineJob {
                                input: &in_dir,
                                output: &up_dir,
                                style: params.style,
                                plan: ep,
                                gpu: params.gpu,
                                tile_size,
                                tta: params.tta,
                                threads: params.threads,
                                expect_outputs: Some(b.inputs()),
                            };
                            run_engine(engine, &job, params, on_stage, on_log, cancel).await
                        }
                        Cleanup::Esrgan(scale) => {
                            let started = std::sync::Mutex::new(None::<std::time::Instant>);
                            let events = |ev: crate::engine::EngineEvent| match ev {
                                crate::engine::EngineEvent::DeviceReady(name) => {
                                    *started.lock().unwrap() = Some(std::time::Instant::now());
                                    on_log(format!("device ready: {name}"));
                                    on_stage(Stage::Upscaling);
                                }
                                crate::engine::EngineEvent::Log(line) => on_log(line),
                            };
                            let job = crate::esrgan::EsrganJob {
                                input: &in_dir,
                                output: &up_dir,
                                scale,
                                gpu: params.gpu,
                                tile_size: params.tile_size,
                                threads: params.threads,
                                tta: params.tta,
                                expect_outputs: b.inputs(),
                            };
                            spec.esrgan.expect("checked").run(&job, &events, cancel).await?;
                            let ms = started.lock().unwrap().map(|t| t.elapsed().as_millis() as u64).unwrap_or(0);
                            Ok(ms)
                        }
                    }
                };
                engine_ms += with_frame_poll(fut, &up_dir, |w| report(w.min(b.inputs() as u64) as f64 * w_clean, src_at + w)).await?;
                *units_done.lock().unwrap() += b.inputs() as f64 * w_clean;
                current = up_dir.clone();
                ext = "png";
                if let Some(Cleanup::Waifu2x(ep)) = cleanup {
                    let p = eparams.as_ref().expect("clean-up has params");
                    work_mp += b.inputs() as f64 * crate::engine::plan::work_megapixels(geo.work, &ep, p.tta);
                }
            }

            // In-between frames. Out of GPU memory: a lighter setting, then real frames only.
            let mut sources = b.sources.clone();
            let mut render = if rife_ok { b.render } else { 0 };
            if b.render > 0 && render == 0 {
                sources = timemap::make_block(&picks, b.samples.clone(), b.first_key, b.last_key, false).sources;
            }
            while render > 0 {
                on_stage(Stage::Interpolating);
                let rife = spec.rife.expect("checked when planning");
                let fut = async {
                    rife.interpolate(&current, &mid_dir, render, choice, spec.params.gpu, spec.params.threads, on_log, cancel).await?;
                    Ok(0u64)
                };
                let res = with_frame_poll(fut, &mid_dir, |w| report(w.min(render as u64) as f64 * 0.3, src_at + w * b.inputs() as u64 / render as u64)).await;
                match res {
                    Ok(_) => break,
                    Err(e) if e.is_cancelled() => return Err(e),
                    Err(e) => {
                        let _ = std::fs::remove_dir_all(&mid_dir);
                        if let Some(l) = choice.lighter() {
                            on_log(format!("Smooth Motion failed ({}): retrying with a lighter setting", e.detail));
                            notice("smoothLighter", &mut notices);
                            choice = l;
                        } else {
                            on_log(format!("Smooth Motion failed ({}): real frames only from here", e.detail));
                            notice("smoothFailed", &mut notices);
                            rife_ok = false;
                            sources = timemap::make_block(&picks, b.samples.clone(), b.first_key, b.last_key, false).sources;
                            render = 0;
                        }
                    }
                }
            }
            *units_done.lock().unwrap() += b.render as f64 * 0.3;

            // The samples, in order, as one numbered sequence.
            std::fs::create_dir_all(&sel_dir)?;
            let sel_ext = if render > 0 { "png" } else { ext };
            for (i, s) in sources.iter().enumerate() {
                let dst = sel_dir.join(format!("{:08}.{sel_ext}", i + 1));
                match *s {
                    timemap::Source::Input(k) => {
                        let src = current.join(format!("{:08}.{ext}", k + 1));
                        if sel_ext == ext {
                            link_or_copy(&src, &dst)?;
                        } else {
                            copy_as_png(&src, &dst)?;
                        }
                    }
                    timemap::Source::Rendered(r) => link_or_copy(&mid_dir.join(format!("{:08}.png", r + 1)), &dst)?,
                }
            }

            let part = work.join(format!("seg_{bi:05}.part.mkv"));
            let mut args = os(&["-framerate", &seg_rate, "-i"]);
            args.push(sel_dir.join(format!("%08d.{sel_ext}")).into());
            let mut vf = Vec::new();
            let frames_out = b.samples.len() / subs;
            if subs > 1 {
                // Shutter: average the sub-frames of each output frame, keep one.
                vf.push(format!("tmix=frames={subs}:weights='{}'", vec!["1"; subs].join(" ")));
                vf.push(format!("select='eq(mod(n\\,{subs})\\,{})'", subs - 1));
                vf.push(format!("setpts=N/({out_rate_s})/TB"));
            }
            if needs_resize {
                vf.push(format!("scale={}:{}:flags=lanczos", target.width, target.height));
            }
            // Frames are RGB: convert with the HD matrix and tag it.
            vf.push("scale=out_color_matrix=bt709:out_range=tv".into());
            vf.push("format=yuv420p".into());
            args.extend(os(&["-vf", &vf.join(","), "-frames:v", &frames_out.to_string(), "-r", &out_rate_s]));
            args.extend(os(&["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]));
            args.extend(intermediate_codec(spec.encoder));
            args.push(part.clone().into());
            ff.run(&args, cancel, &|_| {}, on_log).await?;
            std::fs::rename(&part, &seg)?;
            *units_done.lock().unwrap() += b.samples.len() as f64 * 0.03;
            for d in [&in_dir, &up_dir, &mid_dir, &sel_dir] {
                let _ = std::fs::remove_dir_all(d);
            }
            // Source frames no later block needs.
            if let Some(next) = blocks.get(bi + 1) {
                for f in keys.idx[b.first_key]..keys.idx[next.first_key] {
                    let _ = std::fs::remove_file(frame_path(f));
                }
            }
        }
        let list = work.join("segments.txt");
        std::fs::write(&list, segments)?;
        let joined = work.join("enhanced.mkv");
        let mut args = os(&["-f", "concat", "-safe", "0", "-i"]);
        args.push(list.into());
        args.extend(os(&["-c", "copy"]));
        args.push(joined.clone().into());
        ff.run(&args, cancel, &|_| {}, on_log).await?;
        final_start = 0.8;
        let mut input = os(&["-i"]);
        input.push(joined.into());
        input.push("-i".into());
        input.push(spec.source.into());
        let resize = geo.fill.then_some(Resize::Fill(target));
        (input, 1, resize, if timed { out_fps } else { info.fps })
    } else {
        final_start = progress_at;
        let mut input = Vec::new();
        if placebo {
            input.extend(vulkan_device(spec.params.gpu));
        }
        input.push("-i".into());
        input.push(spec.source.into());
        let resize = if geo.fill {
            Some(Resize::Fill(target))
        } else {
            (geo.work != target).then_some(Resize::Exact(target))
        };
        (input, 0, resize, info.fps)
    };

    // ---- Audio follows the speed (pitch kept) ----
    let src_duration_s = info.duration_ms as f64 / 1000.0;
    let mut audio_index = info.has_audio.then_some(audio_input);
    let mut audio_codec = info.audio_codec.as_deref();
    if let (Some(w), true) = (&warp, info.has_audio) {
        let cmd = work.join("speed_audio.cmd");
        std::fs::write(&cmd, w.audio_commands())?;
        let wav = work.join("speed_audio.wav");
        let first = w.speed_at_source(0.0);
        let mut args = os(&["-i"]);
        args.push(spec.source.into());
        let af = format!("asendcmd=f='{}',rubberband@rb=tempo={first:.4}", color::escape_filter_path(&cmd));
        args.extend(os(&["-vn", "-t", &format!("{src_duration_s:.3}"), "-af", &af, "-c:a", "pcm_s16le"]));
        args.push(wav.clone().into());
        match ff.run(&args, cancel, &|_| {}, on_log).await {
            Ok(()) => {
                video_input.push("-i".into());
                video_input.push(wav.into());
                audio_index = Some(if frames_path { 2 } else { 1 });
                audio_codec = None;
            }
            Err(e) if e.is_cancelled() => return Err(e),
            Err(e) => {
                on_log(format!("audio could not follow the speed ({}): no audio", e.detail));
                notice("speedNoAudio", &mut notices);
                audio_index = None;
            }
        }
    }

    on_stage(Stage::Encoding);
    let sub_blur = rife_shutter.is_some();
    let after = AnimSettings {
        // The rate is already reached by the time map: no FFmpeg retiming on top.
        fps: if timed { None } else { a.fps },
        fps_mode: if !timed && smooth_up { FpsMode::Interpolate } else { FpsMode::Retime },
        // Motion blur already rendered from sub-frames.
        motion_blur: if sub_blur { 0 } else { a.motion_blur },
        ..a.clone()
    };
    let mut filters: Vec<String> = Vec::new();
    if !frames_path && !crop_vf.is_empty() {
        filters.push(format!("fps={}", info.fps_rational));
        filters.push("setpts=N/FRAME_RATE/TB".into());
        filters.extend(crop_vf.iter().cloned());
    }
    // Temporal stabilisation after Clean-up: settles shimmering detail where
    // nothing moves (measured -38 % flicker on anime, docs/VIDEO_ENGINE.md).
    if cleanup.is_some() {
        let per_src = (stage_fps / info.fps).round().max(1.0) as u32;
        let window = (5 * per_src).min(15) | 1;
        let (ta, tb) = if a.enhance == Enhance::Strong { (0.04, 0.08) } else { (0.02, 0.04) };
        filters.push(format!("atadenoise=0a={ta}:0b={tb}:1a={ta}:1b={tb}:2a={ta}:2b={tb}:s={window}"));
    }
    filters.extend(post_filters(&after, stage_fps, resize_to));
    let final_fps = if timed { out_fps } else { after.fps.filter(|f| (*f as f64 - info.fps).abs() > 0.01).map_or(info.fps, |f| f as f64) };
    let out_duration_s = if timed { out_frames as f64 / out_fps } else { src_duration_s };

    // ---- Beat Sync ----
    if a.beat.on && (a.beat.zoom || a.beat.shake) {
        if !info.has_audio {
            on_log("Beat Sync: the clip has no audio".into());
            notice("beatNoAudio", &mut notices);
        } else {
            match beat::detect(ff, spec.source, cancel, on_log).await? {
                Some(b) => {
                    let times: Vec<f64> = b.times.iter().map(|&t| warp.as_ref().map_or(t, |w| w.to_output(t))).collect();
                    let frames = (out_duration_s * final_fps).ceil() as usize + 1;
                    let (script, crop) = beat::effect_filters(&times, &b.strength, frames, final_fps, target.width, target.height, a.beat.zoom, a.beat.shake);
                    let cmd = work.join("beat.cmd");
                    std::fs::write(&cmd, script)?;
                    if frames_path || crop_vf.is_empty() {
                        filters.insert(0, "setpts=PTS-STARTPTS".into());
                    }
                    filters.push(format!("sendcmd=f='{}'", color::escape_filter_path(&cmd)));
                    filters.extend(crop);
                    notices.push(format!("beat:{:.0}", b.bpm));
                }
                None => notice("beatNotFound", &mut notices),
            }
        }
    }

    // ---- Glow, colour, LUT ----
    let input_transfer = if frames_path || placebo { Transfer::Sdr } else { info.transfer };
    if placebo && !frames_path {
        filters.extend(color::placebo_to_sdr());
    }
    if a.look.glow > 0 {
        filters.push(glow_filter(a.look.glow, target, input_transfer.is_hdr()));
    }
    let creative = match a.lut.as_deref() {
        Some(id) => looks::resolve(id, a.lut_strength, spec.luts_dir.unwrap_or(Path::new("")))?,
        None => None,
    };
    if creative.is_some() {
        on_log(format!("look: {} at {} %", a.lut.as_deref().unwrap_or_default(), a.lut_strength));
    }
    let matrix = if frames_path || placebo { "bt709" } else { info.color_matrix.as_str() };
    let plan = ColorPlan { input: input_transfer, output: output_transfer, look: a.look, creative };
    match color::prepare(&plan, work, "color", matrix)? {
        Some(f) => filters.extend(f),
        None if output_transfer.is_hdr() => {
            filters.push("format=yuv420p10le".into());
            filters.push(format!("setparams=color_primaries=bt2020:color_trc={}:colorspace=bt2020nc", hdr_trc(output_transfer)));
        }
        None => filters.push("format=yuv420p".into()),
    }
    let mp4 = Mp4Encode {
        input: &video_input,
        audio_input: audio_index,
        audio_codec,
        vf: &filters.join(","),
        duration_ms: (out_duration_s * 1000.0).round() as u64,
        compress: spec.compress,
        encoder: spec.encoder,
        work,
        dest: tmp_dest,
        hdr: output_transfer.is_hdr().then_some(output_transfer),
    };
    let report = encode_mp4(ff, &mp4, final_start, on_progress, on_log, cancel).await?;
    // Output time -> source time, for the Before / After viewer.
    let timing = warp.as_ref().map(|w| {
        let steps = (w.out_duration() / 0.1).ceil() as usize;
        (0..=steps).map(|i| {
            let t = (i as f64 * 0.1).min(w.out_duration());
            [t, w.to_source(t)]
        }).collect()
    });
    Ok(ClipDone { engine_ms, work_mp, report, notices, timing })
}

/// Soft bloom: bright areas, blurred, screened over the picture.
fn glow_filter(strength: u8, size: Dimensions, hdr: bool) -> String {
    let (w, h) = (size.width, size.height);
    let (sw, sh) = ((w / 4).max(2) & !1, (h / 4).max(2) & !1);
    let sigma = (sw.max(sh) as f64 / 60.0).max(2.0);
    let opacity = strength.min(100) as f64 / 100.0 * 0.75;
    let fmt = if hdr { "gbrp16le" } else { "gbrp" };
    let key = "clip((val-maxval*0.6)*2.5\\,0\\,maxval)";
    format!(
        "format={fmt},split[gla][glb];[glb]scale={sw}:{sh}:flags=area,lutrgb=r='{key}':g='{key}':b='{key}',gblur=sigma={sigma:.1},scale={w}:{h}:flags=bicubic[glh];[gla][glh]blend=all_mode=screen:all_opacity={opacity:.3}"
    )
}

fn hdr_trc(t: Transfer) -> &'static str {
    if t == Transfer::Hlg {
        "arib-std-b67"
    } else {
        "smpte2084"
    }
}

/// HEVC Main 10 for HDR output: NVENC when it works, otherwise x265. Colour
/// tags are written in the stream; HDR10 also gets mastering metadata.
fn hdr_codec(encoder: Option<HwEncoder>, transfer: Transfer, crf: u32, bitrate_kbps: Option<f64>) -> Vec<OsString> {
    let trc = hdr_trc(transfer);
    let mut a = match (encoder, bitrate_kbps) {
        (Some(HwEncoder::Nvenc), None) => {
            let preset = if crate::tuning::quality_presets() { "p7" } else { "p5" };
            os(&["-c:v", "hevc_nvenc", "-profile:v", "main10", "-pix_fmt", "p010le", "-preset", preset, "-rc", "vbr", "-cq", &crf.to_string(), "-b:v", "0"])
        }
        _ => {
            let mut params = format!("colorprim=bt2020:transfer={trc}:colormatrix=bt2020nc:repeat-headers=1");
            if transfer == Transfer::Pq {
                params.push_str(":hdr10=1:hdr10-opt=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400");
            }
            let preset = if crate::tuning::quality_presets() { "slow" } else { "medium" };
            let mut v = os(&["-c:v", "libx265", "-preset", preset, "-pix_fmt", "yuv420p10le"]);
            match bitrate_kbps {
                Some(k) => v.extend(os(&["-b:v", &format!("{k:.0}k"), "-maxrate", &format!("{:.0}k", k * 1.2), "-bufsize", &format!("{:.0}k", k * 2.0)])),
                None => v.extend(os(&["-crf", &crf.to_string()])),
            }
            v.extend(os(&["-x265-params", &params]));
            v
        }
    };
    a.extend(os(&["-tag:v", "hvc1", "-color_primaries", "bt2020", "-color_trc", trc, "-colorspace", "bt2020nc"]));
    a
}

/// One H.264 MP4 encode job (shared by the clip pipeline and Convert).
pub(crate) struct Mp4Encode<'a> {
    pub input: &'a [OsString],
    /// Index of the input carrying the audio to keep, None = no audio.
    pub audio_input: Option<usize>,
    pub audio_codec: Option<&'a str>,
    pub vf: &'a str,
    pub duration_ms: u64,
    pub compress: &'a CompressSettings,
    pub encoder: Option<HwEncoder>,
    pub work: &'a Path,
    pub dest: &'a Path,
    /// HDR output (HEVC Main 10) with this transfer, None = SDR H.264.
    pub hdr: Option<Transfer>,
}

/// Quality mode (CRF / hardware encoder, with x264 fallback) or, with a size
/// limit, x264 two-pass on a bitrate computed from the target size.
pub(crate) async fn encode_mp4(
    ff: &Ffmpeg,
    e: &Mp4Encode<'_>,
    final_start: f32,
    on_progress: ProgressSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<CompressReport> {
    let limit = e.compress.limit_bytes();
    let duration_s = (e.duration_ms as f64 / 1000.0).max(0.1);
    let audio_kbps: u64 = if e.audio_input.is_some() { if limit.is_some() { 128 } else { 160 } } else { 0 };
    let maps = |args: &mut Vec<OsString>, with_audio: bool| {
        args.extend(os(&["-map", "0:v:0"]));
        if let (true, Some(i)) = (with_audio, e.audio_input) {
            args.extend(os(&["-map", &format!("{i}:a:0?")]));
        }
    };
    let audio_codec = |args: &mut Vec<OsString>| {
        if e.audio_input.is_none() {
            return;
        }
        if limit.is_none() && e.audio_codec == Some("aac") {
            args.extend(os(&["-c:a", "copy"]));
        } else {
            args.extend(os(&["-c:a", "aac", "-b:a", &format!("{audio_kbps}k")]));
        }
    };
    let span = 1.0 - final_start;

    let size = match (limit, e.hdr) {
        (Some(limit), Some(transfer)) => {
            // HDR with a size cap: x265 at a computed bitrate, lowered if the file is over.
            let mut video_kbps = ((limit as f64 * 8.0 * 0.95 / duration_s / 1000.0) - audio_kbps as f64).max(80.0);
            let mut size = 0;
            for attempt in 0..3 {
                let mut args = e.input.to_vec();
                maps(&mut args, true);
                args.extend(os(&["-vf", e.vf]));
                args.extend(hdr_codec(None, transfer, 0, Some(video_kbps)));
                audio_codec(&mut args);
                args.extend(os(&["-movflags", "+faststart"]));
                args.push(e.dest.into());
                let p = if attempt == 0 { Phase { start: final_start, span } } else { Phase { start: 0.99, span: 0.0 } };
                ff_timed(ff, &args, e.duration_ms, p, on_progress, on_log, cancel).await?;
                size = file_size(e.dest);
                if size <= limit {
                    break;
                }
                on_log(format!("video is {size} bytes, above the {limit} byte limit: lowering the bitrate"));
                video_kbps = (video_kbps * limit as f64 / size as f64 * 0.93).max(50.0);
            }
            size
        }
        (Some(limit), None) => {
            // x264 two-pass: the only way to land reliably on a target size.
            let mut video_kbps = ((limit as f64 * 8.0 * 0.96 / duration_s / 1000.0) - audio_kbps as f64).max(80.0);
            let passlog = e.work.join("x264");
            let mut pass1 = e.input.to_vec();
            maps(&mut pass1, false);
            pass1.extend(os(&["-vf", e.vf, "-c:v", "libx264", "-preset", x264_preset(), "-b:v", &format!("{video_kbps:.0}k"), "-pass", "1", "-passlogfile"]));
            pass1.push(passlog.clone().into());
            pass1.extend(os(&["-an", "-f", "null", "NUL"]));
            ff_timed(ff, &pass1, e.duration_ms, Phase { start: final_start, span: span * 0.45 }, on_progress, on_log, cancel).await?;
            let mut size = 0;
            for attempt in 0..2 {
                let mut pass2 = e.input.to_vec();
                maps(&mut pass2, true);
                pass2.extend(os(&["-vf", e.vf, "-c:v", "libx264", "-preset", x264_preset(), "-b:v", &format!("{video_kbps:.0}k"), "-pass", "2", "-passlogfile"]));
                pass2.push(passlog.clone().into());
                audio_codec(&mut pass2);
                pass2.extend(os(&["-movflags", "+faststart"]));
                pass2.push(e.dest.into());
                let p = if attempt == 0 { Phase { start: final_start + span * 0.45, span: span * 0.55 } } else { Phase { start: 0.99, span: 0.0 } };
                ff_timed(ff, &pass2, e.duration_ms, p, on_progress, on_log, cancel).await?;
                size = file_size(e.dest);
                if size <= limit {
                    break;
                }
                on_log(format!("video is {size} bytes, above the {limit} byte limit: lowering the bitrate"));
                video_kbps = (video_kbps * limit as f64 / size as f64 * 0.95).max(50.0);
            }
            size
        }
        (None, hdr) => {
            let crf = crf_for(e.compress);
            let encode = |encoder: Option<HwEncoder>| {
                let mut args = e.input.to_vec();
                maps(&mut args, true);
                args.extend(os(&["-vf", e.vf]));
                match hdr {
                    // x265 CRF runs a little lower than x264's for the same look.
                    Some(t) => args.extend(hdr_codec(encoder, t, crf.saturating_sub(1), None)),
                    None => args.extend(quality_codec(encoder, crf)),
                }
                audio_codec(&mut args);
                args.extend(os(&["-movflags", "+faststart"]));
                args.push(e.dest.into());
                args
            };
            let phase = Phase { start: final_start, span };
            let first = ff_timed(ff, &encode(e.encoder), e.duration_ms, phase, on_progress, on_log, cancel).await;
            match first {
                Err(err) if e.encoder.is_some() && !err.is_cancelled() => {
                    on_log(format!("hardware encoder failed ({}), using x264", err.detail));
                    ff_timed(ff, &encode(None), e.duration_ms, phase, on_progress, on_log, cancel).await?;
                }
                other => other?,
            }
            file_size(e.dest)
        }
    };
    Ok(CompressReport { limit_bytes: limit, met: limit.is_none_or(|l| size <= l), quality: None, scale: 1.0, bytes: size })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anim() -> AnimSettings {
        AnimSettings::default()
    }

    #[test]
    fn filters_only_when_needed() {
        assert!(post_filters(&anim(), 30.0, None).is_empty());
        let a = AnimSettings { fps: Some(30.0), ..anim() };
        assert!(post_filters(&a, 30.0, None).is_empty(), "same fps is a no-op");
        let a = AnimSettings { fps: Some(60.0), fps_mode: FpsMode::Interpolate, motion_blur: 50, enhance: Enhance::Sharpen, ..anim() };
        let f = post_filters(&a, 24.0, Some(Resize::Exact(Dimensions { width: 100, height: 50 }))).join(",");
        assert!(f.starts_with("scale=100:50:flags=lanczos,cas="));
        assert!(f.contains("minterpolate=fps=60") && f.contains("tmix=frames=4"));
        let a = AnimSettings { fps: Some(24.0), ..anim() };
        assert_eq!(post_filters(&a, 30.0, None), vec!["fps=24".to_string()]);
    }

    #[test]
    fn cuts_from_scene_scores() {
        let text = "frame:0    pts:0       pts_time:0
lavfi.scene_score=0.000000
frame:1    pts:1       pts_time:1
lavfi.scene_score=0.010000
frame:2    pts:2       pts_time:2
lavfi.scene_score=0.870000
";
        assert_eq!(parse_cuts(text).into_iter().collect::<Vec<_>>(), vec![2]);
        assert!(parse_cuts("").is_empty());
    }

    #[test]
    fn cover_crop_filter() {
        let f = Resize::Cover(Dimensions { width: 680, height: 240 }).filter();
        assert_eq!(f, "scale=680:240:force_original_aspect_ratio=increase:flags=lanczos,crop=680:240");
    }

    #[test]
    fn video_dims_are_even() {
        let info = MediaInfo {
            width: 853,
            height: 480,
            fps: 30.0,
            fps_rational: "30/1".into(),
            frames: 1,
            duration_ms: 1,
            codec: String::new(),
            has_audio: false,
            audio_codec: None,
            size_bytes: 0,
            container: String::new(),
            pix_fmt: String::new(),
            rotation: 0,
            playable: false,
            transfer: crate::color::Transfer::Sdr,
            color_matrix: String::new(),
        };
        let d = target_dims(&info, 1.6, MediaKind::Video);
        assert_eq!((d.width % 2, d.height % 2), (0, 0));
        assert_eq!(target_dims(&info, 1.0, MediaKind::Gif).width, 853);
    }

    #[test]
    fn engine_only_for_cleanup_levels() {
        let base = UpscaleParams::default();
        assert!(engine_params(&AnimSettings { enhance: Enhance::Sharpen, ..anim() }, &base).is_none());
        let p = engine_params(&AnimSettings { enhance: Enhance::Medium, scale: 2.0, ..anim() }, &base).unwrap();
        assert_eq!((p.noise, p.scale), (1, 2.0));
    }
}
