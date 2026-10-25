//! Image I/O around the engine: probing, input normalisation, resizing for
//! non-native scales, final encoding and lightweight previews for the UI.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use fast_image_resize::{images::Image as FirImage, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::codecs::jpeg::JpegEncoder;
pub use image::codecs::png::CompressionType;
use image::codecs::png::{FilterType as PngFilter, PngEncoder};
use image::{DynamicImage, ImageEncoder, ImageReader, RgbImage, RgbaImage};
use serde::Serialize;

use crate::engine::plan::Dimensions;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fsutil::{extension_lower, file_size};
use crate::settings::{OutputFormat, OutputOptions};

pub const SUPPORTED_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"];
/// Formats waifu2x-ncnn-vulkan decodes itself; others are converted to PNG first.
const ENGINE_NATIVE: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
pub const WEBP_MAX_SIDE: u32 = 16383;
pub const JPEG_MAX_SIDE: u32 = 65535;
/// Above this, the UI gets a downscaled proxy instead of the full image.
pub const PREVIEW_PROXY_THRESHOLD_MP: f64 = 16.0;
pub const PREVIEW_PROXY_MAX_SIDE: u32 = 4096;
pub const THUMB_MAX_SIDE: u32 = 320;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
    pub format: String,
}

impl ImageInfo {
    pub fn dims(&self) -> Dimensions {
        Dimensions { width: self.width, height: self.height }
    }
}

pub fn is_supported(path: &Path) -> bool {
    SUPPORTED_EXTENSIONS.contains(&extension_lower(path).as_str())
}

fn decode_err(path: &Path, e: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::DecodeFailed, format!("{}: {e}", path.display()))
}

/// Reads only the header: cheap even for huge files.
pub fn probe(path: &Path) -> AppResult<ImageInfo> {
    if !path.is_file() {
        return Err(AppError::new(ErrorCode::FileNotFound, path.display().to_string()));
    }
    if !is_supported(path) {
        return Err(AppError::new(ErrorCode::UnsupportedFormat, path.display().to_string()));
    }
    let reader = ImageReader::open(path)?.with_guessed_format()?;
    let format = reader
        .format()
        .map(|f| f.extensions_str().first().copied().unwrap_or("?").to_ascii_uppercase())
        .ok_or_else(|| decode_err(path, "unknown image format"))?;
    let (width, height) = reader.into_dimensions().map_err(|e| decode_err(path, e))?;
    if width == 0 || height == 0 {
        return Err(decode_err(path, "empty image"));
    }
    Ok(ImageInfo { width, height, size_bytes: file_size(path), format })
}

pub fn decode(path: &Path) -> AppResult<DynamicImage> {
    let mut reader = ImageReader::open(path)?.with_guessed_format()?;
    reader.no_limits();
    reader.decode().map_err(|e| decode_err(path, e))
}

/// Returns the path the engine should read: BMP/TIFF and files whose content does
/// not match their extension are re-encoded to a temporary PNG. The image is
/// always fully decoded first: the engine's decoder silently accepts truncated
/// files and would produce a partly black result.
pub fn prepare_engine_input(src: &Path, temp_png: &Path) -> AppResult<Option<PathBuf>> {
    let ext = extension_lower(src);
    let content_matches = ImageReader::open(src)?
        .with_guessed_format()?
        .format()
        .map(|f| f.extensions_str().contains(&ext.as_str()) || (ext == "jpg" && f == image::ImageFormat::Jpeg))
        .unwrap_or(false);
    let img = decode(src)?;
    if ENGINE_NATIVE.contains(&ext.as_str()) && content_matches {
        return Ok(None);
    }
    save_png(&img, temp_png, CompressionType::Fast)?;
    Ok(Some(temp_png.to_path_buf()))
}

fn to_rgba(img: DynamicImage) -> RgbaImage {
    match img {
        DynamicImage::ImageRgba8(i) => i,
        other => other.to_rgba8(),
    }
}

