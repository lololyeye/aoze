//! Learns how fast each model runs on this machine, so progress and ETA can be
//! estimated: waifu2x-ncnn-vulkan prints no progress of its own.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::fsutil::write_json_atomic;
use crate::settings::{Style, UpscaleParams};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Throughput {
    /// Output megapixels produced per second.
    pub mp_per_sec: f64,
    pub samples: u32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct PerfModel {
    #[serde(default)]
    entries: HashMap<String, Throughput>,
    #[serde(skip)]
    path: Option<PathBuf>,
}

pub fn key(params: &UpscaleParams) -> String {
    let device = match params.gpu {
        Some(-1) => "cpu".to_string(),
        Some(i) => format!("gpu{i}"),
        None => "auto".to_string(),
    };
    // "v2": entries learned before the fixed model-load cost was modelled are ignored.
    format!("v2|{:?}|{}|tta={}", params.style, device, params.tta)
}

/// Below this much work, a run is dominated by fixed costs and is not learned from.
const MIN_LEARN_MP: f64 = 2.0;

/// Fixed cost after device init: model load and pipeline compilation (GTX 1650).
fn model_load_ms(params: &UpscaleParams) -> u64 {
    match params.style {
        Style::Artwork => 2500,
        Style::ArtworkFast | Style::Photo => 1200,
    }
}

/// Conservative first guesses (measured on a GTX 1650), replaced by real measurements.
fn default_throughput(params: &UpscaleParams) -> f64 {
    let base = match params.style {
        Style::Artwork => 2.4,
        Style::ArtworkFast | Style::Photo => 7.0,
    };
    if params.gpu == Some(-1) {
        base / 25.0
    } else {
        base
    }
}

impl PerfModel {
    pub fn load(path: &Path) -> Self {
        let mut model: PerfModel = std::fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        model.path = Some(path.to_path_buf());
        model
    }

    /// Estimated engine time in ms, and whether it comes from real measurements.
    pub fn estimate_ms(&self, params: &UpscaleParams, work_mp: f64) -> (u64, bool) {
        let (rate, measured) = match self.entries.get(&key(params)) {
            Some(t) if t.samples > 0 => (t.mp_per_sec, true),
            _ => (default_throughput(params), false),
        };
        (model_load_ms(params) + (work_mp / rate.max(1e-3) * 1000.0).round() as u64, measured)
    }

    pub fn record(&mut self, params: &UpscaleParams, work_mp: f64, elapsed_ms: u64) {
        // Small runs are dominated by fixed costs and would skew the rate.
        if work_mp < MIN_LEARN_MP {
            return;
        }
        let compute_ms = elapsed_ms.saturating_sub(model_load_ms(params)).max(300);
        let rate = work_mp / (compute_ms as f64 / 1000.0);
        let entry = self.entries.entry(key(params)).or_insert(Throughput { mp_per_sec: rate, samples: 0 });
        entry.mp_per_sec = if entry.samples == 0 { rate } else { entry.mp_per_sec * 0.6 + rate * 0.4 };
        entry.samples += 1;
        if let Some(path) = &self.path {
            if let Err(e) = write_json_atomic(path, self) {
                log::warn!("could not save performance data: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn learns_from_measurements() {
        let mut m = PerfModel::default();
        let p = UpscaleParams::default();
        let (guess, measured) = m.estimate_ms(&p, 24.0);
        assert!(!measured && guess == 2_500 + 10_000);
        m.record(&p, 10.0, 4_500); // 2 s of compute after the 2.5 s model load: 5 MP/s
        let (ms, measured) = m.estimate_ms(&p, 10.0);
        assert!(measured && ms == 4_500);
        m.record(&p, 0.5, 4_000); // ignored: too little work
        assert_eq!(m.estimate_ms(&p, 10.0).0, 4_500);
    }

    #[test]
    fn keys_separate_devices_and_tta() {
        let a = UpscaleParams::default();
        let b = UpscaleParams { tta: true, ..a.clone() };
        let c = UpscaleParams { gpu: Some(-1), ..a.clone() };
        assert_ne!(key(&a), key(&b));
        assert_ne!(key(&a), key(&c));
    }
}
