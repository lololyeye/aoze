//! Where every output frame comes from, for clips whose timing changes:
//! Smooth Motion (new frame rate), Speed (slow / fast / ramps) and motion blur
//! (sub-frames averaged inside a virtual shutter).
//!
//! An output sample at output time `τ` maps to a source position `x` (in source
//! frames, fractional): through the speed curve, then onto the clip's distinct
//! pictures ("keys"). Anime drawn on twos or threes repeats each drawing over
//! 2-3 frames; interpolating between identical frames would leave the motion
//! jerky, so positions are spread between the drawings instead. Positions
//! across a scene cut repeat the nearest real frame (never a morph).
//!
//! RIFE renders a uniform grid between the keys of a block (folder mode: `N`
//! outputs for `F` inputs, output `i` at input time `i·F/N`). The grid is
//! exact when the positions are uniform (a plain frame rate change), and dense
//! enough otherwise (ramps, held drawings, blur sub-frames) that the nearest
//! grid frame is within a quarter of the spacing between samples.

use crate::settings::{SpeedPreset, SpeedSettings, SPEED_MAX, SPEED_MIN, SPEED_POINTS};

/// Longest run of identical frames still treated as animation timing (on fours).
const MAX_RUN: usize = 4;
/// Rendered frames per input frame, at most (bounds disk and time).
pub const MAX_RENDER: usize = 20;
/// Smallest speed step sent to the audio time-stretcher.
const AUDIO_STEP_S: f64 = 0.04;

// ---------- speed ----------

/// Speed over the clip: points (position 0..1 of the source, speed), eased in between.
#[derive(Debug, Clone, PartialEq)]
pub struct SpeedCurve {
    points: Vec<(f64, f64)>,
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl SpeedCurve {
    pub fn from_settings(s: &SpeedSettings) -> Option<Self> {
        let points: Vec<(f64, f64)> = match s.preset {
            SpeedPreset::Normal => return None,
            SpeedPreset::Slow => vec![(0.0, 0.5), (1.0, 0.5)],
            SpeedPreset::Fast => vec![(0.0, 2.0), (1.0, 2.0)],
            // Normal -> slow on the middle -> fast -> normal: the usual edit ramp.
            SpeedPreset::Ramp => vec![(0.0, 1.0), (0.3, 1.0), (0.42, 0.4), (0.58, 0.4), (0.68, 2.0), (0.86, 2.0), (1.0, 1.0)],
            SpeedPreset::Custom => {
                let pts: Vec<(f64, f64)> =
                    (0..SPEED_POINTS).map(|i| (i as f64 / (SPEED_POINTS - 1) as f64, s.curve[i].clamp(SPEED_MIN, SPEED_MAX) as f64)).collect();
                if pts.iter().all(|p| (p.1 - 1.0).abs() < 1e-3) {
                    return None;
                }
                pts
            }
        };
        Some(Self { points })
    }

    pub fn constant(&self) -> Option<f64> {
        let first = self.points[0].1;
        self.points.iter().all(|p| (p.1 - first).abs() < 1e-9).then_some(first)
    }

    pub fn min(&self) -> f64 {
        self.points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min)
    }

    /// Speed at position `p` (0..1). Between two points the speed eases in log
    /// space, so 0.5x -> 2x takes as long to slow down as to speed up.
    pub fn at(&self, p: f64) -> f64 {
        let p = p.clamp(0.0, 1.0);
        let i = self.points.iter().rposition(|q| q.0 <= p).unwrap_or(0);
        if i + 1 >= self.points.len() {
            return self.points[i].1;
        }
        let (a, b) = (self.points[i], self.points[i + 1]);
        let t = smoothstep((p - a.0) / (b.0 - a.0).max(1e-9));
        (a.1.ln() + (b.1.ln() - a.1.ln()) * t).exp()
    }
}

/// Source time <-> output time for a speed curve (seconds).
#[derive(Debug, Clone)]
pub struct TimeWarp {
    src_duration: f64,
    step: f64,
    /// Output time at source time `i * step`.
    table: Vec<f64>,
    curve: SpeedCurve,
}

