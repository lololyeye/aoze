//! One still image, end to end: validate -> plan -> prepare input -> engine ->
//! resize/encode (optionally to a size limit) -> atomic move.
//! Independent from Tauri so it can be exercised by integration tests.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::compress::{encode_to_limit, CompressReport, Request};
use crate::engine::plan::{final_dimensions, plan, work_megapixels, Dimensions, EnginePlan};
use crate::engine::{EngineEvent, EngineJob, UpscaleEngine};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fsutil::sibling_temp;
use crate::imaging::{self, ImageInfo};
use crate::media::MediaInfo;
use crate::output::{base_output_path, render_suffix, resolve_conflict, Resolved};
use crate::settings::{ImageAction, OutputFormat, OutputOptions, TargetSpec, UpscaleParams};

/// Tile size used for the automatic retry after a GPU failure.
pub const RETRY_TILE_SIZE: u32 = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Preparing,
    /// Decoding a GIF / clip into frames.
    Extracting,
    Initializing,
    Upscaling,
    /// Smooth Motion: making in-between frames.
    Interpolating,
    Encoding,
}

/// Real progress reported by pipelines that can measure it (frames, time).
/// Serialised as {type: "frames", done, total} / {type: "time", doneMs, totalMs}.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum ProgressDetail {
    Frames { done: u64, total: u64 },
    Time { done_ms: u64, total_ms: u64 },
}

pub type StageSink<'a> = &'a (dyn Fn(Stage) + Send + Sync);
pub type LogSink<'a> = &'a (dyn Fn(String) + Send + Sync);
/// Overall fraction 0..1 plus what it measures.
pub type ProgressSink<'a> = &'a (dyn Fn(f32, Option<ProgressDetail>) + Send + Sync);

/// Quality / size limit to apply when encoding the result.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressPlan {
    pub quality: u8,
    pub limit: Option<u64>,
}

pub struct JobSpec<'a> {
    pub source: &'a Path,
    pub params: &'a UpscaleParams,
    pub output: &'a OutputOptions,
    pub action: ImageAction,
    /// Some = encode with this quality / size limit (compression requested).
    pub compress: Option<CompressPlan>,
    /// Used when the source has no usable parent folder (e.g. pasted images).
    pub fallback_output_dir: &'a Path,
    pub work_dir: &'a Path,
    pub keep_temp: bool,
    /// Exact size for a Discord slot (cover + centred crop) and its file suffix.
    pub target: Option<(TargetSpec, &'static str)>,
}

/// How the final pixels reach the output size.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ImageFit {
    Exact(Dimensions),
    /// Scale to cover, then crop the centre.
    Cover(Dimensions),
}

#[derive(Debug, Clone)]
pub struct JobOutcome {
    pub output_path: PathBuf,
    pub output_info: Option<ImageInfo>,
    pub skipped: bool,
    pub work_mp: f64,
    /// Time spent inside the network (after device init), for throughput learning.
    pub engine_ms: u64,
    pub compression: Option<CompressReport>,
    /// Output facts for GIFs and clips.
    pub media: Option<MediaInfo>,
}

impl JobOutcome {
    pub fn skipped(path: PathBuf) -> Self {
        Self { output_path: path, output_info: None, skipped: true, work_mp: 0.0, engine_ms: 0, compression: None, media: None }
    }
}

/// What a job will do, computed before running it (for estimates and validation).
pub struct Prepared {
    pub plan: EnginePlan,
    pub target: Dimensions,
    pub work_mp: f64,
}

pub fn prepare(engine: &dyn UpscaleEngine, source: &ImageInfo, params: &UpscaleParams, output: &OutputOptions) -> AppResult<Prepared> {
    let caps = engine.capabilities(params.style);
    let plan = plan(params.scale, params.noise, &caps)?;
    let target = final_dimensions(source.dims(), params.scale);
    imaging::check_output_limits(output.format, target)?;
    Ok(Prepared { plan, target, work_mp: work_megapixels(source.dims(), &plan, params.tta) })
}

/// Removes the per-job work directory on every exit path.
pub struct WorkDir {
    pub path: PathBuf,
    keep: bool,
    /// Kept when the run does not finish, so the next run can resume.
    resumable: bool,
}

/// Prefix of work folders a later run may resume.
pub const RESUME_PREFIX: &str = "resume-";

impl WorkDir {
    pub fn create(parent: &Path, keep: bool) -> AppResult<Self> {
        let path = parent.join(uuid::Uuid::new_v4().simple().to_string());
        std::fs::create_dir_all(&path)?;
        Ok(Self { path, keep, resumable: false })
    }

