use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::error::{AppError, AppResult, ErrorCode};

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Write a file next to its destination, then rename over it, so a crash never
/// leaves a truncated settings/history file behind.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = sibling_temp(path);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::from(e)
    })
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))?;
    write_atomic(path, &bytes)
}

/// `dir/name.ext` -> `dir/.name.ext.<uuid>.tmp`
pub fn sibling_temp(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple());
    path.with_file_name(tmp)
}

pub fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

pub fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn extension_lower(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}
