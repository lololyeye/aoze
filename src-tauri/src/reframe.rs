//! Smart Reframe: changes a clip's shape (16:9, 9:16, 1:1, 4:5) keeping what
//! matters in the frame, like a camera operator would.
//!
//! Per frame, a saliency map is built from the analysis (analysis.rs): motion
//! relative to the rest of the frame (the subject, not a camera pan), detail
//! (faces, line art, text), and a light centre bias. Screen recordings (mostly
//! still pixels) follow activity instead: the cursor, panels that change, text.
//! The crop window only moves along one axis; for each frame the window holding
//! the most saliency is found, smoothed over time, and a virtual camera follows
//! it: it stays put while the subject is inside a dead zone and otherwise moves
//! with eased, critically damped motion. Each shot is framed on its own; on a
//! cut the camera jumps, as in an edit.
//!
//! Approach after Google's AutoFlip (saliency per shot, stable camera when
//! possible, smooth path otherwise); implemented here without ML models.

use std::fmt::Write as _;

use crate::analysis::Analysis;
use crate::settings::{Focus, FrameFormat};

/// How the new shape is reached.
#[derive(Debug, Clone, PartialEq)]
pub enum Plan {
    /// Crop a window of `w`×`h` source pixels, moving along one axis.
    Crop { w: u32, h: u32, path: Vec<(u32, u32)> },
    /// Too little of the picture would remain (portrait to landscape): the
    /// whole picture over a blurred, enlarged copy of itself.
    Fill { w: u32, h: u32 },
}

/// Portrait to landscape keeps under this share of the picture: fill instead.
const MIN_KEPT_FOR_CROP: f64 = 0.45;

fn even(v: f64) -> u32 {
    ((v.round() as u32) / 2 * 2).max(2)
}

/// Crop size for a ratio, or None when the source already has that shape.
pub fn crop_size(w: u32, h: u32, format: FrameFormat) -> Option<(u32, u32)> {
    let (rw, rh) = format.ratio()?;
    let target = rw as f64 / rh as f64;
    let src = w as f64 / h as f64;
    if (src / target - 1.0).abs() < 0.01 {
        return None;
    }
    Some(if src > target { (even(h as f64 * target).min(w), h & !1) } else { (w & !1, even(w as f64 / target).min(h)) })
}

/// Fill (blurred background) rather than crop?
pub fn fills(w: u32, h: u32, format: FrameFormat) -> bool {
    let Some((cw, ch)) = crop_size(w, h, format) else { return false };
    let (rw, rh) = format.ratio().expect("checked");
    let wider = rw as f64 / rh as f64 > w as f64 / h as f64;
    wider && (cw as f64 * ch as f64) / (w as f64 * h as f64) < MIN_KEPT_FOR_CROP
}

/// Size of a filled frame: the new shape with the source's short side.
pub fn fill_size(w: u32, h: u32, format: FrameFormat) -> (u32, u32) {
    let (rw, rh) = format.ratio().unwrap_or((w, h));
    let short = w.min(h) as f64;
    if rw >= rh {
        (even(short * rw as f64 / rh as f64), even(short))
    } else {
        (even(short), even(short * rh as f64 / rw as f64))
    }
}

/// The picture without black bars, as (x, y, w, h) in source pixels (even).
pub fn picture_box(w: u32, h: u32, analysis: Option<&Analysis>) -> (u32, u32, u32, u32) {
    let Some(a) = analysis else { return (0, 0, w, h) };
    let Some((x, y, bw, bh)) = a.picture_box() else { return (0, 0, w, h) };
    let (sx, sy) = (w as f64 / a.width as f64, h as f64 / a.height as f64);
    // Rounded inwards to even pixels: never a line of bar left.
    let x0 = ((x as f64 * sx).ceil() as u32 + 1) & !1;
    let y0 = ((y as f64 * sy).ceil() as u32 + 1) & !1;
    let x1 = (((x + bw) as f64 * sx).floor() as u32 & !1).min(w);
    let y1 = (((y + bh) as f64 * sy).floor() as u32 & !1).min(h);
    if x1 <= x0 + 16 || y1 <= y0 + 16 {
        return (0, 0, w, h);
    }
    (x0, y0, x1 - x0, y1 - y0)
}

