//! Colour pipeline for clips: HDR handling and the "Look" adjustments.
//!
//! Everything is done by one 3D LUT computed here and applied by FFmpeg's
//! `lut3d` on 16-bit RGB. The LUT decodes the input transfer (SDR gamma, PQ or
//! HLG) to linear light in nits, applies the look, maps the luminance range
//! (HDR to SDR tone mapping, or SDR to HDR inverse tone mapping), converts the
//! primaries and encodes the output transfer. Nothing is faked: an HDR output
//! is a real PQ / HLG signal in BT.2020, 10-bit, tagged as such.

use std::fmt::Write as _;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::settings::Look;

/// Transfer characteristic of a video signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transfer {
    /// BT.709 / sRGB-like gamma, BT.709 primaries.
    Sdr,
    /// SMPTE ST 2084 (HDR10), BT.2020 primaries.
    Pq,
    /// ARIB STD-B67 (HLG), BT.2020 primaries.
    Hlg,
}

impl Transfer {
    /// From ffprobe's `color_transfer`.
    pub fn from_probe(color_transfer: &str) -> Self {
        match color_transfer {
            "smpte2084" => Self::Pq,
            "arib-std-b67" => Self::Hlg,
            _ => Self::Sdr,
        }
    }

    pub fn is_hdr(self) -> bool {
        self != Self::Sdr
    }

    fn ffmpeg_trc(self) -> &'static str {
        match self {
            Self::Sdr => "bt709",
            Self::Pq => "smpte2084",
            Self::Hlg => "arib-std-b67",
        }
    }
}

/// SDR reference white (BT.2408): diffuse white and skin keep this level in HDR.
const SDR_WHITE_NITS: f64 = 203.0;
/// Peak of the expanded highlights for SDR to HDR.
const ITM_PEAK_NITS: f64 = 1000.0;
/// Where highlight expansion starts, in SDR linear light (0..1).
const ITM_KNEE: f64 = 0.62;
/// HLG nominal peak (BT.2100 reference display).
const HLG_PEAK_NITS: f64 = 1000.0;
/// Assumed mastering peak of PQ sources without metadata.
const PQ_SOURCE_PEAK_NITS: f64 = 1000.0;
pub const LUT_SIZE: usize = 33;

// --- transfer functions -----------------------------------------------------

const PQ_M1: f64 = 0.1593017578125;
const PQ_M2: f64 = 78.84375;
const PQ_C1: f64 = 0.8359375;
const PQ_C2: f64 = 18.8515625;
const PQ_C3: f64 = 18.6875;

/// Nits -> PQ signal (0..1).
pub fn pq_encode(nits: f64) -> f64 {
    let y = (nits / 10_000.0).clamp(0.0, 1.0).powf(PQ_M1);
    ((PQ_C1 + PQ_C2 * y) / (1.0 + PQ_C3 * y)).powf(PQ_M2)
}

/// PQ signal -> nits.
pub fn pq_decode(v: f64) -> f64 {
    let p = v.clamp(0.0, 1.0).powf(1.0 / PQ_M2);
    let y = ((p - PQ_C1).max(0.0) / (PQ_C2 - PQ_C3 * p)).powf(1.0 / PQ_M1);
    y * 10_000.0
}

const HLG_A: f64 = 0.178_832_77;
const HLG_B: f64 = 0.284_668_92;
const HLG_C: f64 = 0.559_910_73;

/// HLG signal -> scene light (0..1).
fn hlg_inverse_oetf(v: f64) -> f64 {
    if v <= 0.5 {
        v * v / 3.0
    } else {
        (((v - HLG_C) / HLG_A).exp() + HLG_B) / 12.0
    }
}

/// Scene light (0..1) -> HLG signal.
fn hlg_oetf(e: f64) -> f64 {
    let e = e.clamp(0.0, 1.0);
    if e <= 1.0 / 12.0 {
        (3.0 * e).sqrt()
    } else {
        HLG_A * (12.0 * e - HLG_B).ln() + HLG_C
    }
}

/// HLG system gamma for a 1000 nit display (BT.2100).
const HLG_GAMMA: f64 = 1.2;

// --- colour spaces ----------------------------------------------------------

type Rgb = [f64; 3];

