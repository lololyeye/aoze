//! Beat Sync: finds the beat of the clip's own music and adds a short zoom
//! punch and/or camera shake on it.
//!
//! Onsets: spectral flux of the log-magnitude spectrum. Tempo: autocorrelation
//! of the onset curve with a prior around 120 BPM. Beats: dynamic programming
//! (D. Ellis, "Beat Tracking by Dynamic Programming", 2007), written here from
//! the paper (the usual libraries are GPL or Python-only). When the beat is not
//! clear (speech, ambient music, no audio), nothing is synchronised and the
//! result says so: a missed beat looks worse than no effect.

use std::f64::consts::PI;
use std::ffi::OsString;
use std::fmt::Write as _;
use std::path::Path;

use tokio_util::sync::CancellationToken;

use crate::error::AppResult;
use crate::media::Ffmpeg;
use crate::pipeline::LogSink;

const RATE: usize = 11025;
const WIN: usize = 1024;
const HOP: usize = 128;
/// At most this much audio is analysed.
const MAX_SECONDS: usize = 20 * 60;

#[derive(Debug, Clone, PartialEq)]
pub struct Beats {
    pub bpm: f64,
    /// Beat times (seconds, source time).
    pub times: Vec<f64>,
    /// Relative strength of each beat (0..1): accents get the shake.
    pub strength: Vec<f64>,
}

/// In-place radix-2 FFT (`re.len()` must be a power of two).
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * PI / len as f64;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let (tr, ti) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                (cr, ci) = (cr * wr - ci * wi, cr * wi + ci * wr);
            }
        }
        len <<= 1;
    }
}

/// Onset strength per hop (HOP / RATE seconds), normalised.
#[derive(Debug, Clone, Default)]
pub struct Onsets {
    pub env: Vec<f64>,
    /// Rise of the (linear) spectrum relative to its level: near 0 for steady
    /// sounds (a tone, a hum), clearly above for anything with attacks.
    pub relative: f64,
}

pub fn onset_envelope(samples: &[f32]) -> Onsets {
    if samples.len() < WIN {
        return Onsets::default();
    }
    let window: Vec<f64> = (0..WIN).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / WIN as f64).cos()).collect();
    // Up to ~5.5 kHz (the whole band at this rate), log-compressed.
    let bins = WIN / 2;
    let mut prev = vec![0.0; bins];
    let mut env = Vec::with_capacity(samples.len() / HOP);
    let (mut lin_flux, mut lin_level) = (0.0, 0.0);
    let mut prev_lin = vec![0.0; bins];
    let (mut re, mut im) = (vec![0.0; WIN], vec![0.0; WIN]);
    let mut pos = 0;
    while pos + WIN <= samples.len() {
        for i in 0..WIN {
            re[i] = samples[pos + i] as f64 * window[i];
            im[i] = 0.0;
        }
        fft(&mut re, &mut im);
        let mut flux = 0.0;
        for k in 1..bins {
            let lin = (re[k] * re[k] + im[k] * im[k]).sqrt();
            let mag = (1.0 + 1000.0 * lin).ln();
            flux += (mag - prev[k]).max(0.0);
            prev[k] = mag;
            lin_flux += (lin - prev_lin[k]).max(0.0);
            lin_level += lin;
            prev_lin[k] = lin;
        }
        env.push(flux);
        pos += HOP;
    }
    if !env.is_empty() {
        env[0] = 0.0;
    }
    // Remove the slow trend (local mean over ~0.5 s), keep the peaks.
    let half = (0.25 * RATE as f64 / HOP as f64) as usize;
    let mut prefix = vec![0.0; env.len() + 1];
    for i in 0..env.len() {
        prefix[i + 1] = prefix[i] + env[i];
    }
    let out: Vec<f64> = (0..env.len())
        .map(|i| {
            let (a, b) = (i.saturating_sub(half), (i + half + 1).min(env.len()));
            (env[i] - (prefix[b] - prefix[a]) / (b - a) as f64).max(0.0)
        })
        .collect();
    let relative = lin_flux / lin_level.max(1e-9);
    let sd = (out.iter().map(|v| v * v).sum::<f64>() / out.len().max(1) as f64).sqrt();
    let env = if sd > 0.0 { out.into_iter().map(|v| v / sd).collect() } else { out };
    Onsets { env, relative }
}

