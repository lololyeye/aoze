// Mirrors of the structs serialised by the Rust backend (camelCase).

export type Style = "artwork" | "artworkFast" | "photo";
export type OutputFormat = "png" | "jpeg" | "webp";
export type ConflictPolicy = "rename" | "overwrite" | "skip";
export type Theme = "system" | "dark" | "light";
export type Language = "system" | "en" | "fr";
export type MediaKind = "image" | "gif" | "video";
export type ImageAction = "improve" | "compress" | "both";
export type Enhance = "off" | "sharpen" | "light" | "medium" | "strong";
export type FpsMode = "retime" | "interpolate";
export type CompressLevel = "best" | "balanced" | "small" | "custom";
export type SizeUnit = "kb" | "mb" | "gb";
export type VideoEncoder = "auto" | "cpu";
export type HwEncoder = "nvenc" | "amf" | "qsv";
export type DiscordTarget = "profilePicture" | "profileBanner" | "serverBanner";
export type GifOutput = "mp4" | "frames";
export type Purpose = "process" | "convert";
export type Conversion = "clipToGif" | "gifToMp4" | "gifToFrames" | "imagesToGif";

export interface ConvertSettings {
  gifOutput: GifOutput;
  /** null = keep the clip's frame rate */
  gifFps: number | null;
  /** null = original width */
  width: number | null;
  frameMs: number;
  compress: CompressSettings;
}

export type SmoothMotion = "off" | "low" | "medium" | "high";
export type HdrMode = "off" | "auto" | "enhanced";
export type Transfer = "sdr" | "pq" | "hlg";

/** Clip colour adjustments: -100..100, sharpness and glow 0..100. */
export interface Look {
  exposure: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  glow: number;
}

/** Output shape of a clip. */
export type FrameFormat = "original" | "landscape" | "portrait" | "square" | "feed";
/** What Smart Reframe follows. */
export type Focus = "auto" | "subject" | "screen" | "center";
export type SpeedPreset = "normal" | "slow" | "fast" | "ramp" | "custom";

export interface SpeedSettings {
  preset: SpeedPreset;
  /** Custom: speed at 0, 25, 50, 75 and 100 % of the clip (0.25..4). */
  curve: number[];
}

export interface BeatSync {
  on: boolean;
  zoom: boolean;
  shake: boolean;
}

/** A colour look: built-in, or a .cube LUT the user imported. */
export interface LutInfo {
  id: string;
  name: string;
  builtin: boolean;
}

export interface AnimSettings {
  scale: number;
  enhance: Enhance;
  style: Style;
  /** null = original frame rate */
  fps: number | null;
  /** GIFs only; clips use `smooth`. */
  fpsMode: FpsMode;
  /** 0 = off, 1..100 */
  motionBlur: number;
  /** Clips: RIFE in-between frames. */
  smooth: SmoothMotion;
  hdr: HdrMode;
  look: Look;
  format: FrameFormat;
  /** Follow the content when the shape changes (off = centred crop). */
  reframe: boolean;
  focus: Focus;
  speed: SpeedSettings;
  /** "builtin:<id>" or "user:<file>", null = none. */
  lut: string | null;
  lutStrength: number;
  beat: BeatSync;
}

export interface CompressSettings {
  level: CompressLevel;
  quality: number;
  /** null = no limit */
  maxSize: number | null;
  unit: SizeUnit;
}

export interface CompressReport {
  limitBytes: number | null;
  met: boolean;
  quality: number | null;
  scale: number;
  bytes: number;
}

export interface MediaInfo {
  width: number;
  height: number;
  fps: number;
  fpsRational: string;
  frames: number;
  durationMs: number;
  codec: string;
  hasAudio: boolean;
  audioCodec: string | null;
  sizeBytes: number;
  container: string;
  pixFmt: string;
  rotation: number;
  /** The webview plays the file itself (otherwise a preview copy is made). */
  playable: boolean;
  transfer: Transfer;
  colorMatrix: string;
}

