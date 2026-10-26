//! Updates from Aoze's GitHub releases.
//!
//! The update manifest (`latest.json`, written by `npm run release`) is read from the URL in
//! tauri.conf.json (`plugins.updater.endpoints`). An update is installed only if:
//! - its installer comes from the official release downloads (`DOWNLOAD_PREFIX`);
//! - its minisign signature matches the public key built into Aoze, and the version it was
//!   signed for is the version announced (checked by tauri-plugin-updater);
//! - its SHA-256 and size match the manifest.
//!
//! The verified installer is kept in the cache folder, so a postponed update is not downloaded
//! twice. Nothing of the current installation is touched until the installer runs: it then
//! installs over it in passive mode (progress only), and reopens Aoze.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::core::Core;

/// The only place installers are downloaded from.
const DOWNLOAD_PREFIX: &str = "https://github.com/lololyeye/aoze/releases/download/";
/// Platform key of the Windows installer in latest.json.
const PLATFORM: &str = "windows-x86_64";
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub date: Option<String>,
    /// Structured notes of the new version (docs/release-notes/v<version>.json), or null.
    pub notes: serde_json::Value,
    pub size: Option<u64>,
    /// The installer was already downloaded and verified.
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    received: u64,
    total: Option<u64>,
}

/// Why an update step failed, in terms the interface can explain.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateErrorKind {
    /// GitHub could not be reached or the download broke off.
    Network,
    /// The installer did not match its signature, SHA-256 or size, or came from elsewhere.
    Integrity,
    /// The installer could not be stored or started.
    Disk,
    /// A file is being processed: installing would stop it.
    Busy,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateError {
    pub kind: UpdateErrorKind,
    pub detail: String,
}

impl UpdateError {
    fn new(kind: UpdateErrorKind, detail: impl Into<String>) -> Self {
        Self { kind, detail: detail.into() }
    }
}

impl From<tauri_plugin_updater::Error> for UpdateError {
    fn from(e: tauri_plugin_updater::Error) -> Self {
        use tauri_plugin_updater::Error as E;
        let kind = match &e {
            E::Reqwest(_) | E::Network(_) | E::ReleaseNotFound => UpdateErrorKind::Network,
            E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => {
                UpdateErrorKind::Integrity
            }
            E::Io(_) => UpdateErrorKind::Disk,
            _ => UpdateErrorKind::Other,
        };
        Self::new(kind, e.to_string())
    }
}

impl From<std::io::Error> for UpdateError {
    fn from(e: std::io::Error) -> Self {
        Self::new(UpdateErrorKind::Disk, e.to_string())
    }
}

type UpdateResult<T> = Result<T, UpdateError>;

#[derive(Default)]
struct Inner {
    update: Option<Update>,
    /// Verified installer, ready to run.
    ready: Option<PathBuf>,
    download: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Bumped by every download and cancel: a download that finishes after being cancelled
    /// (its last step, the checks, cannot be interrupted) sees it and throws its file away.
    generation: u64,
}

#[derive(Default)]
pub struct UpdateState(Arc<Mutex<Inner>>);

/// Expected SHA-256 (lowercase hex) and size of the installer, from latest.json.
fn expected(update: &Update) -> UpdateResult<(String, Option<u64>)> {
    let entry = &update.raw_json["platforms"][PLATFORM];
    let sha = entry["sha256"].as_str().map(str::to_ascii_lowercase).filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()));
    let Some(sha) = sha else {
        return Err(UpdateError::new(UpdateErrorKind::Integrity, "the update manifest has no SHA-256 for the installer"));
    };
    Ok((sha, entry["size"].as_u64()))
}

fn allowed_url(url: &str) -> bool {
    // Debug builds may test the whole flow against a local server.
    url.starts_with(DOWNLOAD_PREFIX) || (cfg!(debug_assertions) && url.starts_with("http://127.0.0.1:"))
}

/// `Aoze_<version>_x64-setup.exe`, taken from the URL and checked, so it is a plain file name.
fn installer_name(update: &Update) -> UpdateResult<String> {
    let name = update.download_url.path_segments().and_then(|mut s| s.next_back()).unwrap_or_default().to_string();
    if name != format!("Aoze_{}_x64-setup.exe", update.version) {
        return Err(UpdateError::new(UpdateErrorKind::Integrity, format!("unexpected installer name {name:?}")));
    }
    Ok(name)
}

fn updates_dir(app: &AppHandle) -> PathBuf {
    app.state::<Arc<Core>>().paths.cache_dir.join("updates")
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Checks downloaded bytes against the manifest (the signature is checked by the plugin).
fn check_bytes(update: &Update, bytes: &[u8]) -> UpdateResult<()> {
    let (sha, size) = expected(update)?;
    if size.is_some_and(|s| s != bytes.len() as u64) {
        return Err(UpdateError::new(UpdateErrorKind::Integrity, format!("size {} instead of {}", bytes.len(), size.unwrap_or(0))));
    }
    if sha256_hex(bytes) != sha {
        return Err(UpdateError::new(UpdateErrorKind::Integrity, "SHA-256 does not match the release"));
    }
    Ok(())
}

/// A previously downloaded installer for this update, if it still checks out.
fn cached(update: &Update, path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else { return false };
    let ok = check_bytes(update, &bytes).is_ok() && update.verify(&bytes).is_ok();
    if !ok {
        log::warn!("discarding cached installer {}", path.display());
        let _ = std::fs::remove_file(path);
    }
    ok
}

/// Removes installers other than `keep` (older updates, interrupted downloads).
fn clean_dir(dir: &Path, keep: Option<&str>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if keep.is_some_and(|k| e.file_name().to_string_lossy() == k) {
            continue;
        }
        let _ = std::fs::remove_file(e.path());
    }
}

