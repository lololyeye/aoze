use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::fsutil::write_json_atomic;
use crate::media::MediaKind;
use crate::settings::{OutputFormat, UpscaleParams};

const MAX_ENTRIES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub finished_at: u64,
    pub source_path: PathBuf,
    #[serde(default)]
    pub kind: MediaKind,
    pub output_path: PathBuf,
    pub source_width: u32,
    pub source_height: u32,
    pub source_bytes: u64,
    pub output_width: u32,
    pub output_height: u32,
    pub output_bytes: u64,
    pub duration_ms: u64,
    pub params: UpscaleParams,
    pub format: OutputFormat,
}

pub struct HistoryStore {
    path: PathBuf,
    entries: Mutex<Vec<HistoryEntry>>,
}

impl HistoryStore {
    pub fn load(path: &Path) -> Self {
        let entries = std::fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<HistoryEntry>>(&t).ok())
            .unwrap_or_default();
        Self { path: path.to_path_buf(), entries: Mutex::new(entries) }
    }

    /// Newest first.
    pub fn list(&self) -> Vec<HistoryEntry> {
        self.entries.lock().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<HistoryEntry> {
        self.entries.lock().unwrap().iter().find(|e| e.id == id).cloned()
    }

    pub fn contains_path(&self, path: &Path) -> bool {
        self.entries.lock().unwrap().iter().any(|e| e.output_path == path || e.source_path == path)
    }

    pub fn push(&self, entry: HistoryEntry) {
        let mut entries = self.entries.lock().unwrap();
        entries.insert(0, entry);
        entries.truncate(MAX_ENTRIES);
        self.persist(&entries);
    }

    pub fn remove(&self, id: &str) {
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|e| e.id != id);
        self.persist(&entries);
    }

    pub fn clear(&self) {
        let mut entries = self.entries.lock().unwrap();
        entries.clear();
        self.persist(&entries);
    }

    fn persist(&self, entries: &[HistoryEntry]) {
        if let Err(e) = write_json_atomic(&self.path, &entries) {
            log::warn!("could not save history: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            finished_at: 1,
            source_path: "a.png".into(),
            kind: MediaKind::Image,
            output_path: format!("{id}.png").into(),
            source_width: 1,
            source_height: 1,
            source_bytes: 1,
            output_width: 2,
            output_height: 2,
            output_bytes: 2,
            duration_ms: 10,
            params: UpscaleParams::default(),
            format: OutputFormat::Png,
        }
    }

    #[test]
    fn persists_newest_first_and_caps() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = HistoryStore::load(&path);
        for i in 0..(MAX_ENTRIES + 5) {
            store.push(entry(&i.to_string()));
        }
        store.remove("504");
        let reloaded = HistoryStore::load(&path).list();
        assert_eq!(reloaded.len(), MAX_ENTRIES - 1);
        assert_eq!(reloaded[0].id, "503");
        store.clear();
        assert!(HistoryStore::load(&path).list().is_empty());
    }
}
