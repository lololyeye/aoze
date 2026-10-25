//! Application core shared by the Tauri commands and the queue worker.
//! It does not depend on a Tauri `AppHandle`: UI side effects go through [`Hooks`].

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;

use crate::engine::waifu2x::Waifu2xEngine;
use crate::engine::{EngineStatus, UpscaleEngine};
use crate::gpu::{self, VulkanStatus};
use crate::history::HistoryStore;
use crate::media::{Ffmpeg, HwEncoder};
use crate::perf::PerfModel;
use crate::queue::{QueueEvent, QueueState};
use crate::settings::Settings;
use crate::smooth::Rife;
use crate::tuning::{self, Hardware, Profile, Tuning};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub log_dir: PathBuf,
    pub bundled_engine_dir: PathBuf,
    pub ffmpeg_dir: PathBuf,
    /// rife-ncnn-vulkan and its model (Smooth Motion).
    pub rife_dir: PathBuf,
    /// realesrgan-ncnn-vulkan and the anime video model (clip Clean-up).
    pub esrgan_dir: PathBuf,
    /// Output folder for images that have no folder of their own (clipboard pastes).
    pub fallback_output_dir: PathBuf,
}

impl AppPaths {
    pub fn settings_file(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }
    pub fn history_file(&self) -> PathBuf {
        self.config_dir.join("history.json")
    }
    pub fn perf_file(&self) -> PathBuf {
        self.config_dir.join("performance.json")
    }
    pub fn work_dir(&self) -> PathBuf {
        self.cache_dir.join("work")
    }
    pub fn thumbs_dir(&self) -> PathBuf {
        self.cache_dir.join("previews")
    }
    pub fn pasted_dir(&self) -> PathBuf {
        self.cache_dir.join("pasted")
    }
}

/// UI side effects requested by the core.
pub trait Hooks: Send + Sync {
    fn emit(&self, event: QueueEvent);
    /// Lets the webview load this file through the asset protocol.
    fn allow_file(&self, path: &Path);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub app_version: &'static str,
    pub engine: EngineStatus,
    pub vulkan: VulkanStatus,
    pub ffmpeg: FfmpegStatus,
    /// Smooth Motion engine (RIFE) installed.
    pub smooth_motion: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub found: bool,
    pub version: Option<String>,
    pub dir: String,
    /// Hardware video encoders that passed a test encode.
    pub encoders: Vec<HwEncoder>,
    /// False until encoder detection has run.
    pub detected: bool,
}

pub struct Core {
    pub paths: AppPaths,
    pub settings: RwLock<Settings>,
    pub engine: RwLock<Arc<dyn UpscaleEngine>>,
    pub vulkan: RwLock<VulkanStatus>,
    pub history: HistoryStore,
    pub perf: Mutex<PerfModel>,
    pub queue: Mutex<QueueState>,
    pub wake: tokio::sync::Notify,
    /// Bounds concurrent preview generation (each one decodes a full image).
    pub preview_slots: tokio::sync::Semaphore,
    pub hooks: Box<dyn Hooks>,
    pub ffmpeg: Ffmpeg,
    pub rife: Rife,
    pub esrgan: crate::esrgan::Esrgan,
    pub encoders: RwLock<Vec<HwEncoder>>,
    encoders_detected: std::sync::atomic::AtomicBool,
    vulkan_detected: std::sync::atomic::AtomicBool,
    /// Hardware read at startup (after Vulkan detection) and on device change.
    pub profile: RwLock<Option<Profile>>,
}

/// Result of the startup check shown by the splash and in Settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCheck {
    pub profile: Option<Profile>,
    pub tuning: Tuning,
}

/// Clears leftovers of a previous run, except recent clip work a retry can
/// resume (kept 3 days).
fn clean_work_dir(dir: &Path) {
    const KEEP: std::time::Duration = std::time::Duration::from_secs(3 * 24 * 3600);
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let fresh = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age < KEEP);
        if name.starts_with(crate::pipeline::RESUME_PREFIX) && fresh {
            continue;
        }
        let _ = std::fs::remove_dir_all(e.path()).or_else(|_| std::fs::remove_file(e.path()));
    }
}

pub fn engine_for(settings: &Settings, paths: &AppPaths) -> Arc<dyn UpscaleEngine> {
    let dir = settings.engine_dir.clone().unwrap_or_else(|| paths.bundled_engine_dir.clone());
    Arc::new(Waifu2xEngine::new(dir))
}