impl TimeWarp {
    pub fn new(curve: SpeedCurve, src_duration: f64) -> Self {
        let src_duration = src_duration.max(1e-3);
        let steps = ((src_duration / 0.002).ceil() as usize).clamp(64, 400_000);
        let step = src_duration / steps as f64;
        let mut table = Vec::with_capacity(steps + 1);
        let mut acc = 0.0;
        table.push(0.0);
        for i in 0..steps {
            // Midpoint rule: dτ = dt / speed.
            let mid = (i as f64 + 0.5) * step / src_duration;
            acc += step / curve.at(mid);
            table.push(acc);
        }
        Self { src_duration, step, table, curve }
    }

    pub fn curve(&self) -> &SpeedCurve {
        &self.curve
    }

    pub fn out_duration(&self) -> f64 {
        *self.table.last().expect("non-empty")
    }

    pub fn speed_at_source(&self, t: f64) -> f64 {
        self.curve.at(t / self.src_duration)
    }

    pub fn to_output(&self, t: f64) -> f64 {
        let x = (t / self.step).clamp(0.0, (self.table.len() - 1) as f64);
        let i = (x.floor() as usize).min(self.table.len() - 2);
        let f = x - i as f64;
        self.table[i] + (self.table[i + 1] - self.table[i]) * f
    }

    pub fn to_source(&self, tau: f64) -> f64 {
        let tau = tau.clamp(0.0, self.out_duration());
        let i = self.table.partition_point(|&v| v <= tau).clamp(1, self.table.len() - 1) - 1;
        let (a, b) = (self.table[i], self.table[i + 1]);
        let f = if b > a { (tau - a) / (b - a) } else { 0.0 };
        (i as f64 + f) * self.step
    }

    /// `asendcmd` lines driving `rubberband@rb` so the audio follows the speed
    /// (pitch kept). Times are source times, as the audio filter sees them.
    pub fn audio_commands(&self) -> String {
        let mut out = String::new();
        let mut last = f64::NAN;
        let mut t = 0.0;
        while t < self.src_duration {
            let s = self.speed_at_source(t + AUDIO_STEP_S / 2.0);
            if (s - last).abs() > 0.003 || last.is_nan() {
                out.push_str(&format!("{t:.3} rubberband@rb tempo {s:.4};\n"));
                last = s;
            }
            t += AUDIO_STEP_S;
        }
        out
    }
}

// ---------- keys: distinct pictures ----------

/// The distinct pictures of a clip and how source positions map onto them.
#[derive(Debug, Clone)]
pub struct Keys {
    /// Source frame index of each key.
    pub idx: Vec<usize>,
    /// Key index starting each scene (a key that is a cut).
    cut_keys: std::collections::HashSet<usize>,
    /// Typical frames per drawing (1 for live action, 2 on twos...).
    cadence: usize,
}

/// What an output sample shows.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pick {
    /// A real picture (key index).
    Key(usize),
    /// In between keys `floor(u)` and `floor(u) + 1`.
    Mid(f64),
}

impl Keys {
    /// `held[i]`: frame i repeats frame i-1. `cuts`: first frames of new shots.
    pub fn new(frames: usize, held: Option<&[bool]>, cuts: &std::collections::HashSet<usize>) -> Self {
        let idx: Vec<usize> = (0..frames.max(1)).filter(|&i| i == 0 || cuts.contains(&i) || !held.is_some_and(|h| h.get(i).copied().unwrap_or(false))).collect();
        let cut_keys = idx.iter().enumerate().filter(|(_, f)| cuts.contains(f)).map(|(k, _)| k).collect();
        // Typical run length among the short ones (long runs are real pauses).
        let mut runs: Vec<usize> = idx.windows(2).map(|w| w[1] - w[0]).filter(|&r| r <= MAX_RUN).collect();
        runs.sort_unstable();
        let cadence = runs.get(runs.len() / 2).copied().unwrap_or(1).max(1);
        Self { idx, cut_keys, cadence }
    }

