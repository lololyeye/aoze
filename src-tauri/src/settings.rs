use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::fsutil::write_json_atomic;

pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Style {
    /// waifu2x CUnet: best quality for anime / illustrations.
    Artwork,
    /// waifu2x UpConv7 anime: faster, slightly lower quality.
    ArtworkFast,
    /// waifu2x UpConv7 photo.
    Photo,
}

impl Style {
    pub const ALL: [Style; 3] = [Style::Artwork, Style::ArtworkFast, Style::Photo];

    pub fn model_dir(self) -> &'static str {
        match self {
            Style::Artwork => "models-cunet",
            Style::ArtworkFast => "models-upconv_7_anime_style_art_rgb",
            Style::Photo => "models-upconv_7_photo",
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Style::Artwork => "art",
            Style::ArtworkFast => "art-fast",
            Style::Photo => "photo",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Threads {
    pub load: u8,
    pub proc: u8,
    pub save: u8,
}

impl Default for Threads {
    fn default() -> Self {
        Self { load: 1, proc: 2, save: 2 }
    }
}

/// Everything that drives the upscaling itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpscaleParams {
    pub style: Style,
    /// Final scale factor: 1, 1.6, 2, 4 or 8.
    pub scale: f32,
    /// -1 = no denoise, 0..=3 = waifu2x noise levels.
    pub noise: i8,
    /// None = engine default (auto), Some(-1) = CPU, Some(n) = Vulkan device n.
    pub gpu: Option<i32>,
    /// 0 = auto.
    pub tile_size: u32,
    pub tta: bool,
    pub threads: Threads,
}

impl Default for UpscaleParams {
    fn default() -> Self {
        Self {
            style: Style::Artwork,
            scale: 2.0,
            noise: 1,
            gpu: None,
            tile_size: 0,
            tta: false,
            threads: Threads::default(),
        }
    }
}

pub const SUPPORTED_SCALES: [f32; 5] = [1.0, 1.6, 2.0, 4.0, 8.0];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    Png,
    Jpeg,
    Webp,
}

impl OutputFormat {
    pub fn extension(self) -> &'static str {
        match self {
            OutputFormat::Png => "png",
            OutputFormat::Jpeg => "jpg",
            OutputFormat::Webp => "webp",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Keep both: append " (1)", " (2)", ...
    Rename,
    Overwrite,
    Skip,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OutputOptions {
    pub format: OutputFormat,
    /// 1..=100, used by JPEG and lossy WebP.
    pub quality: u8,
    pub webp_lossless: bool,
    /// None = next to the source image.
    pub directory: Option<PathBuf>,
    /// Tokens: {style} {scale} {noise}
    pub suffix: String,
    pub conflict: ConflictPolicy,
}

pub const DEFAULT_SUFFIX: &str = "_{style}_{scale}x_noise{noise}";

impl Default for OutputOptions {
    fn default() -> Self {
        Self {
            format: OutputFormat::Png,
            quality: 92,
            webp_lossless: false,
            directory: None,
            suffix: DEFAULT_SUFFIX.into(),
            conflict: ConflictPolicy::Rename,
        }
    }
}


/// What the image workspace does with a still image.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageAction {
    /// Enlarge / denoise with the engine.
    Improve,
    /// Re-encode to a smaller file, same resolution.
    Compress,
    Both,
}

/// Enhancement for GIFs and clips.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Enhance {
    /// Plain Lanczos resize.
    Off,
    /// Lanczos resize + contrast-adaptive sharpening (FFmpeg, fast).
    Sharpen,
    /// waifu2x with noise level 0 / 1 / 2 (GPU, slow on long clips).
    Light,
    Medium,
    Strong,
}

impl Enhance {
    /// waifu2x noise level when this enhancement runs the engine.
    pub fn engine_noise(self) -> Option<i8> {
        match self {
            Enhance::Light => Some(0),
            Enhance::Medium => Some(1),
            Enhance::Strong => Some(2),
            Enhance::Off | Enhance::Sharpen => None,
        }
    }
}