    /// A folder named after `key`: an interrupted run leaves it for the next one.
    pub fn resumable(parent: &Path, key: &str, keep: bool) -> AppResult<Self> {
        let path = parent.join(format!("{RESUME_PREFIX}{key}"));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path, keep, resumable: true })
    }

    /// The run succeeded: the folder can go.
    pub fn finish(mut self) {
        self.resumable = false;
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        if !self.keep && !self.resumable {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

pub fn check(cancel: &CancellationToken) -> AppResult<()> {
    if cancel.is_cancelled() {
        Err(AppError::cancelled())
    } else {
        Ok(())
    }
}

pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("worker thread failed: {e}")))?
}

/// Resolves the destination (conflict policy) and makes sure its folder exists.
pub fn destination(source: &Path, fallback: &Path, output: &OutputOptions, suffix: &str, ext: &str) -> AppResult<Resolved> {
    let base = base_output_path(source, fallback, output.directory.as_deref(), suffix, ext);
    let resolved = resolve_conflict(base, source, output.conflict)?;
    if let Resolved::Write(dest) = &resolved {
        let dir = dest.parent().map(Path::to_path_buf).unwrap_or_default();
        std::fs::create_dir_all(&dir).map_err(|e| AppError::new(ErrorCode::OutputUnwritable, format!("{}: {e}", dir.display())))?;
    }
    Ok(resolved)
}

