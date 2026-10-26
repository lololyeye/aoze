//! Colour looks for clips: a few built-in looks (computed, no third-party
//! files) and `.cube` 3D LUTs the user imports. A look is folded into the
//! clip's single colour LUT (color.rs), applied to SDR signal values, so HDR
//! sources are graded after tone mapping and HDR output is expanded after.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;

use crate::error::{AppError, AppResult, ErrorCode};

type Rgb = [f64; 3];

/// Largest LUT accepted (65³ is the biggest size in common use).
const MAX_CUBE_SIZE: usize = 65;
/// Imported files above this size are not LUTs anyone needs (65³ ≈ 8 MB of text).
const MAX_CUBE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Builtin {
    TealOrange,
    Warm,
    Cool,
    Fade,
    Mono,
    Vivid,
}

impl Builtin {
    pub const ALL: [Builtin; 6] = [Builtin::TealOrange, Builtin::Warm, Builtin::Cool, Builtin::Fade, Builtin::Mono, Builtin::Vivid];

    pub fn slug(self) -> &'static str {
        match self {
            Builtin::TealOrange => "teal-orange",
            Builtin::Warm => "warm",
            Builtin::Cool => "cool",
            Builtin::Fade => "fade",
            Builtin::Mono => "mono",
            Builtin::Vivid => "vivid",
        }
    }

    fn apply(self, c: Rgb) -> Rgb {
        let y = luma(c);
        match self {
            Builtin::TealOrange => {
                // Split toning: cool shadows, warm highlights (skin stays warm), light S curve.
                let sh = (1.0 - y).powi(2);
                let hi = y * y;
                let t = [c[0] - 0.05 * sh + 0.07 * hi, c[1] + 0.015 * sh + 0.015 * hi, c[2] + 0.06 * sh - 0.06 * hi];
                saturate(s_curve(t, 0.12), 1.08)
            }
            Builtin::Warm => [c[0] * 1.05 + 0.01, c[1] * 1.01, c[2] * 0.9],
            Builtin::Cool => [c[0] * 0.92, c[1] * 1.0, c[2] * 1.06 + 0.01],
            Builtin::Fade => {
                // Lifted blacks, softer highlights, a little less colour.
                let f = c.map(|v| 0.07 + v * 0.86);
                saturate(f, 0.82)
            }
            Builtin::Mono => {
                let m = s_curve([y; 3], 0.15);
                [m[0] * 1.01, m[1], m[2] * 0.98]
            }
            Builtin::Vivid => saturate(s_curve(c, 0.1), 1.3),
        }
    }
}

fn luma(c: Rgb) -> f64 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

fn saturate(c: Rgb, s: f64) -> Rgb {
    let y = luma(c);
    c.map(|v| y + (v - y) * s)
}

/// Contrast around mid grey that keeps black and white in place.
fn s_curve(c: Rgb, k: f64) -> Rgb {
    c.map(|v| {
        let v = v.clamp(0.0, 1.0);
        let s = v * v * (3.0 - 2.0 * v);
        v + (s - v) * k * 2.0
    })
}

/// A parsed `.cube` 3D LUT.
#[derive(Debug, Clone, PartialEq)]
pub struct CubeLut {
    size: usize,
    min: Rgb,
    max: Rgb,
    /// Red fastest, then green, then blue (the .cube order).
    data: Vec<[f32; 3]>,
}

