//! Processing queue: jobs, their lifecycle, and the single worker that feeds
//! the GPU one image at a time (waifu2x already saturates the device).

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::anim::{self, AnimSpec};
use crate::convert::{self, Conversion, ConvertSpec};
use crate::compress::CompressReport;
use crate::core::Core;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fsutil::{extension_lower, file_name, now_ms};
use crate::history::HistoryEntry;
use crate::imaging::{self, ImageInfo, PREVIEW_PROXY_MAX_SIDE, PREVIEW_PROXY_THRESHOLD_MP, THUMB_MAX_SIDE};
use crate::media::{kind_of, Ffmpeg, HwEncoder, MediaInfo, MediaKind};
use crate::pipeline::{self, CompressPlan, JobSpec, ProgressDetail, Stage};
use crate::settings::{
    engine_scale_for, AnimSettings, CompressSettings, ConvertSettings, DiscordTarget, ImageAction, OutputOptions, Settings, UpscaleParams, VideoEncoder,
};

const MAX_LOG_LINES: usize = 1000;
const INIT_ESTIMATE_MS: u64 = 1200;
const ENCODE_MP_PER_SEC: f64 = 25.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    /// Added, waiting for the user to start.
    Idle,
    Waiting,
    Processing,
    Completed,
    Failed,
    Cancelled,
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFile {
    pub path: PathBuf,
    pub name: String,
    pub kind: MediaKind,
    pub info: ImageInfo,
    /// Frames, frame rate, duration... for GIFs and clips.
    pub media: Option<MediaInfo>,
    pub thumb: Option<PathBuf>,
    /// Image: downscaled rendition of a very large image. Clip: H.264 copy for
    /// formats the viewer cannot play. None = display the original.
    pub preview: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub output_path: PathBuf,
    pub info: ImageInfo,
    pub duration_ms: u64,
    pub preview: Option<PathBuf>,
    pub compression: Option<CompressReport>,
    pub media: Option<MediaInfo>,
    /// Notes on the result (e.g. "beatNotFound"), translated by the UI.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub notices: Vec<String>,
    /// Speed changes: (result time, original time) pairs for the comparison viewer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timing: Option<Vec<[f64; 2]>>,
}

/// Which section a file was added from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Purpose {
    /// Image & GIF / Clip workspaces.
    #[default]
    Process,
    Convert,
}

/// A queued conversion.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertTask {
    pub conversion: Conversion,
    pub settings: ConvertSettings,
    /// Images -> GIF: all images, in order.
    pub images: Vec<PathBuf>,
}

/// Everything besides the engine parameters that a job was queued with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSettings {
    pub action: ImageAction,
    pub compress: CompressSettings,
    /// Quality / limit applied to a still image (None = plain encode).
    pub compress_plan: Option<CompressPlan>,
    pub anim: Option<AnimSettings>,
    pub encoder: Option<HwEncoder>,
    /// Prepared for this Discord slot.
    pub discord: Option<DiscordTarget>,
    pub convert: Option<ConvertTask>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub purpose: Purpose,
    pub source: SourceFile,
    /// Frozen when the job is queued.
    pub params: Option<UpscaleParams>,
    pub output: Option<OutputOptions>,
    pub task: Option<TaskSettings>,
    pub status: JobStatus,
    pub stage: Option<Stage>,
    pub progress: f32,
    pub estimated_ms: Option<u64>,
    pub estimate_measured: bool,
    pub added_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub result: Option<JobResult>,
    pub skipped_path: Option<PathBuf>,
    pub error: Option<AppError>,
}

#[derive(Default)]
struct BatchCounter {
    active: bool,
    completed: u32,
    failed: u32,
    skipped: u32,
    cancelled: u32,
    last_output: Option<PathBuf>,
}

