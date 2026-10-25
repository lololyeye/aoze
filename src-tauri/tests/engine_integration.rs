//! End-to-end tests against the real waifu2x-ncnn-vulkan binary and GPU.
//! They are skipped (with a message) when the engine has not been fetched:
//! run `npm run fetch-engine` first.

#![allow(clippy::await_holding_lock)] // the GPU lock deliberately serialises engine tests

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use image::{DynamicImage, Rgba, RgbaImage};
use aoze_lib::core::{AppPaths, Core, Hooks};
use aoze_lib::engine::waifu2x::Waifu2xEngine;
use aoze_lib::engine::UpscaleEngine;
use aoze_lib::error::{AppResult, ErrorCode};
use aoze_lib::imaging::probe;
use aoze_lib::pipeline::{self, JobOutcome, JobSpec};
use aoze_lib::queue::{run_worker, JobStatus, QueueEvent};
use aoze_lib::settings::{ConflictPolicy, ImageAction, OutputFormat, OutputOptions, Settings, Style, UpscaleParams};
use tokio_util::sync::CancellationToken;

/// Engine runs are serialised: they share one GPU.
static GPU: Mutex<()> = Mutex::new(());

fn engine_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("engine");
    if dir.join("waifu2x-ncnn-vulkan.exe").is_file() {
        Some(dir)
    } else {
        eprintln!("SKIPPED: engine not found in {} (run `npm run fetch-engine`)", dir.display());
        None
    }
}

macro_rules! engine_or_skip {
    () => {
        match engine_dir() {
            Some(d) => d,
            None => return,
        }
    };
}

/// A colourful test pattern with an alpha gradient.
fn pattern(w: u32, h: u32, alpha: bool) -> DynamicImage {
    let img = RgbaImage::from_fn(w, h, |x, y| {
        let r = ((x * 255) / w.max(1)) as u8;
        let g = ((y * 255) / h.max(1)) as u8;
        let b = if (x / 7 + y / 7) % 2 == 0 { 230 } else { 30 };
        let a = if alpha { (((x + y) * 255) / (w + h)) as u8 } else { 255 };
        Rgba([r, g, b, a])
    });
    if alpha {
        DynamicImage::ImageRgba8(img)
    } else {
        DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(img).to_rgb8())
    }
}

fn write_image(dir: &Path, name: &str, w: u32, h: u32, alpha: bool) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join(name);
    pattern(w, h, alpha).save(&path).unwrap();
    path
}

fn params(style: Style, scale: f32, noise: i8) -> UpscaleParams {
    UpscaleParams { style, scale, noise, ..UpscaleParams::default() }
}

async fn upscale(engine: &dyn UpscaleEngine, src: &Path, params: &UpscaleParams, output: &OutputOptions, work: &Path) -> AppResult<JobOutcome> {
    upscale_with_cancel(engine, src, params, output, work, &CancellationToken::new()).await
}

async fn upscale_with_cancel(
    engine: &dyn UpscaleEngine,
    src: &Path,
    params: &UpscaleParams,
    output: &OutputOptions,
    work: &Path,
    cancel: &CancellationToken,
) -> AppResult<JobOutcome> {
    let spec = JobSpec {
        source: src,
        params,
        output,
        action: ImageAction::Improve,
        compress: None,
        fallback_output_dir: work,
        work_dir: &work.join("work"),
        keep_temp: false,
        target: None,
    };
    pipeline::run(engine, spec, &|_| {}, &|line| eprintln!("  engine: {line}"), cancel).await
}

/// Checks size and that the result carries real content: a lost GPU device
/// makes the engine write a uniform (blank) image while reporting success.
fn assert_dims(path: &Path, w: u32, h: u32) {
    let info = probe(path).unwrap();
    assert_eq!((info.width, info.height), (w, h), "{}", path.display());
    let img = image::open(path).unwrap().to_rgb8();
    let (min, max) = img.pixels().fold((255u8, 0u8), |(lo, hi), p| (lo.min(p[0]), hi.max(p[0])));
    assert!(max - min > 100, "{} looks blank (red channel {min}..{max})", path.display());
}

