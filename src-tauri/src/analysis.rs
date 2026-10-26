//! One fast decode of a clip at low resolution, before processing, for what
//! needs to understand its content:
//! - scene cuts (FFmpeg's scene score, as before): no interpolation across a cut;
//! - held frames (anime drawn "on twos / threes"): Smooth Motion interpolates
//!   between the drawings instead of between identical frames;
//! - per-frame motion and detail maps on a coarse grid: Smart Reframe.

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::Path;

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::media::{Ffmpeg, MediaInfo};
use crate::pipeline::LogSink;

/// Analysis width (pixels): enough to see a mouth move on a 1080p frame.
const WIDTH: u32 = 320;
/// Pixels per side of a map cell.
pub const CELL: usize = 10;
/// Block size for the held-frame test.
const BLOCK: usize = 8;
/// A held frame: no 8×8 block changes by more than this mean level...
const HOLD_BLOCK_MAX: f32 = 7.0;
/// ...and almost no block changes at all (compression noise stays below).
const HOLD_BLOCK_LO: f32 = 2.5;
const HOLD_FRAC: f32 = 0.02;

#[derive(Debug, Clone, Default)]
pub struct Analysis {
    pub frames: usize,
    /// Analysis frame size.
    pub width: usize,
    pub height: usize,
    /// Map grid (cells).
    pub cols: usize,
    pub rows: usize,
    /// First frames of a new shot.
    pub cuts: HashSet<usize>,
    /// Frame i shows the same picture as frame i-1.
    pub held: Vec<bool>,
    /// Per frame, per cell: mean absolute change from the previous frame (0..255).
    pub motion: Vec<u8>,
    /// Per frame, per cell: mean gradient magnitude (detail, edges, text).
    pub detail: Vec<u8>,
    /// Per frame: share of pixels that did not change at all (screen recordings are mostly static).
    pub still: Vec<f32>,
    /// Brightest value of each row / column over the whole clip (black bars stay dark).
    pub row_max: Vec<u8>,
    pub col_max: Vec<u8>,
}

impl Analysis {
    pub fn cells(&self) -> usize {
        self.cols * self.rows
    }

    /// The picture without black bars (letterbox / pillarbox), as (x, y, w, h)
    /// in analysis pixels, or None when there are no bars worth removing.
    pub fn picture_box(&self) -> Option<(usize, usize, usize, usize)> {
        const DARK: u8 = 28;
        let span = |max: &[u8]| -> Option<(usize, usize)> {
            let first = max.iter().position(|&v| v > DARK)?;
            let last = max.iter().rposition(|&v| v > DARK)?;
            Some((first, last + 1))
        };
        let (y0, y1) = span(&self.row_max)?;
        let (x0, x1) = span(&self.col_max)?;
        let (w, h) = (self.width, self.height);
        // Bars of at least 2 % on a side, and a real picture left.
        let barred = |a: usize, b: usize, n: usize| (a > n / 50 || n - b > n / 50) && (b - a) * 2 > n;
        let rows = barred(y0, y1, h);
        let cols = barred(x0, x1, w);
        if !rows && !cols {
            return None;
        }
        let (y0, y1) = if rows { (y0, y1) } else { (0, h) };
        let (x0, x1) = if cols { (x0, x1) } else { (0, w) };
        Some((x0, y0, x1 - x0, y1 - y0))
    }
    pub fn motion_at(&self, frame: usize) -> &[u8] {
        let c = self.cells();
        &self.motion[frame * c..(frame + 1) * c]
    }
    pub fn detail_at(&self, frame: usize) -> &[u8] {
        let c = self.cells();
        &self.detail[frame * c..(frame + 1) * c]
    }
}

/// Analysis frame size for a source (even, at most `WIDTH` wide or tall).
pub fn analysis_size(w: u32, h: u32) -> (usize, usize) {
    let s = (WIDTH as f64 / w.max(h) as f64 * if w >= h { 1.0 } else { 16.0 / 9.0 }).min(1.0);
    let ew = ((w as f64 * s).round() as usize / 2 * 2).max(2 * CELL);
    let eh = ((h as f64 * s).round() as usize / 2 * 2).max(2 * CELL);
    (ew, eh)
}

/// Accumulates frames into an [`Analysis`].
pub struct Analyzer {
    a: Analysis,
    prev: Vec<u8>,
}