    pub fn len(&self) -> usize {
        self.idx.len()
    }

    pub fn is_empty(&self) -> bool {
        self.idx.is_empty()
    }

    pub fn deduplicated(&self, frames: usize) -> bool {
        self.idx.len() < frames
    }

    /// Source position (frames) -> what to show.
    pub fn pick(&self, x: f64) -> Pick {
        let last = self.idx.len() - 1;
        let m = self.idx.partition_point(|&f| f as f64 <= x + 1e-9).saturating_sub(1);
        if m >= last {
            return Pick::Key(last);
        }
        let (a, b) = (self.idx[m] as f64, self.idx[m + 1] as f64);
        if self.cut_keys.contains(&(m + 1)) {
            // Across a cut: the source frame that is really there.
            return Pick::Key(if x.round() >= b { m + 1 } else { m });
        }
        let run = b - a;
        let frac = if run <= MAX_RUN as f64 {
            (x - a) / run
        } else {
            // A real pause: hold, then move over the usual drawing time.
            let c = self.cadence as f64;
            ((x - (b - c)) / c).max(0.0)
        };
        if frac < 1e-6 {
            Pick::Key(m)
        } else if frac > 1.0 - 1e-6 {
            Pick::Key(m + 1)
        } else {
            Pick::Mid(m as f64 + frac)
        }
    }
}

// ---------- output samples ----------

/// Output timing: rate, sub-frames for motion blur.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Output {
    pub fps: f64,
    /// Sub-frame spacing: `1 / shutter_div` of a frame.
    pub shutter_div: u32,
    /// Sub-frames averaged per output frame (1 = no blur).
    pub subs: u32,
}

/// Output frames for a clip of `frames` source frames at `src_fps`.
pub fn output_frames(frames: usize, src_fps: f64, out_fps: f64, warp: Option<&TimeWarp>) -> usize {
    let src_dur = frames as f64 / src_fps;
    let dur = warp.map_or(src_dur, |w| w.out_duration());
    ((dur * out_fps) + 1e-6).floor().max(1.0) as usize
}

/// Every output sample (frame-major, `subs` per frame) as a pick.
pub fn plan_samples(frames: usize, src_fps: f64, out: Output, warp: Option<&TimeWarp>, keys: &Keys) -> Vec<Pick> {
    let n_out = output_frames(frames, src_fps, out.fps, warp);
    let subs = out.subs.max(1);
    let div = out.shutter_div.max(1) as f64;
    let mut picks = Vec::with_capacity(n_out * subs as usize);
    for j in 0..n_out {
        for r in 0..subs {
            let tau = (j as f64 + r as f64 / div) / out.fps;
            let t = warp.map_or(tau, |w| w.to_source(tau));
            let x = (t * src_fps).clamp(0.0, (frames - 1) as f64);
            // Snap float noise so exact positions stay exact.
            let x = if (x - x.round()).abs() < 1e-6 { x.round() } else { x };
            picks.push(keys.pick(x));
        }
    }
    picks
}

// ---------- blocks ----------

/// Where a block's sample comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Input frame of the block (0-based).
    Input(usize),
    /// RIFE output frame (0-based).
    Rendered(usize),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    /// Keys fed to the block (inclusive range).
    pub first_key: usize,
    pub last_key: usize,
    /// Range of samples (whole output frames) this block writes.
    pub samples: std::ops::Range<usize>,
    /// Frames RIFE renders from the inputs (0 = no RIFE).
    pub render: usize,
    pub sources: Vec<Source>,
}

impl Block {
    pub fn inputs(&self) -> usize {
        self.last_key - self.first_key + 1
    }
}