pub fn resize_rgba(img: &RgbaImage, target: Dimensions, filter: FilterType) -> AppResult<RgbaImage> {
    let internal = |e: &dyn std::fmt::Display| AppError::new(ErrorCode::Internal, format!("resize: {e}"));
    let src = FirImage::from_vec_u8(img.width(), img.height(), img.as_raw().clone(), PixelType::U8x4)
        .map_err(|e| internal(&e))?;
    let mut dst = FirImage::new(target.width, target.height, PixelType::U8x4);
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(filter)).use_alpha(true);
    Resizer::new().resize(&src, &mut dst, &opts).map_err(|e| internal(&e))?;
    RgbaImage::from_raw(target.width, target.height, dst.into_vec()).ok_or_else(|| internal(&"buffer size"))
}

fn flatten_on_white(img: &RgbaImage) -> RgbImage {
    RgbImage::from_fn(img.width(), img.height(), |x, y| {
        let p = img.get_pixel(x, y).0;
        let a = p[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
        image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])])
    })
}

fn encode_err(e: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::EncodeFailed, e.to_string())
}

fn save_png(img: &DynamicImage, dest: &Path, compression: CompressionType) -> AppResult<()> {
    let w = BufWriter::new(File::create(dest)?);
    let enc = PngEncoder::new_with_quality(w, compression, PngFilter::Adaptive);
    img.write_with_encoder(enc).map_err(encode_err)
}

pub fn check_output_limits(format: OutputFormat, dims: Dimensions) -> AppResult<()> {
    let max = match format {
        OutputFormat::Webp => WEBP_MAX_SIDE,
        OutputFormat::Jpeg => JPEG_MAX_SIDE,
        OutputFormat::Png => u32::MAX,
    };
    if dims.width > max || dims.height > max {
        return Err(AppError::new(
            ErrorCode::InvalidParams,
            format!("{}x{} exceeds the {max}px limit of {:?}", dims.width, dims.height, format),
        ));
    }
    Ok(())
}

/// Converts the engine's PNG into the final file: optional resize to the exact
/// target size, then encoding. A PNG that needs no resize is moved as-is.
pub fn finalize(engine_png: &Path, target: Option<Dimensions>, opts: &OutputOptions, dest: &Path) -> AppResult<()> {
    if target.is_none() && opts.format == OutputFormat::Png {
        std::fs::rename(engine_png, dest).or_else(|_| std::fs::copy(engine_png, dest).map(|_| ()))?;
        return Ok(());
    }
    let img = decode(engine_png)?;
    let has_alpha = img.color().has_alpha();
    let img = match target {
        Some(t) if t.width != img.width() || t.height != img.height() => {
            DynamicImage::ImageRgba8(resize_rgba(&to_rgba(img), t, FilterType::Lanczos3)?)
        }
        _ => img,
    };
    encode(img, has_alpha, opts, dest)
}

fn encode(img: DynamicImage, has_alpha: bool, opts: &OutputOptions, dest: &Path) -> AppResult<()> {
    let bytes = encode_bytes(&img, has_alpha, opts.format, opts.quality, opts.webp_lossless, CompressionType::Default)?;
    std::fs::write(dest, bytes)?;
    Ok(())
}