#[derive(Default)]
pub struct QueueState {
    jobs: Vec<Job>,
    logs: HashMap<String, Vec<String>>,
    paused: bool,
    current: Option<(String, CancellationToken)>,
    batch: BatchCounter,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub jobs: Vec<Job>,
    pub paused: bool,
    pub active_job: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub id: String,
    pub stage: Stage,
    pub progress: f32,
    pub elapsed_ms: u64,
    pub remaining_ms: Option<u64>,
    pub queue_remaining_ms: Option<u64>,
    pub measured: bool,
    /// Frames or media time actually processed (GIFs, clips).
    pub detail: Option<ProgressDetail>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub completed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub cancelled: u32,
    pub last_output: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rejected {
    pub path: PathBuf,
    pub error: AppError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddResult {
    pub added: Vec<String>,
    pub rejected: Vec<Rejected>,
}

#[derive(Debug, Clone)]
pub enum QueueEvent {
    Updated(QueueSnapshot),
    Progress(ProgressEvent),
    Log { id: String, line: String },
    BatchFinished(BatchSummary),
}

/// Smooth progress inside a stage: linear up to 85% of the estimate, then an
/// asymptote, so a pessimistic estimate never shows 100% before the end.
fn soft(x: f64) -> f64 {
    if x < 0.85 {
        x.max(0.0)
    } else {
        0.85 + 0.15 * (1.0 - (-(x - 0.85) * 4.0).exp())
    }
}

fn stage_progress(stage: Stage, stage_ms: u64, engine_est: u64, encode_est: u64) -> f32 {
    let t = stage_ms as f64;
    let p = match stage {
        Stage::Preparing | Stage::Extracting => 0.02 * soft(t / 400.0),
        Stage::Initializing => 0.02 + 0.04 * soft(t / INIT_ESTIMATE_MS as f64),
        Stage::Upscaling | Stage::Interpolating => 0.06 + 0.86 * soft(t / engine_est.max(1) as f64),
        Stage::Encoding => 0.92 + 0.08 * soft(t / encode_est.max(1) as f64),
    };
    p.clamp(0.0, 0.999) as f32
}

fn encode_estimate_ms(target_mp: f64, needs_work: bool) -> u64 {
    if needs_work {
        (target_mp / ENCODE_MP_PER_SEC * 1000.0) as u64 + 100
    } else {
        50
    }
}

fn cache_key(path: &Path, info: &ImageInfo) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    info.size_bytes.hash(&mut h);
    std::fs::metadata(path).and_then(|m| m.modified()).ok().hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Expands dropped folders (one level) and keeps supported image files.
pub fn expand_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in paths {
        if p.is_dir() {
            let mut files: Vec<PathBuf> = std::fs::read_dir(&p)
                .map(|it| it.flatten().map(|e| e.path()).filter(|f| f.is_file() && kind_of(f).is_some()).collect())
                .unwrap_or_default();
            files.sort();
            out.extend(files);
        } else {
            out.push(p);
        }
    }
    out
}

fn new_job(source: SourceFile, purpose: Purpose) -> Job {
    Job {
        id: uuid::Uuid::new_v4().simple().to_string(),
        purpose,
        source,
        params: None,
        output: None,
        task: None,
        status: JobStatus::Idle,
        stage: None,
        progress: 0.0,
        estimated_ms: None,
        estimate_measured: false,
        added_at: now_ms(),
        started_at: None,
        finished_at: None,
        result: None,
        skipped_path: None,
        error: None,
    }
}

/// Rough duration of an FFmpeg pass over a clip / GIF, for the queue ETA only.
fn ffmpeg_estimate_ms(media: &MediaInfo, anim: &AnimSettings) -> u64 {
    let heavy = anim.fps.is_some() && anim.fps_mode == crate::settings::FpsMode::Interpolate;
    let mp = media.width as f64 * media.height as f64 / 1e6;
    let per_s = if heavy { 4.0 } else { 0.4 } * mp.max(0.2);
    1000 + (media.duration_ms as f64 * per_s) as u64
}

/// Engine parameters, task, estimated ms and whether the estimate is measured.
type Frozen = (UpscaleParams, TaskSettings, u64, bool);

struct Next {
    id: String,
    source: SourceFile,
    params: UpscaleParams,
    output: OutputOptions,
    task: TaskSettings,
    estimate_ms: u64,
    token: CancellationToken,
}

impl QueueState {
    fn job_mut(&mut self, id: &str) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|j| j.id == id)
    }

    fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot { jobs: self.jobs.clone(), paused: self.paused, active_job: self.current.as_ref().map(|c| c.0.clone()) }
    }

    fn remaining_waiting_ms(&self) -> u64 {
        self.jobs.iter().filter(|j| j.status == JobStatus::Waiting).filter_map(|j| j.estimated_ms).sum()
    }
}

impl Core {
    fn emit_snapshot(&self) {
        let snapshot = self.queue.lock().unwrap().snapshot();
        self.hooks.emit(QueueEvent::Updated(snapshot));
    }

    pub fn queue_snapshot(&self) -> QueueSnapshot {
        self.queue.lock().unwrap().snapshot()
    }

    pub fn job_log(&self, id: &str) -> Vec<String> {
        self.queue.lock().unwrap().logs.get(id).cloned().unwrap_or_default()
    }

    /// Adds images as Idle jobs. Blocking (reads headers): call from a blocking context.
    pub fn add_files(self: &Arc<Self>, paths: Vec<PathBuf>) -> AddResult {
        self.add_files_for(paths, Purpose::Process)
    }

    /// Adds files for a section. Blocking (reads headers): call from a blocking context.
    pub fn add_files_for(self: &Arc<Self>, paths: Vec<PathBuf>, purpose: Purpose) -> AddResult {
        let mut added = Vec::new();
        let mut rejected = Vec::new();
        let mut new_jobs = Vec::new();
        for path in expand_paths(paths) {
            let path = path.canonicalize().map(strip_unc).unwrap_or(path);
            let duplicate = self
                .queue
                .lock()
                .unwrap()
                .jobs
                .iter()
                .any(|j| j.source.path == path && j.purpose == purpose && matches!(j.status, JobStatus::Idle | JobStatus::Waiting));
            if duplicate {
                continue;
            }
            match self.probe_source(&path) {
                Ok((kind, info, media)) => {
                    self.hooks.allow_file(&path);
                    let job = new_job(SourceFile { name: file_name(&path), path, kind, info, media, thumb: None, preview: None }, purpose);
                    added.push(job.id.clone());
                    new_jobs.push(job);
                }
                Err(error) => {
                    log::warn!("rejected {}: {}", path.display(), error);
                    rejected.push(Rejected { path, error });
                }
            }
        }
        if !new_jobs.is_empty() {
            let sources: Vec<(String, SourceFile)> = new_jobs.iter().map(|j| (j.id.clone(), j.source.clone())).collect();
            self.queue.lock().unwrap().jobs.extend(new_jobs);
            for (id, source) in sources {
                self.spawn_source_previews(id, source);
            }
            self.emit_snapshot();
        }
        AddResult { added, rejected }
    }

