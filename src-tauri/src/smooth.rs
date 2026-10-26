//! Smooth Motion: real in-between frames with RIFE (rife-ncnn-vulkan, v4.6 /
//! v4.25 models, optical flow on the GPU through Vulkan). Also renders the
//! sub-frames real motion blur is averaged from, and never interpolates across
//! a scene cut (docs/VIDEO_ENGINE.md).
//!
//! RIFE's folder mode writes N frames for F input frames, output `i` sitting
//! at input time `i * F / N` (frames past the last input repeat it). A clip is
//! processed in blocks so frames never pile up on disk or in memory; blocks
//! start on multiples of `q` and get `q` frames of look-ahead so every output
//! lands exactly on the target cadence across block boundaries.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::engine::waifu2x::classify;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::settings::{SmoothMotion, Threads};

pub const EXE_NAME: &str = "rife-ncnn-vulkan.exe";
/// Default model: as good as the newer ones on measured footage, 3-4x less VRAM.
pub const MODEL: &str = "rife-v4.6";
/// The model author's pick for anime, used by the Quality level when it fits.
pub const MODEL_ANIME: &str = "rife-v4.25";
/// Above this factor the motion between real frames is too large to invent well.
pub const MAX_FACTOR: f64 = 8.0;
/// Rendered frames per source frame, motion-blur sub-frames included.
const MAX_RENDER_FACTOR: f64 = 20.0;
const MAX_DENOMINATOR: u64 = 12;
const MAX_LOG_LINES: usize = 300;

pub struct Rife {
    dir: PathBuf,
}

/// The RIFE model and options for a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelChoice {
    pub model: &'static str,
    /// Spatial TTA (a mirrored second pass, averaged). Not used with v4.25.
    pub tta: bool,
    /// Optical flow at half resolution (`-u`): faster, less VRAM.
    pub uhd: bool,
}

impl ModelChoice {
    /// The next lighter setting after running out of GPU memory, if any.
    pub fn lighter(self) -> Option<Self> {
        if self.model != MODEL {
            Some(ModelChoice { model: MODEL, tta: false, uhd: false })
        } else if self.tta {
            Some(ModelChoice { tta: false, ..self })
        } else if !self.uhd {
            Some(ModelChoice { uhd: true, ..self })
        } else {
            None
        }
    }
}

/// Picks the model from the level, the content and the hardware. Never the
/// heavy model when it would not fit: v4.25 needs ~1.8 GB of VRAM at 1080p.
pub fn choose_model(level: SmoothMotion, anime: bool, vram_bytes: u64, out_pixels: u64) -> ModelChoice {
    const GB: u64 = 1024 * 1024 * 1024;
    let roomy = vram_bytes >= 4 * GB && out_pixels <= 1920 * 1088;
    match level {
        SmoothMotion::High if anime && roomy => ModelChoice { model: MODEL_ANIME, tta: false, uhd: false },
        SmoothMotion::High => ModelChoice { model: MODEL, tta: vram_bytes >= 3 * GB || vram_bytes == 0, uhd: false },
        // Fast: flow at half resolution; also what a 4K output gets on a small GPU.
        SmoothMotion::Low => ModelChoice { model: MODEL, tta: false, uhd: true },
        _ => ModelChoice { model: MODEL, tta: false, uhd: out_pixels > 2560 * 1440 && vram_bytes > 0 && vram_bytes < 3 * GB },
    }
}

/// Output rate as `p / q` times the source rate (reduced fraction).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ratio {
    pub p: u64,
    pub q: u64,
}