impl Analyzer {
    pub fn new(width: usize, height: usize) -> Self {
        let a = Analysis { width, height, cols: width / CELL, rows: height / CELL, row_max: vec![0; height], col_max: vec![0; width], ..Default::default() };
        Self { a, prev: Vec::new() }
    }

    pub fn push(&mut self, frame: &[u8]) {
        let (w, h, cols, rows) = (self.a.width, self.a.height, self.a.cols, self.a.rows);
        debug_assert_eq!(frame.len(), w * h);
        let first = self.prev.is_empty();
        // Held frame test on 8x8 blocks.
        let mut held = !first;
        let mut still = 0usize;
        if !first {
            let (bw, bh) = (w / BLOCK, h / BLOCK);
            let mut moving = 0usize;
            'blocks: for by in 0..bh {
                for bx in 0..bw {
                    let mut sum = 0u32;
                    for y in by * BLOCK..(by + 1) * BLOCK {
                        let row = y * w + bx * BLOCK;
                        sum += frame[row..row + BLOCK].iter().zip(&self.prev[row..row + BLOCK]).map(|(a, b)| a.abs_diff(*b) as u32).sum::<u32>();
                    }
                    let mean = sum as f32 / (BLOCK * BLOCK) as f32;
                    if mean > HOLD_BLOCK_MAX {
                        held = false;
                        break 'blocks;
                    }
                    if mean > HOLD_BLOCK_LO {
                        moving += 1;
                    }
                }
            }
            if held && moving as f32 > HOLD_FRAC * (bw * bh) as f32 {
                held = false;
            }
            still = frame.iter().zip(&self.prev).filter(|(a, b)| a.abs_diff(**b) <= 1).count();
        }
        // Maps.
        let mut motion = vec![0u8; cols * rows];
        let mut detail = vec![0u8; cols * rows];
        for cy in 0..rows {
            for cx in 0..cols {
                let (mut m, mut d) = (0u32, 0u32);
                for y in cy * CELL..(cy + 1) * CELL {
                    for x in cx * CELL..(cx + 1) * CELL {
                        let i = y * w + x;
                        if !first {
                            m += frame[i].abs_diff(self.prev[i]) as u32;
                        }
                        let gx = if x + 1 < w { frame[i + 1].abs_diff(frame[i]) } else { 0 };
                        let gy = if y + 1 < h { frame[i + w].abs_diff(frame[i]) } else { 0 };
                        d += gx.max(gy) as u32;
                    }
                }
                let n = (CELL * CELL) as u32;
                motion[cy * cols + cx] = (m / n).min(255) as u8;
                detail[cy * cols + cx] = (d / n).min(255) as u8;
            }
        }
        for (y, row) in frame.chunks_exact(w).enumerate() {
            for (x, &v) in row.iter().enumerate() {
                self.a.row_max[y] = self.a.row_max[y].max(v);
                self.a.col_max[x] = self.a.col_max[x].max(v);
            }
        }
        self.a.held.push(held);
        self.a.still.push(if first { 0.0 } else { still as f32 / (w * h) as f32 });
        self.a.motion.extend(motion);
        self.a.detail.extend(detail);
        self.a.frames += 1;
        self.prev.clear();
        self.prev.extend_from_slice(frame);
    }

    pub fn finish(mut self, cuts: HashSet<usize>) -> Analysis {
        // A cut is never a held frame, and the first frame of a shot has no motion.
        for &c in &cuts {
            if c < self.a.frames {
                self.a.held[c] = false;
                let n = self.a.cells();
                self.a.motion[c * n..(c + 1) * n].fill(0);
            }
        }
        self.a.cuts = cuts;
        self.a
    }
}