/// Runs the engine; on a GPU failure, retries once with smaller tiles (the
/// engine can pick tiles too large for the free VRAM).
/// Returns the time spent after device init.
pub async fn run_engine<'a>(
    engine: &dyn UpscaleEngine,
    job: &(dyn Fn(u32) -> EngineJob<'a> + Send + Sync),
    params: &UpscaleParams,
    on_stage: StageSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<u64> {
    let started = std::sync::Mutex::new(None::<std::time::Instant>);
    let events = |ev: EngineEvent| match ev {
        EngineEvent::DeviceReady(name) => {
            *started.lock().unwrap() = Some(std::time::Instant::now());
            on_log(format!("device ready: {name}"));
            on_stage(Stage::Upscaling);
        }
        EngineEvent::Log(line) => on_log(line),
    };
    let mut result = engine.run(job(params.tile_size), &events, cancel).await;
    if let Err(e) = &result {
        let gpu_failure = matches!(e.code, ErrorCode::GpuDeviceLost | ErrorCode::GpuOutOfMemory);
        let retry_tile = match params.tile_size {
            0 => Some(RETRY_TILE_SIZE),
            t if t > 64 => Some((t / 2).min(RETRY_TILE_SIZE)),
            _ => None,
        };
        if let Some(tile) = retry_tile.filter(|_| gpu_failure && params.gpu != Some(-1) && !cancel.is_cancelled()) {
            on_log(format!("GPU error ({}), retrying with tile size {tile}", e.detail));
            on_stage(Stage::Initializing);
            result = engine.run(job(tile), &events, cancel).await;
        }
    }
    result?;
    let elapsed = started.lock().unwrap().map(|t| t.elapsed().as_millis() as u64).unwrap_or(0);
    Ok(elapsed)
}

pub async fn run(
    engine: &dyn UpscaleEngine,
    spec: JobSpec<'_>,
    on_stage: StageSink<'_>,
    on_log: LogSink<'_>,
    cancel: &CancellationToken,
) -> AppResult<JobOutcome> {
    on_stage(Stage::Preparing);
    let source = spec.source.to_path_buf();
    let info = blocking({
        let s = source.clone();
        move || imaging::probe(&s)
    })
    .await?;
    let improve = spec.action != ImageAction::Compress;
    // Discord slots: PNG (accepted everywhere), exact size, size cap.
    let target_output;
    let output = match spec.target {
        Some(_) => {
            target_output = OutputOptions { format: OutputFormat::Png, ..spec.output.clone() };
            &target_output
        }
        None => spec.output,
    };
    let compress = match spec.target {
        Some((t, _)) => Some(CompressPlan { quality: 95, limit: t.max_bytes }),
        None => spec.compress,
    };
    let prepared = if improve {
        Some(prepare(engine, &info, spec.params, output)?)
    } else {
        imaging::check_output_limits(output.format, info.dims())?;
        None
    };

    let suffix = match spec.target {
        Some((_, slug)) => slug.to_string(),
        None if improve => render_suffix(&output.suffix, spec.params),
        None => "_compressed".to_string(),
    };
    let dest = match destination(&source, spec.fallback_output_dir, output, &suffix, output.format.extension())? {
        Resolved::Skip(path) => {
            on_log(format!("output already exists, skipped: {}", path.display()));
            return Ok(JobOutcome::skipped(path));
        }
        Resolved::Write(path) => path,
    };

    let work = WorkDir::create(spec.work_dir, spec.keep_temp)?;
    let mut engine_ms = 0;
    let (pixels, target) = match &prepared {
        Some(prepared) => {
            let converted = blocking({
                let (s, t) = (source.clone(), work.path.join("input.png"));
                move || imaging::prepare_engine_input(&s, &t)
            })
            .await?;
            if converted.is_some() {
                on_log("input converted to PNG for the engine".into());
            }
            let engine_input = converted.unwrap_or_else(|| source.clone());
            let engine_output = work.path.join("output.png");
            check(cancel)?;

            on_stage(Stage::Initializing);
            let job = |tile_size: u32| EngineJob {
                input: &engine_input,
                output: &engine_output,
                style: spec.params.style,
                plan: prepared.plan,
                gpu: spec.params.gpu,
                tile_size,
                tta: spec.params.tta,
                threads: spec.params.threads,
                expect_outputs: None,
            };
            engine_ms = run_engine(engine, &job, spec.params, on_stage, on_log, cancel).await?;
            check(cancel)?;
            (engine_output, prepared.plan.needs_resize.then_some(ImageFit::Exact(prepared.target)))
        }
        None => (source.clone(), None),
    };
    let target = match spec.target {
        Some((t, _)) => Some(ImageFit::Cover(Dimensions { width: t.width, height: t.height })),
        None => target,
    };

    on_stage(Stage::Encoding);
    let tmp_dest = sibling_temp(&dest);
    let (output_info, compression) = blocking({
        let (td, d, opts, plan) = (tmp_dest.clone(), dest.clone(), output.clone(), compress);
        let fixed_size = spec.target.is_some();
        move || {
            let result = encode_result(&pixels, target, &opts, plan, fixed_size, &td).and_then(|report| {
                std::fs::rename(&td, &d)?;
                Ok((imaging::probe(&d)?, report))
            });
            if result.is_err() {
                let _ = std::fs::remove_file(&td);
            }
            result
        }
    })
    .await?;
    if let Some(r) = &compression {
        on_log(format!("compression: {} bytes, quality {:?}, scale {:.2}, limit met: {}", r.bytes, r.quality, r.scale, r.met));
    }
    on_log(format!("saved {}", dest.display()));
    Ok(JobOutcome {
        output_path: dest,
        output_info: Some(output_info),
        skipped: false,
        work_mp: prepared.map(|p| p.work_mp).unwrap_or(0.0),
        engine_ms,
        compression,
        media: None,
    })
}

/// Writes the final file. Without a compression plan this is the original fast
/// path (a PNG that needs no resize is just moved).
fn encode_result(
    pixels: &Path,
    fit: Option<ImageFit>,
    opts: &OutputOptions,
    plan: Option<CompressPlan>,
    fixed_size: bool,
    dest: &Path,
) -> AppResult<Option<CompressReport>> {
    match (plan, fit) {
        (None, None) => {
            imaging::finalize(pixels, None, opts, dest)?;
            return Ok(None);
        }
        (None, Some(ImageFit::Exact(d))) => {
            imaging::finalize(pixels, Some(d), opts, dest)?;
            return Ok(None);
        }
        _ => {}
    }
    let plan = plan.unwrap_or(CompressPlan { quality: opts.quality, limit: None });
    let encoded = compress_image_fit(pixels, fit, opts, plan, !fixed_size)?;
    std::fs::write(dest, &encoded.bytes)?;
    Ok(Some(encoded.report))
}

/// Decodes, resizes to `target` if needed and encodes with the plan. Also used
/// to compute the exact output size shown before running a "Compress" job.
pub fn compress_image(pixels: &Path, target: Option<Dimensions>, opts: &OutputOptions, plan: CompressPlan) -> AppResult<crate::compress::Encoded> {
    compress_image_fit(pixels, target.map(ImageFit::Exact), opts, plan, true)
}

fn compress_image_fit(pixels: &Path, fit: Option<ImageFit>, opts: &OutputOptions, plan: CompressPlan, allow_downscale: bool) -> AppResult<crate::compress::Encoded> {
    let img = imaging::decode(pixels)?;
    let has_alpha = img.color().has_alpha();
    let img = match fit {
        Some(ImageFit::Exact(t)) if t.width != img.width() || t.height != img.height() => {
            image::DynamicImage::ImageRgba8(imaging::resize_rgba(&img.to_rgba8(), t, fast_image_resize::FilterType::Lanczos3)?)
        }
        Some(ImageFit::Cover(t)) => imaging::cover_crop(&img, t)?,
        _ => img,
    };
    let req = Request { format: opts.format, quality: plan.quality, webp_lossless: opts.webp_lossless, limit: plan.limit, png_best: true, allow_downscale };
    encode_to_limit(&img, has_alpha, &req)
}
