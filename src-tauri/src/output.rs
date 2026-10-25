//! Output file naming and conflict handling.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorCode};
use crate::settings::{ConflictPolicy, UpscaleParams};

pub fn format_scale(scale: f32) -> String {
    let s = format!("{scale:.2}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

pub fn render_suffix(template: &str, params: &UpscaleParams) -> String {
    let noise = if params.noise < 0 { "off".to_string() } else { params.noise.to_string() };
    let rendered = template
        .replace("{style}", params.style.slug())
        .replace("{scale}", &format_scale(params.scale))
        .replace("{noise}", &noise);
    rendered.chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !c.is_control()).collect()
}

/// Where the output would go, before conflict resolution.
pub fn base_output_path(source: &Path, fallback_dir: &Path, directory: Option<&Path>, suffix: &str, ext: &str) -> PathBuf {
    let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "image".into());
    let dir = directory
        .map(Path::to_path_buf)
        .or_else(|| source.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| fallback_dir.to_path_buf());
    let name = format!("{stem}{suffix}.{ext}");
    dir.join(name.trim())
}

/// Suffix for GIFs and clips: `_aoze`, plus the scale and frame rate when they change.
pub fn anim_suffix(scale: f32, fps: Option<f32>) -> String {
    let mut s = String::from("_aoze");
    if (scale - 1.0).abs() > 1e-3 {
        s.push_str(&format!("_{}x", format_scale(scale)));
    }
    if let Some(f) = fps {
        s.push_str(&format!("_{}fps", format_scale(f)));
    }
    s
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy()),
    }
}

fn numbered(path: &Path, n: u32) -> PathBuf {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    path.with_file_name(format!("{stem} ({n}){ext}"))
}

pub enum Resolved {
    Write(PathBuf),
    /// The output exists and the policy is Skip.
    Skip(PathBuf),
}

/// Applies the conflict policy. The source file is never overwritten, whatever the policy.
pub fn resolve_conflict(base: PathBuf, source: &Path, policy: ConflictPolicy) -> AppResult<Resolved> {
    let clashes = |p: &Path| p.exists() || same_file(p, source);
    if !clashes(&base) {
        return Ok(Resolved::Write(base));
    }
    let is_source = same_file(&base, source);
    match policy {
        ConflictPolicy::Skip if !is_source => Ok(Resolved::Skip(base)),
        ConflictPolicy::Overwrite if !is_source => Ok(Resolved::Write(base)),
        _ => (1..10_000)
            .map(|n| numbered(&base, n))
            .find(|p| !clashes(p))
            .map(Resolved::Write)
            .ok_or_else(|| AppError::new(ErrorCode::OutputUnwritable, "too many files with the same name")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{OutputFormat, OutputOptions, Style};

    fn params() -> UpscaleParams {
        UpscaleParams { style: Style::Artwork, scale: 1.6, noise: -1, ..UpscaleParams::default() }
    }

    #[test]
    fn suffix_tokens_and_sanitising() {
        assert_eq!(render_suffix("_{style}_{scale}x_noise{noise}", &params()), "_art_1.6x_noiseoff");
        assert_eq!(render_suffix("_a:b*?{scale}", &UpscaleParams::default()), "_ab2");
        assert_eq!(format_scale(2.0), "2");
    }

    #[test]
    fn base_path_uses_source_dir_or_custom_dir() {
        let src = Path::new(r"C:\pics\my image.webp");
        let suffix = render_suffix(&OutputOptions::default().suffix, &params());
        let p = base_output_path(src, Path::new(r"C:\fallback"), None, &suffix, OutputFormat::Png.extension());
        assert_eq!(p, PathBuf::from(r"C:\pics\my image_art_1.6x_noiseoff.png"));
        let out = Path::new(r"D:\out");
        assert_eq!(base_output_path(src, Path::new("x"), Some(out), "", "png"), PathBuf::from(r"D:\out\my image.png"));
    }

    #[test]
    fn anim_suffixes() {
        assert_eq!(anim_suffix(1.0, None), "_aoze");
        assert_eq!(anim_suffix(2.0, Some(60.0)), "_aoze_2x_60fps");
        assert_eq!(anim_suffix(1.6, None), "_aoze_1.6x");
    }

    #[test]
    fn conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.png");
        let out = dir.path().join("out.png");
        std::fs::write(&src, b"s").unwrap();

        assert!(matches!(resolve_conflict(out.clone(), &src, ConflictPolicy::Skip).unwrap(), Resolved::Write(p) if p == out));
        std::fs::write(&out, b"o").unwrap();
        assert!(matches!(resolve_conflict(out.clone(), &src, ConflictPolicy::Skip).unwrap(), Resolved::Skip(_)));
        assert!(matches!(resolve_conflict(out.clone(), &src, ConflictPolicy::Overwrite).unwrap(), Resolved::Write(p) if p == out));
        let renamed = dir.path().join("out (1).png");
        assert!(matches!(resolve_conflict(out.clone(), &src, ConflictPolicy::Rename).unwrap(), Resolved::Write(p) if p == renamed));
        // Never overwrite the source, even with Overwrite.
        let r = resolve_conflict(src.clone(), &src, ConflictPolicy::Overwrite).unwrap();
        assert!(matches!(r, Resolved::Write(p) if p == dir.path().join("src (1).png")));
    }
}
