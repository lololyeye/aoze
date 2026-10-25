//! Hardware profile and automatic tuning.
//!
//! A quick local check (no benchmark): logical CPUs, physical memory, and the
//! Vulkan device found at startup. From that and the performance mode, Aoze
//! picks how much of the machine to use. Tuning never changes the output
//! pixels: only tiles, threads, memory per clip block, process priority and
//! (Quality mode) slower video encoder presets.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::Serialize;

use crate::gpu::{GpuKind, VulkanStatus};
use crate::settings::{PerformanceMode, Settings, Threads};

const GB: u64 = 1024 * 1024 * 1024;
const MB: u64 = 1024 * 1024;
/// Memory used by one clip block of frames when auto-optimize is off.
pub const DEFAULT_BLOCK_BYTES: u64 = 400 * MB;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub cpu_threads: u32,
    pub ram_total_bytes: u64,
    pub ram_available_bytes: u64,
    /// Device waifu2x will use; None means CPU processing.
    pub gpu_name: Option<String>,
    pub gpu_kind: Option<GpuKind>,
    pub vram_bytes: u64,
    /// Values were forced by AOZE_SIMULATE_HARDWARE (testing).
    pub simulated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub hardware: Hardware,
    pub gpu: Tier,
    pub memory: Tier,
    pub cpu: Tier,
}

/// What Aoze actually uses for the next jobs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tuning {
    /// waifu2x tile size; 0 lets the engine choose from free VRAM.
    pub tile_size: u32,
    pub threads: Threads,
    /// Frames of a clip held on disk and in memory per waifu2x pass.
    pub block_bytes: u64,
    /// Engine and FFmpeg run below normal priority so the PC stays responsive.
    pub background_priority: bool,
    /// Slower, better encoder presets (Quality mode).
    pub quality_presets: bool,
    /// False when the values come from the Advanced settings.
    pub automatic: bool,
}

#[cfg(windows)]
fn memory() -> (u64, u64) {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }
    // SAFETY: zeroed POD struct with its length set, as the API requires.
    unsafe {
        let mut m: MemoryStatusEx = std::mem::zeroed();
        m.length = std::mem::size_of::<MemoryStatusEx>() as u32;
        if GlobalMemoryStatusEx(&mut m) != 0 {
            return (m.total_phys, m.avail_phys);
        }
    }
    (0, 0)
}

#[cfg(not(windows))]
fn memory() -> (u64, u64) {
    (0, 0)
}

impl Hardware {
    /// Reads the machine. `gpu` is the Vulkan status and the device setting
    /// (None = default device, -1 = CPU).
    pub fn detect(vulkan: &VulkanStatus, gpu: Option<i32>) -> Self {
        if let Ok(sim) = std::env::var("AOZE_SIMULATE_HARDWARE") {
            if let Some(h) = Self::simulated(&sim) {
                return h;
            }
        }
        let (ram_total_bytes, ram_available_bytes) = memory();
        let cpu_threads = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(4);
        let device = match gpu {
            Some(-1) => None,
            Some(i) => vulkan.gpus.iter().find(|g| g.index as i32 == i),
            None => vulkan.default_gpu.and_then(|i| vulkan.gpus.iter().find(|g| g.index == i)),
        };
        Self {
            cpu_threads,
            ram_total_bytes,
            ram_available_bytes,
            gpu_name: device.map(|g| g.name.clone()),
            gpu_kind: device.map(|g| g.kind),
            vram_bytes: device.map(|g| g.vram_bytes).unwrap_or(0),
            simulated: false,
        }
    }

    /// "low" mimics a small laptop: 4 threads, 8 GB (3 GB free), 2 GB integrated GPU.
    fn simulated(kind: &str) -> Option<Self> {
        match kind {
            "low" => Some(Self {
                cpu_threads: 4,
                ram_total_bytes: 8 * GB,
                ram_available_bytes: 3 * GB,
                gpu_name: Some("Simulated integrated GPU".into()),
                gpu_kind: Some(GpuKind::Integrated),
                vram_bytes: 2 * GB,
                simulated: true,
            }),
            "cpu" => Some(Self {
                cpu_threads: 4,
                ram_total_bytes: 8 * GB,
                ram_available_bytes: 3 * GB,
                gpu_name: None,
                gpu_kind: None,
                vram_bytes: 0,
                simulated: true,
            }),
            _ => None,
        }
    }
}