const BT709_TO_BT2020: [[f64; 3]; 3] = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.0880, 0.8956]];
const BT2020_TO_BT709: [[f64; 3]; 3] = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]];
const LUMA_709: Rgb = [0.2126, 0.7152, 0.0722];
const LUMA_2020: Rgb = [0.2627, 0.6780, 0.0593];

fn mul(m: &[[f64; 3]; 3], c: Rgb) -> Rgb {
    [0, 1, 2].map(|i| m[i][0] * c[0] + m[i][1] * c[1] + m[i][2] * c[2])
}

fn luma(c: Rgb, w: Rgb) -> f64 {
    c[0] * w[0] + c[1] * w[1] + c[2] * w[2]
}

// --- the plan -----------------------------------------------------------------

/// What happens to the colours of one clip.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ColorPlan {
    pub input: Transfer,
    pub output: Transfer,
    pub look: Look,
}

impl ColorPlan {
    /// Nothing to do: no LUT, no conversion.
    pub fn is_identity(&self) -> bool {
        self.input == self.output && self.look.is_neutral()
    }

    /// One LUT entry: input signal (R'G'B', 0..1) -> output signal.
    fn map(&self, rgb: Rgb) -> Rgb {
        // 1. Decode to linear light in nits, in the input primaries.
        let (lin, wide) = match self.input {
            Transfer::Sdr => (rgb.map(|v| v.clamp(0.0, 1.0).powf(2.4) * SDR_WHITE_NITS), false),
            Transfer::Pq => (rgb.map(pq_decode), true),
            Transfer::Hlg => {
                let scene = rgb.map(hlg_inverse_oetf);
                let y = luma(scene, LUMA_2020).max(1e-9);
                let ootf = y.powf(HLG_GAMMA - 1.0) * HLG_PEAK_NITS;
                (scene.map(|e| e * ootf), true)
            }
        };
        // 2. Work in BT.2020 for every case.
        let mut c = if wide { lin } else { mul(&BT709_TO_BT2020, lin) };

        // 3. Look: exposure, contrast and saturation around the reference white.
        c = self.apply_look(c);

        // 4. Luminance range.
        let y = luma(c, LUMA_2020).max(1e-9);
        let target = match (self.input.is_hdr(), self.output.is_hdr()) {
            (false, true) => expand_highlights(y),
            (true, false) => tone_map(y),
            _ => y,
        };
        c = c.map(|v| v.max(0.0) * target / y);

        // 5. Encode the output.
        match self.output {
            Transfer::Sdr => {
                let s = mul(&BT2020_TO_BT709, c);
                // Out-of-gamut colours are desaturated toward their luma, not clipped per channel.
                let l = luma(s, LUMA_709).max(0.0);
                let lo = s.iter().cloned().fold(f64::INFINITY, f64::min);
                let k = if lo < 0.0 && l > 0.0 { l / (l - lo) } else { 1.0 };
                s.map(|v| ((l + (v - l) * k) / SDR_WHITE_NITS).clamp(0.0, 1.0).powf(1.0 / 2.4))
            }
            Transfer::Pq => c.map(pq_encode),
            Transfer::Hlg => {
                let y = (luma(c, LUMA_2020) / HLG_PEAK_NITS).max(1e-9);
                let scale = y.powf((1.0 - HLG_GAMMA) / HLG_GAMMA) / HLG_PEAK_NITS;
                c.map(|v| hlg_oetf(v * scale))
            }
        }
    }

    fn apply_look(&self, c: Rgb) -> Rgb {
        let l = self.look;
        if l.is_neutral() {
            return c;
        }
        // Exposure: -100..100 -> -1..+1 stop.
        let gain = 2f64.powf(l.exposure as f64 / 100.0);
        let mut c = c.map(|v| v * gain);
        // Contrast: a gentle power curve in log space pivoting on 18 % grey.
        if l.contrast != 0 {
            let k = 1.0 + l.contrast as f64 / 100.0 * 0.35;
            let pivot = 0.18 * SDR_WHITE_NITS;
            c = c.map(|v| if v <= 0.0 { 0.0 } else { pivot * (v / pivot).powf(k) });
        }
        // Saturation: distance from the luma, -100..100 -> 0.5..1.5.
        if l.saturation != 0 {
            let s = 1.0 + l.saturation as f64 / 100.0 * 0.5;
            let y = luma(c, LUMA_2020);
            c = c.map(|v| (y + (v - y) * s).max(0.0));
        }
        c
    }