/// Below this, the sound has no attacks to follow (measured: steady tone
/// 0.002; drum & bass, film trailer, live-action clip 0.12-0.13; clicks 0.17).
const MIN_RELATIVE_ONSET: f64 = 0.03;
/// The tempo's autocorrelation must stand out (drum & bass ~2.9x the average
/// lag, an orchestral trailer ~1.6x).
const MIN_TEMPO_CONTRAST: f64 = 2.2;
const MIN_TEMPO_PEAK: f64 = 0.3;

/// Finds the beats, or None when there is no clear, steady beat.
pub fn track(onsets: &Onsets) -> Option<Beats> {
    let env = &onsets.env;
    let fps = RATE as f64 / HOP as f64;
    if env.len() < (fps * 4.0) as usize || onsets.relative < MIN_RELATIVE_ONSET {
        return None;
    }
    // Tempo: autocorrelation weighted by a log-normal prior around 120 BPM.
    let lag_of = |bpm: f64| 60.0 * fps / bpm;
    let (lo, hi) = (lag_of(200.0).floor() as usize, lag_of(60.0).ceil() as usize);
    let n = env.len();
    let ac = |lag: usize| -> f64 { (0..n - lag).map(|i| env[i] * env[i + lag]).sum::<f64>() / (n - lag) as f64 };
    let zero = ac(0).max(1e-12);
    let mut best = (0.0, 0usize);
    let mut sum_ac = 0.0;
    for lag in lo..=hi.min(n / 2) {
        let bpm = 60.0 * fps / lag as f64;
        let prior = (-0.5 * ((bpm / 120.0).log2() / 0.9).powi(2)).exp();
        let v = ac(lag) / zero;
        sum_ac += v;
        if v * prior > best.0 {
            best = (v * prior, lag);
        }
    }
    let lag = best.1;
    if lag == 0 {
        return None;
    }
    let peak = ac(lag) / zero;
    let mean = sum_ac / (hi.min(n / 2) - lo + 1) as f64;
    // Refine the period between lags (parabolic interpolation).
    let period = {
        let (a, b, c) = (ac(lag - 1), ac(lag), ac(lag + 1));
        let d = a - 2.0 * b + c;
        lag as f64 + if d.abs() > 1e-12 { 0.5 * (a - c) / d } else { 0.0 }
    };
    // Dynamic programming: each beat rewards a strong onset and a gap close to the period.
    let tightness = 100.0;
    let mut score = env.to_vec();
    let mut back = vec![usize::MAX; n];
    let (pmin, pmax) = ((period / 2.0).round() as usize, (period * 2.0).round() as usize);
    for t in 0..n {
        let mut best_prev = (f64::MIN, usize::MAX);
        for gap in pmin.max(1)..=pmax {
            if gap > t {
                break;
            }
            let p = t - gap;
            let penalty = -tightness * ((gap as f64 / period).ln()).powi(2);
            let v = score[p] + penalty;
            if v > best_prev.0 {
                best_prev = (v, p);
            }
        }
        if best_prev.1 != usize::MAX && best_prev.0 > 0.0 {
            score[t] = env[t] + best_prev.0;
            back[t] = best_prev.1;
        }
    }
    // Last beat: the best score in the final period.
    let tail = n.saturating_sub(period.ceil() as usize);
    let mut t = (tail..n).max_by(|&a, &b| score[a].total_cmp(&score[b]))?;
    let mut frames = vec![t];
    while back[t] != usize::MAX {
        t = back[t];
        frames.push(t);
    }
    frames.reverse();
    // Reliability: beats must sit on onsets clearly above average, and the tempo must stand out.
    let on_beat = frames.iter().map(|&f| env[f]).sum::<f64>() / frames.len() as f64;
    let overall = env.iter().sum::<f64>() / n as f64;
    let coverage = frames.len() as f64 * period / n as f64;
    if peak < MIN_TEMPO_PEAK || peak < mean * MIN_TEMPO_CONTRAST || on_beat < overall * 1.8 || coverage < 0.6 {
        return None;
    }
    let max_on = frames.iter().map(|&f| env[f]).fold(0.0, f64::max).max(1e-9);
    Some(Beats {
        bpm: 60.0 * fps / period,
        // Flux peaks once the onset is ~3/4 into the analysis window (measured on clicks).
        times: frames.iter().map(|&f| (f * HOP) as f64 / RATE as f64 + 0.75 * WIN as f64 / RATE as f64).collect(),
        strength: frames.iter().map(|&f| env[f] / max_on).collect(),
    })
}