impl Profile {
    pub fn of(hardware: Hardware) -> Self {
        let h = &hardware;
        let gpu = match h.gpu_kind {
            None | Some(GpuKind::Cpu) => Tier::Low,
            Some(GpuKind::Integrated) => Tier::Low,
            _ if h.vram_bytes < 3 * GB => Tier::Low,
            _ if h.vram_bytes < 6 * GB => Tier::Medium,
            _ => Tier::High,
        };
        // Unknown memory (0) is treated as medium rather than starving the jobs.
        let memory = match (h.ram_total_bytes, h.ram_available_bytes) {
            (0, _) => Tier::Medium,
            (t, a) if t < 8 * GB || a < 2 * GB => Tier::Low,
            (t, a) if t < 16 * GB || a < 6 * GB => Tier::Medium,
            _ => Tier::High,
        };
        let cpu = match h.cpu_threads {
            0..=4 => Tier::Low,
            5..=8 => Tier::Medium,
            _ => Tier::High,
        };
        Self { hardware, gpu, memory, cpu }
    }

    /// Priority: stability, then smoothness, then speed. Performance mode
    /// trades smoothness of the rest of the PC for speed.
    pub fn tuning(&self, mode: PerformanceMode) -> Tuning {
        let fast = mode == PerformanceMode::Performance;
        let cpu_only = self.hardware.gpu_kind.is_none();
        // Long GPU dispatches (big tiles) starve the desktop and Aoze's own
        // interface on weak GPUs; smaller tiles let them interleave.
        let tile_size = match (self.gpu, fast) {
            _ if cpu_only => 0,
            (Tier::Low, false) => 100,
            (Tier::Low, true) if self.hardware.vram_bytes <= 2 * GB => 100,
            (Tier::Medium, false) => 200,
            _ => 0,
        };
        let threads = if cpu_only {
            let n = self.hardware.cpu_threads.max(1);
            let proc = if fast { n } else { n.saturating_sub(2).max(1) }.min(16) as u8;
            Threads { load: 1, proc, save: 1 }
        } else {
            match (self.cpu.min(self.memory), fast) {
                (Tier::Low, false) => Threads { load: 1, proc: 1, save: 1 },
                (Tier::High, true) => Threads { load: 2, proc: 2, save: 4 },
                _ => Threads::default(),
            }
        };
        let block_bytes = match (self.memory, fast) {
            (Tier::Low, _) => 150 * MB,
            (Tier::High, true) => 800 * MB,
            _ => DEFAULT_BLOCK_BYTES,
        };
        Tuning { tile_size, threads, block_bytes, background_priority: !fast, quality_presets: mode == PerformanceMode::Quality, automatic: true }
    }
}

impl Tuning {
    /// Auto-optimize off: tiles and threads from the Advanced settings.
    pub fn manual(settings: &Settings) -> Self {
        let mode = settings.performance.mode;
        Self {
            tile_size: settings.upscale.tile_size,
            threads: settings.upscale.threads,
            block_bytes: DEFAULT_BLOCK_BYTES,
            background_priority: mode != PerformanceMode::Performance,
            quality_presets: mode == PerformanceMode::Quality,
            automatic: false,
        }
    }

    pub fn for_settings(settings: &Settings, profile: Option<&Profile>) -> Self {
        match profile {
            Some(p) if settings.performance.auto_optimize => p.tuning(settings.performance.mode),
            _ => Self::manual(settings),
        }
    }
}

// Read by the process launchers and the clip pipeline, which do not see the settings.
static BACKGROUND_PRIORITY: AtomicBool = AtomicBool::new(true);
static QUALITY_PRESETS: AtomicBool = AtomicBool::new(false);
static BLOCK_BYTES: AtomicU64 = AtomicU64::new(DEFAULT_BLOCK_BYTES);