/// Window kept for a new shape: the crop inside the picture (bars removed),
/// or None when the clip already has that shape (kept as it is, bars included).
pub fn window(w: u32, h: u32, format: FrameFormat, analysis: Option<&Analysis>) -> Option<(u32, u32, u32, u32)> {
    crop_size(w, h, format)?;
    let (bx, by, bw, bh) = picture_box(w, h, analysis);
    match crop_size(bw, bh, format) {
        Some((cw, ch)) => Some((bx, by, cw, ch)),
        None if (bw, bh) != (w, h) => Some((bx, by, bw & !1, bh & !1)),
        None => None,
    }
}

struct Shot {
    start: usize,
    end: usize,
}

fn shots(a: &Analysis) -> Vec<Shot> {
    let mut starts: Vec<usize> = a.cuts.iter().copied().filter(|&c| c > 0 && c < a.frames).collect();
    starts.sort_unstable();
    let mut out = Vec::new();
    let mut s = 0;
    for c in starts {
        out.push(Shot { start: s, end: c });
        s = c;
    }
    out.push(Shot { start: s, end: a.frames });
    out
}

/// Mode actually used for a shot.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Mode {
    Subject,
    Screen,
}

fn is_screen(a: &Analysis, shot: &Shot) -> bool {
    // Screen recordings: most pixels never change between frames.
    let mut still: Vec<f32> = a.still[shot.start + 1.min(shot.end - shot.start - 1)..shot.end].to_vec();
    if still.is_empty() {
        return false;
    }
    still.sort_by(f32::total_cmp);
    still[still.len() / 2] > 0.85
}

/// Saliency profile along the free axis (cells), per frame of a shot.
fn profiles(a: &Analysis, shot: &Shot, horizontal: bool, mode: Mode, fps: f64) -> Vec<Vec<f64>> {
    let (cols, rows) = (a.cols, a.rows);
    let len = if horizontal { cols } else { rows };
    let prior: Vec<f64> = (0..len)
        .map(|i| {
            let d = (i as f64 + 0.5) / len as f64 - 0.5;
            (-(d * d) / (2.0 * 0.3 * 0.3)).exp()
        })
        .collect();
    let mut activity = vec![0.0f64; cols * rows];
    // Screen recordings: recent activity counts, fading over about 0.3 s.
    let decay = (-1.0 / (0.3 * fps.max(1.0))).exp();
    let mut out = Vec::with_capacity(shot.end - shot.start);
    for f in shot.start..shot.end {
        let m = a.motion_at(f);
        let d = a.detail_at(f);
        let mut sorted: Vec<u8> = m.to_vec();
        sorted.sort_unstable();
        let median = sorted[sorted.len() / 2] as f64;
        let m_max = (*sorted.last().unwrap() as f64 - median).max(1.0);
        let d_mean = (d.iter().map(|&v| v as f64).sum::<f64>() / d.len() as f64).max(1.0);
        let mut p = vec![0.0; len];
        for r in 0..rows {
            for c in 0..cols {
                let i = r * cols + c;
                // Motion of this area compared with the frame as a whole (ignores pans).
                let mv = ((m[i] as f64 - median).max(0.0) / m_max).min(1.0);
                let det = (d[i] as f64 / d_mean).min(3.0) / 3.0;
                let s = match mode {
                    Mode::Subject => mv + 0.35 * det,
                    Mode::Screen => {
                        // Where things happened recently (cursor, panels that change).
                        activity[i] = activity[i] * decay + mv;
                        activity[i].min(4.0) / 4.0 + 0.3 * det
                    }
                };
                p[if horizontal { c } else { r }] += s;
            }
        }
        let bias = if mode == Mode::Subject { 0.5 } else { 0.25 };
        for (i, v) in p.iter_mut().enumerate() {
            *v *= 1.0 - bias + bias * prior[i];
        }
        let sum: f64 = p.iter().sum();
        if sum > 0.0 {
            p.iter_mut().for_each(|v| *v /= sum);
        } else {
            p.copy_from_slice(&prior);
        }
        out.push(p);
    }
    out
}