/// Encodes in memory, so compression can try several qualities cheaply.
pub fn encode_bytes(
    img: &DynamicImage,
    has_alpha: bool,
    format: OutputFormat,
    quality: u8,
    webp_lossless: bool,
    png: CompressionType,
) -> AppResult<Vec<u8>> {
    let mut out = Vec::new();
    match format {
        OutputFormat::Png => {
            let enc = PngEncoder::new_with_quality(&mut out, png, PngFilter::Adaptive);
            if has_alpha {
                img.write_with_encoder(enc).map_err(encode_err)?;
            } else {
                DynamicImage::ImageRgb8(img.to_rgb8()).write_with_encoder(enc).map_err(encode_err)?;
            }
        }
        OutputFormat::Jpeg => {
            let rgb = if has_alpha { flatten_on_white(&img.to_rgba8()) } else { img.to_rgb8() };
            JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100))
                .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
                .map_err(encode_err)?;
        }
        OutputFormat::Webp => {
            let enc_bytes = |enc: webp::Encoder<'_>| {
                if webp_lossless { enc.encode_lossless().to_vec() } else { enc.encode(quality as f32).to_vec() }
            };
            out = if has_alpha {
                let rgba = img.to_rgba8();
                enc_bytes(webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height()))
            } else {
                let rgb = img.to_rgb8();
                enc_bytes(webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height()))
            };
        }
    }
    Ok(out)
}

/// Scales `img` to cover `target` (no stretching), then crops the centre to exactly `target`.
pub fn cover_crop(img: &DynamicImage, target: Dimensions) -> AppResult<DynamicImage> {
    let f = (target.width as f64 / img.width() as f64).max(target.height as f64 / img.height() as f64);
    let scaled = Dimensions {
        width: ((img.width() as f64 * f).ceil() as u32).max(target.width),
        height: ((img.height() as f64 * f).ceil() as u32).max(target.height),
    };
    let rgba = if scaled.width == img.width() && scaled.height == img.height() {
        img.to_rgba8()
    } else {
        resize_rgba(&img.to_rgba8(), scaled, FilterType::Lanczos3)?
    };
    let x = (scaled.width - target.width) / 2;
    let y = (scaled.height - target.height) / 2;
    Ok(DynamicImage::ImageRgba8(image::imageops::crop_imm(&rgba, x, y, target.width, target.height).to_image()))
}

/// Fits `img` inside `size` (no crop, no stretch) and centres it on a transparent canvas.
pub fn contain_on_canvas(img: &DynamicImage, size: Dimensions) -> AppResult<DynamicImage> {
    let f = (size.width as f64 / img.width() as f64).min(size.height as f64 / img.height() as f64);
    let fit = Dimensions {
        width: ((img.width() as f64 * f).round() as u32).clamp(1, size.width),
        height: ((img.height() as f64 * f).round() as u32).clamp(1, size.height),
    };
    let rgba = if fit.width == img.width() && fit.height == img.height() { img.to_rgba8() } else { resize_rgba(&img.to_rgba8(), fit, FilterType::Lanczos3)? };
    let mut canvas = RgbaImage::new(size.width, size.height);
    image::imageops::overlay(&mut canvas, &rgba, ((size.width - fit.width) / 2) as i64, ((size.height - fit.height) / 2) as i64);
    Ok(DynamicImage::ImageRgba8(canvas))
}

/// Lanczos resize by a factor (used when a size limit cannot be met by quality alone).
pub fn resize_by(img: &DynamicImage, factor: f64) -> AppResult<DynamicImage> {
    let target = Dimensions {
        width: ((img.width() as f64 * factor).round() as u32).max(1),
        height: ((img.height() as f64 * factor).round() as u32).max(1),
    };
    Ok(DynamicImage::ImageRgba8(resize_rgba(&img.to_rgba8(), target, FilterType::Lanczos3)?))
}