/// RIFE grid for positions `v` (relative to the first input) over `inputs` frames:
/// exact when one exists within budget, else dense enough. Returns N.
fn grid(inputs: usize, v: &[f64]) -> usize {
    let cap = inputs * MAX_RENDER;
    let on_grid = |n: usize| {
        let g = inputs as f64 / n as f64;
        v.iter().all(|&p| {
            let k = p / g;
            (k - k.round()).abs() < 1e-6
        })
    };
    let mut sorted: Vec<f64> = v.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    let min_gap = sorted.windows(2).map(|w| w[1] - w[0]).fold(f64::INFINITY, f64::min);
    // Mid positions are never on an input, so a gap to the nearest whole frame counts too.
    let edge_gap = sorted.iter().map(|p| (p - p.floor()).min(p.ceil() - p)).fold(f64::INFINITY, f64::min);
    let spacing = min_gap.min(edge_gap * 2.0).min(1.0);
    let dense = ((inputs as f64 / (spacing / 2.0)).ceil() as usize).clamp(inputs, cap);
    (inputs..=dense).find(|&n| on_grid(n)).unwrap_or(dense)
}

/// Splits the samples into blocks of at most `max_keys` input keys whose
/// renders stay under `max_render` frames. `subs` samples make one output frame.
pub fn plan_blocks(picks: &[Pick], subs: usize, max_keys: usize, max_render: usize, rife: bool) -> Vec<Block> {
    let subs = subs.max(1);
    let max_keys = max_keys.max(2);
    let frames = picks.len() / subs;
    let span = |p: &Pick| match *p {
        Pick::Key(k) => (k, k),
        Pick::Mid(u) => (u.floor() as usize, u.floor() as usize + 1),
    };
    let mut blocks = Vec::new();
    let mut j = 0;
    while j < frames {
        // Grow the block frame by frame.
        let (mut lo, mut hi) = (usize::MAX, 0);
        let mut end = j;
        while end < frames {
            let (mut flo, mut fhi) = (lo, hi);
            for p in &picks[end * subs..(end + 1) * subs] {
                let (a, b) = span(p);
                flo = flo.min(a);
                fhi = fhi.max(b);
            }
            if end > j && fhi - flo + 1 > max_keys {
                break;
            }
            (lo, hi) = (flo, fhi);
            end += 1;
        }
        let mut block = make_block(picks, j * subs..end * subs, lo, hi, rife);
        // Too many rendered frames: halve until it fits (one frame always fits).
        let mut stop = end;
        while block.render > max_render && stop - j > 1 {
            stop = j + (stop - j) / 2;
            let (mut lo2, mut hi2) = (usize::MAX, 0);
            for p in &picks[j * subs..stop * subs] {
                let (a, b) = span(p);
                lo2 = lo2.min(a);
                hi2 = hi2.max(b);
            }
            block = make_block(picks, j * subs..stop * subs, lo2, hi2, rife);
        }
        j = stop;
        blocks.push(block);
    }
    blocks
}