#[tokio::test]
async fn formats_scales_and_paths_with_spaces_and_accents() {
    let dir = engine_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let engine = Waifu2xEngine::new(dir);
    let tmp = tempfile::tempdir().unwrap();
    let pics = tmp.path().join("Mes images été");
    let png = write_image(&pics, "fan art (final).png", 160, 120, true);
    let jpg = write_image(&pics, "photo 1.jpg", 150, 100, false);
    let webp = write_image(&pics, "web image.webp", 100, 80, false);
    let bmp = write_image(&pics, "old.bmp", 64, 48, false);
    let out = OutputOptions::default();

    // PNG with alpha, 2x, denoise, accented folder with spaces.
    let r = upscale(&engine, &png, &params(Style::Artwork, 2.0, 1), &out, tmp.path()).await.unwrap();
    assert_eq!(r.output_path, pics.join("fan art (final)_art_2x_noise1.png"));
    assert_dims(&r.output_path, 320, 240);
    assert!(image::open(&r.output_path).unwrap().color().has_alpha(), "alpha must be preserved");

    // JPEG, 4x (two passes), photo model, saved as JPEG.
    let jpeg_out = OutputOptions { format: OutputFormat::Jpeg, quality: 90, ..out.clone() };
    let r = upscale(&engine, &jpg, &params(Style::Photo, 4.0, 2), &jpeg_out, tmp.path()).await.unwrap();
    assert_dims(&r.output_path, 600, 400);
    assert_eq!(probe(&r.output_path).unwrap().format, "JPG");

    // WebP at 1.6x (2x + Lanczos) saved as lossy WebP.
    let webp_out = OutputOptions { format: OutputFormat::Webp, ..out.clone() };
    let r = upscale(&engine, &webp, &params(Style::ArtworkFast, 1.6, -1), &webp_out, tmp.path()).await.unwrap();
    assert_dims(&r.output_path, 160, 128);

    // BMP is converted for the engine.
    let r = upscale(&engine, &bmp, &params(Style::Artwork, 2.0, 0), &out, tmp.path()).await.unwrap();
    assert_dims(&r.output_path, 128, 96);

    // Denoise only: native 1x model (CUnet) and 2x+downscale fallback (UpConv7).
    let r = upscale(&engine, &png, &params(Style::Artwork, 1.0, 3), &out, tmp.path()).await.unwrap();
    assert_dims(&r.output_path, 160, 120);
    let r = upscale(&engine, &jpg, &params(Style::Photo, 1.0, 1), &out, tmp.path()).await.unwrap();
    assert_dims(&r.output_path, 150, 100);

    assert!(!tmp.path().join("work").read_dir().map(|mut d| d.next().is_some()).unwrap_or(false), "work dir must be cleaned");
}

#[tokio::test]
async fn existing_output_rename_overwrite_skip() {
    let dir = engine_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let engine = Waifu2xEngine::new(dir);
    let tmp = tempfile::tempdir().unwrap();
    let src = write_image(tmp.path(), "a.png", 64, 64, false);
    let p = params(Style::ArtworkFast, 2.0, -1);

    let first = upscale(&engine, &src, &p, &OutputOptions::default(), tmp.path()).await.unwrap();
    let renamed = upscale(&engine, &src, &p, &OutputOptions::default(), tmp.path()).await.unwrap();
    assert_eq!(renamed.output_path.file_name().unwrap(), "a_art-fast_2x_noiseoff (1).png");

    let skip = OutputOptions { conflict: ConflictPolicy::Skip, ..OutputOptions::default() };
    let skipped = upscale(&engine, &src, &p, &skip, tmp.path()).await.unwrap();
    assert!(skipped.skipped);

    let before = std::fs::metadata(&first.output_path).unwrap().modified().unwrap();
    std::thread::sleep(Duration::from_millis(20));
    let over = OutputOptions { conflict: ConflictPolicy::Overwrite, ..OutputOptions::default() };
    let r = upscale(&engine, &src, &p, &over, tmp.path()).await.unwrap();
    assert_eq!(r.output_path, first.output_path);
    assert!(std::fs::metadata(&r.output_path).unwrap().modified().unwrap() > before);

    // The source itself is never overwritten, even with an empty suffix.
    let same = OutputOptions { suffix: String::new(), conflict: ConflictPolicy::Overwrite, ..OutputOptions::default() };
    let r = upscale(&engine, &src, &p, &same, tmp.path()).await.unwrap();
    assert_eq!(r.output_path.file_name().unwrap(), "a (1).png");
    assert_dims(&src, 64, 64);
}