/// Centre (in cells) of the window of `win` cells holding the most saliency.
fn best_center(p: &[f64], win: f64) -> f64 {
    let len = p.len() as f64;
    if win >= len {
        return len / 2.0;
    }
    let w = win.round().max(1.0) as usize;
    let mut best = (f64::MIN, 0usize);
    let mut sum: f64 = p[..w].iter().sum();
    for s in 0..=p.len() - w {
        if s > 0 {
            sum += p[s + w - 1] - p[s - 1];
        }
        if sum > best.0 + 1e-12 {
            best = (sum, s);
        }
    }
    // Centroid inside the best window: continuous, not stuck on the cell grid.
    let (s, e) = (best.1, best.1 + w);
    let mass: f64 = p[s..e].iter().sum();
    let c = if mass > 0.0 { p[s..e].iter().enumerate().map(|(i, v)| (s + i) as f64 * v).sum::<f64>() / mass + 0.5 } else { (s + e) as f64 / 2.0 };
    c.clamp(win / 2.0, len - win / 2.0)
}

/// Camera centre per frame of a shot (in cells).
fn camera(targets: &[f64], fps: f64, dead_zone: f64, omega: f64, lo: f64, hi: f64) -> Vec<f64> {
    let n = targets.len();
    if n == 0 {
        return Vec::new();
    }
    let mut sorted = targets.to_vec();
    sorted.sort_by(f64::total_cmp);
    let median = sorted[n / 2];
    // The whole shot fits in the dead zone: a still camera.
    if targets.iter().all(|t| (t - median).abs() <= dead_zone) {
        return vec![median.clamp(lo, hi); n];
    }
    let dt = 1.0 / fps;
    // A critically damped camera trails a steady motion by 2/ω seconds: aim
    // that far ahead and it keeps a moving subject centred.
    let lead = (2.0 / omega * fps).round() as usize;
    let start = targets[..n.min((0.5 * fps) as usize + 1)].iter().sum::<f64>() / n.min((0.5 * fps) as usize + 1) as f64;
    let (mut pos, mut vel, mut goal) = (start, 0.0, start);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let t = targets[(i + lead).min(n - 1)];
        if (t - goal).abs() > dead_zone {
            goal = t;
        }
        // Critically damped spring: eases in and out, never overshoots.
        let steps = 4;
        let h = dt / steps as f64;
        for _ in 0..steps {
            let acc = omega * omega * (goal - pos) - 2.0 * omega * vel;
            vel += acc * h;
            pos += vel * h;
        }
        out.push(pos.clamp(lo, hi));
    }
    out
}

/// Plans the reframe of a clip of `w`×`h` at `fps`. `analysis` is required
/// unless the crop is static (focus Center, or Smart Reframe off); with it,
/// black bars (letterbox) are left out of the frame.
pub fn plan(w: u32, h: u32, fps: f64, format: FrameFormat, smart: bool, focus: Focus, analysis: Option<&Analysis>) -> Option<Plan> {
    if fills(w, h, format) {
        let (fw, fh) = fill_size(w, h, format);
        return Some(Plan::Fill { w: fw, h: fh });
    }
    let (bx, by, cw, ch) = window(w, h, format, analysis)?;
    let (_, _, bw, bh) = picture_box(w, h, analysis);
    let horizontal = cw < bw;
    let (cx0, cy0) = (bx + (bw - cw) / 2, by + (bh - ch) / 2);
    let frames = analysis.map_or(1, |a| a.frames);
    let a = match analysis {
        Some(a) if smart && focus != Focus::Center && a.frames > 0 && a.cols > 1 && a.rows > 1 && (cw < bw || ch < bh) => a,
        _ => return Some(Plan::Crop { w: cw, h: ch, path: vec![(cx0, cy0); frames] }),
    };
    let len_cells = if horizontal { a.cols } else { a.rows } as f64;
    let src_len = if horizontal { w } else { h } as f64;
    let crop_len = if horizontal { cw } else { ch } as f64;
    // The window moves inside the picture (between the bars).
    let (pic0, pic_len) = if horizontal { (bx as f64, bw as f64) } else { (by as f64, bh as f64) };
    let to_cells = |px: f64| px / src_len * len_cells;
    let win = to_cells(crop_len);
    let (lo, hi) = (to_cells(pic0) + win / 2.0, (to_cells(pic0 + pic_len) - win / 2.0).max(to_cells(pic0) + win / 2.0));
    let mut path = Vec::with_capacity(a.frames);
    for shot in shots(a) {
        if shot.end <= shot.start {
            continue;
        }
        let mode = match focus {
            Focus::Screen => Mode::Screen,
            Focus::Subject => Mode::Subject,
            _ if is_screen(a, &shot) => Mode::Screen,
            _ => Mode::Subject,
        };
        let prof = profiles(a, &shot, horizontal, mode, fps);
        // Smooth the saliency over time before choosing (steadier choices).
        let half = ((if mode == Mode::Screen { 0.6 } else { 0.4 }) * fps).round() as usize;
        let n = prof.len();
        let mut targets = Vec::with_capacity(n);
        let mut acc = vec![0.0; prof[0].len()];
        let (mut lo_i, mut hi_i) = (0usize, 0usize);
        for i in 0..n {
            let (want_lo, want_hi) = (i.saturating_sub(half), (i + half + 1).min(n));
            while hi_i < want_hi {
                acc.iter_mut().zip(&prof[hi_i]).for_each(|(a, b)| *a += b);
                hi_i += 1;
            }
            while lo_i < want_lo {
                acc.iter_mut().zip(&prof[lo_i]).for_each(|(a, b)| *a -= b);
                lo_i += 1;
            }
            targets.push(best_center(&acc, win).clamp(lo, hi));
        }
        let (dz, omega) = if mode == Mode::Screen { (0.15 * win, 3.5) } else { (0.1 * win, 4.5) };
        for c in camera(&targets, fps, dz, omega, lo, hi) {
            let px = (c / len_cells * src_len - crop_len / 2.0).round().clamp(pic0, pic0 + pic_len - crop_len) as u32;
            path.push(if horizontal { (px, cy0) } else { (cx0, px) });
        }
    }
    Some(Plan::Crop { w: cw, h: ch, path })
}