    /// The LUT as a `.cube` file.
    pub fn cube(&self) -> String {
        let n = LUT_SIZE;
        let mut out = String::with_capacity(n * n * n * 28 + 64);
        let _ = writeln!(out, "TITLE \"Aoze\"\nLUT_3D_SIZE {n}");
        // .cube order: red changes fastest.
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let v = [r, g, b].map(|i| i as f64 / (n - 1) as f64);
                    let o = self.map(v);
                    let _ = writeln!(out, "{:.6} {:.6} {:.6}", o[0], o[1], o[2]);
                }
            }
        }
        out
    }

    /// FFmpeg filters converting YUV in, through the LUT, to YUV out (tagged).
    /// `matrix` is the input's YUV matrix from ffprobe (empty when unknown).
    pub fn filters(&self, lut: &Path, matrix: &str) -> Vec<String> {
        let in_matrix = match (self.input.is_hdr(), matrix) {
            (true, _) => "bt2020",
            (false, "bt470bg" | "smpte170m") => "bt601",
            _ => "bt709",
        };
        let out_hdr = self.output.is_hdr();
        let (out_matrix, primaries, space, pix) =
            if out_hdr { ("bt2020", "bt2020", "bt2020nc", "yuv420p10le") } else { ("bt709", "bt709", "bt709", "yuv420p") };
        vec![
            format!("scale=in_color_matrix={in_matrix}:in_range=tv:out_range=pc"),
            "format=gbrp16le".into(),
            format!("lut3d=file='{}':interp=tetrahedral", escape_filter_path(lut)),
            format!("scale=out_color_matrix={out_matrix}:out_range=tv"),
            format!("format={pix}"),
            format!(
                "setparams=color_primaries={primaries}:color_trc={}:colorspace={space}:range=tv",
                self.output.ffmpeg_trc()
            ),
        ]
    }
}

/// SDR luminance (nits, white = 203) -> HDR luminance: unchanged up to the
/// knee, then highlights rise smoothly to the peak.
fn expand_highlights(nits: f64) -> f64 {
    let x = nits / SDR_WHITE_NITS;
    if x <= ITM_KNEE {
        return nits;
    }
    let t = ((x - ITM_KNEE) / (1.0 - ITM_KNEE)).min(1.5);
    // Continuous slope at the knee (t² term), reaches the peak at SDR white.
    nits + (ITM_PEAK_NITS - SDR_WHITE_NITS) * t * t
}

/// HDR luminance (nits) -> SDR luminance: linear in the shadows and mid tones,
/// highlights rolled off (Reinhard-style shoulder) so 1000 nits lands on white.
fn tone_map(nits: f64) -> f64 {
    let knee = 0.7 * SDR_WHITE_NITS;
    if nits <= knee {
        return nits;
    }
    let range = SDR_WHITE_NITS - knee;
    let over = nits - knee;
    let max_over = PQ_SOURCE_PEAK_NITS - knee;
    // Shoulder normalised so the source peak reaches SDR white exactly.
    let k = over / (1.0 + over / range) * (1.0 + max_over / range) / max_over;
    knee + range * k.min(1.0)
}

/// HDR -> SDR with libplacebo on the GPU (Vulkan): BT.2390 tone mapping with
/// per-scene peak detection, perceptual gamut mapping and contrast recovery.
/// Needs a Vulkan device in FFmpeg's global options (`-init_hw_device`).
pub fn placebo_to_sdr() -> Vec<String> {
    vec![
        "hwupload".into(),
        "libplacebo=tonemapping=bt.2390:peak_detect=1:gamut_mode=perceptual:contrast_recovery=0.3:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p".into(),
        "hwdownload".into(),
        "format=yuv420p".into(),
    ]
}

/// `C:\a b\c.cube` -> `C\:/a b/c.cube` for an FFmpeg filter argument.
pub fn escape_filter_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").replace(':', "\\:").replace('\'', "\\'")
}