/// Decodes the clip's audio (mono, 11 kHz) and tracks its beat.
pub async fn detect(ff: &Ffmpeg, source: &Path, cancel: &CancellationToken, on_log: LogSink<'_>) -> AppResult<Option<Beats>> {
    let mut args: Vec<OsString> = vec!["-i".into(), source.into()];
    let rate = RATE.to_string();
    let max = MAX_SECONDS.to_string();
    for a in ["-vn", "-ac", "1", "-ar", &rate, "-t", &max, "-f", "f32le", "pipe:1"] {
        args.push(a.into());
    }
    let mut samples: Vec<f32> = Vec::new();
    let mut on_chunk = |c: &[u8]| samples.extend(c.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])));
    ff.run_raw(&args, 4096, cancel, &mut on_chunk, on_log).await?;
    let beats = tokio::task::spawn_blocking(move || track(&onset_envelope(&samples))).await.unwrap_or(None);
    match &beats {
        Some(b) => on_log(format!("Beat Sync: {:.1} BPM, {} beats", b.bpm, b.times.len())),
        None => on_log("Beat Sync: no clear, steady beat found: no effect added".into()),
    }
    Ok(beats)
}

/// Zoom and offset of one output frame.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Pose {
    zoom: f64,
    dx: f64,
    dy: f64,
}

