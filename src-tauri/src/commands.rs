//! Thin Tauri command layer: argument plumbing only, logic lives in `core`/`queue`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::core::{Core, SystemCheck, SystemStatus};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fsutil::write_atomic;
use crate::history::HistoryEntry;
use crate::queue::{AddResult, QueueSnapshot};
use crate::settings::Settings;

type CoreState<'a> = State<'a, Arc<Core>>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))
}

#[tauri::command]
pub async fn get_system_status(core: CoreState<'_>) -> AppResult<SystemStatus> {
    Ok(core.system_status())
}

#[tauri::command]
pub async fn refresh_system_status(core: CoreState<'_>) -> AppResult<SystemStatus> {
    let c = core.inner().clone();
    blocking(move || c.refresh_vulkan()).await?;
    Ok(core.system_status())
}

/// Quick hardware check for the splash. Waits (briefly) for the Vulkan
/// detection started at launch instead of running a second one.
#[tauri::command]
pub async fn system_check(core: CoreState<'_>) -> AppResult<SystemCheck> {
    for _ in 0..80 {
        if core.vulkan_detected() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let c = core.inner().clone();
    blocking(move || c.system_check()).await
}

#[tauri::command]
pub async fn get_settings(core: CoreState<'_>) -> AppResult<Settings> {
    Ok(core.settings())
}

#[tauri::command]
pub async fn save_settings(core: CoreState<'_>, settings: Settings) -> AppResult<Settings> {
    core.update_settings(settings)
}

#[tauri::command]
pub async fn add_files(core: CoreState<'_>, paths: Vec<PathBuf>, purpose: Option<crate::queue::Purpose>) -> AppResult<AddResult> {
    let c = core.inner().clone();
    blocking(move || c.add_files_for(paths, purpose.unwrap_or_default())).await
}

/// Receives raw image bytes pasted from the clipboard and adds them as a job.
#[tauri::command]
pub async fn add_pasted_image(core: CoreState<'_>, request: tauri::ipc::Request<'_>) -> AppResult<AddResult> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::new(ErrorCode::InvalidParams, "expected raw image bytes"));
    };
    let format = image::guess_format(bytes).map_err(|e| AppError::new(ErrorCode::UnsupportedFormat, e.to_string()))?;
    let ext = match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Bmp => "bmp",
        image::ImageFormat::Tiff => "tiff",
        other => return Err(AppError::new(ErrorCode::UnsupportedFormat, format!("{other:?}"))),
    };
    let stamp = crate::fsutil::now_ms();
    let path = core.paths.pasted_dir().join(format!("pasted-{stamp}.{ext}"));
    write_atomic(&path, bytes)?;
    let c = core.inner().clone();
    blocking(move || c.add_files(vec![path])).await
}

/// Exact size a "Compress" job would produce with the current settings (a real encode).
#[tauri::command]
pub async fn estimate_compression(core: CoreState<'_>, id: String) -> AppResult<crate::compress::CompressReport> {
    let job = core
        .queue_snapshot()
        .jobs
        .into_iter()
        .find(|j| j.id == id)
        .ok_or_else(|| AppError::new(ErrorCode::InvalidParams, "unknown job"))?;
    if job.source.kind != crate::media::MediaKind::Image {
        return Err(AppError::new(ErrorCode::InvalidParams, "only still images can be estimated"));
    }
    let settings = core.settings();
    let c = &settings.image_compress;
    let plan = crate::pipeline::CompressPlan { quality: c.quality(), limit: c.limit_bytes() };
    blocking(move || crate::pipeline::compress_image(&job.source.path, None, &settings.output, plan).map(|e| e.report)).await?
}

/// A custom startup sound dropped by the user in the config folder
/// (startup-sound.mp3 / .ogg / .wav). None = the built-in synthesized chime.
#[tauri::command]
pub async fn startup_sound_path(core: CoreState<'_>) -> AppResult<Option<PathBuf>> {
    let found = ["mp3", "ogg", "wav"]
        .iter()
        .map(|ext| core.paths.config_dir.join(format!("startup-sound.{ext}")))
        .find(|p| p.is_file());
    if let Some(p) = &found {
        core.hooks.allow_file(p);
    }
    Ok(found)
}

#[tauri::command]
pub async fn get_queue(core: CoreState<'_>) -> AppResult<QueueSnapshot> {
    Ok(core.queue_snapshot())
}

#[tauri::command]
pub async fn enqueue(core: CoreState<'_>, ids: Option<Vec<String>>) -> AppResult<usize> {
    Ok(core.enqueue(ids))
}

#[tauri::command]
pub async fn cancel_job(core: CoreState<'_>, id: String) -> AppResult<()> {
    core.cancel_job(&id);
    Ok(())
}

#[tauri::command]
pub async fn cancel_all(core: CoreState<'_>) -> AppResult<()> {
    core.cancel_all();
    Ok(())
}

#[tauri::command]
pub async fn set_paused(core: CoreState<'_>, paused: bool) -> AppResult<()> {
    core.set_paused(paused);
    Ok(())
}

#[tauri::command]
pub async fn retry_jobs(core: CoreState<'_>, ids: Option<Vec<String>>) -> AppResult<()> {
    core.retry(ids);
    Ok(())
}

#[tauri::command]
pub async fn remove_jobs(core: CoreState<'_>, ids: Vec<String>) -> AppResult<()> {
    core.remove_jobs(&ids);
    Ok(())
}