/// How to reach a target frame rate.
#[derive(Debug, Clone, PartialEq)]
pub struct RatePlan {
    /// Frames RIFE renders per source frame (sub-frames included).
    pub ratio: Ratio,
    /// Rate of the rendered frames ("num/den").
    pub rate: String,
    /// Final output rate ("num/den") and its value.
    pub out_rate: String,
    pub fps: f64,
    /// Rendered frames per output frame (1 = no motion blur sub-frames).
    pub sub: u32,
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

pub(crate) fn parse_rational(r: &str) -> Option<(u64, u64)> {
    let (n, d) = r.split_once('/').unwrap_or((r, "1"));
    let (n, d) = (n.trim().parse::<u64>().ok()?, d.trim().parse::<u64>().ok()?);
    (n > 0 && d > 0).then_some((n, d))
}

/// Plans `src_rate` ("num/den") -> `target` FPS (None = keep the rate), with
/// `sub` rendered frames per output frame for motion blur. NTSC sources (x/1001)
/// go to the matching NTSC rate (23.976 -> 59.94 for "60"), as editors expect.
/// Returns None when nothing needs rendering, or the target is out of reach.
pub fn plan_rate(src_rate: &str, target: Option<f32>, sub: u32) -> Option<RatePlan> {
    let (a, b) = parse_rational(src_rate)?;
    let src = a as f64 / b as f64;
    let sub = sub.max(1);
    // Output rate as a fraction of the source: (op / oq).
    let (op, oq) = match target {
        None => (1u64, 1u64),
        Some(t) => {
            let t = t as f64;
            if t < src - 0.01 || t / src > MAX_FACTOR + 1e-9 {
                return None;
            }
            if b == 1001 {
                (t.round() as u64 * 1000, a)
            } else {
                ((t * b as f64).round() as u64, a)
            }
        }
    };
    let g = gcd(op, oq);
    let (mut op, mut oq) = (op / g, oq / g);
    if oq > MAX_DENOMINATOR {
        // Closest fraction with a small denominator (output rate within ~1 %).
        let r = op as f64 / oq as f64;
        (op, oq) = (1..=MAX_DENOMINATOR)
            .map(|d| ((r * d as f64).round() as u64, d))
            .min_by(|x, y| (x.0 as f64 / x.1 as f64 - r).abs().total_cmp(&(y.0 as f64 / y.1 as f64 - r).abs()))
            .expect("non-empty range");
        let g = gcd(op, oq);
        (op, oq) = (op / g, oq / g);
    }
    if op == oq && sub == 1 {
        return None;
    }
    // Fewer sub-frames when the render rate would explode (e.g. 15 -> 120 FPS).
    let mut sub = sub as u64;
    while sub > 1 && (op * sub) as f64 / oq as f64 > MAX_RENDER_FACTOR {
        sub -= 1;
    }
    if op == oq && sub == 1 {
        return None;
    }
    let (p, q) = (op * sub, oq);
    let g = gcd(p, q);
    let ratio = Ratio { p: p / g, q: q / g };
    let rational = |n: u64, d: u64| {
        let g = gcd(n, d);
        format!("{}/{}", n / g, d / g)
    };
    Some(RatePlan {
        ratio,
        rate: rational(a * p, b * q),
        out_rate: rational(a * op, b * oq),
        fps: (a * op) as f64 / (b * oq) as f64,
        sub: sub as u32,
    })
}

/// One block of source frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    /// Index of the first source frame.
    pub start: usize,
    /// Source frames this block owns (its outputs cover their time span).
    pub own: usize,
    /// Real frames fed to RIFE (own + look-ahead), before padding.
    pub inputs: usize,
    /// Frames fed to RIFE after padding with the last frame (multiple of q).
    pub padded: usize,
    /// Frames RIFE writes.
    pub write: usize,
    /// Frames kept (the rest belongs to the next block).
    pub keep: usize,
}

/// Splits `total` source frames into blocks of about `block` frames. With
/// motion blur, each block's first rendered frame must also start a group of
/// `sub` sub-frames, hence the extra alignment.
pub fn plan_blocks(total: usize, ratio: Ratio, block: usize, sub: u32) -> Vec<Block> {
    let (p, q) = (ratio.p as usize, ratio.q as usize);
    let sub = sub.max(1) as usize;
    let unit = q * (sub / gcd(p as u64, sub as u64) as usize);
    let size = (block / unit).max(1) * unit;
    let mut out = Vec::new();
    let mut start = 0;
    while start < total {
        let own = size.min(total - start);
        let last = start + own >= total;
        let inputs = (own + q).min(total - start);
        // Room for the frame after the last owned one (a repeat at the very end).
        let padded = (inputs.max(own + 1)).div_ceil(q) * q;
        let write = padded * p / q;
        let keep = if last { (own * p).div_ceil(q).div_ceil(sub) * sub } else { own * p / q };
        out.push(Block { start, own, inputs, padded, write, keep });
        start += own;
    }
    out
}