impl Core {
    pub fn new(paths: AppPaths, hooks: Box<dyn Hooks>) -> Arc<Self> {
        let settings = Settings::load(&paths.settings_file());
        let engine = engine_for(&settings, &paths);
        clean_work_dir(&paths.work_dir());
        Arc::new(Self {
            history: HistoryStore::load(&paths.history_file()),
            perf: Mutex::new(PerfModel::load(&paths.perf_file())),
            settings: RwLock::new(settings),
            engine: RwLock::new(engine),
            vulkan: RwLock::new(VulkanStatus { available: false, instance_version: None, gpus: vec![], default_gpu: None, error: None }),
            queue: Mutex::new(QueueState::default()),
            wake: tokio::sync::Notify::new(),
            preview_slots: tokio::sync::Semaphore::new(2),
            ffmpeg: Ffmpeg::new(paths.ffmpeg_dir.clone()),
            rife: Rife::new(paths.rife_dir.clone()),
            esrgan: crate::esrgan::Esrgan::new(paths.esrgan_dir.clone()),
            encoders: RwLock::new(vec![]),
            encoders_detected: std::sync::atomic::AtomicBool::new(false),
            vulkan_detected: std::sync::atomic::AtomicBool::new(false),
            profile: RwLock::new(None),
            paths,
            hooks,
        })
    }

    pub fn engine(&self) -> Arc<dyn UpscaleEngine> {
        self.engine.read().unwrap().clone()
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    pub fn update_settings(&self, new: Settings) -> crate::error::AppResult<Settings> {
        let new = new.sanitized();
        new.save(&self.paths.settings_file())?;
        let engine_changed = self.settings.read().unwrap().engine_dir != new.engine_dir;
        if engine_changed {
            *self.engine.write().unwrap() = engine_for(&new, &self.paths);
        }
        let device_changed = self.settings.read().unwrap().upscale.gpu != new.upscale.gpu;
        *self.settings.write().unwrap() = new.clone();
        if device_changed {
            self.read_hardware();
        }
        tuning::publish(&self.tuning());
        Ok(new)
    }

    /// Re-reads CPU, memory and the selected GPU (cheap: no benchmark).
    pub fn read_hardware(&self) {
        let gpu = self.settings.read().unwrap().upscale.gpu;
        let hardware = Hardware::detect(&self.vulkan.read().unwrap(), gpu);
        let profile = Profile::of(hardware);
        log::info!("hardware: {:?} -> gpu {:?}, memory {:?}, cpu {:?}", profile.hardware, profile.gpu, profile.memory, profile.cpu);
        *self.profile.write().unwrap() = Some(profile);
        tuning::publish(&self.tuning());
    }

    /// What the next jobs will use (auto-optimized or from Advanced settings).
    pub fn tuning(&self) -> Tuning {
        Tuning::for_settings(&self.settings.read().unwrap(), self.profile.read().unwrap().as_ref())
    }

    pub fn vulkan_detected(&self) -> bool {
        self.vulkan_detected.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn system_check(&self) -> SystemCheck {
        // Free memory changes over time: refresh it for an up-to-date report.
        if self.vulkan_detected() {
            self.read_hardware();
        }
        SystemCheck { profile: self.profile.read().unwrap().clone(), tuning: self.tuning() }
    }

    /// Re-detects Vulkan devices. Blocking (loads the Vulkan driver): call off the UI thread.
    pub fn refresh_vulkan(&self) -> VulkanStatus {
        let status = gpu::detect();
        log::info!(
            "vulkan: available={} devices={:?} error={:?}",
            status.available,
            status.gpus.iter().map(|g| &g.name).collect::<Vec<_>>(),
            status.error
        );
        *self.vulkan.write().unwrap() = status.clone();
        self.vulkan_detected.store(true, std::sync::atomic::Ordering::Relaxed);
        self.read_hardware();
        status
    }

    /// Test-encodes with each hardware encoder. Blocking: call off the UI thread.
    pub fn refresh_encoders(&self) {
        let found = self.ffmpeg.detect_encoders();
        let _ = self.ffmpeg.libplacebo();
        log::info!("video encoders: {found:?} (x264 always available)");
        *self.encoders.write().unwrap() = found;
        self.encoders_detected.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn system_status(&self) -> SystemStatus {
        SystemStatus {
            app_version: env!("CARGO_PKG_VERSION"),
            engine: self.engine().status(),
            vulkan: self.vulkan.read().unwrap().clone(),
            ffmpeg: FfmpegStatus {
                found: self.ffmpeg.found(),
                version: self.ffmpeg.version(),
                dir: self.ffmpeg.dir().to_string_lossy().into_owned(),
                encoders: self.encoders.read().unwrap().clone(),
                detected: self.encoders_detected.load(std::sync::atomic::Ordering::Relaxed),
            },
            smooth_motion: self.rife.found(),
        }
    }
}