    /// Kind, display info and (for GIFs / clips) media facts of a file.
    fn probe_source(&self, path: &Path) -> AppResult<(MediaKind, ImageInfo, Option<MediaInfo>)> {
        let kind = kind_of(path).ok_or_else(|| AppError::new(ErrorCode::UnsupportedFormat, path.display().to_string()))?;
        if kind == MediaKind::Image {
            return Ok((kind, imaging::probe(path)?, None));
        }
        let media = self.ffmpeg.probe(path, kind)?;
        let info = ImageInfo {
            width: media.width,
            height: media.height,
            size_bytes: media.size_bytes,
            format: extension_lower(path).to_ascii_uppercase(),
        };
        Ok((kind, info, Some(media)))
    }

    fn spawn_source_previews(self: &Arc<Self>, id: String, source: SourceFile) {
        let core = self.clone();
        tokio::spawn(async move {
            let Ok(_permit) = core.preview_slots.acquire().await else { return };
            let c = core.clone();
            let made = tokio::task::spawn_blocking(move || match source.kind {
                MediaKind::Image => c.make_previews(&source.path, &source.info, true),
                _ => c.make_media_previews(&source),
            })
            .await;
            if let Ok((thumb, preview)) = made {
                if let Some(job) = core.queue.lock().unwrap().job_mut(&id) {
                    job.source.thumb = thumb;
                    job.source.preview = preview;
                }
                core.emit_snapshot();
            }
        });
    }

    /// Returns (thumbnail, proxy). Errors are logged: previews are a convenience.
    fn make_previews(&self, path: &Path, info: &ImageInfo, with_thumb: bool) -> (Option<PathBuf>, Option<PathBuf>) {
        let key = cache_key(path, info);
        let dir = self.paths.thumbs_dir();
        let render = |suffix: &str, side: u32| -> Option<PathBuf> {
            let dest = dir.join(format!("{key}{suffix}.webp"));
            if !dest.is_file() {
                if let Err(e) = imaging::write_preview(path, side, &dest) {
                    log::warn!("preview failed for {}: {e}", path.display());
                    return None;
                }
            }
            self.hooks.allow_file(&dest);
            Some(dest)
        };
        let thumb = if with_thumb { render("_t", THUMB_MAX_SIDE) } else { None };
        let proxy = if info.dims().megapixels() > PREVIEW_PROXY_THRESHOLD_MP { render("_p", PREVIEW_PROXY_MAX_SIDE) } else { None };
        (thumb, proxy)
    }

    /// Thumbnail from a frame grab; for clips the webview cannot play, an H.264 preview copy.
    fn make_media_previews(&self, source: &SourceFile) -> (Option<PathBuf>, Option<PathBuf>) {
        let Some(media) = &source.media else { return (None, None) };
        let key = cache_key(&source.path, &source.info);
        let dir = self.paths.thumbs_dir();
        let thumb = dir.join(format!("{key}_t.webp"));
        if !thumb.is_file() {
            let frame = dir.join(format!("{key}_f.png"));
            let at = if source.kind == MediaKind::Video { media.duration_ms / 10 } else { 0 };
            let made = self.ffmpeg.grab_frame(&source.path, at, THUMB_MAX_SIDE, &frame).and_then(|_| imaging::write_preview(&frame, THUMB_MAX_SIDE, &thumb));
            let _ = std::fs::remove_file(&frame);
            if let Err(e) = made {
                log::warn!("thumbnail failed for {}: {e}", source.path.display());
            }
        }
        let thumb = thumb.is_file().then(|| {
            self.hooks.allow_file(&thumb);
            thumb
        });
        // Very large clips also get the light copy: comparing means decoding two
        // videos at once. Until it is ready, the original itself plays.
        let (limit, height) = self.clip_preview_size();
        let heavy = media.width as u64 * media.height as u64 > limit;
        let proxy = (source.kind == MediaKind::Video && (!media.playable || heavy)).then(|| {
            let dest = dir.join(format!("{key}_p{height}.mp4"));
            if !dest.is_file() {
                if let Err(e) = self.ffmpeg.preview_copy(&source.path, &dest, media.transfer, &media.color_matrix, height) {
                    log::warn!("preview copy failed for {}: {e}", source.path.display());
                    return None;
                }
            }
            self.hooks.allow_file(&dest);
            Some(dest)
        });
        (thumb, proxy.flatten())
    }

    /// (pixels above which a clip plays through a light copy, height of that copy).
    /// Modest GPUs get a smaller copy sooner.
    fn clip_preview_size(&self) -> (u64, u32) {
        let lite = self.profile.read().unwrap().as_ref().is_some_and(|p| p.gpu == crate::tuning::Tier::Low);
        if lite {
            (1920 * 1080, 720)
        } else {
            (2560 * 1440, 1080)
        }
    }