/// `crop@<name>` filter with its start position.
pub fn crop_filter(name: &str, w: u32, h: u32, first: (u32, u32)) -> String {
    format!("crop@{name}=w={w}:h={h}:x={}:y={}:exact=1", first.0, first.1)
}

/// `sendcmd` script moving `crop@<name>` frame by frame (frame `i` at `i / fps`).
pub fn crop_commands(name: &str, path: &[(u32, u32)], fps: f64) -> String {
    let mut out = String::new();
    let mut last = None;
    for (i, &p) in path.iter().enumerate() {
        if last == Some(p) {
            continue;
        }
        // Half a frame early: lands on frame i, never on frame i-1.
        let t = if i == 0 { 0.0 } else { (i as f64 - 0.5) / fps };
        let _ = writeln!(out, "{t:.4} crop@{name} x {}, crop@{name} y {};", p.0, p.1);
        last = Some(p);
    }
    out
}

/// FFmpeg filters drawing a frame of `w`×`h` from the whole picture over a
/// blurred, enlarged copy of itself.
pub fn fill_filter(w: u32, h: u32) -> String {
    let (bw, bh) = ((w / 8).max(2) & !1, (h / 8).max(2) & !1);
    format!(
        "split[rfa][rfb];[rfb]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},gblur=sigma=6,eq=brightness=-0.06:saturation=0.9,scale={w}:{h}:flags=bicubic[rfbg];[rfa]scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos[rffg];[rfbg][rffg]overlay=(W-w)/2:(H-h)/2,setsar=1"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::Analyzer;
    use std::collections::HashSet;

    #[test]
    fn sizes_for_each_format() {
        assert_eq!(crop_size(1920, 1080, FrameFormat::Portrait), Some((608, 1080)));
        assert_eq!(crop_size(1920, 1080, FrameFormat::Square), Some((1080, 1080)));
        assert_eq!(crop_size(1920, 1080, FrameFormat::Feed), Some((864, 1080)));
        assert_eq!(crop_size(1920, 1080, FrameFormat::Landscape), None);
        assert_eq!(crop_size(1080, 1920, FrameFormat::Square), Some((1080, 1080)));
        assert!(fills(1080, 1920, FrameFormat::Landscape));
        assert!(!fills(1080, 1920, FrameFormat::Square));
        assert!(!fills(1920, 1080, FrameFormat::Portrait));
        assert_eq!(fill_size(1080, 1920, FrameFormat::Landscape), (1920, 1080));
    }

    /// A bright square moving left to right on a textured background.
    fn moving_square(frames: usize, cut_at: Option<usize>) -> Analysis {
        let (w, h) = (320, 180);
        let mut an = Analyzer::new(w, h);
        for f in 0..frames {
            let after_cut = cut_at.is_some_and(|c| f >= c);
            let x0 = if after_cut { 30 } else { 20 + f * 240 / frames };
            let frame: Vec<u8> = (0..h)
                .flat_map(|y| (0..w).map(move |x| (x, y)))
                .map(|(x, y)| if (x0..x0 + 40).contains(&x) && (60..120).contains(&y) { 230 } else { 40 })
                .collect();
            an.push(&frame);
        }
        an.finish(cut_at.into_iter().collect::<HashSet<_>>())
    }

    #[test]
    fn follows_the_subject_smoothly() {
        let a = moving_square(120, None);
        let Some(Plan::Crop { w, path, .. }) = plan(1920, 1080, 30.0, FrameFormat::Portrait, true, Focus::Subject, Some(&a)) else { panic!() };
        assert_eq!(w, 608);
        assert_eq!(path.len(), 120);
        // The square goes from x≈120 to x≈1560 (source pixels): the window follows.
        assert!(path[10].0 < 300, "{:?}", path[10]);
        assert!(path[115].0 > 900, "{:?}", path[115]);
        // No jumps: at most ~30 px per frame at 30 FPS.
        for p in path.windows(2) {
            assert!(p[0].0.abs_diff(p[1].0) < 40, "{p:?}");
        }
    }

    #[test]
    fn screen_focus_follows_activity_too() {
        let a = moving_square(120, None);
        let Some(Plan::Crop { path, .. }) = plan(1920, 1080, 30.0, FrameFormat::Portrait, true, Focus::Screen, Some(&a)) else { panic!() };
        // Square centre in source pixels: (20 + f*2 + 20) * 6.
        for f in [20, 60, 100] {
            let sq = (40.0 + f as f64 * 2.0) * 6.0;
            let x = path[f].0 as f64;
            assert!(sq > x && sq < x + 608.0, "frame {f}: square at {sq}, window {x}");
        }
    }

    #[test]
    fn center_and_off_are_static() {
        let a = moving_square(30, None);
        for (smart, focus) in [(false, Focus::Auto), (true, Focus::Center)] {
            let Some(Plan::Crop { path, .. }) = plan(1920, 1080, 30.0, FrameFormat::Portrait, smart, focus, Some(&a)) else { panic!() };
            assert!(path.iter().all(|&p| p == (656, 0)));
        }
    }

    #[test]
    fn cut_jumps_to_the_new_shot() {
        let a = moving_square(90, Some(60));
        let Some(Plan::Crop { path, .. }) = plan(1920, 1080, 30.0, FrameFormat::Portrait, true, Focus::Subject, Some(&a)) else { panic!() };
        assert_eq!(path.len(), 90);
        // Second shot: the square sits still at the left.
        assert!(path[80].0 < 300, "{:?}", path[80]);
    }

    #[test]
    fn letterbox_bars_are_left_out() {
        // 2.39:1 film inside a 16:9 frame (320x180 analysis): bars of 23 rows.
        let (w, h) = (320, 180);
        let mut an = Analyzer::new(w, h);
        for f in 0..30 {
            let frame: Vec<u8> = (0..h)
                .flat_map(|y| (0..w).map(move |x| (x, y)))
                .map(|(x, y)| if !(23..157).contains(&y) { 16 } else if (100 + f..140 + f).contains(&x) { 220 } else { 70 })
                .collect();
            an.push(&frame);
        }
        let a = an.finish(HashSet::new());
        let Some(Plan::Crop { w: cw, h: ch, path }) = plan(1280, 720, 30.0, FrameFormat::Portrait, true, Focus::Subject, Some(&a)) else { panic!() };
        // The window is as tall as the picture, not the frame.
        assert!(ch < 560 && ch > 520, "{cw}x{ch}");
        assert!(path.iter().all(|p| p.1 >= 92 && p.1 + ch <= 628), "{:?}", path[0]);
        // Same shape as the frame: left as it is, bars included.
        assert_eq!(plan(1280, 720, 30.0, FrameFormat::Landscape, true, Focus::Auto, Some(&a)), None);
    }

    #[test]
    fn commands_only_when_moving() {
        let cmds = crop_commands("rf", &[(0, 0), (0, 0), (10, 0)], 30.0);
        assert_eq!(cmds.lines().count(), 2);
        assert!(cmds.lines().nth(1).unwrap().starts_with("0.0500 crop@rf x 10"));
    }
}
