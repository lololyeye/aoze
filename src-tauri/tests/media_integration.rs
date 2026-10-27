//! End-to-end tests of compression, GIF and clip processing with the bundled
//! FFmpeg and the real engine. Skipped when the binaries have not been fetched
//! (`npm run fetch-engine`).
#![allow(clippy::await_holding_lock)] // the GPU lock deliberately serialises engine tests

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use aoze_lib::anim::{self, AnimSpec};
use aoze_lib::engine::waifu2x::Waifu2xEngine;
use aoze_lib::error::{AppResult, ErrorCode};
use aoze_lib::imaging::probe;
use aoze_lib::media::{Ffmpeg, HwEncoder, MediaKind};
use aoze_lib::pipeline::{self, CompressPlan, JobOutcome, JobSpec};
use aoze_lib::color::Transfer;
use aoze_lib::esrgan::Esrgan;
use aoze_lib::smooth::Rife;
use aoze_lib::settings::{
    AnimSettings, CompressLevel, CompressSettings, Enhance, FpsMode, ImageAction, OutputFormat, OutputOptions, SizeUnit, Style, UpscaleParams, HdrMode, Look, SmoothMotion, SpeedPreset, SpeedSettings, FrameFormat, BeatSync};
use image::{DynamicImage, Rgb, RgbImage};
use tokio_util::sync::CancellationToken;

static GPU: Mutex<()> = Mutex::new(());

fn resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
}

fn tools() -> Option<(Waifu2xEngine, Ffmpeg)> {
    let r = resources();
    let ff = Ffmpeg::new(r.join("ffmpeg"));
    if !ff.found() || !r.join("engine").join("waifu2x-ncnn-vulkan.exe").is_file() {
        eprintln!("SKIPPED: engine or FFmpeg not fetched (run `npm run fetch-engine`)");
        return None;
    }
    Some((Waifu2xEngine::new(r.join("engine")), ff))
}

macro_rules! tools_or_skip {
    () => {
        match tools() {
            Some(t) => t,
            None => return,
        }
    };
}

/// Generates a test file with FFmpeg's lavfi sources.
fn lavfi(ff: &Ffmpeg, args: &[&str], dest: &Path) {
    let status = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .arg(dest)
        .status()
        .unwrap();
    assert!(status.success(), "fixture generation failed: {args:?}");
}

/// 160x120 GIF, 12.5 FPS, 1.5 s, right half transparent.
fn make_gif(ff: &Ffmpeg, dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    lavfi(
        ff,
        &[
            "-f", "lavfi", "-i",
            "testsrc2=s=160x120:r=12.5:d=1.5,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(X,80),0,255)'",
            "-vf", "split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128", "-loop", "0",
        ],
        &p,
    );
    p
}

