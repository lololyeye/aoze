pub mod analysis;
pub mod anim;
pub mod beat;
pub mod color;
pub mod commands;
pub mod compress;
pub mod convert;
pub mod core;
pub mod engine;
pub mod error;
pub mod fsutil;
pub mod gpu;
pub mod history;
pub mod imaging;
pub mod looks;
pub mod media;
pub mod output;
pub mod perf;
pub mod pipeline;
pub mod queue;
pub mod reframe;
pub mod settings;
pub mod esrgan;
pub mod smooth;
pub mod timemap;
pub mod tuning;
pub mod update;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::core::{AppPaths, Core, Hooks};
use crate::queue::QueueEvent;

struct TauriHooks {
    app: AppHandle,
}

impl Hooks for TauriHooks {
    fn emit(&self, event: QueueEvent) {
        let result = match event {
            QueueEvent::Updated(s) => self.app.emit("queue://updated", s),
            QueueEvent::Progress(p) => self.app.emit("queue://progress", p),
            QueueEvent::Log { id, line } => self.app.emit("queue://log", serde_json::json!({ "id": id, "line": line })),
            QueueEvent::BatchFinished(b) => self.app.emit("queue://batch-finished", b),
        };
        if let Err(e) = result {
            log::warn!("emit failed: {e}");
        }
    }

    fn allow_file(&self, path: &Path) {
        if let Err(e) = self.app.asset_protocol_scope().allow_file(path) {
            log::warn!("asset scope: {e}");
        }
    }
}

fn resolve_paths(app: &AppHandle) -> tauri::Result<AppPaths> {
    let p = app.path();
    let mut engine = p.resource_dir()?.join("engine");
    if cfg!(debug_assertions) && !engine.join(engine::waifu2x::EXE_NAME).is_file() {
        engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("engine");
    }
    let mut ffmpeg = p.resource_dir()?.join("ffmpeg");
    if cfg!(debug_assertions) && !ffmpeg.join("ffmpeg.exe").is_file() {
        ffmpeg = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("ffmpeg");
    }
    let mut rife = p.resource_dir()?.join("rife");
    if cfg!(debug_assertions) && !rife.join(smooth::EXE_NAME).is_file() {
        rife = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("rife");
    }
    let mut esrgan = p.resource_dir()?.join("realesrgan");
    if cfg!(debug_assertions) && !esrgan.join(esrgan::EXE_NAME).is_file() {
        esrgan = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("realesrgan");
    }
    let fallback = p
        .picture_dir()
        .or_else(|_| p.document_dir())
        .map(|d| d.join("Aoze"))
        .or_else(|_| p.app_data_dir().map(|d| d.join("output")))?;
    Ok(AppPaths {
        config_dir: p.app_config_dir()?,
        cache_dir: p.app_cache_dir()?,
        log_dir: p.app_log_dir()?,
        bundled_engine_dir: queue::strip_unc(engine),
        ffmpeg_dir: queue::strip_unc(ffmpeg),
        rife_dir: queue::strip_unc(rife),
        esrgan_dir: queue::strip_unc(esrgan),
        fallback_output_dir: fallback,
    })
}

/// Aoze was called Kirei: carry its settings, history and measured speeds over
/// on first launch (the old folders are left untouched).
fn migrate_from_kirei(config_dir: &Path) {
    if config_dir.join("settings.json").exists() {
        return;
    }
    let Some(old) = config_dir.parent().map(|d| d.join("app.kirei.upscaler")) else { return };
    if !old.is_dir() {
        return;
    }
    let _ = std::fs::create_dir_all(config_dir);
    for f in ["settings.json", "history.json", "performance.json"] {
        if old.join(f).is_file() {
            match std::fs::copy(old.join(f), config_dir.join(f)) {
                Ok(_) => log::info!("migrated {f} from Kirei"),
                Err(e) => log::warn!("could not migrate {f}: {e}"),
            }
        }
    }
}

/// Files passed on the command line ("Open with", Explorer context menu).
fn file_args(args: &[String]) -> Vec<PathBuf> {
    args.iter().skip(1).filter(|a| !a.starts_with('-')).map(PathBuf::from).filter(|p| p.exists()).collect()
}

fn add_from_args(core: Arc<Core>, args: Vec<String>) {
    let files = file_args(&args);
    if files.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let _ = tokio::task::spawn_blocking(move || core.add_files(files)).await;
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_plugin = tauri_plugin_log::Builder::new()
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("aoze".into()) }),
        ])
        .level(log::LevelFilter::Info)
        .max_file_size(2_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(core) = app.try_state::<Arc<Core>>() {
                add_from_args(core.inner().clone(), args);
            }
        }))
        .plugin(log_plugin)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::UpdateState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = resolve_paths(&handle)?;
            log::info!("Aoze {} starting; engine dir {}", env!("CARGO_PKG_VERSION"), paths.bundled_engine_dir.display());
            migrate_from_kirei(&paths.config_dir);
            let core = Core::new(paths, Box::new(TauriHooks { app: handle.clone() }));
            app.manage(core.clone());

            tauri::async_runtime::spawn(queue::run_worker(core.clone()));
            {
                let (core, handle) = (core.clone(), handle.clone());
                tauri::async_runtime::spawn(async move {
                    let c = core.clone();
                    if tokio::task::spawn_blocking(move || c.refresh_vulkan()).await.is_ok() {
                        let _ = handle.emit("system://updated", core.system_status());
                    }
                    // Hardware video encoders: a short test encode each.
                    let c = core.clone();
                    if tokio::task::spawn_blocking(move || c.refresh_encoders()).await.is_ok() {
                        let _ = handle.emit("system://updated", core.system_status());
                    }
                });
            }
            add_from_args(core, std::env::args().collect());

            // The window starts hidden and the UI shows it once styled; never
            // leave it invisible if the frontend failed to load.
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        log::warn!("frontend did not show the window in time, showing it");
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_system_status,
            commands::refresh_system_status,
            commands::system_check,
            commands::get_settings,
            commands::lut_list,
            commands::lut_import,
            commands::lut_remove,
            commands::save_settings,
            commands::add_files,
            commands::add_pasted_image,
            commands::estimate_compression,
            commands::repair_preview,
            commands::startup_sound_path,
            commands::get_queue,
            commands::enqueue,
            commands::cancel_job,
            commands::cancel_all,
            commands::set_paused,
            commands::retry_jobs,
            commands::remove_jobs,
            commands::clear_finished,
            commands::duplicate_job,
            commands::get_job_log,
            commands::get_history,
            commands::remove_history,
            commands::clear_history,
            commands::open_file,
            commands::reveal_file,
            commands::open_logs_dir,
            commands::get_diagnostics,
            update::update_check,
            update::update_download,
            update::update_cancel,
            update::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aoze");
}
