//! FFmpeg wrapper: probing, frame grabs, hardware encoder detection and
//! cancellable runs with real progress (`-progress pipe:1`).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::color::{ColorPlan, Transfer};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::fsutil::{extension_lower, file_size};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const GIF_EXTENSIONS: [&str; 1] = ["gif"];
pub const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    #[default]
    Image,
    Gif,
    Video,
}

pub fn kind_of(path: &Path) -> Option<MediaKind> {
    let ext = extension_lower(path);
    if GIF_EXTENSIONS.contains(&ext.as_str()) {
        Some(MediaKind::Gif)
    } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        Some(MediaKind::Video)
    } else if crate::imaging::is_supported(path) {
        Some(MediaKind::Image)
    } else {
        None
    }
}

/// Facts about an animated file, from ffprobe (no full decode).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Exact rate as "num/den", for FFmpeg arguments.
    pub fps_rational: String,
    pub frames: u64,
    pub duration_ms: u64,
    pub codec: String,
    pub has_audio: bool,
    pub audio_codec: Option<String>,
    pub size_bytes: u64,
    pub container: String,
    /// Pixel format of the video stream (e.g. yuv420p, yuv420p10le).
    pub pix_fmt: String,
    /// Display rotation in degrees from the container (phones); width/height
    /// above are already the displayed (rotated) size, as FFmpeg decodes them.
    pub rotation: i32,
    /// The webview can play the file itself; otherwise an H.264 preview copy is made.
    pub playable: bool,
    /// SDR, or the HDR transfer (PQ / HLG) of the video stream.
    #[serde(default = "sdr")]
    pub transfer: Transfer,
    /// YUV matrix from ffprobe (`bt709`, `bt2020nc`…), empty when untagged.
    #[serde(default)]
    pub color_matrix: String,
}

fn sdr() -> Transfer {
    Transfer::Sdr
}

/// Containers, codecs and pixel formats WebView2 decodes reliably. 10-bit
/// H.264 and HEVC would show a black frame, so they get a preview copy.
fn webview_playable(path: &Path, codec: &str, pix_fmt: &str) -> bool {
    let ext = extension_lower(path);
    ["mp4", "m4v", "webm", "mov"].contains(&ext.as_str())
        && ["h264", "vp8", "vp9", "av1"].contains(&codec)
        && ["yuv420p", "yuvj420p"].contains(&pix_fmt)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HwEncoder {
    Nvenc,
    Amf,
    Qsv,
}

impl HwEncoder {
    pub fn codec(self) -> &'static str {
        match self {
            HwEncoder::Nvenc => "h264_nvenc",
            HwEncoder::Amf => "h264_amf",
            HwEncoder::Qsv => "h264_qsv",
        }
    }
}

/// Progress reported by a running FFmpeg: output timestamp in ms.
pub type ProgressSink<'a> = &'a (dyn Fn(u64) + Send + Sync);
pub type LogSink<'a> = &'a (dyn Fn(String) + Send + Sync);

#[derive(Deserialize)]
struct ProbeOut {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    nb_frames: Option<String>,
    nb_read_packets: Option<String>,
    duration: Option<String>,
    pix_fmt: Option<String>,
    color_transfer: Option<String>,
    color_space: Option<String>,
    #[serde(default)]
    disposition: Option<ProbeDisposition>,
    #[serde(default)]
    side_data_list: Vec<ProbeSideData>,
    #[serde(default)]
    tags: Option<ProbeTags>,
}

#[derive(Deserialize)]
struct ProbeDisposition {
    #[serde(default)]
    attached_pic: u8,
}

#[derive(Deserialize)]
struct ProbeSideData {
    rotation: Option<f64>,
}

#[derive(Deserialize)]
struct ProbeTags {
    rotate: Option<String>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    format_name: Option<String>,
}

fn parse_rate(r: &str) -> Option<f64> {
    let (n, d) = r.split_once('/').unwrap_or((r, "1"));
    let (n, d) = (n.trim().parse::<f64>().ok()?, d.trim().parse::<f64>().ok()?);
    (d > 0.0 && n > 0.0).then(|| n / d)
}

fn media_err(detail: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::MediaFailed, detail)
}

pub struct Ffmpeg {
    dir: PathBuf,
}

impl Ffmpeg {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn found(&self) -> bool {
        self.dir.join("ffmpeg.exe").is_file() && self.dir.join("ffprobe.exe").is_file()
    }

    pub fn version(&self) -> Option<String> {
        std::fs::read_to_string(self.dir.join("FFMPEG_VERSION")).ok().map(|v| v.trim().to_string())
    }

