//! GIF encoding with a tiny memory budget: the palette is computed in a first
//! pass instead of holding every frame. Own test binary, because the budget
//! is process-wide.

use std::path::PathBuf;

use aoze_lib::convert::{self, Conversion, ConvertSpec};
use aoze_lib::imaging::ImageInfo;
use aoze_lib::media::{Ffmpeg, MediaKind};
use aoze_lib::settings::{ConvertSettings, OutputOptions, Threads};
use aoze_lib::tuning::{self, Tuning};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn two_pass_palette_when_frames_exceed_budget() {
    let ff = Ffmpeg::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("ffmpeg"));
    if !ff.found() {
        eprintln!("SKIPPED: FFmpeg not fetched");
        return;
    }
    tuning::publish(&Tuning {
        tile_size: 0,
        threads: Threads::default(),
        block_bytes: 1,
        background_priority: true,
        quality_presets: false,
        automatic: true,
    });
    let tmp = tempfile::tempdir().unwrap();
    let clip = tmp.path().join("clip.mp4");
    let status = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=2", "-pix_fmt", "yuv420p"])
        .arg(&clip)
        .status()
        .unwrap();
    assert!(status.success());

    let media = ff.probe(&clip, MediaKind::Video).unwrap();
    let info = ImageInfo { width: media.width, height: media.height, size_bytes: media.size_bytes, format: String::new() };
    let logs = std::sync::Mutex::new(Vec::<String>::new());
    let spec = ConvertSpec {
        conversion: Conversion::ClipToGif,
        source: &clip,
        images: &[],
        image_info: &info,
        media: Some(&media),
        settings: &ConvertSettings::default(),
        output: &OutputOptions::default(),
        encoder: None,
        fallback_output_dir: tmp.path(),
        work_dir: &tmp.path().join("work"),
        keep_temp: false,
    };
    let r = convert::run(&ff, spec, &|_| {}, &|_, _| {}, &|l| logs.lock().unwrap().push(l), &CancellationToken::new()).await.unwrap();
    assert!(logs.lock().unwrap().iter().any(|l| l.contains("two-pass palette")), "{:?}", logs.lock().unwrap());
    let m = r.media.unwrap();
    assert_eq!((m.width, m.height), (320, 180));
    assert!((m.fps - 15.0).abs() < 1.0 && (m.duration_ms as i64 - 2000).abs() < 200, "{m:?}");
    // No palette file left next to the result.
    let leftovers: Vec<_> = std::fs::read_dir(tmp.path()).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains("palette")).collect();
    assert!(leftovers.is_empty());
}

/// Small memory budget: a clip goes through Clean-up and Smooth Motion in
/// many blocks of 8 frames; the cadence must stay exact across them.
#[tokio::test]
async fn smooth_motion_across_many_blocks() {
    use aoze_lib::anim::{self, AnimSpec};
    use aoze_lib::engine::waifu2x::Waifu2xEngine;
    use aoze_lib::settings::{AnimSettings, CompressSettings, Enhance, SmoothMotion, UpscaleParams};
    use aoze_lib::smooth::Rife;
    let res = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    let ff = Ffmpeg::new(res.join("ffmpeg"));
    let rife = Rife::new(res.join("rife"));
    let engine = Waifu2xEngine::new(res.join("engine"));
    if !ff.found() || !rife.found() || !engine.exe().is_file() {
        eprintln!("SKIPPED: tools not fetched");
        return;
    }
    tuning::publish(&Tuning { tile_size: 0, threads: Threads::default(), block_bytes: 1, background_priority: true, quality_presets: false, automatic: true });
    let tmp = tempfile::tempdir().unwrap();
    let clip = tmp.path().join("ntsc clip.mp4");
    let status = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=24000/1001:d=2", "-pix_fmt", "yuv420p"])
        .arg(&clip)
        .status()
        .unwrap();
    assert!(status.success());
    let info = ff.probe(&clip, MediaKind::Video).unwrap();
    let anim = AnimSettings { fps: Some(60.0), smooth: SmoothMotion::Medium, enhance: Enhance::Light, ..AnimSettings::default() };
    let params = UpscaleParams { tile_size: 128, ..UpscaleParams::default() };
    let compress = CompressSettings::default();
    let logs = std::sync::Mutex::new(Vec::<String>::new());
    let spec = AnimSpec {
        kind: MediaKind::Video,
        source: &clip,
        info: &info,
        anim: &anim,
        params: &params,
        compress: &compress,
        output: &OutputOptions::default(),
        encoder: None,
        fallback_output_dir: tmp.path(),
        work_dir: &tmp.path().join("work"),
        keep_temp: false,
        target: None,
        rife: Some(&rife),
        esrgan: None,
        vram_bytes: 0,
    };
    let r = anim::run(&engine, &ff, spec, &|_| {}, &|_, _| {}, &|l| logs.lock().unwrap().push(l), &CancellationToken::new()).await.unwrap();
    let m = r.media.unwrap();
    let blocks = logs.lock().unwrap().iter().find(|l| l.contains("block(s)")).cloned().unwrap_or_default();
    assert!(blocks.contains("48 frames, 6 block(s)"), "{blocks}");
    // 23.976 -> 59.94: 48 frames become 120, same duration.
    assert!((m.fps - 59.94).abs() < 0.05 && m.frames == 120, "{m:?}");
    assert!((m.duration_ms as i64 - info.duration_ms as i64).abs() < 60, "{m:?} vs {info:?}");
}