/// Writes the plan's LUT next to `dir` and returns its filters, or None when
/// nothing needs to change.
pub fn prepare(plan: &ColorPlan, dir: &Path, name: &str, matrix: &str) -> std::io::Result<Option<Vec<String>>> {
    if plan.is_identity() {
        return Ok(None);
    }
    let lut = dir.join(format!("{name}.cube"));
    std::fs::write(&lut, plan.cube())?;
    Ok(Some(plan.filters(&lut, matrix)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(input: Transfer, output: Transfer) -> ColorPlan {
        ColorPlan { input, output, look: Look::default() }
    }

    #[test]
    fn pq_round_trip() {
        for nits in [0.5, 100.0, 203.0, 1000.0, 4000.0] {
            assert!((pq_decode(pq_encode(nits)) - nits).abs() / nits < 1e-6, "{nits}");
        }
        // Reference points: 100 nits ≈ 0.508, 1000 nits ≈ 0.752.
        assert!((pq_encode(100.0) - 0.508).abs() < 0.002);
        assert!((pq_encode(1000.0) - 0.752).abs() < 0.002);
    }

    #[test]
    fn hlg_round_trip() {
        for e in [0.01, 0.05, 0.5, 1.0] {
            assert!((hlg_inverse_oetf(hlg_oetf(e)) - e).abs() < 1e-9);
        }
    }

    #[test]
    fn sdr_identity_is_skipped_and_exact() {
        let p = plan(Transfer::Sdr, Transfer::Sdr);
        assert!(p.is_identity());
        for v in [0.0, 0.25, 0.5, 1.0] {
            let o = p.map([v, v, v]);
            assert!((o[0] - v).abs() < 1e-3, "{v} -> {o:?}");
        }
        let red = p.map([1.0, 0.0, 0.0]);
        assert!(red[0] > 0.99 && red[1] < 0.01 && red[2] < 0.01, "{red:?}");
    }

    #[test]
    fn sdr_to_hdr_keeps_mid_tones_and_expands_highlights() {
        let p = plan(Transfer::Sdr, Transfer::Pq);
        // 18 % grey stays where an SDR grade puts it (≈ 37 nits).
        let grey = pq_decode(p.map([0.5, 0.5, 0.5])[1]);
        assert!((grey - 0.5f64.powf(2.4) * SDR_WHITE_NITS).abs() < 1.0, "{grey}");
        // SDR white becomes a 1000 nit highlight.
        let white = pq_decode(p.map([1.0, 1.0, 1.0])[1]);
        assert!((white - ITM_PEAK_NITS).abs() < 5.0, "{white}");
    }

    #[test]
    fn hdr_to_sdr_rolls_off_highlights() {
        let p = plan(Transfer::Pq, Transfer::Sdr);
        let v = pq_encode(1000.0);
        let white = p.map([v, v, v]);
        assert!(white[0] > 0.98, "{white:?}");
        // Mid tones are kept: 50 nits stays 50 nits.
        let g = pq_encode(50.0);
        let o = p.map([g, g, g])[0].powf(2.4) * SDR_WHITE_NITS;
        assert!((o - 50.0).abs() < 1.0, "{o}");
        assert!(tone_map(400.0) < tone_map(800.0));
    }

    #[test]
    fn look_moves_in_the_right_direction() {
        let base = plan(Transfer::Sdr, Transfer::Sdr);
        let bright = ColorPlan { look: Look { exposure: 50, ..Look::default() }, ..base };
        assert!(bright.map([0.4, 0.4, 0.4])[0] > 0.45);
        let sat = ColorPlan { look: Look { saturation: 60, ..Look::default() }, ..base };
        let c = sat.map([0.6, 0.4, 0.3]);
        assert!(c[0] - c[2] > 0.3, "{c:?}");
        let flat = ColorPlan { look: Look { contrast: -80, ..Look::default() }, ..base };
        assert!(flat.map([0.9, 0.9, 0.9])[0] < 0.9 && flat.map([0.15, 0.15, 0.15])[0] > 0.15);
    }

    #[test]
    fn cube_has_every_entry() {
        let cube = plan(Transfer::Sdr, Transfer::Pq).cube();
        assert_eq!(cube.lines().count(), 2 + LUT_SIZE.pow(3));
    }

    #[test]
    fn filter_path_is_escaped() {
        assert_eq!(escape_filter_path(Path::new(r"C:\a b\l.cube")), r"C\:/a b/l.cube");
    }
}
