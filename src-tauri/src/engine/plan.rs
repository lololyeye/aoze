use serde::Serialize;

use super::models::ModelCapabilities;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::settings::SUPPORTED_SCALES;

/// How a requested (scale, noise) pair is executed with the available models.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginePlan {
    /// Native waifu2x scale passed with `-s` (1, 2, 4 or 8).
    pub engine_scale: u32,
    pub noise: i8,
    /// When the requested scale is not a native one (1.6x, or 1x denoise on
    /// models without 1x weights), the engine output is resized to this size.
    pub needs_resize: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dimensions {
    pub width: u32,
    pub height: u32,
}

impl Dimensions {
    pub fn megapixels(self) -> f64 {
        self.width as f64 * self.height as f64 / 1e6
    }
}

pub fn final_dimensions(src: Dimensions, scale: f32) -> Dimensions {
    let f = |v: u32| ((v as f64 * scale as f64).round() as u32).max(1);
    Dimensions { width: f(src.width), height: f(src.height) }
}

pub fn plan(scale: f32, noise: i8, caps: &ModelCapabilities) -> AppResult<EnginePlan> {
    if !SUPPORTED_SCALES.iter().any(|s| (s - scale).abs() < 1e-3) {
        return Err(AppError::new(ErrorCode::InvalidParams, format!("unsupported scale {scale}")));
    }
    if !(-1..=3).contains(&noise) {
        return Err(AppError::new(ErrorCode::InvalidParams, format!("unsupported noise level {noise}")));
    }
    if !caps.installed {
        return Err(AppError::new(ErrorCode::ModelMissing, format!("model folder {} not found", caps.dir)));
    }
    let missing = |what: &str| {
        Err(AppError::new(ErrorCode::ModelMissing, format!("{} has no {what} model", caps.dir)))
    };

    if (scale - 1.0).abs() < 1e-3 {
        if noise < 0 {
            return Err(AppError::new(ErrorCode::InvalidParams, "1x without noise reduction does nothing"));
        }
        if caps.can_denoise_1x(noise) {
            return Ok(EnginePlan { engine_scale: 1, noise, needs_resize: false });
        }
        // UpConv7 models have no 1x weights: denoise during a 2x pass, then
        // downscale back to the original size.
        if caps.can_scale2(noise) {
            return Ok(EnginePlan { engine_scale: 2, noise, needs_resize: true });
        }
        return missing(&format!("noise level {noise}"));
    }

    // waifu2x runs the selected 2x model log2(scale) times.
    let engine_scale = if (scale - 1.6).abs() < 1e-3 { 2 } else { scale.round() as u32 };
    if !caps.can_scale2(noise) {
        return missing(&format!("2x / noise level {noise}"));
    }
    Ok(EnginePlan { engine_scale, noise, needs_resize: engine_scale as f32 != scale })
}

/// Output megapixels the network has to produce, used to estimate duration.
/// waifu2x runs log2(scale) passes of 2x; a 1x pass produces the input size.
pub fn work_megapixels(src: Dimensions, plan: &EnginePlan, tta: bool) -> f64 {
    let base = src.megapixels();
    let work = if plan.engine_scale <= 1 {
        base
    } else {
        let passes = plan.engine_scale.trailing_zeros();
        (1..=passes).map(|i| base * 4f64.powi(i as i32)).sum()
    };
    if tta {
        work * 8.0
    } else {
        work
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Style;

    fn caps(scale1: bool) -> ModelCapabilities {
        ModelCapabilities {
            style: Style::Artwork,
            dir: "m".into(),
            installed: true,
            scale2: true,
            noise_scale2: [true; 4],
            noise_scale1: [scale1; 4],
            size_bytes: 0,
        }
    }

    #[test]
    fn native_scales() {
        assert_eq!(plan(2.0, 1, &caps(true)).unwrap(), EnginePlan { engine_scale: 2, noise: 1, needs_resize: false });
        assert_eq!(plan(4.0, -1, &caps(true)).unwrap().engine_scale, 4);
        assert_eq!(plan(8.0, 3, &caps(true)).unwrap().engine_scale, 8);
    }

    #[test]
    fn fractional_scale_resizes_after_2x() {
        let p = plan(1.6, 0, &caps(true)).unwrap();
        assert_eq!((p.engine_scale, p.needs_resize), (2, true));
    }

    #[test]
    fn denoise_only_uses_1x_model_or_falls_back() {
        assert_eq!(plan(1.0, 2, &caps(true)).unwrap().engine_scale, 1);
        let p = plan(1.0, 2, &caps(false)).unwrap();
        assert_eq!((p.engine_scale, p.needs_resize), (2, true));
        assert_eq!(plan(1.0, -1, &caps(true)).unwrap_err().code, ErrorCode::InvalidParams);
    }

    #[test]
    fn rejects_invalid_and_missing() {
        assert_eq!(plan(3.0, 0, &caps(true)).unwrap_err().code, ErrorCode::InvalidParams);
        let mut c = caps(true);
        c.noise_scale2[3] = false;
        assert_eq!(plan(2.0, 3, &c).unwrap_err().code, ErrorCode::ModelMissing);
        c.installed = false;
        assert_eq!(plan(2.0, 0, &c).unwrap_err().code, ErrorCode::ModelMissing);
    }

    #[test]
    fn dimensions_and_work() {
        let src = Dimensions { width: 1000, height: 500 };
        assert_eq!(final_dimensions(src, 1.6), Dimensions { width: 1600, height: 800 });
        let p4 = plan(4.0, 0, &caps(true)).unwrap();
        // pass 1: 2 MP, pass 2: 8 MP
        assert!((work_megapixels(src, &p4, false) - 10.0).abs() < 1e-9);
        assert!((work_megapixels(src, &p4, true) - 80.0).abs() < 1e-9);
    }
}