    fn ensure(&self) -> AppResult<()> {
        if self.found() {
            Ok(())
        } else {
            Err(AppError::new(ErrorCode::FfmpegMissing, format!("ffmpeg.exe / ffprobe.exe not found in {}", self.dir.display())))
        }
    }

    fn std_cmd(&self, exe: &str) -> std::process::Command {
        let mut c = std::process::Command::new(self.dir.join(exe));
        c.current_dir(&self.dir).stdin(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(CREATE_NO_WINDOW);
        }
        c
    }

    /// Reads stream/format metadata. GIFs get an exact frame count by counting
    /// packets (cheap: demux only, no decode).
    pub fn probe(&self, path: &Path, kind: MediaKind) -> AppResult<MediaInfo> {
        self.ensure()?;
        if !path.is_file() {
            return Err(AppError::new(ErrorCode::FileNotFound, path.display().to_string()));
        }
        let mut cmd = self.std_cmd("ffprobe.exe");
        cmd.args(["-v", "error"]);
        if kind == MediaKind::Gif {
            cmd.arg("-count_packets");
        }
        cmd.args([
            "-show_entries",
            "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_packets,duration,pix_fmt,color_transfer,color_space:stream_disposition=attached_pic:stream_side_data=rotation:stream_tags=rotate:format=duration,format_name",
            "-of",
            "json",
        ])
        .arg(path);
        let out = cmd.output().map_err(|e| media_err(format!("could not run ffprobe: {e}")))?;
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(AppError::new(ErrorCode::DecodeFailed, format!("{}: {msg}", path.display())));
        }
        let parsed: ProbeOut = serde_json::from_slice(&out.stdout).map_err(|e| media_err(format!("ffprobe output: {e}")))?;
        let video = parsed
            .streams
            .iter()
            // Skip cover art stored as a still "video" stream.
            .find(|s| s.codec_type.as_deref() == Some("video") && s.disposition.as_ref().is_none_or(|d| d.attached_pic == 0))
            .ok_or_else(|| AppError::new(ErrorCode::DecodeFailed, format!("{}: no video stream", path.display())))?;
        let audio = parsed.streams.iter().find(|s| s.codec_type.as_deref() == Some("audio"));
        let (mut width, mut height) = (video.width.unwrap_or(0), video.height.unwrap_or(0));
        let rotation = video
            .side_data_list
            .iter()
            .find_map(|d| d.rotation)
            .map(|r| r.round() as i32)
            .or_else(|| video.tags.as_ref().and_then(|t| t.rotate.as_deref()).and_then(|r| r.parse::<i32>().ok()))
            .unwrap_or(0)
            .rem_euclid(360);
        // FFmpeg applies the rotation when decoding: report the displayed size.
        if rotation == 90 || rotation == 270 {
            std::mem::swap(&mut width, &mut height);
        }
        if width == 0 || height == 0 {
            return Err(AppError::new(ErrorCode::DecodeFailed, format!("{}: unknown frame size", path.display())));
        }
        let duration_s = parsed
            .format
            .as_ref()
            .and_then(|f| f.duration.as_deref())
            .or(video.duration.as_deref())
            .and_then(|d| d.parse::<f64>().ok())
            .unwrap_or(0.0);
        let counted = video
            .nb_read_packets
            .as_deref()
            .or(video.nb_frames.as_deref())
            .and_then(|n| n.parse::<u64>().ok())
            .filter(|n| *n > 0);
        // GIF r_frame_rate is a timebase artefact; the average rate is the real one.
        let rate_str = video.avg_frame_rate.as_deref().filter(|r| parse_rate(r).is_some()).or(video.r_frame_rate.as_deref());
        let mut fps = rate_str.and_then(parse_rate).unwrap_or(0.0);
        if let (Some(n), true) = (counted, duration_s > 0.0) {
            if kind == MediaKind::Gif || fps <= 0.0 {
                fps = n as f64 / duration_s;
            }
        }
        if fps <= 0.0 || !fps.is_finite() {
            fps = 25.0;
        }
        let frames = counted.unwrap_or_else(|| (duration_s * fps).round().max(1.0) as u64);
        let fps_rational = rate_str
            .filter(|r| kind == MediaKind::Video && parse_rate(r).is_some())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}/1000", (fps * 1000.0).round() as u64));
        let codec = video.codec_name.clone().unwrap_or_default();
        let pix_fmt = video.pix_fmt.clone().unwrap_or_default();
        let transfer = Transfer::from_probe(video.color_transfer.as_deref().unwrap_or(""));
        Ok(MediaInfo {
            // An HDR stream shows washed-out colours in the webview: it gets a tone-mapped copy.
            playable: kind == MediaKind::Video && webview_playable(path, &codec, &pix_fmt) && !transfer.is_hdr(),
            transfer,
            color_matrix: video.color_space.clone().unwrap_or_default(),
            width,
            height,
            fps,
            fps_rational,
            frames,
            duration_ms: (duration_s * 1000.0).round() as u64,
            codec,
            pix_fmt,
            rotation,
            has_audio: audio.is_some(),
            audio_codec: audio.and_then(|a| a.codec_name.clone()),
            size_bytes: file_size(path),
            container: parsed.format.and_then(|f| f.format_name).unwrap_or_default(),
        })
    }

    /// Display duration of every frame, in seconds (keeps variable GIF timing).
    pub fn frame_durations(&self, path: &Path) -> AppResult<Vec<f64>> {
        self.ensure()?;
        let out = self
            .std_cmd("ffprobe.exe")
            .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=duration_time", "-of", "csv=p=0"])
            .arg(path)
            .output()
            .map_err(|e| media_err(format!("could not run ffprobe: {e}")))?;
        if !out.status.success() {
            return Err(media_err(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim().trim_end_matches(',').parse::<f64>().unwrap_or(0.1))
            .map(|d| if d > 0.0 { d } else { 0.1 })
            .collect())
    }

    /// Writes one frame as PNG (for thumbnails), scaled to fit `max_side`.
    pub fn grab_frame(&self, path: &Path, at_ms: u64, max_side: u32, dest: &Path) -> AppResult<()> {
        self.ensure()?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let scale = format!("scale='min({max_side},iw)':'min({max_side},ih)':force_original_aspect_ratio=decrease");
        let out = self
            .std_cmd("ffmpeg.exe")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", &format!("{:.3}", at_ms as f64 / 1000.0), "-i"])
            .arg(path)
            .args(["-frames:v", "1", "-vf", &scale])
            .arg(dest)
            .output()
            .map_err(|e| media_err(format!("could not run ffmpeg: {e}")))?;
        if !out.status.success() || !dest.is_file() {
            return Err(media_err(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        Ok(())
    }

    /// libplacebo (Vulkan) works in this FFmpeg on this machine. Tested once
    /// with a tiny HDR frame; blocking the first time.
    pub fn libplacebo(&self) -> bool {
        static OK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        *OK.get_or_init(|| {
            if !self.found() {
                return false;
            }
            let ok = self
                .std_cmd("ffmpeg.exe")
                .args(["-hide_banner", "-loglevel", "error", "-init_hw_device", "vulkan=vk", "-filter_hw_device", "vk", "-f", "lavfi", "-i"])
                .arg("color=c=gray:s=64x64:d=0.1,format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc")
                .args(["-vf", &crate::color::placebo_to_sdr().join(","), "-f", "null", "-"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            log::info!("libplacebo (Vulkan) tone mapping: {}", if ok { "available" } else { "unavailable, using the LUT" });
            ok
        })
    }

    /// Light H.264 SDR copy (at most `max_h` lines) for clips the webview cannot
    /// play, or that are too heavy to decode twice for the comparison.
    /// HDR clips are tone mapped so the preview shows their real colours. Blocking.
    pub fn preview_copy(&self, src: &Path, dest: &Path, transfer: Transfer, matrix: &str, max_h: u32) -> AppResult<()> {
        self.ensure()?;
        let tmp = crate::fsutil::sibling_temp(dest).with_extension("mp4");
        let mut vf = vec![format!("scale=-2:'min({max_h},ih)'")];
        let lut_dir = dest.parent().unwrap_or(Path::new("."));
        let stem = dest.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let plan = ColorPlan { input: transfer, output: Transfer::Sdr, look: Default::default(), creative: None };
        let color = crate::color::prepare(&plan, lut_dir, &format!("{stem}_preview"), matrix)?;
        vf.extend(color.iter().flatten().cloned());
        if !vf.iter().any(|f| f.starts_with("format=")) {
            vf.push("format=yuv420p".into());
        }
        let out = self
            .std_cmd("ffmpeg.exe")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(src)
            .args(["-map", "0:v:0", "-map", "0:a:0?", "-vf", &vf.join(","), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26"])
            .args(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"])
            .arg(&tmp)
            .output()
            .map_err(|e| media_err(format!("could not run ffmpeg: {e}")))?;
        if color.is_some() {
            let _ = std::fs::remove_file(lut_dir.join(format!("{stem}_preview.cube")));
        }
        if !out.status.success() {
            let _ = std::fs::remove_file(&tmp);
            return Err(media_err(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        std::fs::rename(&tmp, dest)?;
        Ok(())
    }

    /// Hardware H.264 encoders that actually work on this machine (a real test
    /// encode each: listing them is not enough, the driver must accept them).
    pub fn detect_encoders(&self) -> Vec<HwEncoder> {
        if !self.found() {
            return vec![];
        }
        [HwEncoder::Nvenc, HwEncoder::Amf, HwEncoder::Qsv]
            .into_iter()
            .filter(|e| {
                self.std_cmd("ffmpeg.exe")
                    .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2", "-frames:v", "3", "-c:v"])
                    .arg(e.codec())
                    .args(["-f", "null", "-"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
            })
            .collect()
    }

    /// Runs ffmpeg to completion. Reports the output timestamp through `progress`,
    /// kills the process when `cancel` fires.
    pub async fn run(&self, args: &[OsString], cancel: &CancellationToken, progress: ProgressSink<'_>, log: LogSink<'_>) -> AppResult<()> {
        self.ensure()?;
        let mut cmd = tokio::process::Command::new(self.dir.join("ffmpeg.exe"));
        cmd.args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"])
            .args(args)
            .current_dir(&self.dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(crate::tuning::process_flags());
        log(format!("$ ffmpeg {}", args.iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ")));

        let mut child = cmd.spawn().map_err(|e| media_err(format!("could not start ffmpeg: {e}")))?;
        let stdout = child.stdout.take().expect("stdout is piped");
        let stderr = child.stderr.take().expect("stderr is piped");
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));

        let read_progress = async {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(v) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
                    // Both keys are in microseconds (historical FFmpeg naming).
                    if let Ok(us) = v.trim().parse::<i64>() {
                        progress((us.max(0) / 1000) as u64);
                    }
                }
            }
        };
        let read_errors = {
            let errors = errors.clone();
            async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        log(line.clone());
                        let mut e = errors.lock().unwrap();
                        if e.len() < 200 {
                            e.push(line);
                        }
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
            (status, _, _) = async { tokio::join!(child.wait(), read_progress, read_errors) } => status?,
        };
        if status.success() {
            return Ok(());
        }
        let tail = errors.lock().unwrap().iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n");
        Err(media_err(format!("ffmpeg exited with {:?}\n{tail}", status.code())))
    }

    /// Runs ffmpeg writing raw data to stdout (`pipe:1`) and hands it over in
    /// chunks of exactly `chunk` bytes (a trailing partial chunk is dropped).
    pub async fn run_raw(
        &self,
        args: &[OsString],
        chunk: usize,
        cancel: &CancellationToken,
        on_chunk: &mut (dyn FnMut(&[u8]) + Send),
        log: LogSink<'_>,
    ) -> AppResult<()> {
        use tokio::io::AsyncReadExt;
        self.ensure()?;
        let mut cmd = tokio::process::Command::new(self.dir.join("ffmpeg.exe"));
        cmd.args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats"])
            .args(args)
            .current_dir(&self.dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(crate::tuning::process_flags());
        log(format!("$ ffmpeg {}", args.iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ")));
        let mut child = cmd.spawn().map_err(|e| media_err(format!("could not start ffmpeg: {e}")))?;
        let mut stdout = child.stdout.take().expect("stdout is piped");
        let stderr = child.stderr.take().expect("stderr is piped");
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let read_data = async {
            let mut buf = vec![0u8; chunk.max(1)];
            while stdout.read_exact(&mut buf).await.is_ok() {
                on_chunk(&buf);
            }
        };
        let read_errors = {
            let errors = errors.clone();
            async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        log(line.clone());
                        let mut e = errors.lock().unwrap();
                        if e.len() < 200 {
                            e.push(line);
                        }
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
            (status, _, _) = async { tokio::join!(child.wait(), read_data, read_errors) } => status?,
        };
        if status.success() {
            return Ok(());
        }
        let tail = errors.lock().unwrap().iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n");
        Err(media_err(format!("ffmpeg exited with {:?}\n{tail}", status.code())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rates_and_kinds() {
        assert!((parse_rate("24000/1001").unwrap() - 23.976).abs() < 1e-3);
        assert_eq!(parse_rate("0/0"), None);
        assert_eq!(kind_of(Path::new("a.GIF")), Some(MediaKind::Gif));
        assert_eq!(kind_of(Path::new("clip.mp4")), Some(MediaKind::Video));
        assert_eq!(kind_of(Path::new("x.png")), Some(MediaKind::Image));
        assert_eq!(kind_of(Path::new("x.txt")), None);
        assert!(webview_playable(Path::new("a.mp4"), "h264", "yuv420p"));
        assert!(!webview_playable(Path::new("a.mp4"), "h264", "yuv420p10le"), "10-bit H.264 shows black in WebView2");
        assert!(!webview_playable(Path::new("a.mp4"), "hevc", "yuv420p"));
        assert!(!webview_playable(Path::new("a.mkv"), "h264", "yuv420p"));
    }
}