#[tokio::test]
async fn invalid_inputs_and_broken_setups_give_precise_errors() {
    let dir = engine_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let engine = Waifu2xEngine::new(dir.clone());
    let tmp = tempfile::tempdir().unwrap();
    let out = OutputOptions::default();
    let p = params(Style::Artwork, 2.0, 0);

    // Not an image at all.
    let fake = tmp.path().join("fake.png");
    std::fs::write(&fake, b"this is text").unwrap();
    assert_eq!(upscale(&engine, &fake, &p, &out, tmp.path()).await.unwrap_err().code, ErrorCode::DecodeFailed);

    // Valid header, truncated body: rejected before reaching the engine, which
    // would otherwise "succeed" with a partly black image.
    let good = write_image(tmp.path(), "good.png", 300, 300, false);
    let bytes = std::fs::read(&good).unwrap();
    let truncated = tmp.path().join("truncated.png");
    std::fs::write(&truncated, &bytes[..bytes.len() / 3]).unwrap();
    let e = upscale(&engine, &truncated, &p, &out, tmp.path()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::DecodeFailed, "{e:?}");

    // Missing file.
    let e = upscale(&engine, &tmp.path().join("nope.png"), &p, &out, tmp.path()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::FileNotFound);

    // GPU that does not exist.
    let bad_gpu = UpscaleParams { gpu: Some(9), ..p.clone() };
    assert_eq!(upscale(&engine, &good, &bad_gpu, &out, tmp.path()).await.unwrap_err().code, ErrorCode::GpuInvalid);

    // Engine folder without models.
    let no_models = tmp.path().join("engine-no-models");
    std::fs::create_dir_all(&no_models).unwrap();
    std::fs::copy(dir.join("waifu2x-ncnn-vulkan.exe"), no_models.join("waifu2x-ncnn-vulkan.exe")).unwrap();
    std::fs::copy(dir.join("vcomp140.dll"), no_models.join("vcomp140.dll")).unwrap();
    let e = upscale(&Waifu2xEngine::new(no_models), &good, &p, &out, tmp.path()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::ModelMissing);

    // Engine folder with models but no executable.
    let no_exe = tmp.path().join("engine-no-exe");
    let models = no_exe.join("models-cunet");
    std::fs::create_dir_all(&models).unwrap();
    for f in ["noise0_scale2.0x_model.param", "noise0_scale2.0x_model.bin"] {
        std::fs::copy(dir.join("models-cunet").join(f), models.join(f)).unwrap();
    }
    let e = upscale(&Waifu2xEngine::new(no_exe), &good, &p, &out, tmp.path()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::EngineMissing);

    // WebP cannot hold more than 16383 px per side.
    let webp = OutputOptions { format: OutputFormat::Webp, ..out.clone() };
    let wide = write_image(tmp.path(), "wide.png", 3000, 8, false);
    let e = upscale(&engine, &wide, &params(Style::Artwork, 8.0, -1), &webp, tmp.path()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidParams);
}

fn waifu2x_running() -> bool {
    let out = std::process::Command::new("tasklist").args(["/FI", "IMAGENAME eq waifu2x-ncnn-vulkan.exe"]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).contains("waifu2x-ncnn-vulkan.exe")
}