/// One block over `range` of the samples and keys `lo..=hi` (with or without RIFE).
pub fn make_block(picks: &[Pick], range: std::ops::Range<usize>, lo: usize, hi: usize, rife: bool) -> Block {
    let inputs = hi - lo + 1;
    let mids: Vec<f64> = picks[range.clone()].iter().filter_map(|p| if let Pick::Mid(u) = p { Some(u - lo as f64) } else { None }).collect();
    let render = if rife && !mids.is_empty() { grid(inputs, &mids) } else { 0 };
    let g = if render > 0 { inputs as f64 / render as f64 } else { 1.0 };
    let sources = picks[range.clone()]
        .iter()
        .map(|p| match *p {
            Pick::Key(k) => Source::Input(k - lo),
            Pick::Mid(u) if render == 0 => Source::Input(((u - lo as f64).round() as usize).min(inputs - 1)),
            Pick::Mid(u) => {
                let i = (((u - lo as f64) / g).round() as usize).min(render - 1);
                let at = i as f64 * g;
                if (at - at.round()).abs() < 1e-9 {
                    Source::Input(at.round() as usize)
                } else {
                    Source::Rendered(i)
                }
            }
        })
        .collect();
    Block { first_key: lo, last_key: hi, samples: range, render, sources }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn all_keys(n: usize) -> Keys {
        Keys::new(n, None, &HashSet::new())
    }

    #[test]
    fn plain_rate_change_is_exact_and_cheap() {
        // 24 -> 60 FPS: outputs every 0.4 source frame, RIFE renders 2.5x exactly.
        let keys = all_keys(48);
        let picks = plan_samples(48, 24.0, Output { fps: 60.0, shutter_div: 1, subs: 1 }, None, &keys);
        assert_eq!(picks.len(), 120);
        assert_eq!(picks[5], Pick::Key(2));
        let blocks = plan_blocks(&picks, 1, 1000, 100_000, true);
        assert_eq!(blocks.len(), 1);
        let b = &blocks[0];
        assert_eq!(b.inputs(), 48);
        assert_eq!(b.render, 120);
        assert_eq!(b.sources[1], Source::Rendered(1));
        assert_eq!(b.sources[5], Source::Input(2));
    }

    #[test]
    fn held_drawings_are_spread() {
        // On twos: A A B B C C ... -> output frames move every frame.
        let n = 12;
        let held: Vec<bool> = (0..n).map(|i| i % 2 == 1).collect();
        let keys = Keys::new(n, Some(&held), &HashSet::new());
        assert_eq!(keys.len(), 6);
        assert!(keys.deduplicated(n));
        // Frame 1 (a repeat of A) becomes halfway between A and B.
        assert_eq!(keys.pick(1.0), Pick::Mid(0.5));
        assert_eq!(keys.pick(2.0), Pick::Key(1));
        // Same frame rate: every repeated frame is replaced by an in-between.
        let picks = plan_samples(n, 24.0, Output { fps: 24.0, shutter_div: 1, subs: 1 }, None, &keys);
        let mids = picks.iter().filter(|p| matches!(p, Pick::Mid(_))).count();
        assert_eq!(mids, 5); // the last repeat has no next drawing
    }

    #[test]
    fn long_pauses_hold_then_move() {
        // 10 frames of the same picture, then a new one: no slow morph over the pause.
        let mut held = vec![false; 14];
        for h in held.iter_mut().take(10).skip(1) {
            *h = true;
        }
        held[11] = true;
        held[13] = true;
        let keys = Keys::new(14, Some(&held), &HashSet::new());
        assert_eq!(keys.idx, vec![0, 10, 12]);
        assert_eq!(keys.pick(4.0), Pick::Key(0));
        assert!(matches!(keys.pick(9.0), Pick::Mid(u) if (u - 0.5).abs() < 1e-9));
    }

    #[test]
    fn cuts_are_held_not_morphed() {
        let cuts: HashSet<usize> = [4].into_iter().collect();
        let keys = Keys::new(8, None, &cuts);
        assert_eq!(keys.pick(3.4), Pick::Key(3));
        assert_eq!(keys.pick(3.6), Pick::Key(4));
        assert_eq!(keys.pick(2.5), Pick::Mid(2.5));
    }

    #[test]
    fn speed_curves() {
        let ramp = SpeedCurve::from_settings(&SpeedSettings { preset: SpeedPreset::Ramp, ..Default::default() }).unwrap();
        assert!((ramp.at(0.1) - 1.0).abs() < 1e-9);
        assert!((ramp.at(0.5) - 0.4).abs() < 1e-9);
        assert!((ramp.at(0.75) - 2.0).abs() < 1e-9);
        // Eased: halfway through a transition, between both speeds.
        let mid = ramp.at(0.36);
        assert!(mid < 1.0 && mid > 0.4);
        assert!(SpeedCurve::from_settings(&SpeedSettings::default()).is_none());
        let flat = SpeedSettings { preset: SpeedPreset::Custom, curve: [1.0; 5] };
        assert!(SpeedCurve::from_settings(&flat).is_none());
        let slow = SpeedCurve::from_settings(&SpeedSettings { preset: SpeedPreset::Slow, ..Default::default() }).unwrap();
        assert_eq!(slow.constant(), Some(0.5));
    }

    #[test]
    fn warp_round_trips_and_has_the_right_length() {
        let slow = SpeedCurve::from_settings(&SpeedSettings { preset: SpeedPreset::Slow, ..Default::default() }).unwrap();
        let w = TimeWarp::new(slow, 4.0);
        assert!((w.out_duration() - 8.0).abs() < 1e-6);
        let ramp = SpeedCurve::from_settings(&SpeedSettings { preset: SpeedPreset::Ramp, ..Default::default() }).unwrap();
        let w = TimeWarp::new(ramp, 10.0);
        for t in [0.0, 1.3, 4.9, 7.7, 10.0] {
            assert!((w.to_source(w.to_output(t)) - t).abs() < 1e-3, "{t}");
        }
        assert!(w.audio_commands().starts_with("0.000 rubberband@rb tempo 1.0000;"));
    }

    #[test]
    fn ramp_blocks_render_dense_enough() {
        let keys = all_keys(240);
        let ramp = SpeedCurve::from_settings(&SpeedSettings { preset: SpeedPreset::Ramp, ..Default::default() }).unwrap();
        let w = TimeWarp::new(ramp, 10.0);
        let picks = plan_samples(240, 24.0, Output { fps: 60.0, shutter_div: 1, subs: 1 }, Some(&w), &keys);
        let blocks = plan_blocks(&picks, 1, 48, 100_000, true);
        let mut covered = 0;
        for b in &blocks {
            assert!(b.inputs() <= 48);
            covered += b.samples.len();
            let g = if b.render > 0 { b.inputs() as f64 / b.render as f64 } else { 1.0 };
            for (s, p) in b.samples.clone().zip(&b.sources) {
                let want = match picks[s] {
                    Pick::Key(k) => k as f64,
                    Pick::Mid(u) => u,
                } - b.first_key as f64;
                let got = match *p {
                    Source::Input(i) => i as f64,
                    Source::Rendered(i) => i as f64 * g,
                };
                assert!((want - got).abs() <= g / 2.0 + 1e-9, "sample {s}: want {want}, got {got}");
            }
        }
        assert_eq!(covered, picks.len());
    }

    #[test]
    fn blur_subframes_stay_with_their_frame() {
        let keys = all_keys(48);
        let picks = plan_samples(48, 24.0, Output { fps: 24.0, shutter_div: 4, subs: 3 }, None, &keys);
        assert_eq!(picks.len(), 48 * 3);
        let blocks = plan_blocks(&picks, 3, 10, 100_000, true);
        assert!(blocks.iter().all(|b| b.samples.len() % 3 == 0));
        assert_eq!(blocks.iter().map(|b| b.samples.len()).sum::<usize>(), picks.len());
        // Sub-frames every quarter frame: an exact 4x grid.
        assert_eq!(blocks[0].render, blocks[0].inputs() * 4);
    }

    #[test]
    fn without_rife_picks_round_to_real_frames() {
        let keys = all_keys(24);
        let slow = SpeedCurve::from_settings(&SpeedSettings { preset: SpeedPreset::Slow, ..Default::default() }).unwrap();
        let w = TimeWarp::new(slow, 1.0);
        let picks = plan_samples(24, 24.0, Output { fps: 24.0, shutter_div: 1, subs: 1 }, Some(&w), &keys);
        assert_eq!(picks.len(), 48);
        let blocks = plan_blocks(&picks, 1, 100, 100_000, false);
        assert!(blocks.iter().all(|b| b.render == 0));
        assert!(blocks[0].sources.iter().all(|s| matches!(s, Source::Input(_))));
    }

    #[test]
    fn render_budget_splits_blocks() {
        let keys = all_keys(100);
        let picks = plan_samples(100, 24.0, Output { fps: 120.0, shutter_div: 1, subs: 1 }, None, &keys);
        let blocks = plan_blocks(&picks, 1, 100, 60, true);
        assert!(blocks.len() > 1);
        assert!(blocks.iter().all(|b| b.render <= 60));
    }
}