/// A clip cancelled half-way resumes from its finished segments.
#[tokio::test]
async fn interrupted_clip_resumes() {
    use aoze_lib::anim::{self, AnimSpec};
    use aoze_lib::engine::waifu2x::Waifu2xEngine;
    use aoze_lib::settings::{AnimSettings, CompressSettings, SmoothMotion, UpscaleParams};
    use aoze_lib::smooth::Rife;
    let res = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    let ff = Ffmpeg::new(res.join("ffmpeg"));
    let rife = Rife::new(res.join("rife"));
    let engine = Waifu2xEngine::new(res.join("engine"));
    if !ff.found() || !rife.found() {
        eprintln!("SKIPPED: tools not fetched");
        return;
    }
    tuning::publish(&Tuning { tile_size: 0, threads: Threads::default(), block_bytes: 1, background_priority: true, quality_presets: false, automatic: true });
    let tmp = tempfile::tempdir().unwrap();
    let clip = tmp.path().join("resume me.mp4");
    let status = std::process::Command::new(ff.dir().join("ffmpeg.exe"))
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=24:d=4", "-pix_fmt", "yuv420p"])
        .arg(&clip)
        .status()
        .unwrap();
    assert!(status.success());
    let info = ff.probe(&clip, MediaKind::Video).unwrap();
    let anim = AnimSettings { fps: Some(60.0), smooth: SmoothMotion::Medium, ..AnimSettings::default() };
    let params = UpscaleParams::default();
    let compress = CompressSettings::default();
    let work = tmp.path().join("work");
    let run = |cancel: CancellationToken, logs: std::sync::Arc<std::sync::Mutex<Vec<String>>>| {
        let (clip, info, anim, params, compress, work, ff, rife, engine) = (&clip, &info, &anim, &params, &compress, &work, &ff, &rife, &engine);
        async move {
            let spec = AnimSpec {
                kind: MediaKind::Video,
                source: clip,
                info,
                anim,
                params,
                compress,
                output: &OutputOptions::default(),
                encoder: None,
                fallback_output_dir: clip.parent().unwrap(),
                work_dir: work,
                keep_temp: false,
                target: None,
                rife: Some(rife),
                esrgan: None,
                vram_bytes: 0,
            };
            anim::run(engine, ff, spec, &|_| {}, &|_, _| {}, &|l| logs.lock().unwrap().push(l), &cancel).await
        }
    };
    // First run: cancelled once three segments are written.
    let cancel = CancellationToken::new();
    let watcher = {
        let (c, w) = (cancel.clone(), work.clone());
        tokio::spawn(async move {
            loop {
                let segs = walk_count(&w, "seg_");
                if segs >= 3 {
                    c.cancel();
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
    };
    let first = run(cancel, Default::default()).await;
    watcher.abort();
    assert!(first.is_err(), "the first run is cancelled");
    // Second run picks up the finished segments.
    let logs: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();
    let out = run(CancellationToken::new(), logs.clone()).await.unwrap();
    let logs = logs.lock().unwrap();
    assert!(logs.iter().any(|l| l.contains("resuming: ") && l.contains("frames already extracted")), "{logs:?}");
    assert!(logs.iter().any(|l| l.contains("blocks already done")), "{logs:?}");
    let m = out.media.unwrap();
    assert!(m.frames == 240 && (m.fps - 60.0).abs() < 0.01, "{m:?}");
    // Success removes the work folder.
    assert_eq!(walk_count(&work, ""), 0);
}

/// Files under `dir` whose name starts with `prefix`.
fn walk_count(dir: &std::path::Path, prefix: &str) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() {
                walk_count(&p, prefix) + usize::from(prefix.is_empty())
            } else {
                usize::from(e.file_name().to_string_lossy().starts_with(prefix) && !e.file_name().to_string_lossy().contains(".part"))
            }
        })
        .sum()
}