/// How a new frame rate is reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FpsMode {
    /// Duplicate or drop frames (fast, no new images).
    Retime,
    /// Motion-compensated interpolation: real new frames (slow).
    Interpolate,
}

/// Clips: real in-between frames made by RIFE (optical flow). Each level is a
/// different processing, not a different label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SmoothMotion {
    #[default]
    Off,
    /// Motion estimated at reduced resolution: fastest.
    Low,
    /// Full-resolution motion estimation.
    Medium,
    /// Full resolution plus a mirrored second pass averaged in (TTA): cleanest, ~2× slower.
    High,
}

/// Clips: dynamic range of the output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum HdrMode {
    /// Always SDR; HDR sources are tone mapped properly.
    Off,
    /// Keep HDR when the source is HDR, SDR otherwise.
    #[default]
    Auto,
    /// SDR sources become HDR10 (inverse tone mapping); HDR sources stay HDR.
    Enhanced,
}

/// Clips: simple colour adjustments, -100..100 (sharpness and glow 0..100). All 0 = untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Look {
    pub exposure: i8,
    pub contrast: i8,
    pub saturation: i8,
    pub sharpness: u8,
    /// Soft bloom around bright areas.
    pub glow: u8,
}

impl Look {
    /// No colour change (sharpness and glow are separate filters).
    pub fn is_neutral(&self) -> bool {
        self.exposure == 0 && self.contrast == 0 && self.saturation == 0
    }

    fn sanitized(self) -> Self {
        Self {
            exposure: self.exposure.clamp(-100, 100),
            contrast: self.contrast.clamp(-100, 100),
            saturation: self.saturation.clamp(-100, 100),
            sharpness: self.sharpness.min(100),
            glow: self.glow.min(100),
        }
    }
}

/// Clips: output frame shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum FrameFormat {
    #[default]
    Original,
    /// 16:9 (YouTube).
    Landscape,
    /// 9:16 (TikTok, Shorts, Reels).
    Portrait,
    /// 1:1.
    Square,
    /// 4:5 (Instagram feed).
    Feed,
}

impl FrameFormat {
    /// Width / height as a fraction, None = keep the source shape.
    pub fn ratio(self) -> Option<(u32, u32)> {
        match self {
            FrameFormat::Original => None,
            FrameFormat::Landscape => Some((16, 9)),
            FrameFormat::Portrait => Some((9, 16)),
            FrameFormat::Square => Some((1, 1)),
            FrameFormat::Feed => Some((4, 5)),
        }
    }
}

/// Smart Reframe: what the moving frame follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Focus {
    /// Subject for footage, Screen for screen recordings (detected per shot).
    #[default]
    Auto,
    /// What moves and stands out.
    Subject,
    /// Where things happen on a screen recording (cursor, changing panels, text).
    Screen,
    /// Fixed centre.
    Center,
}

/// Clips: playback speed over the clip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SpeedPreset {
    #[default]
    Normal,
    /// Whole clip at half speed.
    Slow,
    /// Whole clip at double speed.
    Fast,
    /// Normal, slows down on the middle, speeds up, back to normal.
    Ramp,
    /// The five points of `SpeedSettings::curve`.
    Custom,
}

/// Speed points of a custom ramp, evenly spread over the clip.
pub const SPEED_POINTS: usize = 5;
pub const SPEED_MIN: f32 = 0.25;
pub const SPEED_MAX: f32 = 4.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SpeedSettings {
    pub preset: SpeedPreset,
    /// Custom: speed at 0 %, 25 %, 50 %, 75 % and 100 % of the clip.
    pub curve: [f32; SPEED_POINTS],
}

impl Default for SpeedSettings {
    fn default() -> Self {
        Self { preset: SpeedPreset::Normal, curve: [1.0, 1.0, 0.5, 1.5, 1.0] }
    }
}

/// Clips: effects synchronised with the beat of the clip's music.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BeatSync {
    pub on: bool,
    /// Short zoom punch on each beat.
    pub zoom: bool,
    /// Short camera shake on strong beats.
    pub shake: bool,
}

impl Default for BeatSync {
    fn default() -> Self {
        Self { on: false, zoom: true, shake: false }
    }
}