pub fn publish(t: &Tuning) {
    BACKGROUND_PRIORITY.store(t.background_priority, Ordering::Relaxed);
    QUALITY_PRESETS.store(t.quality_presets, Ordering::Relaxed);
    BLOCK_BYTES.store(t.block_bytes, Ordering::Relaxed);
}

pub fn quality_presets() -> bool {
    QUALITY_PRESETS.load(Ordering::Relaxed)
}

pub fn block_bytes() -> u64 {
    BLOCK_BYTES.load(Ordering::Relaxed)
}

/// Creation flags for the engine and FFmpeg processes.
#[cfg(windows)]
pub fn process_flags() -> u32 {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
    if BACKGROUND_PRIORITY.load(Ordering::Relaxed) {
        CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
    } else {
        CREATE_NO_WINDOW
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hw(threads: u32, ram_gb: u64, free_gb: u64, kind: Option<GpuKind>, vram_gb: u64) -> Hardware {
        Hardware {
            cpu_threads: threads,
            ram_total_bytes: ram_gb * GB,
            ram_available_bytes: free_gb * GB,
            gpu_name: kind.map(|_| "test".into()),
            gpu_kind: kind,
            vram_bytes: vram_gb * GB,
            simulated: false,
        }
    }

    #[test]
    fn weak_pc_gets_small_tiles_and_blocks() {
        let p = Profile::of(hw(4, 8, 1, Some(GpuKind::Integrated), 2));
        assert_eq!((p.gpu, p.memory, p.cpu), (Tier::Low, Tier::Low, Tier::Low));
        let t = p.tuning(PerformanceMode::Balanced);
        assert_eq!(t.tile_size, 100);
        assert_eq!((t.threads.load, t.threads.proc, t.threads.save), (1, 1, 1));
        assert_eq!(t.block_bytes, 150 * MB);
        assert!(t.background_priority);
        // Performance mode still keeps tiny-VRAM tiles small: stability first.
        assert_eq!(p.tuning(PerformanceMode::Performance).tile_size, 100);
    }

    #[test]
    fn strong_pc_uses_more_in_performance_mode() {
        let p = Profile::of(hw(16, 32, 20, Some(GpuKind::Discrete), 12));
        assert_eq!((p.gpu, p.memory, p.cpu), (Tier::High, Tier::High, Tier::High));
        let fast = p.tuning(PerformanceMode::Performance);
        assert_eq!(fast.tile_size, 0);
        assert_eq!(fast.block_bytes, 800 * MB);
        assert!(!fast.background_priority);
        let balanced = p.tuning(PerformanceMode::Balanced);
        assert_eq!(balanced.block_bytes, DEFAULT_BLOCK_BYTES);
        assert!(balanced.background_priority);
        assert!(p.tuning(PerformanceMode::Quality).quality_presets);
    }

    #[test]
    fn mid_gpu_and_cpu_only() {
        let p = Profile::of(hw(12, 16, 8, Some(GpuKind::Discrete), 4));
        assert_eq!(p.gpu, Tier::Medium);
        assert_eq!(p.tuning(PerformanceMode::Balanced).tile_size, 200);
        let cpu = Profile::of(hw(8, 16, 8, None, 0));
        let t = cpu.tuning(PerformanceMode::Balanced);
        assert_eq!(t.tile_size, 0);
        assert_eq!(t.threads.proc, 6);
        assert_eq!(cpu.tuning(PerformanceMode::Performance).threads.proc, 8);
    }

    #[test]
    fn manual_uses_advanced_settings() {
        let mut s = Settings::default();
        s.performance.auto_optimize = false;
        s.upscale.tile_size = 256;
        let p = Profile::of(hw(4, 8, 1, Some(GpuKind::Integrated), 2));
        let t = Tuning::for_settings(&s, Some(&p));
        assert_eq!(t.tile_size, 256);
        assert!(!t.automatic);
    }
}