impl CubeLut {
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut size = None;
        let mut min = [0.0; 3];
        let mut max = [1.0; 3];
        let mut data = Vec::new();
        for raw in text.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut words = line.split_whitespace();
            let first = words.next().unwrap_or_default();
            let triple = |w: &mut std::str::SplitWhitespace| -> Result<Rgb, String> {
                let v: Vec<f64> = w.take(3).map(|x| x.parse::<f64>().map_err(|_| format!("invalid number in \"{line}\""))).collect::<Result<_, _>>()?;
                if v.len() != 3 || v.iter().any(|x| !x.is_finite()) {
                    return Err(format!("expected three numbers in \"{line}\""));
                }
                Ok([v[0], v[1], v[2]])
            };
            match first.to_ascii_uppercase().as_str() {
                "TITLE" => {}
                "LUT_1D_SIZE" => return Err("1D LUT: only 3D .cube LUTs are supported".into()),
                "LUT_3D_SIZE" => {
                    let n = words.next().and_then(|v| v.parse::<usize>().ok()).ok_or("invalid LUT_3D_SIZE")?;
                    if !(2..=MAX_CUBE_SIZE).contains(&n) {
                        return Err(format!("LUT_3D_SIZE {n} is out of range (2 to {MAX_CUBE_SIZE})"));
                    }
                    size = Some(n);
                }
                "DOMAIN_MIN" => min = triple(&mut words)?,
                "DOMAIN_MAX" => max = triple(&mut words)?,
                "LUT_3D_INPUT_RANGE" => {
                    let v: Vec<f64> = words.filter_map(|x| x.parse().ok()).collect();
                    if v.len() == 2 {
                        min = [v[0]; 3];
                        max = [v[1]; 3];
                    }
                }
                _ if first.starts_with(|c: char| c.is_ascii_digit() || c == '-' || c == '.' || c == '+') => {
                    let mut w = line.split_whitespace();
                    let v = triple(&mut w)?;
                    data.push(v.map(|x| x as f32));
                }
                // Unknown keywords (vendor extensions) are ignored, as other readers do.
                _ => {}
            }
        }
        let size = size.ok_or("missing LUT_3D_SIZE")?;
        if data.len() != size * size * size {
            return Err(format!("{} entries instead of {}", data.len(), size * size * size));
        }
        if (0..3).any(|i| max[i] <= min[i]) {
            return Err("invalid DOMAIN_MIN / DOMAIN_MAX".into());
        }
        Ok(Self { size, min, max, data })
    }

    fn at(&self, r: usize, g: usize, b: usize) -> Rgb {
        let v = self.data[(b * self.size + g) * self.size + r];
        [v[0] as f64, v[1] as f64, v[2] as f64]
    }

    /// Trilinear lookup.
    pub fn sample(&self, c: Rgb) -> Rgb {
        let n = self.size - 1;
        let pos: [f64; 3] = [0, 1, 2].map(|i| ((c[i] - self.min[i]) / (self.max[i] - self.min[i])).clamp(0.0, 1.0) * n as f64);
        let i0 = pos.map(|p| (p.floor() as usize).min(n.saturating_sub(1)));
        let f: [f64; 3] = [0, 1, 2].map(|k| pos[k] - i0[k] as f64);
        let mut out = [0.0; 3];
        for (db, wb) in [(0, 1.0 - f[2]), (1, f[2])] {
            for (dg, wg) in [(0, 1.0 - f[1]), (1, f[1])] {
                for (dr, wr) in [(0, 1.0 - f[0]), (1, f[0])] {
                    let w = wr * wg * wb;
                    if w == 0.0 {
                        continue;
                    }
                    let v = self.at(i0[0] + dr, i0[1] + dg, i0[2] + db);
                    for k in 0..3 {
                        out[k] += v[k] * w;
                    }
                }
            }
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Builtin(Builtin),
    Cube(Arc<CubeLut>),
}

/// A look at a strength, applied to SDR R'G'B' values (0..1).
#[derive(Debug, Clone, PartialEq)]
pub struct Creative {
    kind: Kind,
    strength: f64,
}

impl Creative {
    pub fn apply(&self, c: Rgb) -> Rgb {
        let looked = match &self.kind {
            Kind::Builtin(b) => b.apply(c),
            Kind::Cube(l) => l.sample(c),
        };
        [0, 1, 2].map(|i| (c[i] + (looked[i] - c[i]) * self.strength).clamp(0.0, 1.0))
    }
}

pub fn builtin(id: &str) -> Option<Builtin> {
    let slug = id.strip_prefix("builtin:")?;
    Builtin::ALL.into_iter().find(|b| b.slug() == slug)
}

/// A file name Aoze wrote itself: no path, no surprise characters.
fn safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name.to_ascii_lowercase().ends_with(".cube")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.starts_with('.')
}

