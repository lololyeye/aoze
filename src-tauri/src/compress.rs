//! Still-image compression with a real file size target: every candidate is
//! actually encoded, so the reported size is the size of the file written.

use image::DynamicImage;
use serde::Serialize;

use crate::error::AppResult;
use crate::imaging::{encode_bytes, resize_by, CompressionType};
use crate::settings::OutputFormat;

/// Lowest quality tried before reducing the resolution.
const MIN_QUALITY: u8 = 25;
const MAX_DOWNSCALE_ROUNDS: usize = 4;

/// What compression did, shown with the result.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompressReport {
    pub limit_bytes: Option<u64>,
    /// False when even the smallest attempt stayed above the limit.
    pub met: bool,
    /// Quality used (JPEG / lossy WebP), None for lossless formats.
    pub quality: Option<u8>,
    /// Resolution factor applied to fit the limit (1.0 = unchanged).
    pub scale: f32,
    pub bytes: u64,
}

pub struct Encoded {
    pub bytes: Vec<u8>,
    pub report: CompressReport,
    pub width: u32,
    pub height: u32,
}

pub struct Request {
    pub format: OutputFormat,
    pub quality: u8,
    pub webp_lossless: bool,
    pub limit: Option<u64>,
    /// Use the slowest, smallest PNG settings (compression requested).
    pub png_best: bool,
    /// May reduce the resolution when quality alone cannot meet the limit
    /// (false for fixed-size targets such as Discord banners).
    pub allow_downscale: bool,
}

impl Request {
    fn lossy(&self) -> bool {
        self.format == OutputFormat::Jpeg || (self.format == OutputFormat::Webp && !self.webp_lossless)
    }

    fn png(&self) -> CompressionType {
        if self.png_best { CompressionType::Best } else { CompressionType::Default }
    }
}

fn encode(img: &DynamicImage, has_alpha: bool, req: &Request, quality: u8) -> AppResult<Vec<u8>> {
    encode_bytes(img, has_alpha, req.format, quality, req.webp_lossless, req.png())
}

/// Ok((quality, bytes)) that fits, or Err(bytes at the minimum quality).
type Search = Result<(u8, Vec<u8>), Vec<u8>>;

/// Highest quality in [MIN_QUALITY, start] whose output fits `limit`
/// (binary search: about 6 encodes), or the minimum-quality attempt if none does.
fn search_quality(img: &DynamicImage, has_alpha: bool, req: &Request, start: u8, limit: u64) -> AppResult<Search> {
    let first = encode(img, has_alpha, req, start)?;
    if first.len() as u64 <= limit {
        return Ok(Ok((start, first)));
    }
    let floor = encode(img, has_alpha, req, MIN_QUALITY)?;
    if floor.len() as u64 > limit {
        return Ok(Err(floor));
    }
    let (mut lo, mut hi) = (MIN_QUALITY, start - 1);
    let mut best = (MIN_QUALITY, floor);
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        let bytes = encode(img, has_alpha, req, mid)?;
        if bytes.len() as u64 <= limit {
            best = (mid, bytes);
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    Ok(Ok(best))
}

/// Encodes `img` with the requested format/quality, honouring `req.limit` when
/// possible: first by lowering the quality (lossy formats), then the resolution.
pub fn encode_to_limit(img: &DynamicImage, has_alpha: bool, req: &Request) -> AppResult<Encoded> {
    let quality = req.quality.clamp(1, 100);
    let done = |bytes: Vec<u8>, q: Option<u8>, scale: f32, img: &DynamicImage| {
        let len = bytes.len() as u64;
        Encoded {
            report: CompressReport { limit_bytes: req.limit, met: req.limit.is_none_or(|l| len <= l), quality: q, scale, bytes: len },
            width: img.width(),
            height: img.height(),
            bytes,
        }
    };
    let q_label = req.lossy().then_some(quality);

    let Some(limit) = req.limit else {
        return Ok(done(encode(img, has_alpha, req, quality)?, q_label, 1.0, img));
    };

    let mut current = img.clone();
    let mut factor = 1.0f64;
    // (bytes, quality, factor, image) of the smallest attempt so far.
    type Attempt = (Vec<u8>, Option<u8>, f64, DynamicImage);
    let mut smallest: Option<Attempt> = None;
    for round in 0..=MAX_DOWNSCALE_ROUNDS {
        let attempt = if req.lossy() {
            match search_quality(&current, has_alpha, req, quality.max(MIN_QUALITY), limit)? {
                Ok((q, bytes)) => return Ok(done(bytes, Some(q), factor as f32, &current)),
                Err(bytes) => (bytes, Some(MIN_QUALITY)),
            }
        } else {
            let bytes = encode(&current, has_alpha, req, quality)?;
            if bytes.len() as u64 <= limit {
                return Ok(done(bytes, None, factor as f32, &current));
            }
            (bytes, None)
        };
        let size = attempt.0.len() as f64;
        smallest = Some((attempt.0, attempt.1, factor, current.clone()));
        if round == MAX_DOWNSCALE_ROUNDS || !req.allow_downscale {
            break;
        }
        // Size scales roughly with pixel count: shrink both sides by sqrt(ratio), with margin.
        let step = ((limit as f64 / size).sqrt() * 0.95).clamp(0.2, 0.95);
        factor *= step;
        current = resize_by(img, factor)?;
    }
    let (bytes, q, f, im) = smallest.expect("at least one attempt");
    Ok(done(bytes, q, f as f32, &im))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    /// Noisy image: compresses poorly, so limits actually bite.
    fn noisy(w: u32, h: u32) -> DynamicImage {
        let mut seed = 12345u32;
        DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |_, _| {
            seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
            let v = (seed >> 16) as u8;
            Rgb([v, v.wrapping_mul(3), v.wrapping_add(90)])
        }))
    }

    fn req(format: OutputFormat, limit: Option<u64>) -> Request {
        Request { format, quality: 92, webp_lossless: false, limit, png_best: true, allow_downscale: true }
    }

    #[test]
    fn no_limit_uses_requested_quality() {
        let e = encode_to_limit(&noisy(64, 64), false, &req(OutputFormat::Jpeg, None)).unwrap();
        assert!(e.report.met && e.report.quality == Some(92) && e.report.scale == 1.0);
        assert_eq!(e.report.bytes, e.bytes.len() as u64);
    }

    #[test]
    fn jpeg_quality_is_lowered_to_fit() {
        let img = noisy(400, 300);
        let full = encode_to_limit(&img, false, &req(OutputFormat::Jpeg, None)).unwrap();
        let limit = full.report.bytes * 6 / 10;
        let e = encode_to_limit(&img, false, &req(OutputFormat::Jpeg, Some(limit))).unwrap();
        assert!(e.report.met && e.bytes.len() as u64 <= limit);
        assert!(e.report.quality.unwrap() < 92);
        assert_eq!((e.width, e.height), (400, 300));
    }

    #[test]
    fn png_falls_back_to_downscaling() {
        let img = noisy(300, 300);
        let full = encode_to_limit(&img, false, &req(OutputFormat::Png, None)).unwrap();
        let limit = full.report.bytes / 3;
        let e = encode_to_limit(&img, false, &req(OutputFormat::Png, Some(limit))).unwrap();
        assert!(e.report.met, "{:?}", e.report);
        assert!(e.report.scale < 1.0 && e.width < 300);
    }

    #[test]
    fn impossible_limit_is_reported() {
        let e = encode_to_limit(&noisy(200, 200), false, &req(OutputFormat::Webp, Some(10))).unwrap();
        assert!(!e.report.met);
    }
}