/// For rendered frame `i` of a block starting at source frame `start`: the
/// source frame to repeat when the pair it sits between spans a scene cut
/// (`cut` = index of the first frame of a new shot), None to keep RIFE's frame.
pub fn hold_at_cut(i: usize, ratio: Ratio, start: usize, is_cut: &dyn Fn(usize) -> bool) -> Option<usize> {
    let t = i as f64 * ratio.q as f64 / ratio.p as f64;
    let x0 = t.floor() as usize;
    let frac = t - x0 as f64;
    if frac < 1e-9 || !is_cut(start + x0 + 1) {
        return None;
    }
    Some(start + x0 + usize::from(frac >= 0.5))
}

impl Rife {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn found(&self) -> bool {
        self.dir.join(EXE_NAME).is_file() && self.dir.join(MODEL).join("flownet.bin").is_file()
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn args(&self, input: &Path, output: &Path, frames: usize, choice: ModelChoice, gpu: Option<i32>, threads: Threads) -> Vec<String> {
        let mut a = vec![
            "-i".into(),
            input.to_string_lossy().into_owned(),
            "-o".into(),
            output.to_string_lossy().into_owned(),
            "-n".into(),
            frames.to_string(),
            "-m".into(),
            self.dir.join(choice.model).to_string_lossy().into_owned(),
            "-j".into(),
            format!("{}:{}:{}", threads.load, threads.proc.min(2), threads.save),
            "-f".into(),
            "%08d.png".into(),
        ];
        if let Some(g) = gpu {
            a.push("-g".into());
            a.push(g.to_string());
        }
        if choice.tta {
            a.push("-x".into());
        }
        if choice.uhd {
            a.push("-u".into());
        }
        a
    }

    /// Writes `frames` frames into `output` from the sorted images in `input`.
    #[allow(clippy::too_many_arguments)]
    pub async fn interpolate(
        &self,
        input: &Path,
        output: &Path,
        frames: usize,
        choice: ModelChoice,
        gpu: Option<i32>,
        threads: Threads,
        on_log: &(dyn Fn(String) + Sync),
        cancel: &CancellationToken,
    ) -> AppResult<()> {
        let exe = self.dir.join(EXE_NAME);
        if !self.found() {
            return Err(AppError::new(ErrorCode::EngineMissing, format!("{} or its {MODEL} model not found", exe.display())));
        }
        std::fs::create_dir_all(output)?;
        let args = self.args(input, output, frames, choice, gpu, threads);
        on_log(format!("$ {EXE_NAME} {}", args.join(" ")));
        let mut cmd = Command::new(&exe);
        cmd.args(&args)
            .current_dir(&self.dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(crate::tuning::process_flags());
        let mut child = cmd.spawn().map_err(|e| AppError::new(ErrorCode::EngineFailed, format!("could not start {EXE_NAME}: {e}")))?;
        let stderr = child.stderr.take().expect("stderr is piped");
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let reader = {
            let lines = lines.clone();
            async move {
                let mut reader = BufReader::new(stderr).split(b'\n');
                while let Ok(Some(raw)) = reader.next_segment().await {
                    let line = String::from_utf8_lossy(&raw).trim_end().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    on_log(line.clone());
                    let mut l = lines.lock().unwrap();
                    if l.len() < MAX_LOG_LINES {
                        l.push(line);
                    }
                }
            }
        };
        let status = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                let _ = child.kill().await;
                return Err(AppError::cancelled());
            }
            (status, _) = async { tokio::join!(child.wait(), reader) } => status?,
        };
        let written = std::fs::read_dir(output).map(|d| d.count()).unwrap_or(0);
        let lines = lines.lock().unwrap().clone();
        classify(&lines, status.code(), written >= frames)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rates() {
        let r = plan_rate("24/1", Some(60.0), 1).unwrap();
        assert_eq!((r.ratio, r.rate.as_str(), r.out_rate.as_str()), (Ratio { p: 5, q: 2 }, "60/1", "60/1"));
        // NTSC stays NTSC: 23.976 -> 59.94.
        let r = plan_rate("24000/1001", Some(60.0), 1).unwrap();
        assert_eq!((r.ratio, r.rate.as_str()), (Ratio { p: 5, q: 2 }, "60000/1001"));
        assert_eq!(plan_rate("30000/1001", Some(120.0), 1).unwrap().ratio, Ratio { p: 4, q: 1 });
        assert_eq!(plan_rate("25/1", Some(60.0), 1).unwrap().ratio, Ratio { p: 12, q: 5 });
        let r = plan_rate("1000/37", Some(60.0), 1).unwrap();
        assert!(r.ratio.q <= MAX_DENOMINATOR && (r.fps - 60.0).abs() < 0.6, "{r:?}");
        assert!(plan_rate("60/1", Some(60.0), 1).is_none(), "nothing to render");
        assert!(plan_rate("10/1", Some(120.0), 1).is_none(), "more than 8x");
        // Motion blur sub-frames: 24 -> 60 with 4 per output frame renders 240.
        let r = plan_rate("24/1", Some(60.0), 4).unwrap();
        assert_eq!((r.ratio, r.rate.as_str(), r.out_rate.as_str(), r.sub), (Ratio { p: 10, q: 1 }, "240/1", "60/1", 4));
        // Blur alone keeps the rate.
        let r = plan_rate("30/1", None, 3).unwrap();
        assert_eq!((r.ratio, r.out_rate.as_str()), (Ratio { p: 3, q: 1 }, "30/1"));
        // Too many renders: fewer sub-frames.
        assert!(plan_rate("15/1", Some(120.0), 6).unwrap().sub <= 2);
    }