#[tauri::command]
pub async fn clear_finished(core: CoreState<'_>) -> AppResult<()> {
    core.clear_finished();
    Ok(())
}

#[tauri::command]
pub async fn duplicate_job(core: CoreState<'_>, id: String) -> AppResult<Option<String>> {
    Ok(core.duplicate_job(&id))
}

#[tauri::command]
pub async fn get_job_log(core: CoreState<'_>, id: String) -> AppResult<Vec<String>> {
    Ok(core.job_log(&id))
}

#[tauri::command]
pub async fn get_history(core: CoreState<'_>) -> AppResult<Vec<HistoryEntry>> {
    Ok(core.history.list())
}

#[tauri::command]
pub async fn remove_history(core: CoreState<'_>, id: String) -> AppResult<()> {
    core.history.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn clear_history(core: CoreState<'_>) -> AppResult<()> {
    core.history.clear();
    Ok(())
}

/// Only files the app itself knows about (queue sources/outputs, history) can be opened.
fn ensure_known(core: &Core, path: &Path) -> AppResult<()> {
    let snapshot = core.queue_snapshot();
    let in_queue = snapshot.jobs.iter().any(|j| {
        j.source.path == path
            || j.result.as_ref().is_some_and(|r| r.output_path == path)
            || j.skipped_path.as_deref() == Some(path)
    });
    if in_queue || core.history.contains_path(path) {
        Ok(())
    } else {
        Err(AppError::new(ErrorCode::InvalidParams, format!("not an app file: {}", path.display())))
    }
}

#[tauri::command]
pub async fn open_file(app: AppHandle, core: CoreState<'_>, path: PathBuf) -> AppResult<()> {
    ensure_known(&core, &path)?;
    if !path.exists() {
        return Err(AppError::new(ErrorCode::FileNotFound, path.display().to_string()));
    }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))
}

#[tauri::command]
pub async fn reveal_file(app: AppHandle, core: CoreState<'_>, path: PathBuf) -> AppResult<()> {
    ensure_known(&core, &path)?;
    if path.exists() {
        app.opener().reveal_item_in_dir(&path).map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))
    } else if let Some(dir) = path.parent().filter(|d| d.is_dir()) {
        app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))
    } else {
        Err(AppError::new(ErrorCode::FileNotFound, path.display().to_string()))
    }
}

#[tauri::command]
pub async fn open_logs_dir(app: AppHandle, core: CoreState<'_>) -> AppResult<()> {
    std::fs::create_dir_all(&core.paths.log_dir)?;
    app.opener()
        .open_path(core.paths.log_dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))
}

fn tail(path: &Path, lines: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

#[tauri::command]
pub async fn get_diagnostics(app: AppHandle, core: CoreState<'_>) -> AppResult<String> {
    let status = core.system_status();
    let settings = core.settings();
    let mut out = String::new();
    let mut line = |s: String| {
        out.push_str(&s);
        out.push('\n');
    };
    line(format!("Aoze {}", status.app_version));
    line(format!("OS: {} {}", std::env::consts::OS, std::env::consts::ARCH));
    line(format!("WebView2: {}", tauri::webview_version().unwrap_or_else(|_| "unknown".into())));
    line(String::new());
    line(format!("Engine: {} {}", status.engine.name, status.engine.version.as_deref().unwrap_or("unknown version")));
    line(format!("  found: {}  dir: {}", status.engine.found, status.engine.dir));
    for m in &status.engine.models {
        line(format!(
            "  {:?} ({}): installed={} 2x={} noise2x={:?} noise1x={:?}",
            m.style, m.dir, m.installed, m.scale2, m.noise_scale2, m.noise_scale1
        ));
    }
    let ff = &status.ffmpeg;
    line(format!("FFmpeg: found={} {} hw encoders={:?}", ff.found, ff.version.as_deref().unwrap_or("-"), ff.encoders));
    line(String::new());
    let vk = &status.vulkan;
    line(format!("Vulkan: available={} instance={}", vk.available, vk.instance_version.as_deref().unwrap_or("-")));
    if let Some(e) = &vk.error {
        line(format!("  error: {e}"));
    }
    for g in &vk.gpus {
        line(format!(
            "  [{}] {} ({:?}) vram={} MB api={} driver={}{}",
            g.index,
            g.name,
            g.kind,
            g.vram_bytes / (1024 * 1024),
            g.api_version,
            g.driver_version,
            if vk.default_gpu == Some(g.index) { " (default)" } else { "" }
        ));
    }
    line(String::new());
    line(format!("Settings: {}", serde_json::to_string(&settings).unwrap_or_default()));
    line(String::new());

    let snapshot = core.queue_snapshot();
    if let Some(job) = snapshot.jobs.iter().filter(|j| j.started_at.is_some()).max_by_key(|j| j.started_at) {
        line(format!("Last job: {} -> {:?}", job.source.path.display(), job.status));
        if let Some(e) = &job.error {
            line(format!("  error: {:?} {}", e.code, e.detail));
        }
        for l in core.job_log(&job.id) {
            line(format!("  | {l}"));
        }
        line(String::new());
    }
    let log_file = app.path().app_log_dir().map(|d| d.join("aoze.log")).unwrap_or_default();
    line(format!("App log (last 80 lines of {}):", log_file.display()));
    line(tail(&log_file, 80));
    Ok(out)
}