/// Settings shared by GIFs and clips.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AnimSettings {
    /// 1.0 = original resolution.
    pub scale: f32,
    pub enhance: Enhance,
    pub style: Style,
    /// None = keep the original frame rate.
    pub fps: Option<f32>,
    /// GIFs: how a new frame rate is reached (clips use `smooth`).
    pub fps_mode: FpsMode,
    /// 0 = off, 1..=100 strength.
    pub motion_blur: u8,
    /// Clips only.
    pub smooth: SmoothMotion,
    /// Clips only.
    pub hdr: HdrMode,
    /// Clips only.
    pub look: Look,
    /// Clips: output shape.
    pub format: FrameFormat,
    /// Clips: follow the content when the shape changes (off = centred crop).
    pub reframe: bool,
    pub focus: Focus,
    /// Clips: speed changes.
    pub speed: SpeedSettings,
    /// Clips: colour LUT ("builtin:<id>" or "user:<file name>"), None = no LUT.
    pub lut: Option<String>,
    /// LUT strength, 0..=100.
    pub lut_strength: u8,
    /// Clips: effects on the beat.
    pub beat: BeatSync,
}

impl Default for AnimSettings {
    fn default() -> Self {
        Self {
            scale: 1.0,
            enhance: Enhance::Off,
            style: Style::ArtworkFast,
            fps: None,
            fps_mode: FpsMode::Retime,
            motion_blur: 0,
            smooth: SmoothMotion::Off,
            hdr: HdrMode::Auto,
            look: Look::default(),
            format: FrameFormat::Original,
            reframe: true,
            focus: Focus::Auto,
            speed: SpeedSettings::default(),
            lut: None,
            lut_strength: 100,
            beat: BeatSync::default(),
        }
    }
}

pub const ANIM_SCALES: [f32; 4] = [1.0, 1.6, 2.0, 4.0];
/// GIF delays are in 1/100 s: 50 FPS is the highest exact rate.
pub const GIF_FPS: [f32; 4] = [15.0, 24.0, 30.0, 50.0];
/// Above the source rate, only reachable with Smooth Motion (see the UI).
pub const CLIP_FPS: [f32; 5] = [24.0, 30.0, 48.0, 60.0, 120.0];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompressLevel {
    Best,
    Balanced,
    Small,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SizeUnit {
    Kb,
    Mb,
    Gb,
}

/// Output quality and optional file size limit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CompressSettings {
    pub level: CompressLevel,
    /// 1..=100, used when `level` is Custom.
    pub quality: u8,
    /// None = no limit.
    pub max_size: Option<f64>,
    pub unit: SizeUnit,
}

impl Default for CompressSettings {
    fn default() -> Self {
        Self { level: CompressLevel::Balanced, quality: 80, max_size: None, unit: SizeUnit::Mb }
    }
}

impl CompressSettings {
    /// 1..=100 quality the level stands for.
    pub fn quality(&self) -> u8 {
        match self.level {
            CompressLevel::Best => 95,
            CompressLevel::Balanced => 85,
            CompressLevel::Small => 70,
            CompressLevel::Custom => self.quality.clamp(1, 100),
        }
    }

    pub fn limit_bytes(&self) -> Option<u64> {
        let v = self.max_size.filter(|v| v.is_finite() && *v > 0.0)?;
        let mult = match self.unit {
            SizeUnit::Kb => 1024.0,
            SizeUnit::Mb => 1024.0 * 1024.0,
            SizeUnit::Gb => 1024.0 * 1024.0 * 1024.0,
        };
        Some((v * mult) as u64)
    }
}

/// What a GIF is converted to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GifOutput {
    /// H.264 MP4 video.
    Mp4,
    /// One PNG per frame in a folder.
    Frames,
}

/// Convert section: GIF -> video / frames, video -> GIF, images -> GIF.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConvertSettings {
    pub gif_output: GifOutput,
    /// Frame rate of GIFs made from a clip; None = keep the clip's.
    pub gif_fps: Option<f32>,
    /// Output width in pixels (height follows); None = original.
    pub width: Option<u32>,
    /// Images -> GIF: how long each image stays on screen.
    pub frame_ms: u32,
    pub compress: CompressSettings,
}