/// Small deterministic pseudo-random value in -1..1 for beat `i`.
fn jitter(i: usize, salt: u64) -> f64 {
    let mut x = (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ salt;
    x ^= x >> 31;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 29;
    (x % 20_001) as f64 / 10_000.0 - 1.0
}

/// `sendcmd` script for `crop@bs` on frames of `w`×`h` at `fps`: a zoom punch
/// on each beat (decaying over ~0.2 s) and/or a short shake on accents.
/// `beat_times` are output times. Returns the script and the crop filters to
/// put in the chain (crop, then scale back to `w`×`h`).
#[allow(clippy::too_many_arguments)]
pub fn effect_filters(beat_times: &[f64], strength: &[f64], frames: usize, fps: f64, w: u32, h: u32, zoom: bool, shake: bool) -> (String, Vec<String>) {
    const ZOOM: f64 = 0.06;
    const ZOOM_DECAY: f64 = 0.16;
    const SHAKE: f64 = 0.012;
    const SHAKE_DECAY: f64 = 0.12;
    // Shake needs a margin: the picture is always slightly enlarged with it.
    let base = if shake { 1.0 + SHAKE * 2.2 } else { 1.0 };
    let mut script = String::new();
    let mut last: Option<(u32, u32, u32, u32)> = None;
    let mut b = 0;
    for f in 0..frames {
        let t = f as f64 / fps;
        while b + 1 < beat_times.len() && beat_times[b + 1] <= t {
            b += 1;
        }
        let mut pose = Pose { zoom: base, dx: 0.0, dy: 0.0 };
        // The two most recent beats can still be decaying.
        for k in b.saturating_sub(1)..=b {
            let Some(&bt) = beat_times.get(k) else { continue };
            let age = t - bt;
            if age < 0.0 {
                continue;
            }
            let s = strength.get(k).copied().unwrap_or(1.0);
            if zoom {
                pose.zoom += ZOOM * (0.5 + 0.5 * s) * (-age / ZOOM_DECAY).exp();
            }
            if shake && s > 0.55 {
                let env = (-age / SHAKE_DECAY).exp();
                pose.dx += SHAKE * env * (2.0 * PI * 11.0 * age + jitter(k, 1) * PI).sin() * jitter(k, 7).signum();
                pose.dy += SHAKE * env * (2.0 * PI * 13.0 * age + jitter(k, 3) * PI).sin();
            }
        }
        let cw = ((w as f64 / pose.zoom).round() as u32 / 2 * 2).clamp(2, w);
        let ch = ((h as f64 / pose.zoom).round() as u32 / 2 * 2).clamp(2, h);
        let max_x = (w - cw) as f64;
        let max_y = (h - ch) as f64;
        let x = (max_x / 2.0 + pose.dx * w as f64).round().clamp(0.0, max_x) as u32;
        let y = (max_y / 2.0 + pose.dy * h as f64).round().clamp(0.0, max_y) as u32;
        let p = (cw, ch, x, y);
        if last != Some(p) {
            let at = if f == 0 { 0.0 } else { (f as f64 - 0.5) / fps };
            let _ = writeln!(script, "{at:.4} crop@bs w {cw}, crop@bs h {ch}, crop@bs x {x}, crop@bs y {y};");
            last = Some(p);
        }
    }
    let filters = vec![format!("crop@bs=w={w}:h={h}:x=0:y=0:exact=1"), format!("scale={w}:{h}:flags=bicubic"), "setsar=1".into()];
    (script, filters)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Clicks at `bpm` over `secs`, with some noise.
    fn click_track(bpm: f64, secs: f64, offset: f64) -> Vec<f32> {
        let n = (secs * RATE as f64) as usize;
        let period = 60.0 / bpm;
        let mut seed = 1u32;
        (0..n)
            .map(|i| {
                let t = i as f64 / RATE as f64;
                let since = (t - offset).rem_euclid(period);
                let click = if t >= offset && since < 0.03 { (2.0 * PI * 900.0 * t).sin() * (1.0 - since / 0.03) } else { 0.0 };
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                let noise = ((seed >> 16) as f64 / 32768.0 - 1.0) * 0.02;
                (click * 0.8 + noise) as f32
            })
            .collect()
    }

    #[test]
    fn finds_a_steady_beat() {
        for bpm in [90.0, 128.0, 150.0] {
            let o = onset_envelope(&click_track(bpm, 12.0, 0.2));
            let b = track(&o).expect("beat found");
            assert!((b.bpm - bpm).abs() < 2.0, "{bpm}: {}", b.bpm);
            // Beats line up with the clicks (within 25 ms).
            let period = 60.0 / bpm;
            let mid = b.times[b.times.len() / 2];
            let err = ((mid - 0.2) / period - ((mid - 0.2) / period).round()).abs() * period;
            assert!(err < 0.025, "{bpm}: {err}");
        }
    }

    #[test]
    fn no_beat_in_noise_or_silence() {
        let mut seed = 7u32;
        let noise: Vec<f32> = (0..RATE * 10)
            .map(|_| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.3
            })
            .collect();
        assert!(track(&onset_envelope(&noise)).is_none());
        assert!(track(&onset_envelope(&vec![0.0; RATE * 10])).is_none());
        assert!(track(&onset_envelope(&vec![0.0; 100])).is_none());
    }

    /// Tuning aid, not a check: prints the onset strength and tempo found in real tracks.
    /// `AOZE_BEAT_FILES="a.mp3;b.mp4" cargo test measure_files -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn measure_files() {
        let Ok(list) = std::env::var("AOZE_BEAT_FILES") else { return };
        for f in list.split(';') {
            let out = std::process::Command::new(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/ffmpeg/ffmpeg.exe"))
                .args(["-v", "error", "-i", f, "-vn", "-ac", "1", "-ar", "11025", "-f", "f32le", "-"]).output().unwrap();
            let s: Vec<f32> = out.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
            let o = onset_envelope(&s);
            eprintln!("FILE {f}: relative {:.4} {:?}", o.relative, track(&o).map(|b| (b.bpm, b.times.len())));
        }
        let tone: Vec<f32> = (0..RATE * 6).map(|i| (2.0 * PI * 440.0 * i as f64 / RATE as f64).sin() as f32 * 0.5).collect();
        let o = onset_envelope(&tone);
        eprintln!("tone relative {:.4} {:?}", o.relative, track(&o).map(|b| b.bpm));
    }

    #[test]
    fn effects_punch_on_beats_then_settle() {
        let (script, filters) = effect_filters(&[1.0, 2.0], &[1.0, 1.0], 90, 30.0, 1280, 720, true, false);
        assert!(filters[0].starts_with("crop@bs=w=1280:h=720"));
        let lines: Vec<&str> = script.lines().collect();
        assert!(lines[0].starts_with("0.0000 crop@bs w 1280"));
        // The punch starts at frame 30 (t = 1 s): the crop shrinks there.
        let at_beat = lines.iter().find(|l| l.starts_with("0.9833")).expect("command at the beat");
        assert!(at_beat.contains("w 120") || at_beat.contains("w 119") || at_beat.contains("w 121"), "{at_beat}");
    }

    #[test]
    fn fft_matches_a_known_spectrum() {
        let n = 64;
        let mut re: Vec<f64> = (0..n).map(|i| (2.0 * PI * 5.0 * i as f64 / n as f64).cos()).collect();
        let mut im = vec![0.0; n];
        fft(&mut re, &mut im);
        assert!((re[5] - 32.0).abs() < 1e-9 && re[6].abs() < 1e-9);
    }
}