/// Small WebP rendition for thumbnails and preview proxies. Keeps alpha.
pub fn write_preview(src: &Path, max_side: u32, dest: &Path) -> AppResult<Dimensions> {
    let img = to_rgba(decode(src)?);
    let (w, h) = (img.width(), img.height());
    let ratio = (max_side as f64 / w.max(h) as f64).min(1.0);
    let target = Dimensions {
        width: ((w as f64 * ratio).round() as u32).max(1),
        height: ((h as f64 * ratio).round() as u32).max(1),
    };
    let small = if ratio < 1.0 { resize_rgba(&img, target, FilterType::Bilinear)? } else { img };
    let bytes = webp::Encoder::from_rgba(small.as_raw(), small.width(), small.height()).encode(85.0).to_vec();
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, bytes)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(dir: &Path, name: &str, alpha: bool) -> PathBuf {
        let path = dir.join(name);
        let img = RgbaImage::from_fn(40, 30, |x, y| image::Rgba([x as u8 * 6, y as u8 * 8, 120, if alpha { 128 } else { 255 }]));
        let img = if alpha { DynamicImage::ImageRgba8(img) } else { DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(img).to_rgb8()) };
        img.save(&path).unwrap();
        path
    }

    #[test]
    fn probe_reads_header_and_rejects_bad_files() {
        let dir = tempfile::tempdir().unwrap();
        let png = sample(dir.path(), "a b.png", true);
        let info = probe(&png).unwrap();
        assert_eq!((info.width, info.height, info.format.as_str()), (40, 30, "PNG"));

        let fake = dir.path().join("fake.png");
        std::fs::write(&fake, b"definitely not an image").unwrap();
        assert_eq!(probe(&fake).unwrap_err().code, ErrorCode::DecodeFailed);
        let txt = dir.path().join("notes.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert_eq!(probe(&txt).unwrap_err().code, ErrorCode::UnsupportedFormat);
        assert_eq!(probe(&dir.path().join("missing.png")).unwrap_err().code, ErrorCode::FileNotFound);
    }

    #[test]
    fn bmp_is_converted_but_png_is_passed_through() {
        let dir = tempfile::tempdir().unwrap();
        let png = sample(dir.path(), "x.png", false);
        assert!(prepare_engine_input(&png, &dir.path().join("t.png")).unwrap().is_none());
        let bmp = sample(dir.path(), "x.bmp", false);
        let tmp = dir.path().join("t2.png");
        assert_eq!(prepare_engine_input(&bmp, &tmp).unwrap().as_deref(), Some(tmp.as_path()));
        assert_eq!(probe(&tmp).unwrap().format, "PNG");
    }

    #[test]
    fn finalize_resizes_and_encodes_every_format() {
        let dir = tempfile::tempdir().unwrap();
        let target = Some(Dimensions { width: 64, height: 48 });
        for (format, ext) in [(OutputFormat::Png, "png"), (OutputFormat::Jpeg, "jpg"), (OutputFormat::Webp, "webp")] {
            let src = sample(dir.path(), &format!("src_{ext}.png"), true);
            let dest = dir.path().join(format!("out.{ext}"));
            let opts = OutputOptions { format, ..OutputOptions::default() };
            finalize(&src, target, &opts, &dest).unwrap();
            let info = probe(&dest).unwrap();
            assert_eq!((info.width, info.height), (64, 48), "{ext}");
        }
    }

    #[test]
    fn cover_crop_is_exact_and_centred() {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_fn(400, 300, |x, _| image::Rgba([if x < 200 { 0 } else { 255 }, 0, 0, 255])));
        let out = cover_crop(&img, Dimensions { width: 680, height: 240 }).unwrap();
        assert_eq!((out.width(), out.height()), (680, 240));
        // Centre crop of a left/right split stays split in the middle.
        let px = out.to_rgba8();
        assert!(px.get_pixel(10, 120)[0] < 50 && px.get_pixel(670, 120)[0] > 200);
    }

    #[test]
    fn output_limits() {
        let big = Dimensions { width: 20000, height: 100 };
        assert!(check_output_limits(OutputFormat::Webp, big).is_err());
        assert!(check_output_limits(OutputFormat::Png, big).is_ok());
    }

    #[test]
    fn preview_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let src = sample(dir.path(), "p.png", true);
        let dims = write_preview(&src, 20, &dir.path().join("thumbs/p.webp")).unwrap();
        assert_eq!(dims, Dimensions { width: 20, height: 15 });
    }
}