/// 320x180 H.264 clip, 24 FPS, 2 s, with an AAC tone.
fn make_clip(ff: &Ffmpeg, dir: &Path, name: &str, secs: &str) -> PathBuf {
    let p = dir.join(name);
    lavfi(
        ff,
        &[
            "-f", "lavfi", "-i", &format!("testsrc2=s=320x180:r=24:d={secs}"), "-f", "lavfi", "-i", &format!("sine=frequency=440:duration={secs}"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        ],
        &p,
    );
    p
}

fn params() -> UpscaleParams {
    UpscaleParams { style: Style::ArtworkFast, tile_size: 128, ..UpscaleParams::default() }
}

#[allow(clippy::too_many_arguments)]
async fn run_anim(engine: &Waifu2xEngine, ff: &Ffmpeg, src: &Path, kind: MediaKind, anim: AnimSettings, compress: CompressSettings, work: &Path, cancel: &CancellationToken) -> AppResult<JobOutcome> {
    let info = ff.probe(src, kind).unwrap();
    let base = params();
    let output = OutputOptions::default();
    let encoder = if kind == MediaKind::Video { ff.detect_encoders().first().copied() } else { None };
    let rife = Rife::new(resources().join("rife"));
    let esrgan = Esrgan::new(resources().join("realesrgan"));
    let luts = LUTS.lock().unwrap().clone();
    let spec = AnimSpec {
        kind,
        source: src,
        info: &info,
        anim: &anim,
        params: &base,
        compress: &compress,
        output: &output,
        encoder,
        fallback_output_dir: work,
        work_dir: &work.join("work"),
        keep_temp: false,
        target: None,
        rife: rife.found().then_some(&rife),
        esrgan: esrgan.found().then_some(&esrgan),
        vram_bytes: 0,
        luts_dir: luts.as_deref(),
    };
    let logs = std::sync::Mutex::new(Vec::<String>::new());
    let r = anim::run(engine, ff, spec, &|_| {}, &|_, _| {}, &|l| {
        eprintln!("  {l}");
        logs.lock().unwrap().push(l);
    }, cancel)
    .await;
    *LAST_LOG.lock().unwrap() = logs.into_inner().unwrap();
    r
}

/// Imported LUT folder for `run_anim`.
static LUTS: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Log of the last `run_anim` (tests that read it hold the GPU lock).
static LAST_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn last_log_has(needle: &str) -> bool {
    LAST_LOG.lock().unwrap().iter().any(|l| l.contains(needle))
}

#[tokio::test]
async fn gif_resize_enhance_fps_and_transparency() {
    let (engine, ff) = tools_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let src = make_gif(&ff, tmp.path(), "anim test.gif");
    let src_info = ff.probe(&src, MediaKind::Gif).unwrap();
    assert_eq!((src_info.width, src_info.height, src_info.frames), (160, 120, 19));
    assert!((src_info.fps - 12.5).abs() < 0.8, "{}", src_info.fps);
    let none = CancellationToken::new();

    // Plain 2x resize keeps frame count, timing and transparency.
    let out = run_anim(&engine, &ff, &src, MediaKind::Gif, AnimSettings { scale: 2.0, ..AnimSettings::default() }, CompressSettings::default(), tmp.path(), &none).await.unwrap();
    let m = out.media.clone().unwrap();
    assert_eq!((m.width, m.height, m.frames), (320, 240, src_info.frames));
    assert!((m.duration_ms as i64 - src_info.duration_ms as i64).abs() < 150, "timing kept: {} vs {}", m.duration_ms, src_info.duration_ms);
    let frame = tmp.path().join("first.png");
    ff.grab_frame(&out.output_path, 0, 4096, &frame).unwrap();
    let first = image::open(&frame).unwrap().to_rgba8();
    assert!(first.get_pixel(300, 100)[3] == 0 && first.get_pixel(20, 100)[3] == 255, "transparency kept");

    // waifu2x enhancement (folder mode) on every frame.
    let anim = AnimSettings { scale: 2.0, enhance: Enhance::Medium, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &src, MediaKind::Gif, anim, CompressSettings::default(), tmp.path(), &none).await.unwrap();
    let m = out.media.unwrap();
    assert_eq!((m.width, m.height, m.frames), (320, 240, src_info.frames));

    // Retime to 50 FPS: real 50 FPS output, same duration.
    let anim = AnimSettings { fps: Some(50.0), fps_mode: FpsMode::Retime, motion_blur: 40, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &src, MediaKind::Gif, anim, CompressSettings::default(), tmp.path(), &none).await.unwrap();
    let m = out.media.unwrap();
    assert!((m.fps - 50.0).abs() < 2.0, "fps {}", m.fps);
    assert!(out.output_path.to_string_lossy().ends_with("_aoze_50fps.gif"));
}

#[tokio::test]
async fn gif_size_limit_is_honoured() {
    let (engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    let src = make_gif(&ff, tmp.path(), "big.gif");
    let none = CancellationToken::new();
    let free = run_anim(&engine, &ff, &src, MediaKind::Gif, AnimSettings { scale: 4.0, ..AnimSettings::default() }, CompressSettings::default(), tmp.path(), &none).await.unwrap();
    let full = free.compression.unwrap().bytes;
    let limit_kb = (full / 1024 / 3).max(8) as f64;
    let compress = CompressSettings { max_size: Some(limit_kb), unit: SizeUnit::Kb, ..CompressSettings::default() };
    let out = run_anim(&engine, &ff, &src, MediaKind::Gif, AnimSettings { scale: 4.0, ..AnimSettings::default() }, compress, tmp.path(), &none).await.unwrap();
    let report = out.compression.unwrap();
    assert!(report.met, "{report:?} (unlimited was {full})");
    assert!(std::fs::metadata(&out.output_path).unwrap().len() <= (limit_kb * 1024.0) as u64);
}

#[tokio::test]
async fn clip_resize_sharpen_fps_blur_audio() {
    let (engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    let src = make_clip(&ff, tmp.path(), "my clip.mp4", "2");
    let none = CancellationToken::new();
    let anim = AnimSettings { scale: 2.0, enhance: Enhance::Sharpen, fps: Some(30.0), fps_mode: FpsMode::Retime, motion_blur: 50, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &src, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &none).await.unwrap();
    let m = out.media.unwrap();
    assert_eq!((m.width, m.height), (640, 360));
    assert!((m.fps - 30.0).abs() < 0.1, "fps {}", m.fps);
    assert!(m.has_audio && (m.duration_ms as i64 - 2000).abs() < 150, "{m:?}");

    // Real interpolation to 60 FPS.
    let anim = AnimSettings { fps: Some(60.0), fps_mode: FpsMode::Interpolate, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &src, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &none).await.unwrap();
    let m = out.media.unwrap();
    assert!((m.fps - 60.0).abs() < 0.1 && m.frames >= 110, "{m:?}");
}

#[tokio::test]
async fn clip_enhanced_by_engine_in_blocks() {
    let (engine, ff) = tools_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let src = make_clip(&ff, tmp.path(), "anime.mp4", "2");
    let anim = AnimSettings { scale: 2.0, enhance: Enhance::Light, style: Style::ArtworkFast, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &src, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let m = out.media.unwrap();
    assert_eq!((m.width, m.height), (640, 360));
    assert!((m.frames as i64 - 48).abs() <= 1 && m.has_audio, "{m:?}");
    assert!(!tmp.path().join("work").read_dir().map(|mut d| d.next().is_some()).unwrap_or(false), "work dir cleaned");
}

#[tokio::test]
async fn clip_size_limit_two_pass() {
    let (engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    let src = make_clip(&ff, tmp.path(), "limit.mp4", "4");
    let compress = CompressSettings { max_size: Some(150.0), unit: SizeUnit::Kb, ..CompressSettings::default() };
    let out = run_anim(&engine, &ff, &src, MediaKind::Video, AnimSettings::default(), compress, tmp.path(), &CancellationToken::new()).await.unwrap();
    let r = out.compression.unwrap();
    assert!(r.met && r.bytes <= 150 * 1024, "{r:?}");
    assert_eq!(std::fs::metadata(&out.output_path).unwrap().len(), r.bytes);
}

#[tokio::test]
async fn clip_cancel_leaves_nothing() {
    let (engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    // Other tests run RIFE too: hold the GPU so the process check below sees only ours.
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let src = make_clip(&ff, tmp.path(), "long.mp4", "20");
    let cancel = CancellationToken::new();
    let c = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        c.cancel();
    });
    // Smooth Motion (RIFE) running when the cancel lands: the process must stop and leave nothing.
    let anim = AnimSettings { scale: 2.0, fps: Some(60.0), smooth: SmoothMotion::High, ..AnimSettings::default() };
    let e = run_anim(&engine, &ff, &src, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &cancel).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Cancelled);
    let names: Vec<String> = std::fs::read_dir(tmp.path()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(!names.iter().any(|n| n.contains("_aoze")), "no output left: {names:?}");
    // No interpolation process keeps running.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let ps = std::process::Command::new("tasklist").args(["/FI", "IMAGENAME eq rife-ncnn-vulkan.exe"]).output().unwrap();
    assert!(!String::from_utf8_lossy(&ps.stdout).contains("rife-ncnn-vulkan.exe"), "RIFE still running");
}

#[tokio::test]
async fn invalid_media_is_rejected() {
    let (_engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    let fake = tmp.path().join("fake.mp4");
    std::fs::write(&fake, b"not a video").unwrap();
    assert_eq!(ff.probe(&fake, MediaKind::Video).unwrap_err().code, ErrorCode::DecodeFailed);
    assert!(Ffmpeg::new(tmp.path().to_path_buf()).probe(&fake, MediaKind::Video).unwrap_err().code == ErrorCode::FfmpegMissing);
    let _ = HwEncoder::Nvenc.codec();
}

fn photo(dir: &Path) -> PathBuf {
    let mut seed = 7u32;
    let img = RgbImage::from_fn(640, 480, |x, y| {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let n = (seed >> 27) as u8;
        Rgb([(x / 3) as u8 ^ n, (y / 2) as u8, ((x + y) / 5) as u8 ^ n])
    });
    let p = dir.join("photo shot.png");
    DynamicImage::ImageRgb8(img).save(&p).unwrap();
    p
}

#[tokio::test]
async fn image_compress_and_improve_with_limits() {
    let (engine, _ff) = tools_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let src = photo(tmp.path());
    let work = tmp.path().join("work");
    let run = |action: ImageAction, format: OutputFormat, compress: Option<CompressPlan>| {
        let (src, work, engine) = (src.clone(), work.clone(), &engine);
        async move {
            let p = UpscaleParams { style: Style::Photo, scale: 2.0, noise: 0, tile_size: 128, ..UpscaleParams::default() };
            let out = OutputOptions { format, ..OutputOptions::default() };
            let spec = JobSpec { source: &src, params: &p, output: &out, action, compress, fallback_output_dir: &work, work_dir: &work, keep_temp: false, target: None };
            pipeline::run(engine, spec, &|_| {}, &|_| {}, &CancellationToken::new()).await.unwrap()
        }
    };

    // Compress only: same resolution, "_compressed", within 60 KB.
    let level = CompressSettings { level: CompressLevel::Balanced, ..CompressSettings::default() };
    let r = run(ImageAction::Compress, OutputFormat::Jpeg, Some(CompressPlan { quality: level.quality(), limit: Some(60 * 1024) })).await;
    let info = probe(&r.output_path).unwrap();
    assert_eq!((info.width, info.height), (640, 480));
    assert!(r.output_path.to_string_lossy().ends_with("photo shot_compressed.jpg"));
    let c = r.compression.unwrap();
    assert!(c.met && info.size_bytes <= 60 * 1024, "{c:?}");

    // No limit: quality only.
    let r = run(ImageAction::Compress, OutputFormat::Webp, Some(CompressPlan { quality: 70, limit: None })).await;
    assert_eq!(r.compression.unwrap().quality, Some(70));

    // Improve + compress: 2x, then fit 150 KB.
    let r = run(ImageAction::Both, OutputFormat::Webp, Some(CompressPlan { quality: 90, limit: Some(150 * 1024) })).await;
    let info = probe(&r.output_path).unwrap();
    let c = r.compression.unwrap();
    assert!(c.met && info.size_bytes <= 150 * 1024, "{c:?}");
    assert!(info.width >= 1000, "kept most of the 2x resolution: {}", info.width);

    // Improve without compression keeps the original fast path.
    let r = run(ImageAction::Improve, OutputFormat::Png, None).await;
    assert!(r.compression.is_none());
    assert_eq!(probe(&r.output_path).unwrap().width, 1280);
}

// ---------- Phase 2: probing fixes, Discord targets, Convert ----------

use aoze_lib::convert::{self, Conversion, ConvertSpec};
use aoze_lib::settings::{ConvertSettings, DiscordTarget, GifOutput};

#[tokio::test]
async fn rotated_and_10bit_clips_are_probed_correctly() {
    let (_engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    let base = make_clip(&ff, tmp.path(), "base.mp4", "1");
    // Phone-style rotation metadata: displayed size is 180x320.
    let rotated = tmp.path().join("rotated.mp4");
    lavfi(&ff, &["-display_rotation", "90", "-i", base.to_str().unwrap(), "-c", "copy"], &rotated);
    let m = ff.probe(&rotated, MediaKind::Video).unwrap();
    assert_eq!((m.width, m.height, m.rotation.rem_euclid(180)), (180, 320, 90), "{m:?}");
    // 10-bit H.264 plays black in WebView2: must not be treated as playable.
    let ten = tmp.path().join("ten bit.mp4");
    lavfi(&ff, &["-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p10le"], &ten);
    let m = ff.probe(&ten, MediaKind::Video).unwrap();
    assert!(!m.playable && m.pix_fmt == "yuv420p10le", "{m:?}");
    assert!(ff.probe(&base, MediaKind::Video).unwrap().playable);
    // The preview copy is a playable 8-bit H.264 file.
    let copy = tmp.path().join("copy.mp4");
    ff.preview_copy(&ten, &copy, m.transfer, &m.color_matrix, 720).unwrap();
    let c = ff.probe(&copy, MediaKind::Video).unwrap();
    assert!(c.playable, "{c:?}");
    // A rotated clip processed by the pipeline keeps its displayed orientation.
    let out = run_anim(&_engine, &ff, &rotated, MediaKind::Video, AnimSettings { scale: 2.0, ..AnimSettings::default() }, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let o = out.media.unwrap();
    assert_eq!((o.width, o.height), (360, 640), "{o:?}");
}

#[tokio::test]
async fn discord_banner_from_small_image_and_gif() {
    let (engine, ff) = tools_or_skip!();
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let src = photo(tmp.path()); // 640x480: must be enlarged (cover factor 1.0625 -> engine 2x) then cropped.
    let spec_t = DiscordTarget::ProfileBanner;
    let p = UpscaleParams { style: Style::Artwork, scale: 2.0, noise: 0, tile_size: 128, ..UpscaleParams::default() };
    let out = OutputOptions { format: OutputFormat::Jpeg, ..OutputOptions::default() };
    let work = tmp.path().join("work");
    let spec = JobSpec {
        source: &src,
        params: &p,
        output: &out,
        action: ImageAction::Both,
        compress: None,
        fallback_output_dir: &work,
        work_dir: &work,
        keep_temp: false,
        target: Some((spec_t.spec(), spec_t.slug())),
    };
    let r = pipeline::run(&engine, spec, &|_| {}, &|_| {}, &CancellationToken::new()).await.unwrap();
    let info = probe(&r.output_path).unwrap();
    assert_eq!((info.width, info.height, info.format.as_str()), (680, 240, "PNG"));
    assert!(r.output_path.to_string_lossy().ends_with("photo shot_discord-banner.png"));
    assert!(r.compression.unwrap().met);

    // Animated GIF banner: exact size, animation kept, under 10 MB.
    let gif = make_gif(&ff, tmp.path(), "banner src.gif");
    let info = ff.probe(&gif, MediaKind::Gif).unwrap();
    let base = params();
    let compress = CompressSettings::default();
    let anim = AnimSettings::default();
    let spec = AnimSpec {
        kind: MediaKind::Gif,
        source: &gif,
        info: &info,
        anim: &anim,
        params: &base,
        compress: &compress,
        output: &OutputOptions::default(),
        encoder: None,
        fallback_output_dir: tmp.path(),
        work_dir: &work,
        keep_temp: false,
        target: Some((spec_t.spec(), spec_t.slug())),
        rife: None,
        esrgan: None,
        vram_bytes: 0,
        luts_dir: None,
    };
    let r = anim::run(&engine, &ff, spec, &|_| {}, &|_, _| {}, &|_| {}, &CancellationToken::new()).await.unwrap();
    let m = r.media.unwrap();
    assert_eq!((m.width, m.height, m.frames), (680, 240, info.frames));
    assert!(m.size_bytes <= 10 * 1024 * 1024);
}

async fn run_convert(ff: &Ffmpeg, conversion: Conversion, src: &Path, images: &[PathBuf], settings: &ConvertSettings, dir: &Path) -> JobOutcome {
    let kind = aoze_lib::media::kind_of(src).unwrap();
    let media = (kind != MediaKind::Image).then(|| ff.probe(src, kind).unwrap());
    let image_info = match &media {
        Some(m) => aoze_lib::imaging::ImageInfo { width: m.width, height: m.height, size_bytes: m.size_bytes, format: String::new() },
        None => probe(src).unwrap(),
    };
    let spec = ConvertSpec {
        conversion,
        source: src,
        images,
        image_info: &image_info,
        media: media.as_ref(),
        settings,
        output: &OutputOptions::default(),
        encoder: None,
        fallback_output_dir: dir,
        work_dir: &dir.join("work"),
        keep_temp: false,
    };
    convert::run(ff, spec, &|_| {}, &|_, _| {}, &|l| eprintln!("  {l}"), &CancellationToken::new()).await.unwrap()
}

#[tokio::test]
async fn convert_clip_gif_frames_and_images() {
    let (_engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    let clip = make_clip(&ff, tmp.path(), "my clip.mp4", "2");
    let s = ConvertSettings::default(); // 15 FPS, 480 px wide

    // Clip -> GIF: 15 FPS, never upscaled (source is 320 wide).
    let r = run_convert(&ff, Conversion::ClipToGif, &clip, &[], &s, tmp.path()).await;
    let m = r.media.unwrap();
    assert!(r.output_path.to_string_lossy().ends_with("my clip.gif"));
    assert_eq!((m.width, m.height), (320, 180));
    assert!((m.fps - 15.0).abs() < 1.0 && (m.duration_ms as i64 - 2000).abs() < 200, "{m:?}");

    // GIF -> MP4.
    let gif = r.output_path.clone();
    let r = run_convert(&ff, Conversion::GifToMp4, &gif, &[], &s, tmp.path()).await;
    let m = r.media.unwrap();
    assert!(m.playable && m.width % 2 == 0 && (m.duration_ms as i64 - 2000).abs() < 250, "{m:?}");

    // GIF -> frames folder.
    let frames_settings = ConvertSettings { gif_output: GifOutput::Frames, width: None, ..s.clone() };
    let r = run_convert(&ff, Conversion::GifToFrames, &gif, &[], &frames_settings, tmp.path()).await;
    let count = std::fs::read_dir(&r.output_path).unwrap().count() as u64;
    assert!(r.output_path.is_dir() && count == r.media.unwrap().frames && count >= 25, "{count}");

    // Images -> animated GIF, 3 frames of 400 ms.
    let imgs: Vec<PathBuf> = (0..3).map(|i| {
        let p = tmp.path().join(format!("slide {i}.png"));
        DynamicImage::ImageRgb8(RgbImage::from_pixel(200 + i * 20, 150, Rgb([i as u8 * 80, 100, 200]))).save(&p).unwrap();
        p
    }).collect();
    let img_settings = ConvertSettings { frame_ms: 400, width: None, ..s.clone() };
    let r = run_convert(&ff, Conversion::ImagesToGif, &imgs[0], &imgs, &img_settings, tmp.path()).await;
    let m = r.media.unwrap();
    assert!(r.output_path.to_string_lossy().ends_with("slide 0_animated.gif"));
    assert_eq!((m.width, m.height, m.frames), (200, 150, 3), "{m:?}");
    assert!((m.duration_ms as i64 - 1200).abs() < 100, "{m:?}");

    // Size limit on a converted GIF.
    let limited = ConvertSettings { compress: CompressSettings { max_size: Some(60.0), unit: SizeUnit::Kb, ..CompressSettings::default() }, ..s };
    let r = run_convert(&ff, Conversion::ClipToGif, &clip, &[], &limited, tmp.path()).await;
    assert!(r.compression.unwrap().met && std::fs::metadata(&r.output_path).unwrap().len() <= 60 * 1024);
}

/// MD5 of every decoded frame (to tell new frames from repeated ones).
fn frame_hashes(ff: &Ffmpeg, path: &Path) -> Vec<String> {
    let out = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-map", "0:v:0", "-f", "framemd5", "-"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).lines().filter(|l| !l.starts_with('#')).filter_map(|l| l.rsplit(',').next().map(|h| h.trim().to_string())).collect()
}

/// Mean chroma spread (max - min channel) of the frame at 0.5 s.
fn mean_saturation(ff: &Ffmpeg, path: &Path, dir: &Path) -> f64 {
    let png = dir.join("probe_frame.png");
    let ok = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i"])
        .arg(path)
        .args(["-frames:v", "1"])
        .arg(&png)
        .status()
        .unwrap();
    assert!(ok.success());
    let img = image::open(&png).unwrap().to_rgb8();
    let sum: f64 = img.pixels().map(|p| (*p.0.iter().max().unwrap() as f64) - (*p.0.iter().min().unwrap() as f64)).sum();
    sum / img.pixels().len() as f64
}

#[tokio::test]
async fn smooth_motion_makes_real_frames() {
    let (engine, ff) = tools_or_skip!();
    if !Rife::new(resources().join("rife")).found() {
        eprintln!("SKIPPED: RIFE not fetched");
        return;
    }
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let clip = make_clip(&ff, tmp.path(), "motion.mp4", "2");
    for (level, blur) in [(SmoothMotion::Medium, 0), (SmoothMotion::Low, 30)] {
        let anim = AnimSettings { fps: Some(60.0), smooth: level, motion_blur: blur, ..AnimSettings::default() };
        let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
        let m = out.media.unwrap();
        assert!((m.fps - 60.0).abs() < 0.5 && (m.duration_ms as i64 - 2000).abs() < 120, "{level:?}: {m:?}");
        let hashes = frame_hashes(&ff, &out.output_path);
        assert!((hashes.len() as i64 - 120).abs() <= 2, "{level:?}: {} frames", hashes.len());
        // Retiming 24 -> 60 repeats 3 frames in 5; interpolation makes new ones.
        let unique = hashes.iter().collect::<std::collections::HashSet<_>>().len();
        assert!(unique as f64 > hashes.len() as f64 * 0.95, "{level:?}: {unique}/{} unique", hashes.len());
        assert!(m.has_audio, "audio kept");
        std::fs::remove_file(&out.output_path).unwrap();
    }
}

#[tokio::test]
async fn hdr_kept_converted_and_created() {
    let (engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    // HDR10 source: HEVC Main 10 tagged PQ / BT.2020.
    let hdr = tmp.path().join("hdr src.mp4");
    lavfi(
        &ff,
        &[
            "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1", "-pix_fmt", "yuv420p10le", "-c:v", "libx265", "-x265-params",
            "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:log-level=error", "-color_primaries", "bt2020", "-color_trc", "smpte2084",
            "-colorspace", "bt2020nc", "-tag:v", "hvc1",
        ],
        &hdr,
    );
    let m = ff.probe(&hdr, MediaKind::Video).unwrap();
    assert_eq!(m.transfer, Transfer::Pq, "{m:?}");
    assert!(!m.playable, "HDR needs a tone-mapped preview");

    // Auto keeps HDR10.
    let anim = AnimSettings { hdr: HdrMode::Auto, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &hdr, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let o = out.media.unwrap();
    assert_eq!((o.transfer, o.codec.as_str(), o.pix_fmt.as_str()), (Transfer::Pq, "hevc", "yuv420p10le"), "{o:?}");
    std::fs::remove_file(&out.output_path).unwrap();

    // Off: a proper SDR file, playable everywhere.
    let anim = AnimSettings { hdr: HdrMode::Off, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &hdr, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let o = out.media.unwrap();
    assert!(o.transfer == Transfer::Sdr && o.codec == "h264" && o.playable, "{o:?}");
    // The preview copy of the HDR source is SDR and playable.
    let copy = tmp.path().join("preview.mp4");
    ff.preview_copy(&hdr, &copy, m.transfer, &m.color_matrix, 720).unwrap();
    assert!(ff.probe(&copy, MediaKind::Video).unwrap().playable);
    std::fs::remove_file(&out.output_path).unwrap();

    // Enhanced on an SDR clip: real HDR10 out.
    let sdr = make_clip(&ff, tmp.path(), "sdr.mp4", "1");
    let anim = AnimSettings { hdr: HdrMode::Enhanced, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &sdr, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let o = out.media.unwrap();
    assert_eq!((o.transfer, o.pix_fmt.as_str()), (Transfer::Pq, "yuv420p10le"), "{o:?}");
    assert!(o.has_audio && (o.duration_ms as i64 - 1000).abs() < 100, "{o:?}");
}

#[tokio::test]
async fn look_changes_colours() {
    let (engine, ff) = tools_or_skip!();
    let tmp = tempfile::tempdir().unwrap();
    // A muted source: the test pattern alone is already at full saturation.
    let clip = tmp.path().join("look.mp4");
    lavfi(&ff, &["-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1", "-vf", "eq=saturation=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p"], &clip);
    let base = mean_saturation(&ff, &clip, tmp.path());
    let anim = AnimSettings { look: Look { saturation: 60, contrast: 20, exposure: 0, sharpness: 40, glow: 0 }, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let after = mean_saturation(&ff, &out.output_path, tmp.path());
    assert!(after > base * 1.1, "saturation {base:.1} -> {after:.1}");
    let o = out.media.unwrap();
    assert!(o.playable && o.transfer == Transfer::Sdr, "{o:?}");
}

/// Mean (R, G, B) of the frames of a clip, one entry per frame (32x18 thumbnails).
fn frame_colours(ff: &Ffmpeg, path: &Path) -> Vec<[f64; 3]> {
    let out = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-vf", "scale=32:18,format=rgb24", "-f", "rawvideo", "-"])
        .output()
        .unwrap();
    out.stdout
        .chunks(32 * 18 * 3)
        .map(|f| {
            let mut c = [0.0; 3];
            for px in f.chunks(3) {
                for k in 0..3 {
                    c[k] += px[k] as f64;
                }
            }
            c.map(|v| v / (32.0 * 18.0))
        })
        .collect()
}

/// Edge energy (squared horizontal gradient) of the frame at `t` seconds (lower = blurrier).
fn edge_energy(ff: &Ffmpeg, path: &Path, t: &str, dir: &Path) -> f64 {
    let png = dir.join("edge.png");
    let ok = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", t, "-i"])
        .arg(path)
        .args(["-frames:v", "1"])
        .arg(&png)
        .status()
        .unwrap();
    assert!(ok.success());
    let img = image::open(&png).unwrap().to_luma8();
    let (w, h) = img.dimensions();
    let mut e = 0.0;
    for y in 0..h {
        for x in 1..w {
            // Squared: a soft ramp has the same total step as a hard edge, but less energy.
            e += (img.get_pixel(x, y).0[0] as f64 - img.get_pixel(x - 1, y).0[0] as f64).powi(2);
        }
    }
    e / (w * h) as f64
}

#[tokio::test]
async fn scene_cuts_are_never_morphed() {
    let (engine, ff) = tools_or_skip!();
    if !Rife::new(resources().join("rife")).found() {
        return;
    }
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    // One second of red then one second of blue, each with a moving square.
    let clip = tmp.path().join("cut.mp4");
    lavfi(
        &ff,
        &[
            "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=1", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1",
            "-f", "lavfi", "-i", "color=c=white:s=40x40:r=24:d=2",
            "-filter_complex", "[0][1]concat=n=2:v=1:a=0[bg];[bg][2]overlay=x='mod(t*200,280)':y=60",
            "-pix_fmt", "yuv420p", "-c:v", "libx264",
        ],
        &clip,
    );
    let anim = AnimSettings { fps: Some(60.0), smooth: SmoothMotion::Medium, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(last_log_has("1 scene cut(s)"), "{:?}", LAST_LOG.lock().unwrap());
    let colours = frame_colours(&ff, &out.output_path);
    assert!((colours.len() as i64 - 120).abs() <= 2, "{} frames", colours.len());
    // Every frame is clearly red or clearly blue: no red-to-blue morph.
    for (i, c) in colours.iter().enumerate() {
        let red_share = c[0] / (c[0] + c[2]).max(1.0);
        assert!(!(0.2..0.8).contains(&red_share), "frame {i} blends both shots: {c:?}");
    }
}

#[tokio::test]
async fn motion_blur_from_sub_frames() {
    let (engine, ff) = tools_or_skip!();
    if !Rife::new(resources().join("rife")).found() {
        return;
    }
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let clip = tmp.path().join("fast.mp4");
    lavfi(
        &ff,
        &[
            "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=1", "-f", "lavfi", "-i", "color=c=white:s=30x90:r=24:d=1",
            "-filter_complex", "[0][1]overlay=x='mod(t*600,280)':y=40", "-pix_fmt", "yuv420p", "-c:v", "libx264",
        ],
        &clip,
    );
    let sharp = run_anim(&engine, &ff, &clip, MediaKind::Video, AnimSettings::default(), CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let base = edge_energy(&ff, &sharp.output_path, "0.5", tmp.path());
    std::fs::remove_file(&sharp.output_path).unwrap();
    let anim = AnimSettings { motion_blur: 50, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(last_log_has("motion blur from 3 sub-frames"), "{:?}", LAST_LOG.lock().unwrap());
    let m = out.media.unwrap();
    assert!((m.fps - 24.0).abs() < 0.1 && (m.frames as i64 - 24).abs() <= 1, "rate kept: {m:?}");
    // The moving bar is smeared along its motion: fewer hard edges.
    let blurred = edge_energy(&ff, &out.output_path, "0.5", tmp.path());
    assert!(blurred < base * 0.85, "edge energy {base:.2} -> {blurred:.2}");
}

#[tokio::test]
async fn anime_cleanup_uses_realesrgan_and_hdr_uses_libplacebo() {
    let (engine, ff) = tools_or_skip!();
    if !Esrgan::new(resources().join("realesrgan")).found() {
        return;
    }
    let _gpu = GPU.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let clip = make_clip(&ff, tmp.path(), "anime.mp4", "1");
    let anim = AnimSettings { scale: 2.0, enhance: Enhance::Light, style: Style::ArtworkFast, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(last_log_has("Clean-up: realesr-animevideov3 x2"), "{:?}", LAST_LOG.lock().unwrap());
    let m = out.media.unwrap();
    assert_eq!((m.width, m.height), (640, 360));
    // Live action keeps waifu2x.
    let anim = AnimSettings { scale: 2.0, enhance: Enhance::Light, style: Style::Photo, ..AnimSettings::default() };
    run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(last_log_has("Clean-up: waifu2x"));

    // HDR -> SDR goes through libplacebo when Vulkan works.
    if ff.libplacebo() {
        let hdr = tmp.path().join("hdr.mp4");
        lavfi(
            &ff,
            &[
                "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1", "-pix_fmt", "yuv420p10le", "-c:v", "libx265", "-x265-params",
                "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:log-level=error", "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
            ],
            &hdr,
        );
        let anim = AnimSettings { hdr: HdrMode::Off, ..AnimSettings::default() };
        let out = run_anim(&engine, &ff, &hdr, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
        assert!(last_log_has("libplacebo tone mapping"));
        let m = out.media.unwrap();
        assert!(m.transfer == Transfer::Sdr && m.playable, "{m:?}");
    }
}

// ---------- Advanced clip tools ----------

fn gpu_lock() -> std::sync::MutexGuard<'static, ()> {
    GPU.lock().unwrap_or_else(|e| e.into_inner())
}

/// Per frame (16x9 grey thumbnails): mean luma.
fn frame_luma(ff: &Ffmpeg, path: &Path) -> Vec<f64> {
    let out = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-vf", "scale=16:9,format=gray", "-f", "rawvideo", "-"])
        .output()
        .unwrap();
    out.stdout.chunks(16 * 9).map(|f| f.iter().map(|&v| v as f64).sum::<f64>() / f.len() as f64).collect()
}

#[tokio::test]
async fn speed_presets_change_duration_and_keep_audio() {
    let (engine, ff) = tools_or_skip!();
    let _gpu = gpu_lock();
    let tmp = tempfile::tempdir().unwrap();
    let clip = make_clip(&ff, tmp.path(), "speed.mp4", "2");
    for (preset, want_s) in [(SpeedPreset::Slow, 4.0), (SpeedPreset::Fast, 1.0)] {
        let anim = AnimSettings { speed: SpeedSettings { preset, ..SpeedSettings::default() }, ..AnimSettings::default() };
        let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
        let m = out.media.unwrap();
        assert!((m.duration_ms as f64 / 1000.0 - want_s).abs() < 0.15, "{preset:?}: {m:?}");
        assert!(m.has_audio, "{preset:?}: audio kept");
        assert!((m.fps - 24.0).abs() < 0.1, "{preset:?}: rate kept {m:?}");
        assert!(out.timing.is_some());
        std::fs::remove_file(&out.output_path).unwrap();
    }
    // A ramp: total length from the curve, audio follows.
    let anim = AnimSettings { speed: SpeedSettings { preset: SpeedPreset::Ramp, ..SpeedSettings::default() }, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let total = out.timing.unwrap().last().unwrap()[0];
    let m = out.media.unwrap();
    assert!((m.duration_ms as f64 / 1000.0 - total).abs() < 0.15, "{m:?} vs {total}");
    assert!(m.has_audio);
}

#[tokio::test]
async fn smart_reframe_follows_the_subject_and_fills_portrait() {
    let (engine, ff) = tools_or_skip!();
    let _gpu = gpu_lock();
    let tmp = tempfile::tempdir().unwrap();
    // A white square crossing a dark 16:9 frame from left to right over 3 s.
    let clip = tmp.path().join("pan.mp4");
    lavfi(
        &ff,
        &[
            "-f", "lavfi", "-i", "color=c=0x202020:s=640x360:r=30:d=3", "-f", "lavfi", "-i", "color=c=white:s=60x60:r=30:d=3",
            "-filter_complex", "[0][1]overlay=x='20+t*180':y=150", "-pix_fmt", "yuv420p", "-c:v", "libx264",
        ],
        &clip,
    );
    let anim = AnimSettings { format: FrameFormat::Portrait, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(last_log_has("following the content"), "{:?}", LAST_LOG.lock().unwrap());
    assert!(out.output_path.to_string_lossy().contains("_9x16"));
    let m = out.media.unwrap();
    assert_eq!((m.width, m.height), (202, 360));
    // The square stays in the frame (a centred crop loses it at both ends).
    let frames = frame_luma(&ff, &out.output_path);
    let lost = frames.iter().filter(|&&mean| mean < 37.0).count();
    assert!(lost <= 3, "square out of frame in {lost} of {} frames", frames.len());
    std::fs::remove_file(&out.output_path).unwrap();

    // Off: a still centred crop.
    let anim = AnimSettings { format: FrameFormat::Portrait, reframe: false, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(last_log_has("still at 219,0"), "{:?}", LAST_LOG.lock().unwrap());
    let lost = frame_luma(&ff, &out.output_path).iter().filter(|&&mean| mean < 37.0).count();
    assert!(lost > 20, "a centred crop misses the square at both ends ({lost})");
    std::fs::remove_file(&out.output_path).unwrap();

    // Portrait to landscape: the whole picture on a blurred background.
    let tall = tmp.path().join("tall.mp4");
    lavfi(&ff, &["-f", "lavfi", "-i", "testsrc2=s=360x640:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p"], &tall);
    let anim = AnimSettings { format: FrameFormat::Landscape, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &tall, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let m = out.media.unwrap();
    assert_eq!((m.width, m.height), (640, 360), "{m:?}");
}

#[tokio::test]
async fn held_drawings_are_interpolated_between() {
    let (engine, ff) = tools_or_skip!();
    if !Rife::new(resources().join("rife")).found() {
        return;
    }
    let _gpu = gpu_lock();
    let tmp = tempfile::tempdir().unwrap();
    // "On twos": the square moves every other frame.
    let clip = tmp.path().join("twos.mp4");
    lavfi(
        &ff,
        &[
            "-f", "lavfi", "-i", "color=c=0x303030:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "color=c=white:s=30x30:r=24:d=2",
            "-filter_complex", "[0][1]overlay=x='10+floor(n/2)*10':y=70", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-qp", "0",
        ],
        &clip,
    );
    let anim = AnimSettings { fps: Some(48.0), smooth: SmoothMotion::Medium, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(last_log_has("held drawings:"), "{:?}", LAST_LOG.lock().unwrap());
    // The square moves on every output frame (no stop-and-go).
    let raw = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&out.output_path)
        .args(["-vf", "crop=320:30:0:70,scale=320:1,format=gray", "-f", "rawvideo", "-"])
        .output()
        .unwrap()
        .stdout;
    let centre = |row: &[u8]| {
        let (s, w) = row.iter().enumerate().fold((0.0, 0.0), |(s, w), (x, &v)| if v > 128 { (s + x as f64, w + 1.0) } else { (s, w) });
        s / f64::max(w, 1.0)
    };
    let xs: Vec<f64> = raw.chunks(320).map(centre).collect();
    let steps: Vec<f64> = xs.windows(2).skip(4).take(60).map(|p| p[1] - p[0]).collect();
    let still = steps.iter().filter(|d| d.abs() < 1.0).count();
    assert!(still <= 3, "{still} still frames: {steps:?}");
}

#[tokio::test]
async fn beat_sync_finds_the_beat_or_says_so() {
    let (engine, ff) = tools_or_skip!();
    let _gpu = gpu_lock();
    let tmp = tempfile::tempdir().unwrap();
    // 120 BPM clicks over a test pattern.
    let clip = tmp.path().join("beat.mp4");
    lavfi(
        &ff,
        &[
            "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=8",
            "-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*900*t)*lt(mod(t\\,0.5)\\,0.03):s=44100:d=8",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        ],
        &clip,
    );
    let anim = AnimSettings { beat: BeatSync { on: true, zoom: true, shake: true }, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim.clone(), CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(out.notices.iter().any(|n| n == "beat:120"), "{:?} {:?}", out.notices, LAST_LOG.lock().unwrap());
    let m = out.media.unwrap();
    assert_eq!((m.width, m.height), (320, 180));
    std::fs::remove_file(&out.output_path).unwrap();
    // A plain tone has no beat: nothing added, and the result says so.
    let tone = make_clip(&ff, tmp.path(), "tone.mp4", "6");
    let out = run_anim(&engine, &ff, &tone, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert_eq!(out.notices, vec!["beatNotFound".to_string()]);
}

#[tokio::test]
async fn luts_and_glow() {
    let (engine, ff) = tools_or_skip!();
    let _gpu = gpu_lock();
    let tmp = tempfile::tempdir().unwrap();
    let clip = make_clip(&ff, tmp.path(), "lut.mp4", "1");
    // Built-in black & white look.
    let anim = AnimSettings { lut: Some("builtin:mono".into()), lut_strength: 100, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    assert!(mean_saturation(&ff, &out.output_path, tmp.path()) < 6.0);
    std::fs::remove_file(&out.output_path).unwrap();
    // An imported .cube that swaps red and blue.
    let luts = tmp.path().join("luts");
    let mut cube = String::from("LUT_3D_SIZE 2\n");
    for b in 0..2 {
        for g in 0..2 {
            for r in 0..2 {
                cube.push_str(&format!("{b} {g} {r}\n"));
            }
        }
    }
    let src = tmp.path().join("swap.cube");
    std::fs::write(&src, cube).unwrap();
    let info = aoze_lib::looks::import(&src, &luts).unwrap();
    *LUTS.lock().unwrap() = Some(luts.clone());
    let red = tmp.path().join("red.mp4");
    lavfi(&ff, &["-f", "lavfi", "-i", "color=c=red:s=160x90:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p"], &red);
    let anim = AnimSettings { lut: Some(info.id.clone()), lut_strength: 100, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &red, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    *LUTS.lock().unwrap() = None;
    let c = frame_colours(&ff, &out.output_path)[5];
    assert!(c[2] > 150.0 && c[0] < 80.0, "red became blue: {c:?}");
    std::fs::remove_file(&out.output_path).unwrap();
    // Glow brightens around bright areas.
    let base: f64 = frame_luma(&ff, &clip).iter().sum();
    let anim = AnimSettings { look: Look { glow: 80, ..Look::default() }, ..AnimSettings::default() };
    let out = run_anim(&engine, &ff, &clip, MediaKind::Video, anim, CompressSettings::default(), tmp.path(), &CancellationToken::new()).await.unwrap();
    let glow: f64 = frame_luma(&ff, &out.output_path).iter().sum();
    assert!(glow > base * 1.03, "luma {base:.0} -> {glow:.0}");
}

#[tokio::test]
#[ignore]
async fn real_clips() {
    // AOZE_REAL=<folder with anime.mp4, film_action.mp4, ...>: runs each scenario,
    // writes the results and a 12-frame contact sheet to <folder>/out, prints a summary.
    let Ok(dir) = std::env::var("AOZE_REAL") else { return };
    let (engine, ff) = tools_or_skip!();
    let _gpu = gpu_lock();
    let dir = PathBuf::from(dir);
    let out_dir = dir.join("out");
    std::fs::create_dir_all(&out_dir).unwrap();
    let only = std::env::var("AOZE_REAL_ONLY").ok();
    let d = AnimSettings::default;
    let smooth60 = || AnimSettings { fps: Some(60.0), smooth: SmoothMotion::Medium, ..d() };
    let ramp = SpeedSettings { preset: SpeedPreset::Ramp, ..SpeedSettings::default() };
    let scenarios: Vec<(&str, &str, AnimSettings)> = vec![
        ("anime.mp4", "smooth60", smooth60()),
        ("anime.mp4", "tiktok_ramp_blur", AnimSettings { motion_blur: 50, speed: ramp, ..smooth60() }),
        ("anime.mp4", "blur_only", AnimSettings { motion_blur: 50, ..d() }),
        ("film_action.mp4", "smooth60_blur", AnimSettings { motion_blur: 40, ..smooth60() }),
        ("film_action.mp4", "portrait_reframe", AnimSettings { format: FrameFormat::Portrait, ..d() }),
        ("film_action.mp4", "cinematic_lut_glow", AnimSettings { lut: Some("builtin:teal-orange".into()), lut_strength: 60, look: Look { contrast: 15, saturation: -5, glow: 20, ..Look::default() }, ..d() }),
        ("film_dark.mp4", "smooth60", smooth60()),
        ("film_dark.mp4", "hdr_enhanced_lut", AnimSettings { hdr: HdrMode::Enhanced, lut: Some("builtin:warm".into()), lut_strength: 80, ..d() }),
        ("fast60.mp4", "smooth120", AnimSettings { fps: Some(120.0), smooth: SmoothMotion::Medium, ..d() }),
        ("fast60.mp4", "slow_blur", AnimSettings { motion_blur: 40, speed: SpeedSettings { preset: SpeedPreset::Slow, ..SpeedSettings::default() }, ..d() }),
        ("live30.mp4", "smooth60", smooth60()),
        ("live30.mp4", "square_reframe", AnimSettings { format: FrameFormat::Square, ..d() }),
        ("lowres240.mp4", "smooth60_x2_cleanup", AnimSettings { scale: 2.0, enhance: Enhance::Light, style: Style::Photo, ..smooth60() }),
        ("screen.mp4", "portrait_reframe", AnimSettings { format: FrameFormat::Portrait, ..d() }),
        ("music_edit.mp4", "beat_zoom_shake", AnimSettings { beat: BeatSync { on: true, zoom: true, shake: true }, ..d() }),
        ("music_edit.mp4", "fast_beat", AnimSettings { beat: BeatSync { on: true, zoom: true, shake: false }, speed: SpeedSettings { preset: SpeedPreset::Fast, ..SpeedSettings::default() }, ..d() }),
    ];
    let mut summary = Vec::new();
    for (clip, name, anim) in scenarios {
        if only.as_deref().is_some_and(|o| !name.contains(o) && !clip.contains(o)) {
            continue;
        }
        let src = dir.join(clip);
        let work = tempfile::tempdir().unwrap();
        let started = std::time::Instant::now();
        let res = run_anim(&engine, &ff, &src, MediaKind::Video, anim, CompressSettings::default(), work.path(), &CancellationToken::new()).await;
        let secs = started.elapsed().as_secs_f64();
        let line = match res {
            Ok(out) => {
                let m = out.media.clone().unwrap();
                let dest = out_dir.join(format!("{}_{name}.mp4", clip.trim_end_matches(".mp4")));
                std::fs::copy(&out.output_path, &dest).unwrap();
                let sheet = out_dir.join(format!("{}_{name}.png", clip.trim_end_matches(".mp4")));
                let mid = (m.duration_ms as f64 / 2000.0).to_string();
                let _ = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
                    .args(["-v", "error", "-y", "-ss", &mid, "-i"])
                    .arg(&dest)
                    .args(["-vf", "select='lt(n,12)',scale=240:-2,tile=6x2", "-frames:v", "1"])
                    .arg(&sheet)
                    .status();
                format!(
                    "{clip:16} {name:22} OK {secs:6.1}s  {}x{} {:.2}fps {} frames {:.2}s audio={} notices={:?}",
                    m.width, m.height, m.fps, m.frames, m.duration_ms as f64 / 1000.0, m.has_audio, out.notices
                )
            }
            Err(e) => format!("{clip:16} {name:22} FAILED {secs:6.1}s {:?}: {}", e.code, e.detail),
        };
        eprintln!("RESULT {line}");
        let log = LAST_LOG.lock().unwrap().iter().filter(|l| !l.starts_with('$') && !l.starts_with("[0 ")).cloned().collect::<Vec<_>>().join("
    ");
        summary.push(format!("{line}
    {log}"));
    }
    std::fs::write(out_dir.join("summary.txt"), summary.join("
")).unwrap();
}
