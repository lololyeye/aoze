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
}

/// How the frames reach the output size.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Resize {
    /// Stretch-free resize to exactly this size (same aspect ratio).
    Exact(Dimensions),
    /// Scale to cover this size, then crop the centre.
    Cover(Dimensions),
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
        None => anim_suffix(spec.anim.scale, changes_fps(spec.anim, spec.info.fps)),
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
        MediaKind::Gif => run_gif(engine, ff, &spec, &work.path, &tmp_dest, on_stage, on_progress, on_log, cancel).await,
        _ => run_clip(engine, ff, &spec, &work.path, &tmp_dest, on_stage, on_progress, on_log, cancel).await,
    };
    let (engine_ms, work_mp, report) = match result {
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

/// How a clip reaches its frame rate and motion blur.
enum Motion {
    /// Same rate, or FFmpeg retiming / interpolation / frame mix.
    Filters,
    /// RIFE in-between frames (and motion blur sub-frames).
    Smooth { plan: smooth::RatePlan, choice: smooth::ModelChoice },
}

/// Motion blur as a virtual shutter: `(sub-frames rendered per output frame,
/// sub-frames averaged)`. The averaged span is (K-1)/m of a frame interval:
/// Low ~120°, Medium ~180°, High ~240°.
pub fn blur_shutter(strength: u8) -> Option<(u32, u32)> {
    match strength {
        0 => None,
        1..=35 => Some((3, 2)),
        36..=65 => Some((4, 3)),
        _ => Some((6, 5)),
    }
}

/// Clean-up engines for clips.
#[derive(Clone, Copy, PartialEq)]
enum Cleanup {
    /// waifu2x (live action, or when Real-ESRGAN is missing).
    Waifu2x(EnginePlan),
    /// realesr-animevideov3 at this native scale.
    Esrgan(u32),
}

/// Links (or copies) a frame: look-ahead frames stay in place for the next block.
fn link_or_copy(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::hard_link(src, dst).or_else(|_| std::fs::copy(src, dst).map(|_| ()))
}

/// Writes `src` (JPEG or PNG) as the PNG `dst`.
fn copy_as_png(src: &Path, dst: &Path) -> AppResult<()> {
    if src.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        let _ = std::fs::remove_file(dst);
        std::fs::copy(src, dst)?;
        return Ok(());
    }
    let img = image::open(src).map_err(|e| AppError::new(ErrorCode::DecodeFailed, format!("{}: {e}", src.display())))?;
    img.save(dst).map_err(|e| AppError::new(ErrorCode::EncodeFailed, format!("{}: {e}", dst.display())))
}

/// Scene change score above which two frames belong to different shots.
const CUT_SCORE: f64 = 0.32;