/// Shape of a LUT id stored in the settings.
pub fn valid_id(id: &str) -> bool {
    builtin(id).is_some() || id.strip_prefix("user:").is_some_and(safe_file_name)
}

/// Resolves a LUT id to the look to apply. A user LUT that disappeared or no
/// longer parses is an error the job reports (better than a silent no-op).
pub fn resolve(id: &str, strength: u8, luts_dir: &Path) -> AppResult<Option<Creative>> {
    if strength == 0 {
        return Ok(None);
    }
    let kind = if let Some(b) = builtin(id) {
        Kind::Builtin(b)
    } else if let Some(name) = id.strip_prefix("user:").filter(|n| safe_file_name(n)) {
        let path = luts_dir.join(name);
        let text = std::fs::read_to_string(&path).map_err(|e| AppError::new(ErrorCode::FileNotFound, format!("LUT {}: {e}", path.display())))?;
        Kind::Cube(Arc::new(CubeLut::parse(&text).map_err(|e| AppError::new(ErrorCode::InvalidParams, format!("LUT {name}: {e}")))?))
    } else {
        return Err(AppError::new(ErrorCode::InvalidParams, format!("unknown LUT {id}")));
    };
    Ok(Some(Creative { kind, strength: strength as f64 / 100.0 }))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LutInfo {
    pub id: String,
    /// Display name (user LUTs: the file name without extension; built-ins are translated by the UI).
    pub name: String,
    pub builtin: bool,
}

pub fn list(luts_dir: &Path) -> Vec<LutInfo> {
    let mut out: Vec<LutInfo> = Builtin::ALL
        .iter()
        .map(|b| LutInfo { id: format!("builtin:{}", b.slug()), name: b.slug().into(), builtin: true })
        .collect();
    let mut user: Vec<LutInfo> = std::fs::read_dir(luts_dir)
        .map(|d| {
            d.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    safe_file_name(&name).then(|| LutInfo { id: format!("user:{name}"), name: name[..name.len() - 5].to_string(), builtin: false })
                })
                .collect()
        })
        .unwrap_or_default();
    user.sort_by_key(|l| l.name.to_lowercase());
    out.extend(user);
    out
}

/// File name for an imported LUT: ASCII letters, digits, `-` and `_`, unique in the folder.
fn import_name(src: &Path, luts_dir: &Path) -> String {
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut base: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(60)
        .collect();
    if base.is_empty() {
        base = "lut".into();
    }
    let mut name = format!("{base}.cube");
    let mut i = 2;
    while luts_dir.join(&name).exists() {
        name = format!("{base}-{i}.cube");
        i += 1;
    }
    name
}

/// Checks a `.cube` file and copies it into the LUT folder.
pub fn import(src: &Path, luts_dir: &Path) -> AppResult<LutInfo> {
    let bad = |detail: String| AppError::new(ErrorCode::UnsupportedFormat, detail);
    if !src.extension().is_some_and(|e| e.eq_ignore_ascii_case("cube")) {
        return Err(bad(format!("{}: not a .cube file", src.display())));
    }
    let len = std::fs::metadata(src).map_err(|e| AppError::new(ErrorCode::FileNotFound, format!("{}: {e}", src.display())))?.len();
    if len > MAX_CUBE_BYTES {
        return Err(bad(format!("{}: file too large for a LUT", src.display())));
    }
    let text = std::fs::read_to_string(src).map_err(|e| bad(format!("{}: {e}", src.display())))?;
    CubeLut::parse(&text).map_err(|e| bad(format!("{}: {e}", src.display())))?;
    std::fs::create_dir_all(luts_dir)?;
    let name = import_name(src, luts_dir);
    crate::fsutil::write_atomic(&luts_dir.join(&name), text.as_bytes())?;
    Ok(LutInfo { id: format!("user:{name}"), name: name[..name.len() - 5].to_string(), builtin: false })
}