impl Default for ConvertSettings {
    fn default() -> Self {
        Self { gif_output: GifOutput::Mp4, gif_fps: Some(15.0), width: Some(480), frame_ms: 500, compress: CompressSettings::default() }
    }
}

pub const CONVERT_FPS: [f32; 4] = [10.0, 15.0, 24.0, 30.0];
pub const CONVERT_WIDTHS: [u32; 4] = [320, 480, 720, 1080];

/// Discord upload targets (support.discord.com: Custom Profiles, Server Banners).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiscordTarget {
    /// Square; Discord shows it as a circle. No official size: 512 px keeps it sharp.
    ProfilePicture,
    /// 680 x 240 minimum, PNG / JPG / animated GIF under 10 MB.
    ProfileBanner,
    /// 960 x 540 recommended, 16:9.
    ServerBanner,
}

/// Exact output size (cover + centred crop) and file size cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSpec {
    pub width: u32,
    pub height: u32,
    pub max_bytes: Option<u64>,
}

impl DiscordTarget {
    pub fn spec(self) -> TargetSpec {
        const MB: u64 = 1024 * 1024;
        match self {
            DiscordTarget::ProfilePicture => TargetSpec { width: 512, height: 512, max_bytes: Some(8 * MB) },
            DiscordTarget::ProfileBanner => TargetSpec { width: 680, height: 240, max_bytes: Some(10 * MB) },
            DiscordTarget::ServerBanner => TargetSpec { width: 960, height: 540, max_bytes: None },
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            DiscordTarget::ProfilePicture => "_discord-avatar",
            DiscordTarget::ProfileBanner => "_discord-banner",
            DiscordTarget::ServerBanner => "_discord-server-banner",
        }
    }
}

impl TargetSpec {
    /// Scale that makes a w x h source cover the target.
    pub fn cover_factor(&self, w: u32, h: u32) -> f64 {
        (self.width as f64 / w.max(1) as f64).max(self.height as f64 / h.max(1) as f64)
    }
}

/// Smallest native engine scale (1, 2, 4, 8) that reaches `factor`.
pub fn engine_scale_for(factor: f64) -> f32 {
    [1.0f32, 2.0, 4.0, 8.0].into_iter().find(|s| *s as f64 >= factor - 1e-6).unwrap_or(8.0)
}

/// Video encoder preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoEncoder {
    /// Hardware encoder when one works, otherwise x264.
    Auto,
    Cpu,
}

/// How much of the machine Aoze may use. Never changes the output itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceMode {
    /// Leaves headroom so the PC and the interface stay smooth.
    #[default]
    Balanced,
    /// Same resources as Balanced, slower but better video encoder presets.
    Quality,
    /// Uses everything available to finish sooner.
    Performance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PerformanceSettings {
    pub mode: PerformanceMode,
    /// Pick tiles, threads, memory use and priority from the detected hardware.
    pub auto_optimize: bool,
}