    #[test]
    fn model_choice_respects_vram() {
        const GB: u64 = 1024 * 1024 * 1024;
        assert_eq!(choose_model(SmoothMotion::Medium, true, 8 * GB, 1920 * 1080).model, MODEL);
        assert_eq!(choose_model(SmoothMotion::High, true, 4 * GB, 1920 * 1080).model, MODEL_ANIME);
        assert_eq!(choose_model(SmoothMotion::High, true, 2 * GB, 1920 * 1080).model, MODEL, "too little VRAM");
        assert_eq!(choose_model(SmoothMotion::High, true, 8 * GB, 3840 * 2160).model, MODEL, "4K output");
        assert!(choose_model(SmoothMotion::High, false, 4 * GB, 1920 * 1080).tta);
    }

    #[test]
    fn cuts_are_held_not_morphed() {
        let ratio = Ratio { p: 5, q: 2 };
        // Cut between source frames 3 and 4 (4 starts the new shot).
        let cut = |i: usize| i == 4;
        // Rendered frame 8 sits at t = 3.2: between 3 and 4 -> repeat 3.
        assert_eq!(hold_at_cut(8, ratio, 0, &cut), Some(3));
        // t = 3.6 -> nearer to 4.
        assert_eq!(hold_at_cut(9, ratio, 0, &cut), Some(4));
        // Exactly on frame 4, or elsewhere: RIFE's frame is kept.
        assert_eq!(hold_at_cut(10, ratio, 0, &cut), None);
        assert_eq!(hold_at_cut(3, ratio, 0, &cut), None);
    }

    #[test]
    fn blocks_cover_every_frame_on_the_cadence() {
        for (total, ratio, block, sub) in [(100, Ratio { p: 5, q: 2 }, 24, 1), (7, Ratio { p: 2, q: 1 }, 3, 1), (61, Ratio { p: 12, q: 5 }, 20, 1), (5, Ratio { p: 5, q: 2 }, 100, 1), (100, Ratio { p: 10, q: 1 }, 24, 4)] {
            let blocks = plan_blocks(total, ratio, block, sub);
            assert_eq!(blocks.iter().map(|b| b.own).sum::<usize>(), total);
            let kept: usize = blocks.iter().map(|b| b.keep).sum();
            let rendered = (total * ratio.p as usize).div_ceil(ratio.q as usize);
            assert_eq!(kept, rendered.div_ceil(sub as usize) * sub as usize, "{total} {ratio:?}");
            for b in &blocks {
                // Every block's first rendered frame starts a sub-frame group.
                assert_eq!(b.start * ratio.p as usize / ratio.q as usize % sub as usize, 0, "{b:?}");
                assert_eq!(b.keep % sub as usize, 0);
            }
            for b in &blocks {
                assert_eq!(b.start % ratio.q as usize, 0, "blocks start on the cadence");
                assert_eq!(b.padded % ratio.q as usize, 0);
                assert!(b.padded > b.own && b.keep <= b.write);
                // Every kept output lies before the last input frame: it is interpolated, not repeated.
                let last_time = (b.keep - 1) as f64 * ratio.q as f64 / ratio.p as f64;
                assert!(last_time < b.padded as f64 - 1.0 + 1e-9);
            }
        }
    }
}