pub fn remove(id: &str, luts_dir: &Path) -> AppResult<()> {
    let name = id.strip_prefix("user:").filter(|n| safe_file_name(n)).ok_or_else(|| AppError::new(ErrorCode::InvalidParams, format!("not a user LUT: {id}")))?;
    match std::fs::remove_file(luts_dir.join(name)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Where imported LUTs live.
pub fn dir(config_dir: &Path) -> PathBuf {
    config_dir.join("luts")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_cube(n: usize) -> String {
        let mut s = format!("TITLE \"id\"\n# comment\nLUT_3D_SIZE {n}\n");
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let f = |i: usize| i as f64 / (n - 1) as f64;
                    s.push_str(&format!("{} {} {}\n", f(r), f(g), f(b)));
                }
            }
        }
        s
    }

    #[test]
    fn identity_cube_is_identity() {
        let l = CubeLut::parse(&identity_cube(5)).unwrap();
        for c in [[0.0, 0.0, 0.0], [0.3, 0.6, 0.9], [1.0, 1.0, 1.0], [0.11, 0.5, 0.77]] {
            let o = l.sample(c);
            for k in 0..3 {
                assert!((o[k] - c[k]).abs() < 1e-6, "{c:?} -> {o:?}");
            }
        }
    }

    #[test]
    fn invalid_cubes_are_rejected() {
        assert!(CubeLut::parse("LUT_1D_SIZE 4\n0 0 0").is_err());
        assert!(CubeLut::parse("LUT_3D_SIZE 2\n0 0 0\n1 1 1").is_err());
        assert!(CubeLut::parse("0 0 0").is_err());
        assert!(CubeLut::parse("LUT_3D_SIZE 99").is_err());
        assert!(CubeLut::parse(&identity_cube(2).replace("1 1 1", "1 x 1")).is_err());
    }

    #[test]
    fn strength_blends_toward_the_original() {
        let c = [0.5, 0.4, 0.3];
        let full = resolve("builtin:mono", 100, Path::new(".")).unwrap().unwrap().apply(c);
        let half = resolve("builtin:mono", 50, Path::new(".")).unwrap().unwrap().apply(c);
        assert!((full[0] - full[2]).abs() < 0.05, "mono is grey: {full:?}");
        for k in 0..3 {
            assert!((half[k] - (c[k] + full[k]) / 2.0).abs() < 1e-9);
        }
        assert!(resolve("builtin:mono", 0, Path::new(".")).unwrap().is_none());
    }

    #[test]
    fn builtins_keep_black_and_white_reasonable() {
        for b in Builtin::ALL {
            let k = Creative { kind: Kind::Builtin(b), strength: 1.0 };
            assert!(luma(k.apply([0.0; 3])) < 0.1, "{b:?}");
            assert!(luma(k.apply([1.0; 3])) > 0.85, "{b:?}");
        }
    }

    #[test]
    fn import_list_remove() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("My Film Look (v2).cube");
        std::fs::write(&src, identity_cube(3)).unwrap();
        let luts = dir.path().join("luts");
        let a = import(&src, &luts).unwrap();
        let b = import(&src, &luts).unwrap();
        assert_eq!(a.id, "user:My-Film-Look--v2.cube");
        assert_eq!(b.id, "user:My-Film-Look--v2-2.cube");
        assert!(valid_id(&a.id));
        assert!(!valid_id("user:../x.cube") && !valid_id("user:a\\b.cube") && !valid_id("builtin:nope"));
        assert_eq!(list(&luts).iter().filter(|l| !l.builtin).count(), 2);
        assert!(resolve(&a.id, 100, &luts).unwrap().is_some());
        remove(&a.id, &luts).unwrap();
        assert_eq!(list(&luts).iter().filter(|l| !l.builtin).count(), 1);
        let txt = dir.path().join("x.txt");
        std::fs::write(&txt, identity_cube(3)).unwrap();
        assert!(import(&txt, &luts).is_err());
    }
}