impl Default for PerformanceSettings {
    fn default() -> Self {
        Self { mode: PerformanceMode::Balanced, auto_optimize: true }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    System,
    En,
    Fr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub theme: Theme,
    pub language: Language,
    pub notifications: bool,
    /// Open the folder of the result when files are finished (one window per run).
    pub open_folder_when_done: bool,
    pub upscale: UpscaleParams,
    pub output: OutputOptions,
    /// Overrides the bundled engine directory (folder containing waifu2x-ncnn-vulkan.exe).
    pub engine_dir: Option<PathBuf>,
    pub keep_temp_files: bool,
    /// Logo and system-check sequence at launch.
    pub startup_animation: bool,
    /// Startup chime and welcome voice.
    pub startup_sound: bool,
    /// Soft sound when a run finishes (once per run, not per file).
    pub completion_sound: bool,
    /// Volume of Aoze's sounds, 0-100.
    pub sound_volume: u8,
    pub performance: PerformanceSettings,
    pub image_action: ImageAction,
    pub image_compress: CompressSettings,
    pub gif: AnimSettings,
    pub gif_compress: CompressSettings,
    pub clip: AnimSettings,
    pub clip_compress: CompressSettings,
    pub video_encoder: VideoEncoder,
    /// Image & GIF workspace: prepare for a Discord slot (None = off).
    pub discord: Option<DiscordTarget>,
    pub convert: ConvertSettings,
    /// Look for a new version on GitHub at launch.
    pub check_for_updates: bool,
    /// Version whose "What's new" was last shown (None: never, e.g. settings from 1.0.0).
    pub last_seen_release_notes: Option<String>,
    /// The first-launch tour was finished or skipped. Missing in settings from
    /// before it existed, so updated installs see it once too; a reinstall that
    /// deleted the app data shows it again.
    pub tutorial_done: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            theme: Theme::Dark,
            language: Language::System,
            notifications: true,
            open_folder_when_done: true,
            upscale: UpscaleParams::default(),
            output: OutputOptions::default(),
            engine_dir: None,
            keep_temp_files: false,
            startup_animation: true,
            startup_sound: true,
            completion_sound: true,
            sound_volume: 40,
            performance: PerformanceSettings::default(),
            image_action: ImageAction::Improve,
            image_compress: CompressSettings::default(),
            gif: AnimSettings::default(),
            gif_compress: CompressSettings { level: CompressLevel::Best, ..CompressSettings::default() },
            clip: AnimSettings::default(),
            clip_compress: CompressSettings::default(),
            video_encoder: VideoEncoder::Auto,
            discord: None,
            convert: ConvertSettings::default(),
            check_for_updates: true,
            last_seen_release_notes: None,
            tutorial_done: false,
        }
    }
}