export interface Threads {
  load: number;
  proc: number;
  save: number;
}

export interface UpscaleParams {
  style: Style;
  scale: number;
  noise: number;
  /** null = auto, -1 = CPU, n = Vulkan device index */
  gpu: number | null;
  tileSize: number;
  tta: boolean;
  threads: Threads;
}

export interface OutputOptions {
  format: OutputFormat;
  quality: number;
  webpLossless: boolean;
  directory: string | null;
  suffix: string;
  conflict: ConflictPolicy;
}

export type PerformanceMode = "balanced" | "quality" | "performance";

export interface PerformanceSettings {
  mode: PerformanceMode;
  autoOptimize: boolean;
}

export interface Settings {
  version: number;
  theme: Theme;
  language: Language;
  notifications: boolean;
  openFolderWhenDone: boolean;
  upscale: UpscaleParams;
  output: OutputOptions;
  engineDir: string | null;
  keepTempFiles: boolean;
  startupAnimation: boolean;
  startupSound: boolean;
  completionSound: boolean;
  /** 0-100, for every Aoze sound. */
  soundVolume: number;
  performance: PerformanceSettings;
  imageAction: ImageAction;
  imageCompress: CompressSettings;
  gif: AnimSettings;
  gifCompress: CompressSettings;
  clip: AnimSettings;
  clipCompress: CompressSettings;
  videoEncoder: VideoEncoder;
  discord: DiscordTarget | null;
  convert: ConvertSettings;
  /** Look for a new version on GitHub at launch. */
  checkForUpdates: boolean;
  /** Version whose "What's new" was last shown. */
  lastSeenReleaseNotes: string | null;
  /** The first-launch tour was finished or skipped. */
  tutorialDone: boolean;
}

export interface ModelCapabilities {
  style: Style;
  dir: string;
  installed: boolean;
  scale2: boolean;
  noiseScale2: [boolean, boolean, boolean, boolean];
  noiseScale1: [boolean, boolean, boolean, boolean];
  sizeBytes: number;
}

export interface EngineStatus {
  id: string;
  name: string;
  found: boolean;
  dir: string;
  version: string | null;
  models: ModelCapabilities[];
}

export type GpuKind = "discrete" | "integrated" | "virtual" | "cpu" | "other";

export interface GpuInfo {
  index: number;
  name: string;
  kind: GpuKind;
  vramBytes: number;
  apiVersion: string;
  driverVersion: string;
  vendorId: number;
}

export interface VulkanStatus {
  available: boolean;
  instanceVersion: string | null;
  gpus: GpuInfo[];
  defaultGpu: number | null;
  error: string | null;
}

export interface FfmpegStatus {
  found: boolean;
  version: string | null;
  dir: string;
  encoders: HwEncoder[];
  detected: boolean;
}

export interface SystemStatus {
  appVersion: string;
  engine: EngineStatus;
  vulkan: VulkanStatus;
  ffmpeg: FfmpegStatus;
  /** Smooth Motion engine installed. */
  smoothMotion: boolean;
}

export type ErrorCode =
  | "engineMissing"
  | "modelMissing"
  | "vulkanUnavailable"
  | "gpuInvalid"
  | "gpuOutOfMemory"
  | "gpuDeviceLost"
  | "ffmpegMissing"
  | "mediaFailed"
  | "engineFailed"
  | "decodeFailed"
  | "encodeFailed"
  | "unsupportedFormat"
  | "fileNotFound"
  | "outputUnwritable"
  | "invalidParams"
  | "cancelled"
  | "io"
  | "internal";

export interface AppError {
  code: ErrorCode;
  detail: string;
}

export interface ImageInfo {
  width: number;
  height: number;
  sizeBytes: number;
  format: string;
}

export type JobStatus = "idle" | "waiting" | "processing" | "completed" | "failed" | "cancelled" | "skipped";
export type Stage = "preparing" | "extracting" | "initializing" | "upscaling" | "interpolating" | "encoding";

