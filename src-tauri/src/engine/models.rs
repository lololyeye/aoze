use std::path::Path;

use serde::Serialize;

use crate::settings::Style;

/// What a model directory can actually do, derived from the files present.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub style: Style,
    pub dir: String,
    pub installed: bool,
    /// `scale2.0x_model` present (2x without denoise).
    pub scale2: bool,
    /// `noise{n}_scale2.0x_model` present, index = noise level.
    pub noise_scale2: [bool; 4],
    /// `noise{n}_model` present (denoise at 1x), index = noise level.
    pub noise_scale1: [bool; 4],
    pub size_bytes: u64,
}

impl ModelCapabilities {
    /// True when a 2x pass with this noise level (-1 = none) is possible.
    pub fn can_scale2(&self, noise: i8) -> bool {
        if noise < 0 {
            self.scale2
        } else {
            self.noise_scale2[noise as usize]
        }
    }

    pub fn can_denoise_1x(&self, noise: i8) -> bool {
        noise >= 0 && self.noise_scale1[noise as usize]
    }
}

fn has_model(dir: &Path, stem: &str) -> bool {
    dir.join(format!("{stem}.param")).is_file() && dir.join(format!("{stem}.bin")).is_file()
}

pub fn scan_style(engine_dir: &Path, style: Style) -> ModelCapabilities {
    let dir = engine_dir.join(style.model_dir());
    let installed = dir.is_dir();
    let level = |f: &dyn Fn(usize) -> String| -> [bool; 4] {
        std::array::from_fn(|n| installed && has_model(&dir, &f(n)))
    };
    let size_bytes = std::fs::read_dir(&dir)
        .map(|it| it.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum())
        .unwrap_or(0);
    ModelCapabilities {
        style,
        dir: style.model_dir().to_string(),
        installed,
        scale2: installed && has_model(&dir, "scale2.0x_model"),
        noise_scale2: level(&|n| format!("noise{n}_scale2.0x_model")),
        noise_scale1: level(&|n| format!("noise{n}_model")),
        size_bytes,
    }
}

pub fn scan_all(engine_dir: &Path) -> Vec<ModelCapabilities> {
    Style::ALL.iter().map(|&s| scan_style(engine_dir, s)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, stem: &str) {
        std::fs::write(dir.join(format!("{stem}.param")), b"x").unwrap();
        std::fs::write(dir.join(format!("{stem}.bin")), b"x").unwrap();
    }

    #[test]
    fn detects_partial_model_sets() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(Style::Photo.model_dir());
        std::fs::create_dir_all(&dir).unwrap();
        touch(&dir, "scale2.0x_model");
        touch(&dir, "noise2_scale2.0x_model");
        // A .param without its .bin must not count.
        std::fs::write(dir.join("noise3_scale2.0x_model.param"), b"x").unwrap();

        let caps = scan_style(root.path(), Style::Photo);
        assert!(caps.installed && caps.scale2);
        assert_eq!(caps.noise_scale2, [false, false, true, false]);
        assert!(caps.can_scale2(-1) && caps.can_scale2(2) && !caps.can_scale2(3));
        assert!(!caps.can_denoise_1x(2));
    }

    #[test]
    fn missing_dir_is_not_installed() {
        let root = tempfile::tempdir().unwrap();
        let caps = scan_style(root.path(), Style::Artwork);
        assert!(!caps.installed && !caps.scale2);
    }
}