/// Is a newer version out? `None` when Aoze is up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, UpdateState>) -> Result<Option<UpdateInfo>, UpdateError> {
    let updater = app.updater_builder().timeout(TIMEOUT).build()?;
    let found = updater.check().await?;
    let dir = updates_dir(&app);
    let Some(update) = found else {
        // Up to date: whatever is cached is an installed or older version.
        clean_dir(&dir, None);
        return Ok(None);
    };
    if !allowed_url(update.download_url.as_str()) {
        return Err(UpdateError::new(UpdateErrorKind::Integrity, format!("refusing to download from {}", update.download_url)));
    }
    let name = installer_name(&update)?;
    let (_, size) = expected(&update)?;
    clean_dir(&dir, Some(&name));
    let path = dir.join(&name);
    let downloaded = {
        let u = update.clone();
        let p = path.clone();
        tokio::task::spawn_blocking(move || cached(&u, &p)).await.unwrap_or(false)
    };
    log::info!("update available: {} -> {}{}", update.current_version, update.version, if downloaded { " (already downloaded)" } else { "" });
    let info = UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        date: update.raw_json["pub_date"].as_str().map(str::to_string),
        notes: update.raw_json.get("releaseNotes").cloned().unwrap_or(serde_json::Value::Null),
        size,
        downloaded,
    };
    let mut inner = state.0.lock().unwrap();
    if let Some(task) = inner.download.take() {
        task.abort();
    }
    inner.generation += 1;
    inner.ready = downloaded.then_some(path);
    inner.update = Some(update);
    Ok(Some(info))
}

/// Starts downloading the update found by `update_check`. Reports `update://progress`, then
/// `update://ready` or `update://failed`.
#[tauri::command]
pub async fn update_download(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), UpdateError> {
    let mut inner = state.0.lock().unwrap();
    let Some(update) = inner.update.clone() else {
        return Err(UpdateError::new(UpdateErrorKind::Other, "no update to download"));
    };
    if inner.ready.is_some() {
        let _ = app.emit("update://ready", ());
        return Ok(());
    }
    if inner.download.as_ref().is_some_and(|t| !t.inner().is_finished()) {
        return Ok(());
    }
    inner.generation += 1;
    let generation = inner.generation;
    let shared = state.0.clone();
    let task = tauri::async_runtime::spawn(async move {
        let result = download(&app, &update, &shared, generation).await;
        let mut inner = shared.lock().unwrap();
        if inner.generation != generation {
            // Cancelled while the download was being checked.
            if let Ok(path) = result {
                let _ = std::fs::remove_file(path);
            }
            return;
        }
        match result {
            Ok(path) => {
                inner.ready = Some(path);
                let _ = app.emit("update://ready", ());
            }
            Err(e) => {
                log::warn!("update download failed: {}", e.detail);
                let _ = app.emit("update://failed", e);
            }
        }
    });
    inner.download = Some(task);
    Ok(())
}

async fn download(app: &AppHandle, update: &Update, shared: &Arc<Mutex<Inner>>, generation: u64) -> UpdateResult<PathBuf> {
    let name = installer_name(update)?;
    let (_, size) = expected(update)?;
    let mut received = 0u64;
    let mut last = Instant::now();
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if last.elapsed() >= Duration::from_millis(100) {
                    last = Instant::now();
                    let _ = app.emit("update://progress", Progress { received, total: total.or(size) });
                }
            },
            || {},
        )
        .await?;
    let _ = app.emit("update://progress", Progress { received: bytes.len() as u64, total: Some(bytes.len() as u64) });
    let path = updates_dir(app).join(name);
    let (u, p, shared) = (update.clone(), path.clone(), shared.clone());
    // Runs to its end even if the download is cancelled meanwhile (blocking work cannot be
    // interrupted), so it checks for that itself and leaves no file behind.
    tokio::task::spawn_blocking(move || {
        check_bytes(&u, &bytes)?;
        crate::fsutil::write_atomic(&p, &bytes).map_err(|e| UpdateError::new(UpdateErrorKind::Disk, e.detail))?;
        if shared.lock().unwrap().generation != generation {
            let _ = std::fs::remove_file(&p);
            return Err(UpdateError::new(UpdateErrorKind::Other, "cancelled"));
        }
        Ok(())
    })
    .await
    .map_err(|e| UpdateError::new(UpdateErrorKind::Other, e.to_string()))??;
    log::info!("update {} downloaded and verified", update.version);
    Ok(path)
}

/// Stops a download in progress. The current version is untouched.
#[tauri::command]
pub fn update_cancel(state: State<'_, UpdateState>) {
    let mut inner = state.0.lock().unwrap();
    inner.generation += 1;
    if let Some(task) = inner.download.take() {
        task.abort();
        log::info!("update download cancelled");
    }
}

/// Runs the verified installer and closes Aoze; the installer reopens it once done.
#[tauri::command]
pub async fn update_install(state: State<'_, UpdateState>, core: State<'_, Arc<Core>>) -> Result<(), UpdateError> {
    if core.is_processing() {
        return Err(UpdateError::new(UpdateErrorKind::Busy, "a file is being processed"));
    }
    let (update, path) = {
        let inner = state.0.lock().unwrap();
        match (inner.update.clone(), inner.ready.clone()) {
            (Some(u), Some(p)) => (u, p),
            _ => return Err(UpdateError::new(UpdateErrorKind::Other, "the update is not downloaded")),
        }
    };
    let bytes = tokio::fs::read(&path).await?;
    // Checked again right before running it: the file sat in the cache folder.
    check_bytes(&update, &bytes)?;
    log::info!("installing update {}", update.version);
    // Verifies the signature once more, starts the installer and exits on success.
    update.install(bytes)?;
    Ok(())
}
