use serde::Serialize;

/// Stable error codes. The frontend maps each code to a localized, human
/// explanation (title, possible causes, suggested fix); `detail` carries the
/// technical message for the logs and the diagnostics panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    EngineMissing,
    ModelMissing,
    VulkanUnavailable,
    GpuInvalid,
    GpuOutOfMemory,
    /// VK_ERROR_DEVICE_LOST and other failed GPU submissions (driver timeout, VRAM pressure).
    GpuDeviceLost,
    EngineFailed,
    DecodeFailed,
    EncodeFailed,
    UnsupportedFormat,
    /// The bundled FFmpeg (GIF / clip support) is missing.
    FfmpegMissing,
    /// FFmpeg failed while decoding, filtering or encoding a GIF or clip.
    MediaFailed,
    FileNotFound,
    OutputUnwritable,
    InvalidParams,
    Cancelled,
    Io,
    Internal,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{code:?}: {detail}")]
pub struct AppError {
    pub code: ErrorCode,
    pub detail: String,
}

impl AppError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorCode::Cancelled, "cancelled by user")
    }

    pub fn is_cancelled(&self) -> bool {
        self.code == ErrorCode::Cancelled
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::FileNotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::OutputUnwritable,
            _ => ErrorCode::Io,
        };
        Self::new(code, e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