/// Indices (0-based) of the frames starting a new shot, from FFmpeg's
/// `metadata=print` output of the scene branch (one score per frame, whose
/// pts_time is the frame index).
fn parse_cuts(text: &str) -> std::collections::HashSet<usize> {
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
) -> AppResult<(u64, f64, CompressReport)> {
    let info = spec.info;
    let a = spec.anim;
    let target = target_dims(info, a.scale, MediaKind::Video);
    let anime = a.style != crate::settings::Style::Photo;
    let mut engine_ms = 0;
    let mut work_mp = 0.0;

    // Frame rate and motion blur. RIFE makes the frames above the source rate
    // and the sub-frames motion blur is averaged from.
    let target_fps = changes_fps(a, info.fps);
    let wants_smooth = a.smooth != SmoothMotion::Off && target_fps.is_some_and(|f| f as f64 > info.fps + 0.01);
    let shutter = spec.rife.and(blur_shutter(a.motion_blur));
    let motion = match spec.rife {
        Some(_) if wants_smooth || shutter.is_some() => {
            let rife_target = if wants_smooth { target_fps } else { None };
            match smooth::plan_rate(&info.fps_rational, rife_target, shutter.map(|s| s.0).unwrap_or(1)) {
                Some(plan) => {
                    let level = if a.smooth == SmoothMotion::Off { SmoothMotion::Medium } else { a.smooth };
                    let choice = smooth::choose_model(level, anime, spec.vram_bytes, target.width as u64 * target.height as u64);
                    Motion::Smooth { plan, choice }
                }
                None => Motion::Filters,
            }
        }
        None if wants_smooth => {
            on_log("Smooth Motion engine missing: using FFmpeg motion interpolation".into());
            Motion::Filters
        }
        _ => Motion::Filters,
    };
    let smoothing = matches!(motion, Motion::Smooth { .. });

    // Clean-up: Real-ESRGAN's anime video model for anime, waifu2x otherwise.
    let eparams = engine_params(a, spec.params);
    let cleanup = match &eparams {
        Some(_) if anime && spec.esrgan.is_some() => Some(Cleanup::Esrgan(crate::esrgan::native_scale(a.scale))),
        Some(p) => Some(Cleanup::Waifu2x(engine_plan(engine, p)?)),
        None => None,
    };
    let frames_path = cleanup.is_some() || smoothing;

    // Dynamic range. Clean-up and Smooth Motion work on 8-bit images, so an HDR
    // source going through them is tone mapped first.
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

    let final_start;
    // (video input args, index of the input carrying the original audio, resize still needed, rate after this stage)
    let (video_input, audio_input, resize_to, stage_fps): (Vec<OsString>, usize, Option<Resize>, f64) = if frames_path {
        let frames_dir = work.join("frames");
        let done_marker = work.join("frames.done");
        let cuts_file = work.join("cuts.txt");
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
                let mut vf = vec![format!("fps={}", info.fps_rational)];
                if src_hdr {
                    if placebo {
                        args.extend(vulkan_device(spec.params.gpu));
                        vf.extend(color::placebo_to_sdr());
                    } else {
                        let plan = ColorPlan { input: info.transfer, output: Transfer::Sdr, look: Default::default() };
                        vf.extend(color::prepare(&plan, work, "tonemap", &info.color_matrix)?.unwrap_or_default());
                    }
                }
                args.push("-i".into());
                args.push(spec.source.into());
                // Scene cuts come from the same decode (pts = frame index).
                let graph = if smoothing {
                    format!(
                        "[0:v]{},split[f][s];[s]setpts=N/TB,scale=160:-2,select='gte(scene\\,0)',metadata=print:key=lavfi.scene_score:file='{}'[c]",
                        vf.join(","),
                        color::escape_filter_path(&cuts_file)
                    )
                } else {
                    format!("[0:v]{}[f]", vf.join(","))
                };
                args.extend(os(&["-filter_complex", &graph, "-map", "[f]", "-q:v", "2"]));
                args.push(frames_dir.join("%08d.jpg").into());
                if smoothing {
                    args.extend(os(&["-map", "[c]", "-f", "null", "-"]));
                }
                ff_timed(ff, &args, info.duration_ms, Phase { start: 0.0, span: 0.06 }, on_progress, on_log, cancel).await?;
                let n = count_files(&frames_dir) as usize;
                if n == 0 {
                    return Err(AppError::new(ErrorCode::DecodeFailed, format!("no frames decoded from {}", spec.source.display())));
                }
                std::fs::write(&done_marker, n.to_string())?;
                n
            }
        };
        let cuts = std::fs::read_to_string(&cuts_file).map(|t| parse_cuts(&t)).unwrap_or_default();
        if smoothing {
            on_log(format!("{} scene cut(s): no interpolation across them", cuts.len()));
        }
        let frame_path = |i: usize| frames_dir.join(format!("{:08}.jpg", i + 1));

        let es = match cleanup {
            Some(Cleanup::Esrgan(s)) => s as u64,
            Some(Cleanup::Waifu2x(p)) => p.engine_scale as u64,
            None => 1,
        };
        let frame_bytes = (info.width as u64 * es) * (info.height as u64 * es) * 4;
        let block = (crate::tuning::block_bytes() / frame_bytes.max(1)).clamp(8, 240) as usize;
        let blocks: Vec<smooth::Block> = match &motion {
            Motion::Smooth { plan, .. } => smooth::plan_blocks(n, plan.ratio, block, plan.sub),
            Motion::Filters => (0..n)
                .step_by(block)
                .map(|start| {
                    let own = block.min(n - start);
                    smooth::Block { start, own, inputs: own, padded: own, write: own, keep: own }
                })
                .collect(),
        };
        let (seg_rate, out_rate, stage_fps) = match &motion {
            Motion::Smooth { plan, .. } => (plan.rate.clone(), plan.out_rate.clone(), plan.fps),
            Motion::Filters => (info.fps_rational.clone(), info.fps_rational.clone(), info.fps),
        };
        if let Motion::Smooth { plan, choice } = &motion {
            on_log(format!(
                "Smooth Motion: {} ×{}/{} -> {} fps rendered, {} fps out{}",
                choice.model,
                plan.ratio.p,
                plan.ratio.q,
                plan.rate,
                plan.out_rate,
                if plan.sub > 1 { format!(", motion blur from {} sub-frames", plan.sub) } else { String::new() }
            ));
        }
        match cleanup {
            Some(Cleanup::Esrgan(s)) => on_log(format!("Clean-up: {} x{s}", crate::esrgan::MODEL)),
            Some(Cleanup::Waifu2x(_)) => on_log("Clean-up: waifu2x".into()),
            None => {}
        }
        on_log(format!("{n} frames, {} block(s)", blocks.len()));
        let needs_resize = matches!(cleanup, Some(Cleanup::Waifu2x(p)) if p.needs_resize) || target.width != info.width * es as u32 || target.height != info.height * es as u32;

        // Progress counts source frames per stage; interpolation weighs a little less than Clean-up.
        let w_engine = if cleanup.is_some() { 1.0 } else { 0.0 };
        let w_smooth = match &motion {
            Motion::Smooth { plan, .. } => 0.5 * (plan.ratio.p as f64 / plan.ratio.q as f64 / 2.5).max(1.0),
            Motion::Filters => 0.0,
        };
        let total_units = (n as f64 * (w_engine + w_smooth)).max(1e-9);
        let units_done = std::sync::Mutex::new(0.0f64);
        let report = |weight: f64, frames_in_block: f64, src_done: u64| {
            let u = *units_done.lock().unwrap() + frames_in_block * weight;
            on_progress(0.06 + 0.74 * (u / total_units).min(1.0) as f32, Some(ProgressDetail::Frames { done: src_done.min(n as u64), total: n as u64 }));
        };

        // An interrupted block had moved its frames out: put them back first.
        if let Ok(entries) = std::fs::read_dir(work.join("block_in")) {
            for e in entries.flatten() {
                let name = e.file_name();
                let index = name.to_string_lossy().split('.').next().and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
                let back = frames_dir.join(&name);
                if (1..=n).contains(&index) && !back.exists() {
                    std::fs::rename(e.path(), back)?;
                }
            }
        }
        let mut segments = String::new();
        let mut resumed = 0;
        for (bi, b) in blocks.iter().enumerate() {
            check(cancel)?;
            let seg = work.join(format!("seg_{bi:05}.mkv"));
            segments.push_str(&format!("file '{}'\n", seg.file_name().unwrap_or_default().to_string_lossy()));
            if seg.is_file() {
                // Finished by an interrupted run.
                resumed += 1;
                *units_done.lock().unwrap() += b.own as f64 * (w_engine + w_smooth);
                continue;
            }
            if resumed > 0 && bi == resumed {
                on_log(format!("resuming: {resumed} of {} blocks already done", blocks.len()));
            }
            let in_dir = work.join("block_in");
            let up_dir = work.join("block_up");
            let mid_dir = work.join("block_mid");
            for d in [&in_dir, &up_dir, &mid_dir] {
                let _ = std::fs::remove_dir_all(d);
            }
            std::fs::create_dir_all(&in_dir)?;
            for i in b.start..b.start + b.inputs {
                let (src, dst) = (frame_path(i), in_dir.join(format!("{:08}.jpg", i + 1)));
                if i < b.start + b.own {
                    std::fs::rename(&src, &dst)?;
                } else {
                    link_or_copy(&src, &dst)?;
                }
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
                                expect_outputs: Some(b.inputs),
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
                                expect_outputs: b.inputs,
                            };
                            spec.esrgan.expect("checked").run(&job, &events, cancel).await?;
                            let ms = started.lock().unwrap().map(|t| t.elapsed().as_millis() as u64).unwrap_or(0);
                            Ok(ms)
                        }
                    }
                };
                engine_ms += with_frame_poll(fut, &up_dir, |w| {
                    let own = (w as usize).min(b.own) as f64;
                    report(w_engine, own, b.start as u64 + own as u64);
                })
                .await?;
                *units_done.lock().unwrap() += b.own as f64 * w_engine;
                current = up_dir.clone();
                ext = "png";
            }

            let (seg_input, seg_start, keep) = match &motion {
                Motion::Smooth { plan, choice } => {
                    on_stage(Stage::Interpolating);
                    // Pad with the last frame so RIFE's grid lines up (see smooth.rs).
                    let last = current.join(format!("{:08}.{ext}", b.start + b.inputs));
                    for k in b.inputs..b.padded {
                        link_or_copy(&last, &current.join(format!("{:08}.{ext}", b.start + k + 1)))?;
                    }
                    let rife = spec.rife.expect("checked when planning");
                    let fut = async {
                        rife.interpolate(&current, &mid_dir, b.write, *choice, spec.params.gpu, spec.params.threads, on_log, cancel).await?;
                        Ok(0u64)
                    };
                    with_frame_poll(fut, &mid_dir, |w| {
                        let done = (w as f64 / b.write.max(1) as f64).min(1.0) * b.own as f64;
                        report(w_smooth, done, b.start as u64 + done as u64);
                    })
                    .await?;
                    // Never morph one shot into the next: repeat the nearest real frame.
                    for i in 0..b.keep.min(b.write) {
                        if let Some(src) = smooth::hold_at_cut(i, plan.ratio, b.start, &|f| cuts.contains(&f)) {
                            copy_as_png(&current.join(format!("{:08}.{ext}", src + 1)), &mid_dir.join(format!("{:08}.png", i + 1)))?;
                        }
                    }
                    *units_done.lock().unwrap() += b.own as f64 * w_smooth;
                    (mid_dir.join("%08d.png"), 1u64, b.keep)
                }
                Motion::Filters => (current.join(format!("%08d.{ext}")), b.start as u64 + 1, b.own),
            };

            let part = work.join(format!("seg_{bi:05}.part.mkv"));
            let mut args = os(&["-framerate", &seg_rate, "-start_number", &seg_start.to_string(), "-i"]);
            args.push(seg_input.into());
            let mut vf = Vec::new();
            let mut out_frames = keep;
            if let (Motion::Smooth { plan, .. }, Some((m, k))) = (&motion, shutter) {
                if plan.sub > 1 {
                    // Shutter: average k sub-frames, keep one frame per output frame.
                    let m = plan.sub.min(m);
                    let k = k.min(m + 1).max(2);
                    vf.push(format!("tmix=frames={k}:weights='{}'", vec!["1"; k as usize].join(" ")));
                    vf.push(format!("select='eq(mod(n\\,{m})\\,{})'", k - 1));
                    vf.push(format!("setpts=N/({out_rate})/TB"));
                    out_frames = keep / m as usize;
                }
            }
            if needs_resize {
                vf.push(format!("scale={}:{}:flags=lanczos", target.width, target.height));
            }
            // Frames are RGB: convert with the HD matrix and tag it.
            vf.push("scale=out_color_matrix=bt709:out_range=tv".into());
            vf.push("format=yuv420p".into());
            args.extend(os(&["-vf", &vf.join(","), "-frames:v", &out_frames.to_string(), "-r", &out_rate]));
            args.extend(os(&["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]));
            args.extend(intermediate_codec(spec.encoder));
            args.push(part.clone().into());
            ff.run(&args, cancel, &|_| {}, on_log).await?;
            std::fs::rename(&part, &seg)?;
            for d in [&in_dir, &up_dir, &mid_dir] {
                let _ = std::fs::remove_dir_all(d);
            }
        }
        if let (Some(Cleanup::Waifu2x(ep)), Some(p)) = (cleanup, &eparams) {
            work_mp = n as f64 * crate::engine::plan::work_megapixels(Dimensions { width: info.width, height: info.height }, &ep, p.tta);
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
        (input, 1, None, stage_fps)
    } else {
        final_start = 0.0;
        let mut input = Vec::new();
        if placebo {
            input.extend(vulkan_device(spec.params.gpu));
        }
        input.push("-i".into());
        input.push(spec.source.into());
        let same = target.width == info.width && target.height == info.height;
        (input, 0, (!same).then_some(Resize::Exact(target)), info.fps)
    };

    on_stage(Stage::Encoding);
    let sub_blur = matches!(&motion, Motion::Smooth { plan, .. } if plan.sub > 1);
    let after = AnimSettings {
        // The rate is already reached by RIFE: no FFmpeg retiming on top.
        fps: if smoothing && wants_smooth { None } else { a.fps },
        fps_mode: if !smoothing && wants_smooth { FpsMode::Interpolate } else { FpsMode::Retime },
        // Motion blur already rendered from sub-frames.
        motion_blur: if sub_blur { 0 } else { a.motion_blur },
        ..a.clone()
    };
    // Temporal stabilisation after Clean-up: settles shimmering detail where
    // nothing moves (measured -38 % flicker on anime, docs/VIDEO_ENGINE.md).
    let mut filters: Vec<String> = Vec::new();
    if cleanup.is_some() {
        let per_src = (stage_fps / info.fps).round().max(1.0) as u32;
        let window = (5 * per_src).min(15) | 1;
        let (ta, tb) = if a.enhance == Enhance::Strong { (0.04, 0.08) } else { (0.02, 0.04) };
        filters.push(format!("atadenoise=0a={ta}:0b={tb}:1a={ta}:1b={tb}:2a={ta}:2b={tb}:s={window}"));
    }
    filters.extend(post_filters(&after, stage_fps, resize_to));
    let input_transfer = if frames_path || placebo { Transfer::Sdr } else { info.transfer };
    if placebo && !frames_path {
        filters.extend(color::placebo_to_sdr());
    }
    let matrix = if frames_path || placebo { "bt709" } else { info.color_matrix.as_str() };
    let plan = ColorPlan { input: input_transfer, output: output_transfer, look: a.look };
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
        audio_input: info.has_audio.then_some(audio_input),
        audio_codec: info.audio_codec.as_deref(),
        vf: &filters.join(","),
        duration_ms: info.duration_ms,
        compress: spec.compress,
        encoder: spec.encoder,
        work,
        dest: tmp_dest,
        hdr: output_transfer.is_hdr().then_some(output_transfer),
    };
    let report = encode_mp4(ff, &mp4, final_start, on_progress, on_log, cancel).await?;
    Ok((engine_ms, work_mp, report))
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