    /// Makes the light preview copy of a clip (or of its result) after the
    /// webview failed to play the file itself, then announces it.
    pub async fn repair_preview(self: &Arc<Self>, id: &str, result: bool) -> AppResult<()> {
        let job = self.queue.lock().unwrap().jobs.iter().find(|j| j.id == id).cloned().ok_or_else(|| AppError::new(ErrorCode::InvalidParams, "unknown job"))?;
        let (path, media) = match (&job.result, result) {
            (Some(r), true) => (r.output_path.clone(), r.media.clone()),
            (_, false) => (job.source.path.clone(), job.source.media.clone()),
            _ => return Err(AppError::new(ErrorCode::InvalidParams, "no result yet")),
        };
        let media = media.ok_or_else(|| AppError::new(ErrorCode::InvalidParams, "not a clip"))?;
        let (_, height) = self.clip_preview_size();
        let key = if result { format!("{id}_result_fix") } else { format!("{}_fix", cache_key(&job.source.path, &job.source.info)) };
        let dest = self.paths.thumbs_dir().join(format!("{key}{height}.mp4"));
        if !dest.is_file() {
            let _permit = self.preview_slots.acquire().await;
            let (ff, src, d) = (self.ffmpeg.dir().to_path_buf(), path.clone(), dest.clone());
            tokio::task::spawn_blocking(move || {
                let _ = std::fs::create_dir_all(d.parent().unwrap_or(Path::new(".")));
                Ffmpeg::new(ff).preview_copy(&src, &d, media.transfer, &media.color_matrix, height)
            })
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))??;
        }
        self.hooks.allow_file(&dest);
        if let Some(job) = self.queue.lock().unwrap().job_mut(id) {
            match (&mut job.result, result) {
                (Some(r), true) if r.output_path == path => r.preview = Some(dest),
                (_, false) => job.source.preview = Some(dest),
                _ => {}
            }
        }
        self.emit_snapshot();
        Ok(())
    }

    /// True once detection has run and found no usable Vulkan device.
    fn vulkan_missing(&self) -> bool {
        let v = self.vulkan.read().unwrap();
        !v.available && v.error.is_some()
    }

    /// Settings a job of this kind is queued with, validated, plus its estimate.
    fn freeze(&self, job: &Job, settings: &Settings) -> AppResult<Frozen> {
        let engine = self.engine();
        let perf = self.perf.lock().unwrap();
        let mut base = settings.upscale.clone();
        let tuning = self.tuning();
        base.tile_size = tuning.tile_size;
        base.threads = tuning.threads;
        if base.gpu.is_none() && self.vulkan_missing() {
            base.gpu = Some(-1);
        }
        if job.purpose == Purpose::Convert {
            if !self.ffmpeg.found() {
                return Err(AppError::new(ErrorCode::FfmpegMissing, self.ffmpeg.dir().display().to_string()));
            }
            let conversion = convert::conversion_for(job.source.kind, &settings.convert);
            let encoder = match settings.video_encoder {
                VideoEncoder::Auto => self.encoders.read().unwrap().first().copied(),
                VideoEncoder::Cpu => None,
            };
            let task = TaskSettings {
                action: ImageAction::Improve,
                compress: settings.convert.compress.clone(),
                compress_plan: None,
                anim: None,
                encoder,
                discord: None,
                convert: Some(ConvertTask { conversion, settings: settings.convert.clone(), images: vec![job.source.path.clone()] }),
            };
            let secs = job.source.media.as_ref().map(|m| m.duration_ms).unwrap_or(1000);
            return Ok((UpscaleParams { scale: 1.0, noise: -1, ..base }, task, 1000 + secs, false));
        }
        let discord = settings.discord.filter(|_| job.source.kind != MediaKind::Video);
        // Discord slot: enlarge with the engine only when the source is too small to cover it.
        let discord_scale = discord.map(|d| engine_scale_for(d.spec().cover_factor(job.source.info.width, job.source.info.height)));
        match job.source.kind {
            MediaKind::Image => {
                let action = match discord_scale {
                    Some(s) if s > 1.0 => ImageAction::Both,
                    Some(_) => ImageAction::Compress,
                    None => settings.image_action,
                };
                if let Some(s) = discord_scale {
                    base.scale = s.max(1.0);
                    if s > 1.0 && base.noise < 0 {
                        base.noise = 0;
                    }
                }
                let c = &settings.image_compress;
                let compress_plan = match action {
                    ImageAction::Improve => c.limit_bytes().map(|limit| CompressPlan { quality: settings.output.quality, limit: Some(limit) }),
                    _ => Some(CompressPlan { quality: c.quality(), limit: c.limit_bytes() }),
                };
                let task = TaskSettings { action, compress: c.clone(), compress_plan, anim: None, encoder: None, discord, convert: None };
                if action == ImageAction::Compress {
                    if discord.is_none() {
                        imaging::check_output_limits(settings.output.format, job.source.info.dims())?;
                    }
                    let mp = job.source.info.dims().megapixels();
                    return Ok((base, task, 300 + (mp * 150.0) as u64, false));
                }
                let prep = pipeline::prepare(engine.as_ref(), &job.source.info, &base, &settings.output)?;
                let (engine_ms, measured) = perf.estimate_ms(&base, prep.work_mp);
                let enc = encode_estimate_ms(prep.target.megapixels(), prep.plan.needs_resize || settings.output.format != crate::settings::OutputFormat::Png || compress_plan.is_some());
                Ok((base, task, INIT_ESTIMATE_MS + engine_ms + enc, measured))
            }
            kind => {
                if !self.ffmpeg.found() {
                    return Err(AppError::new(ErrorCode::FfmpegMissing, self.ffmpeg.dir().display().to_string()));
                }
                let media = job.source.media.as_ref().ok_or_else(|| AppError::new(ErrorCode::DecodeFailed, "no media info"))?;
                let (mut anim, compress) = if kind == MediaKind::Gif {
                    (settings.gif.clone(), settings.gif_compress.clone())
                } else {
                    (settings.clip.clone(), settings.clip_compress.clone())
                };
                if let Some(s) = discord_scale {
                    // Native engine scale when cleaning up, plain resize otherwise; the crop does the rest.
                    anim.scale = if anim.enhance.engine_noise().is_some() { s.max(1.0) } else { 1.0 };
                }
                let encoder = match (kind, settings.video_encoder) {
                    (MediaKind::Video, VideoEncoder::Auto) => self.encoders.read().unwrap().first().copied(),
                    _ => None,
                };
                let mut estimate = ffmpeg_estimate_ms(media, &anim);
                let mut measured = false;
                let params = match anim::engine_params(&anim, &base) {
                    Some(p) => {
                        let plan = anim::engine_plan(engine.as_ref(), &p)?;
                        let per_frame = crate::engine::plan::work_megapixels(job.source.info.dims(), &plan, p.tta);
                        let (ms, m) = perf.estimate_ms(&p, per_frame * media.frames as f64);
                        estimate += ms + INIT_ESTIMATE_MS;
                        measured = m;
                        p
                    }
                    None => UpscaleParams { style: anim.style, scale: anim.scale, noise: -1, ..base },
                };
                let target = if kind == MediaKind::Video { anim::clip_geometry(media, &anim).out } else { anim::target_dims(media, anim.scale, kind) };
                // Smooth Motion, Speed, motion blur sub-frames and the reframe analysis.
                if kind == MediaKind::Video {
                    estimate += anim::timing_estimate_ms(media, &anim, self.rife.found());
                }
                if kind == MediaKind::Gif {
                    imaging::check_output_limits(crate::settings::OutputFormat::Png, target)?;
                }
                Ok((
                    params,
                    TaskSettings { action: ImageAction::Improve, compress, compress_plan: None, anim: Some(anim), encoder, discord, convert: None },
                    estimate,
                    measured,
                ))
            }
        }
    }

    /// Queues Idle jobs (all of them, or `ids`) with the current settings.
    pub fn enqueue(&self, ids: Option<Vec<String>>) -> usize {
        let settings = self.settings();
        // Free memory changes over time: tune this run for what is free now.
        if self.vulkan_detected() {
            self.read_hardware();
        }
        let candidates: Vec<Job> = self
            .queue
            .lock()
            .unwrap()
            .jobs
            .iter()
            .filter(|j| j.status == JobStatus::Idle && ids.as_ref().is_none_or(|ids| ids.contains(&j.id)))
            .cloned()
            .collect();
        let frozen: Vec<(String, AppResult<Frozen>)> =
            candidates.iter().map(|j| (j.id.clone(), self.freeze(j, &settings))).collect();
        let mut count = 0;
        {
            let mut q = self.queue.lock().unwrap();
            for (id, result) in frozen {
                let Some(job) = q.job_mut(&id) else { continue };
                if job.status != JobStatus::Idle {
                    continue;
                }
                job.output = Some(settings.output.clone());
                job.error = None;
                match result {
                    Ok((params, task, estimate, measured)) => {
                        job.params = Some(params);
                        job.task = Some(task);
                        job.estimated_ms = Some(estimate);
                        job.estimate_measured = measured;
                        job.status = JobStatus::Waiting;
                        job.progress = 0.0;
                        count += 1;
                    }
                    Err(e) => {
                        job.status = JobStatus::Failed;
                        job.finished_at = Some(now_ms());
                        job.error = Some(e);
                    }
                }
            }
        }
        self.merge_convert_images();
        self.wake.notify_one();
        self.emit_snapshot();
        count
    }

    /// Images queued together in Convert become one animated GIF: the first job
    /// keeps all paths (in queue order), the others are removed.
    fn merge_convert_images(&self) {
        let mut q = self.queue.lock().unwrap();
        let waiting: Vec<usize> = q
            .jobs
            .iter()
            .enumerate()
            .filter(|(_, j)| j.purpose == Purpose::Convert && j.status == JobStatus::Waiting && j.source.kind == MediaKind::Image)
            .map(|(i, _)| i)
            .collect();
        if waiting.len() < 2 {
            return;
        }
        let paths: Vec<PathBuf> = waiting.iter().map(|&i| q.jobs[i].source.path.clone()).collect();
        let first = waiting[0];
        if let Some(c) = q.jobs[first].task.as_mut().and_then(|t| t.convert.as_mut()) {
            c.images = paths;
        }
        let drop: Vec<String> = waiting[1..].iter().map(|&i| q.jobs[i].id.clone()).collect();
        q.jobs.retain(|j| !drop.contains(&j.id));
    }

    pub fn cancel_job(&self, id: &str) {
        {
            let mut q = self.queue.lock().unwrap();
            if let Some((cur, token)) = &q.current {
                if cur == id {
                    token.cancel();
                }
            }
            if let Some(job) = q.job_mut(id) {
                if job.status == JobStatus::Waiting {
                    job.status = JobStatus::Cancelled;
                    job.finished_at = Some(now_ms());
                    q.batch.cancelled += 1;
                }
            }
        }
        self.emit_snapshot();
    }

    /// A job is running (an update must not stop it).
    pub fn is_processing(&self) -> bool {
        self.queue.lock().unwrap().current.is_some()
    }

    pub fn cancel_all(&self) {
        {
            let mut q = self.queue.lock().unwrap();
            let mut n = 0;
            for job in q.jobs.iter_mut().filter(|j| j.status == JobStatus::Waiting) {
                job.status = JobStatus::Cancelled;
                job.finished_at = Some(now_ms());
                n += 1;
            }
            q.batch.cancelled += n;
            if let Some((_, token)) = &q.current {
                token.cancel();
            }
        }
        self.emit_snapshot();
    }

    pub fn set_paused(&self, paused: bool) {
        self.queue.lock().unwrap().paused = paused;
        if !paused {
            self.wake.notify_one();
        }
        self.emit_snapshot();
    }

    /// Puts failed / cancelled / skipped jobs back in the queue with their original settings.
    pub fn retry(&self, ids: Option<Vec<String>>) {
        {
            let mut q = self.queue.lock().unwrap();
            for job in q.jobs.iter_mut() {
                let selected = ids.as_ref().is_none_or(|ids| ids.contains(&job.id));
                let retryable = matches!(job.status, JobStatus::Failed | JobStatus::Cancelled | JobStatus::Skipped);
                if selected && retryable {
                    // Jobs that failed validation never got params: re-validate with current settings.
                    job.status = if job.params.is_some() && job.task.is_some() && job.estimated_ms.is_some() { JobStatus::Waiting } else { JobStatus::Idle };
                    job.error = None;
                    job.progress = 0.0;
                    job.stage = None;
                    job.skipped_path = None;
                }
            }
        }
        let revalidate: Vec<String> = self
            .queue
            .lock()
            .unwrap()
            .jobs
            .iter()
            .filter(|j| j.status == JobStatus::Idle && ids.as_ref().is_none_or(|ids| ids.contains(&j.id)))
            .map(|j| j.id.clone())
            .collect();
        if !revalidate.is_empty() {
            self.enqueue(Some(revalidate));
        }
        self.wake.notify_one();
        self.emit_snapshot();
    }

    pub fn remove_jobs(&self, ids: &[String]) {
        {
            let mut q = self.queue.lock().unwrap();
            q.jobs.retain(|j| !(ids.contains(&j.id) && j.status != JobStatus::Processing));
            let alive: Vec<String> = q.jobs.iter().map(|j| j.id.clone()).collect();
            q.logs.retain(|id, _| alive.contains(id));
        }
        self.emit_snapshot();
    }

    pub fn clear_finished(&self) {
        {
            let mut q = self.queue.lock().unwrap();
            q.jobs.retain(|j| !matches!(j.status, JobStatus::Completed | JobStatus::Skipped | JobStatus::Cancelled));
        }
        self.emit_snapshot();
    }

    /// "Upscale again": a fresh Idle job for the same source.
    pub fn duplicate_job(&self, id: &str) -> Option<String> {
        let new_id = {
            let mut q = self.queue.lock().unwrap();
            let original = q.jobs.iter().find(|j| j.id == id)?;
            let job = new_job(original.source.clone(), original.purpose);
            let new_id = job.id.clone();
            q.jobs.push(job);
            new_id
        };
        self.emit_snapshot();
        Some(new_id)
    }

    fn take_next(&self) -> Option<Next> {
        let mut q = self.queue.lock().unwrap();
        if q.paused || q.current.is_some() {
            return None;
        }
        let job = q.jobs.iter_mut().find(|j| j.status == JobStatus::Waiting)?;
        job.status = JobStatus::Processing;
        job.started_at = Some(now_ms());
        job.stage = Some(Stage::Preparing);
        let token = CancellationToken::new();
        let next = Next {
            id: job.id.clone(),
            source: job.source.clone(),
            params: job.params.clone()?,
            output: job.output.clone()?,
            task: job.task.clone()?,
            estimate_ms: job.estimated_ms.unwrap_or(0),
            token: token.clone(),
        };
        q.current = Some((next.id.clone(), token));
        q.batch.active = true;
        Some(next)
    }

    fn finish_batch_if_idle(&self) {
        let summary = {
            let mut q = self.queue.lock().unwrap();
            let busy = q.current.is_some() || (!q.paused && q.jobs.iter().any(|j| j.status == JobStatus::Waiting));
            if busy || !q.batch.active {
                return;
            }
            let b = std::mem::take(&mut q.batch);
            BatchSummary { completed: b.completed, failed: b.failed, skipped: b.skipped, cancelled: b.cancelled, last_output: b.last_output }
        };
        log::info!("batch finished: {summary:?}");
        self.hooks.emit(QueueEvent::BatchFinished(summary));
    }

    fn push_log(&self, id: &str, line: String) {
        {
            let mut q = self.queue.lock().unwrap();
            let log = q.logs.entry(id.to_string()).or_default();
            if log.len() < MAX_LOG_LINES {
                log.push(line.clone());
            }
        }
        self.hooks.emit(QueueEvent::Log { id: id.to_string(), line });
    }

    async fn process(self: &Arc<Self>, next: Next) {
        let Next { id, source, params, output, task, estimate_ms, token: cancel } = next;
        self.emit_snapshot();
        log::info!("job {id}: {:?} {} {:?}", source.kind, source.path.display(), params);
        let started = Instant::now();
        let engine = self.engine();
        let settings = self.settings();

        let engine_est = estimate_ms.saturating_sub(INIT_ESTIMATE_MS).max(1);
        let tick = Arc::new(Mutex::new((Stage::Preparing, Instant::now())));
        // Pipelines that can measure their progress (GIFs, clips) report it here.
        let real = Arc::new(Mutex::new(None::<(f32, Option<ProgressDetail>)>));
        let measured = self.queue.lock().unwrap().jobs.iter().find(|j| j.id == id).map(|j| j.estimate_measured).unwrap_or(false);

        let ticker = {
            let (core, tick, real, id) = (self.clone(), tick.clone(), real.clone(), id.clone());
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
                loop {
                    interval.tick().await;
                    let (stage, since) = *tick.lock().unwrap();
                    let elapsed_ms = started.elapsed().as_millis() as u64;
                    let (progress, detail, remaining_ms, measured) = match *real.lock().unwrap() {
                        Some((p, detail)) => {
                            // Real progress: extrapolate the remaining time once it is meaningful.
                            let remaining = (p > 0.03 && elapsed_ms > 1500).then(|| (elapsed_ms as f64 * (1.0 - p as f64) / p as f64) as u64);
                            (p.min(0.999), detail, remaining, true)
                        }
                        None => {
                            let p = stage_progress(stage, since.elapsed().as_millis() as u64, engine_est, 400);
                            (p, None, estimate_ms.checked_sub(elapsed_ms).filter(|_| estimate_ms > 0), measured)
                        }
                    };
                    let queue_remaining_ms = {
                        let mut q = core.queue.lock().unwrap();
                        if let Some(job) = q.job_mut(&id) {
                            job.progress = progress;
                            job.stage = Some(stage);
                        }
                        remaining_ms.map(|r| r + q.remaining_waiting_ms())
                    };
                    core.hooks.emit(QueueEvent::Progress(ProgressEvent {
                        id: id.clone(),
                        stage,
                        progress,
                        elapsed_ms,
                        remaining_ms,
                        queue_remaining_ms,
                        measured,
                        detail,
                    }));
                }
            })
        };

        let on_stage = |stage: Stage| {
            *tick.lock().unwrap() = (stage, Instant::now());
        };
        let on_progress = |p: f32, detail: Option<ProgressDetail>| {
            *real.lock().unwrap() = Some((p, detail));
        };
        let on_log = |line: String| self.push_log(&id, line);
        // Pasted images live in the app cache: "next to the original" would hide
        // the result there, so they go to the user's Pictures\Aoze folder.
        let mut output = output;
        if output.directory.is_none() && source.path.starts_with(self.paths.pasted_dir()) {
            output.directory = Some(self.paths.fallback_output_dir.clone());
        }
        let fallback = self.paths.fallback_output_dir.clone();
        let work_dir = self.paths.work_dir();
        let luts_dir = crate::looks::dir(&self.paths.config_dir);
        let discord_target = task.discord.map(|d| (d.spec(), d.slug()));
        let result = match (&source.kind, &task.anim, &source.media) {
            _ if task.convert.is_some() => {
                let c = task.convert.as_ref().expect("checked");
                let spec = ConvertSpec {
                    conversion: c.conversion,
                    source: &source.path,
                    images: &c.images,
                    image_info: &source.info,
                    media: source.media.as_ref(),
                    settings: &c.settings,
                    output: &output,
                    encoder: task.encoder,
                    fallback_output_dir: &fallback,
                    work_dir: &work_dir,
                    keep_temp: settings.keep_temp_files,
                };
                convert::run(&self.ffmpeg, spec, &on_stage, &on_progress, &on_log, &cancel).await
            }
            (MediaKind::Image, _, _) | (_, None, _) | (_, _, None) => {
                let spec = JobSpec {
                    source: &source.path,
                    params: &params,
                    output: &output,
                    action: task.action,
                    compress: task.compress_plan,
                    fallback_output_dir: &fallback,
                    work_dir: &work_dir,
                    keep_temp: settings.keep_temp_files,
                    target: discord_target,
                };
                pipeline::run(engine.as_ref(), spec, &on_stage, &on_log, &cancel).await
            }
            (kind, Some(anim_settings), Some(media)) => {
                let spec = AnimSpec {
                    kind: *kind,
                    source: &source.path,
                    info: media,
                    anim: anim_settings,
                    params: &params,
                    compress: &task.compress,
                    output: &output,
                    encoder: task.encoder,
                    fallback_output_dir: &fallback,
                    work_dir: &work_dir,
                    keep_temp: settings.keep_temp_files,
                    target: discord_target,
                    rife: self.rife.found().then_some(&self.rife),
                    esrgan: self.esrgan.found().then_some(&self.esrgan),
                    vram_bytes: self.profile.read().unwrap().as_ref().map(|p| p.hardware.vram_bytes).unwrap_or(0),
                    luts_dir: Some(&luts_dir),
                };
                anim::run(engine.as_ref(), &self.ffmpeg, spec, &on_stage, &on_progress, &on_log, &cancel).await
            }
        };
        let duration_ms = started.elapsed().as_millis() as u64;
        // A huge result gets its display proxy before it is announced, so the
        // viewer never loads the full-resolution file just to show it fitted.
        let preview = match &result {
            Ok(o) if source.kind == MediaKind::Image => match &o.output_info {
                Some(info) if !o.skipped && info.dims().megapixels() > PREVIEW_PROXY_THRESHOLD_MP => {
                    let (c, path, info) = (self.clone(), o.output_path.clone(), info.clone());
                    let _permit = self.preview_slots.acquire().await;
                    tokio::task::spawn_blocking(move || c.make_previews(&path, &info, false).1).await.ok().flatten()
                }
                _ => None,
            },
            // HDR or HEVC results cannot play in the webview, and very large ones are
            // too heavy to decode next to the original: a light copy for the comparison.
            Ok(o) if !o.skipped => match &o.media {
                Some(m) if source.kind == MediaKind::Video && (!m.playable || m.width as u64 * m.height as u64 > self.clip_preview_size().0) => {
                    let (ff, path, m) = (self.ffmpeg.dir().to_path_buf(), o.output_path.clone(), m.clone());
                    let height = self.clip_preview_size().1;
                    let dest = self.paths.thumbs_dir().join(format!("{id}_result.mp4"));
                    let _permit = self.preview_slots.acquire().await;
                    let made = tokio::task::spawn_blocking(move || {
                        let _ = std::fs::create_dir_all(dest.parent().unwrap_or(Path::new(".")));
                        Ffmpeg::new(ff).preview_copy(&path, &dest, m.transfer, &m.color_matrix, height).map(|_| dest)
                    })
                    .await;
                    match made {
                        Ok(Ok(dest)) => {
                            self.hooks.allow_file(&dest);
                            Some(dest)
                        }
                        Ok(Err(e)) => {
                            log::warn!("result preview failed: {e}");
                            None
                        }
                        Err(_) => None,
                    }
                }
                _ => None,
            },
            _ => None,
        };
        ticker.abort();
        self.complete(&id, &source, &params, &output, duration_ms, result, preview);
    }

    #[allow(clippy::too_many_arguments)]
    fn complete(self: &Arc<Self>, id: &str, source: &SourceFile, params: &UpscaleParams, output: &OutputOptions, duration_ms: u64, result: AppResult<pipeline::JobOutcome>, preview: Option<PathBuf>) {
        let mut history_entry = None;
        {
            let mut q = self.queue.lock().unwrap();
            q.current = None;
            let Some(job) = q.jobs.iter_mut().find(|j| j.id == id) else { return };
            job.finished_at = Some(now_ms());
            job.stage = None;
            let status = match result {
                Ok(outcome) if outcome.skipped => {
                    job.skipped_path = Some(outcome.output_path);
                    JobStatus::Skipped
                }
                Ok(outcome) => {
                    let info = outcome.output_info.clone().expect("completed job has output info");
                    self.hooks.allow_file(&outcome.output_path);
                    self.perf.lock().unwrap().record(params, outcome.work_mp, outcome.engine_ms);
                    history_entry = Some(HistoryEntry {
                        id: uuid::Uuid::new_v4().simple().to_string(),
                        finished_at: now_ms(),
                        source_path: source.path.clone(),
                        kind: source.kind,
                        output_path: outcome.output_path.clone(),
                        source_width: job.source.info.width,
                        source_height: job.source.info.height,
                        source_bytes: job.source.info.size_bytes,
                        output_width: info.width,
                        output_height: info.height,
                        output_bytes: info.size_bytes,
                        duration_ms,
                        params: params.clone(),
                        format: output.format,
                    });
                    job.result = Some(JobResult {
                        output_path: outcome.output_path,
                        info,
                        duration_ms,
                        preview,
                        compression: outcome.compression,
                        media: outcome.media,
                        notices: outcome.notices,
                        timing: outcome.timing,
                    });
                    job.progress = 1.0;
                    JobStatus::Completed
                }
                Err(e) if e.is_cancelled() => JobStatus::Cancelled,
                Err(e) => {
                    log::error!("job {id} failed: {e}");
                    job.error = Some(e);
                    JobStatus::Failed
                }
            };
            job.status = status;
            let b = &mut q.batch;
            match status {
                JobStatus::Completed => {
                    b.completed += 1;
                    b.last_output = history_entry.as_ref().map(|h| h.output_path.clone());
                }
                JobStatus::Failed => b.failed += 1,
                JobStatus::Skipped => b.skipped += 1,
                JobStatus::Cancelled => b.cancelled += 1,
                _ => {}
            }
            log::info!("job {id}: {status:?} in {duration_ms} ms");
        }
        if let Some(entry) = history_entry {
            self.history.push(entry);
        }
        self.emit_snapshot();
    }
}

/// `\\?\C:\x` -> `C:\x` (canonicalize adds the verbatim prefix on Windows).
pub fn strip_unc(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p,
    }
}

pub async fn run_worker(core: Arc<Core>) {
    loop {
        match core.take_next() {
            Some(next) => core.process(next).await,
            None => {
                core.finish_batch_if_idle();
                core.wake.notified().await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_is_monotonic_and_bounded() {
        let mut last = 0.0;
        for stage in [Stage::Preparing, Stage::Initializing, Stage::Upscaling, Stage::Encoding] {
            for t in [0, 100, 1000, 5000, 60_000, 600_000] {
                let p = stage_progress(stage, t, 5000, 400);
                assert!(p >= last && p < 1.0, "{stage:?} {t} {p}");
                last = p;
            }
        }
    }

    #[test]
    fn unc_prefix_is_stripped() {
        assert_eq!(strip_unc(PathBuf::from(r"\\?\C:\a b\c.png")), PathBuf::from(r"C:\a b\c.png"));
        assert_eq!(strip_unc(PathBuf::from(r"\\?\UNC\srv\x")), PathBuf::from(r"\\?\UNC\srv\x"));
    }
}