#[tokio::test]
async fn cancel_kills_the_engine_and_cleans_up() {
    let dir = engine_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let engine = Waifu2xEngine::new(dir);
    let tmp = tempfile::tempdir().unwrap();
    let src = write_image(tmp.path(), "big.png", 2400, 1600, false);
    let cancel = CancellationToken::new();
    let c = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(2500)).await;
        c.cancel();
    });
    let started = std::time::Instant::now();
    let e = upscale_with_cancel(&engine, &src, &params(Style::Artwork, 4.0, 1), &OutputOptions::default(), tmp.path(), &cancel)
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(10), "cancel must be prompt");
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(!waifu2x_running(), "engine process must be killed");
    let leftovers: Vec<_> = std::fs::read_dir(tmp.path()).unwrap().flatten().map(|e| e.file_name()).collect();
    assert!(!leftovers.iter().any(|n| n.to_string_lossy().contains("_art_4x")), "no partial output: {leftovers:?}");
}

#[tokio::test]
async fn very_large_image() {
    let dir = engine_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let engine = Waifu2xEngine::new(dir);
    let tmp = tempfile::tempdir().unwrap();
    let src = write_image(tmp.path(), "huge.png", 6000, 4000, false);
    let r = upscale(&engine, &src, &params(Style::ArtworkFast, 2.0, 0), &OutputOptions::default(), tmp.path()).await.unwrap();
    assert_dims(&r.output_path, 12000, 8000);
}

#[derive(Clone, Default)]
struct RecordingHooks {
    events: Arc<Mutex<Vec<String>>>,
}

impl Hooks for RecordingHooks {
    fn emit(&self, event: QueueEvent) {
        let name = match event {
            QueueEvent::Updated(_) => "updated",
            QueueEvent::Progress(_) => "progress",
            QueueEvent::Log { .. } => "log",
            QueueEvent::BatchFinished(_) => "batch",
        };
        self.events.lock().unwrap().push(name.into());
    }
    fn allow_file(&self, _path: &Path) {}
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queue_processes_a_batch_with_one_failure() {
    let dir = engine_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let paths = AppPaths {
        config_dir: tmp.path().join("config"),
        cache_dir: tmp.path().join("cache"),
        log_dir: tmp.path().join("logs"),
        bundled_engine_dir: dir,
        ffmpeg_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("ffmpeg"),
        rife_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("rife"),
        esrgan_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("realesrgan"),
        fallback_output_dir: tmp.path().join("out"),
    };
    let hooks = RecordingHooks::default();
    let core = Core::new(paths, Box::new(hooks.clone()));
    let settings = Settings { upscale: params(Style::ArtworkFast, 2.0, 1), ..Settings::default() };
    core.update_settings(settings).unwrap();

    let imgs = tmp.path().join("batch");
    let files = vec![
        write_image(&imgs, "image1.png", 200, 150, true),
        write_image(&imgs, "image2.jpg", 180, 120, false),
        write_image(&imgs, "image3.webp", 120, 90, false),
        write_image(&imgs, "image4.png", 210, 140, false),
    ];
    let broken = imgs.join("broken.png");
    std::fs::write(&broken, b"nope").unwrap();

    let mut all = files.clone();
    all.push(broken);
    let added = tokio::task::spawn_blocking({
        let core = core.clone();
        move || core.add_files(all)
    })
    .await
    .unwrap();
    assert_eq!(added.added.len(), 4);
    assert_eq!(added.rejected.len(), 1);
    assert_eq!(added.rejected[0].error.code, ErrorCode::DecodeFailed);

    tokio::spawn(run_worker(core.clone()));
    assert_eq!(core.enqueue(None), 4);

    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    loop {
        let snap = core.queue_snapshot();
        if snap.jobs.iter().all(|j| j.status == JobStatus::Completed) {
            break;
        }
        assert!(!snap.jobs.iter().any(|j| j.status == JobStatus::Failed), "{:?}", snap.jobs.iter().map(|j| &j.error).collect::<Vec<_>>());
        assert!(std::time::Instant::now() < deadline, "queue did not finish");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    for j in core.queue_snapshot().jobs {
        let r = j.result.unwrap();
        assert_eq!((r.info.width, r.info.height), (j.source.info.width * 2, j.source.info.height * 2));
        assert!(!core.job_log(&j.id).is_empty());
    }
    assert_eq!(core.history.list().len(), 4);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = hooks.events.lock().unwrap().clone();
    assert!(events.iter().any(|e| e == "progress"));
    assert!(events.iter().any(|e| e == "batch"), "batch-finished must be emitted");
}