impl Settings {
    /// Clamp every field to a valid value so a hand-edited or older file can
    /// never feed invalid arguments to the engine.
    pub fn sanitized(mut self) -> Self {
        self.version = SETTINGS_VERSION;
        let u = &mut self.upscale;
        if !SUPPORTED_SCALES.iter().any(|s| (s - u.scale).abs() < 1e-3) {
            u.scale = 2.0;
        }
        u.noise = u.noise.clamp(-1, 3);
        if u.tile_size != 0 {
            u.tile_size = u.tile_size.clamp(32, 4096);
        }
        u.threads.load = u.threads.load.clamp(1, 16);
        u.threads.proc = u.threads.proc.clamp(1, 16);
        u.threads.save = u.threads.save.clamp(1, 16);
        if let Some(g) = u.gpu {
            if g < -1 {
                u.gpu = None;
            }
        }
        self.output.quality = self.output.quality.clamp(1, 100);
        self.sound_volume = self.sound_volume.min(100);
        for (anim, fps_list) in [(&mut self.gif, &GIF_FPS[..]), (&mut self.clip, &CLIP_FPS[..])] {
            if !ANIM_SCALES.iter().any(|s| (s - anim.scale).abs() < 1e-3) {
                anim.scale = 1.0;
            }
            if let Some(f) = anim.fps {
                if !fps_list.iter().any(|x| (x - f).abs() < 1e-3) {
                    anim.fps = None;
                }
            }
            anim.motion_blur = anim.motion_blur.min(100);
            anim.look = anim.look.sanitized();
            anim.lut_strength = anim.lut_strength.min(100);
            if anim.lut.as_deref().is_some_and(|l| !crate::looks::valid_id(l)) {
                anim.lut = None;
            }
            for v in anim.speed.curve.iter_mut() {
                *v = if v.is_finite() { v.clamp(SPEED_MIN, SPEED_MAX) } else { 1.0 };
            }
        }
        // Clips used FFmpeg's motion interpolation before Smooth Motion existed.
        if self.clip.fps_mode == FpsMode::Interpolate {
            self.clip.fps_mode = FpsMode::Retime;
            if self.clip.smooth == SmoothMotion::Off {
                self.clip.smooth = SmoothMotion::Medium;
            }
        }
        let cv = &mut self.convert;
        if cv.gif_fps.is_some_and(|f| !CONVERT_FPS.iter().any(|x| (x - f).abs() < 1e-3)) {
            cv.gif_fps = Some(15.0);
        }
        if cv.width.is_some_and(|w| !CONVERT_WIDTHS.contains(&w)) {
            cv.width = None;
        }
        cv.frame_ms = cv.frame_ms.clamp(20, 10_000);
        for c in [&mut self.image_compress, &mut self.gif_compress, &mut self.clip_compress, &mut self.convert.compress] {
            c.quality = c.quality.clamp(1, 100);
            if c.max_size.is_some_and(|v| !v.is_finite() || v <= 0.0) {
                c.max_size = None;
            }
        }
        if self.output.suffix.trim().is_empty() && self.output.directory.is_none() {
            // An empty suffix next to the source would target the source itself.
            self.output.suffix = DEFAULT_SUFFIX.into();
        }
        self
    }

    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(text) => match serde_json::from_str::<Settings>(&text) {
                Ok(s) => s.sanitized(),
                Err(e) => {
                    log::warn!("settings file is invalid, using defaults: {e}");
                    Settings::default()
                }
            },
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        write_json_atomic(path, self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_uses_defaults_for_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"theme":"light","upscale":{"scale":4}}"#).unwrap();
        let s = s.sanitized();
        assert_eq!(s.theme, Theme::Light);
        assert_eq!(s.upscale.scale, 4.0);
        assert_eq!(s.upscale.noise, 1);
        assert_eq!(s.output.format, OutputFormat::Png);
    }

    #[test]
    fn sanitize_clamps_invalid_values() {
        let mut s = Settings::default();
        s.upscale.scale = 3.0;
        s.upscale.noise = 9;
        s.upscale.tile_size = 5;
        s.output.quality = 0;
        s.output.suffix = "  ".into();
        let s = s.sanitized();
        assert_eq!(s.upscale.scale, 2.0);
        assert_eq!(s.upscale.noise, 3);
        assert_eq!(s.upscale.tile_size, 32);
        assert_eq!(s.output.quality, 1);
        assert_eq!(s.output.suffix, DEFAULT_SUFFIX);
    }

    #[test]
    fn older_files_get_new_defaults_and_invalid_values_are_reset() {
        let s: Settings = serde_json::from_str(
            r#"{"theme":"dark","clip":{"scale":3,"fps":61,"motionBlur":200},"gifCompress":{"maxSize":-1}}"#,
        )
        .unwrap();
        let s = s.sanitized();
        assert!(s.startup_sound);
        assert_eq!(s.image_action, ImageAction::Improve);
        assert_eq!((s.clip.scale, s.clip.fps, s.clip.motion_blur), (1.0, None, 100));
        assert_eq!(s.gif_compress.max_size, None);
    }

    #[test]
    fn discord_targets() {
        let b = DiscordTarget::ProfileBanner.spec();
        assert_eq!((b.width, b.height, b.max_bytes), (680, 240, Some(10 * 1024 * 1024)));
        assert_eq!(DiscordTarget::ServerBanner.spec().width, 960);
        // A 400x300 picture must be enlarged 1.7x to cover 680x240 -> engine 2x.
        assert!((b.cover_factor(400, 300) - 1.7).abs() < 1e-9);
        assert_eq!(engine_scale_for(1.7), 2.0);
        assert_eq!(engine_scale_for(0.5), 1.0);
        assert_eq!(engine_scale_for(3.0), 4.0);
    }

    #[test]
    fn size_limits() {
        let c = CompressSettings { max_size: Some(5.0), unit: SizeUnit::Mb, ..CompressSettings::default() };
        assert_eq!(c.limit_bytes(), Some(5 * 1024 * 1024));
        let c = CompressSettings { max_size: Some(500.0), unit: SizeUnit::Kb, ..c };
        assert_eq!(c.limit_bytes(), Some(500 * 1024));
        assert_eq!(CompressSettings::default().limit_bytes(), None);
    }

    #[test]
    fn roundtrip_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let s = Settings { language: Language::Fr, ..Settings::default() };
        s.save(&path).unwrap();
        assert_eq!(Settings::load(&path), s);
    }
}