export interface SourceFile {
  path: string;
  name: string;
  kind: MediaKind;
  info: ImageInfo;
  media: MediaInfo | null;
  thumb: string | null;
  preview: string | null;
}

export interface JobResult {
  outputPath: string;
  info: ImageInfo;
  durationMs: number;
  preview: string | null;
  compression: CompressReport | null;
  media: MediaInfo | null;
  /** Notes on the result ("beatNotFound", "beat:128", ...). */
  notices?: string[];
  /** Speed changes: [result time, original time] pairs (seconds). */
  timing?: [number, number][];
}

export interface CompressPlan {
  quality: number;
  limit: number | null;
}

export interface TaskSettings {
  action: ImageAction;
  compress: CompressSettings;
  compressPlan: CompressPlan | null;
  anim: AnimSettings | null;
  encoder: HwEncoder | null;
  discord: DiscordTarget | null;
  convert: { conversion: Conversion; settings: ConvertSettings; images: string[] } | null;
}

export interface Job {
  id: string;
  purpose: Purpose;
  source: SourceFile;
  params: UpscaleParams | null;
  output: OutputOptions | null;
  task: TaskSettings | null;
  status: JobStatus;
  stage: Stage | null;
  progress: number;
  estimatedMs: number | null;
  estimateMeasured: boolean;
  addedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result: JobResult | null;
  skippedPath: string | null;
  error: AppError | null;
}

export interface QueueSnapshot {
  jobs: Job[];
  paused: boolean;
  activeJob: string | null;
}

export interface ProgressEvent {
  id: string;
  stage: Stage;
  progress: number;
  elapsedMs: number;
  remainingMs: number | null;
  queueRemainingMs: number | null;
  measured: boolean;
  detail: ProgressDetail | null;
}

export type ProgressDetail =
  | { type: "frames"; done: number; total: number }
  | { type: "time"; doneMs: number; totalMs: number };

export interface BatchSummary {
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  lastOutput: string | null;
}

export interface Rejected {
  path: string;
  error: AppError;
}

export interface AddResult {
  added: string[];
  rejected: Rejected[];
}

export interface HistoryEntry {
  id: string;
  finishedAt: number;
  sourcePath: string;
  kind: MediaKind;
  outputPath: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceBytes: number;
  outputWidth: number;
  outputHeight: number;
  outputBytes: number;
  durationMs: number;
  params: UpscaleParams;
  format: OutputFormat;
}

export type Tier = "low" | "medium" | "high";

export interface Hardware {
  cpuThreads: number;
  ramTotalBytes: number;
  ramAvailableBytes: number;
  gpuName: string | null;
  gpuKind: GpuKind | null;
  vramBytes: number;
  simulated: boolean;
}

export interface Profile {
  hardware: Hardware;
  gpu: Tier;
  memory: Tier;
  cpu: Tier;
}

export interface Tuning {
  tileSize: number;
  threads: Threads;
  blockBytes: number;
  backgroundPriority: boolean;
  qualityPresets: boolean;
  automatic: boolean;
}

export interface SystemCheck {
  profile: Profile | null;
  tuning: Tuning;
}

/* ---------- Updates ---------- */

/** One language of docs/release-notes/v<version>.json. */
export interface ReleaseNotesBody {
  summary?: string;
  /** New features. */
  changes: string[];
  improvements: string[];
  fixes: string[];
}

export interface ReleaseNotes {
  version: string;
  date: string;
  en: ReleaseNotesBody;
  fr?: ReleaseNotesBody;
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date: string | null;
  notes: ReleaseNotes | null;
  size: number | null;
  /** Already downloaded and verified. */
  downloaded: boolean;
}

export type UpdateErrorKind = "network" | "integrity" | "disk" | "busy" | "other";

export interface UpdateError {
  kind: UpdateErrorKind;
  detail: string;
}

export interface UpdateProgress {
  received: number;
  total: number | null;
}