/// Decodes the clip once at low resolution. Frame `i` matches frame `i` of the
/// extraction (both normalise the rate with `fps=<source rate>`).
pub async fn analyze(
    ff: &Ffmpeg,
    source: &Path,
    info: &MediaInfo,
    work: &Path,
    cancel: &CancellationToken,
    on_frame: &(dyn Fn(usize) + Sync),
    on_log: LogSink<'_>,
) -> AppResult<Analysis> {
    let (w, h) = analysis_size(info.width, info.height);
    let cuts_file = work.join("analysis_cuts.txt");
    let graph = format!(
        "[0:v]fps={},split[a][b];[a]setpts=N/TB,scale=160:-2,select='gte(scene\\,0)',metadata=print:key=lavfi.scene_score:file='{}'[c];[b]scale={w}:{h}:flags=area,format=gray[g]",
        info.fps_rational,
        crate::color::escape_filter_path(&cuts_file)
    );
    let mut args: Vec<OsString> = vec!["-i".into(), source.into()];
    for a in ["-filter_complex", &graph, "-map", "[g]", "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1", "-map", "[c]", "-f", "null", "-"] {
        args.push(a.into());
    }
    let analyzer = std::sync::Mutex::new(Analyzer::new(w, h));
    let mut on_chunk = |frame: &[u8]| {
        let mut a = analyzer.lock().unwrap();
        a.push(frame);
        on_frame(a.a.frames);
    };
    ff.run_raw(&args, w * h, cancel, &mut on_chunk, on_log).await?;
    let analyzer = analyzer.into_inner().unwrap();
    if analyzer.a.frames == 0 {
        return Err(AppError::new(ErrorCode::DecodeFailed, format!("no frames decoded from {}", source.display())));
    }
    let cuts = std::fs::read_to_string(&cuts_file).map(|t| crate::anim::parse_cuts(&t)).unwrap_or_default();
    let a = analyzer.finish(cuts);
    let held = a.held.iter().filter(|h| **h).count();
    on_log(format!("analysis: {} frames, {} scene cut(s), {} held frame(s)", a.frames, a.cuts.len(), held));
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: usize, h: usize, f: impl Fn(usize, usize) -> u8) -> Vec<u8> {
        (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).map(|(x, y)| f(x, y)).collect()
    }

    #[test]
    fn held_frames_and_motion() {
        let (w, h) = (80, 40);
        let mut an = Analyzer::new(w, h);
        let square = |ox: usize| frame(w, h, move |x, y| if (ox..ox + 10).contains(&x) && (10..20).contains(&y) { 220 } else { 30 });
        an.push(&square(10));
        an.push(&square(10)); // held
        let mut noisy = square(10);
        noisy[5] = noisy[5].wrapping_add(3); // compression noise
        an.push(&noisy); // still held
        an.push(&square(30)); // moved
        let a = an.finish(HashSet::new());
        assert_eq!(a.held, vec![false, true, true, false]);
        // Motion where the square left and arrived, none elsewhere.
        let m = a.motion_at(3);
        assert!(m[a.cols + 1] > 0 && m[a.cols + 3] > 0);
        assert_eq!(m[a.cols * 3 + 7], 0);
        assert!(a.still[1] > 0.99 && a.still[3] < 0.99);
    }

    #[test]
    fn a_small_change_is_not_a_hold() {
        let (w, h) = (80, 40);
        let mut an = Analyzer::new(w, h);
        let base = frame(w, h, |_, _| 50);
        an.push(&base);
        // A mouth: 4x4 pixels change a lot.
        let mut mouth = base.clone();
        for y in 20..24 {
            for x in 40..44 {
                mouth[y * w + x] = 200;
            }
        }
        an.push(&mouth);
        let a = an.finish(HashSet::new());
        assert!(!a.held[1]);
    }

    #[test]
    fn cuts_are_never_holds() {
        let mut an = Analyzer::new(20, 20);
        let f = vec![10u8; 400];
        an.push(&f);
        an.push(&f);
        let a = an.finish([1].into_iter().collect());
        assert!(!a.held[1]);
    }

    #[test]
    fn letterbox_is_found() {
        let (w, h) = (80, 60);
        let mut an = Analyzer::new(w, h);
        // Bars of 10 rows top and bottom, picture in between.
        an.push(&frame(w, h, |x, y| if (10..50).contains(&y) { 60 + (x % 7) as u8 * 20 } else { 16 }));
        let a = an.finish(HashSet::new());
        assert_eq!(a.picture_box(), Some((0, 10, 80, 40)));
        let mut an = Analyzer::new(w, h);
        an.push(&frame(w, h, |_, _| 120));
        assert_eq!(an.finish(HashSet::new()).picture_box(), None);
    }

    #[test]
    fn sizes() {
        assert_eq!(analysis_size(1920, 1080), (320, 180));
        assert_eq!(analysis_size(640, 480), (320, 240));
        assert_eq!(analysis_size(1080, 1920), (320, 568));
        assert_eq!(analysis_size(200, 100), (200, 100));
    }
}
