//! Persisted list of recently opened project files.
//!
//! The list is stored as `recent_projects.json` in the application's data
//! directory and capped at [`MAX_RECENT`] entries with most-recently-used
//! ordering (index 0 = most recent).

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Maximum number of recent project entries to retain.
const MAX_RECENT: usize = 10;

/// Filename inside `app_data_dir` used to persist the list.
const RECENT_FILE: &str = "recent_projects.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Metadata for a single entry in the recent projects list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecentProject {
    /// Display name of the project (stored at save time).
    pub name: String,
    /// Absolute path to the `.mapp` file on disk.
    pub file_path: String,
    /// UTC timestamp of the last time this project was saved.
    pub modified_at: DateTime<Utc>,
}

/// In-memory representation of the full recent-projects list.
///
/// The list is always maintained in most-recently-used order: index 0 is the
/// file opened/saved most recently.  The list is capped at [`MAX_RECENT`].
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RecentProjectsList {
    entries: Vec<RecentProject>,
}

impl RecentProjectsList {
    /// Inserts `project` at the front of the list, deduplicating by path.
    ///
    /// If an entry with the same `file_path` already exists it is removed
    /// before the new entry is prepended, so there are never duplicates.
    /// Entries beyond [`MAX_RECENT`] are dropped.
    fn push(&mut self, project: RecentProject) {
        // Remove any existing entry with the same path.
        self.entries
            .retain(|e| e.file_path != project.file_path);

        self.entries.insert(0, project);
        self.entries.truncate(MAX_RECENT);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Returns the current list of recent projects, most-recently-used first.
///
/// Returns an empty list if `recent_projects.json` does not exist or cannot be
/// parsed — this is treated as a non-error condition (fresh install, etc.).
pub fn load_recent(app_data_dir: &Path) -> Result<Vec<RecentProject>> {
    let path = app_data_dir.join(RECENT_FILE);

    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {:?}", path))?;

    let list: RecentProjectsList =
        serde_json::from_str(&data).unwrap_or_else(|e| {
            log::warn!("Failed to parse recent_projects.json, resetting: {}", e);
            RecentProjectsList::default()
        });

    Ok(list.entries)
}

/// Adds `project` to the front of the recent projects list and persists it.
///
/// The list is loaded from disk, updated in memory, capped at [`MAX_RECENT`],
/// and written back atomically.
pub fn add_recent(app_data_dir: &Path, project: RecentProject) -> Result<()> {
    fs::create_dir_all(app_data_dir)
        .with_context(|| format!("Failed to create app data directory {:?}", app_data_dir))?;

    let path = app_data_dir.join(RECENT_FILE);

    // Load existing list (ignore parse errors — start fresh if corrupt).
    let mut list = if path.exists() {
        let data = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read {:?}", path))?;
        serde_json::from_str::<RecentProjectsList>(&data).unwrap_or_default()
    } else {
        RecentProjectsList::default()
    };

    list.push(project);

    let json = serde_json::to_string_pretty(&list)
        .context("Failed to serialize recent projects list")?;

    // Write to a temp file then rename for atomicity.
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &json)
        .with_context(|| format!("Failed to write {:?}", tmp))?;
    fs::rename(&tmp, &path)
        .with_context(|| format!("Failed to rename {:?} → {:?}", tmp, path))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_entry(name: &str, path: &str) -> RecentProject {
        RecentProject {
            name: name.to_string(),
            file_path: path.to_string(),
            modified_at: Utc::now(),
        }
    }

    #[test]
    fn load_returns_empty_when_file_missing() {
        let tmp = TempDir::new().unwrap();
        let result = load_recent(tmp.path()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn add_and_load_single_entry() {
        let tmp = TempDir::new().unwrap();
        let entry = make_entry("My Song", "/projects/my_song.mapp");
        add_recent(tmp.path(), entry.clone()).unwrap();

        let list = load_recent(tmp.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "My Song");
        assert_eq!(list[0].file_path, "/projects/my_song.mapp");
    }

    #[test]
    fn most_recently_added_is_first() {
        let tmp = TempDir::new().unwrap();

        add_recent(tmp.path(), make_entry("Song A", "/a.mapp")).unwrap();
        add_recent(tmp.path(), make_entry("Song B", "/b.mapp")).unwrap();
        add_recent(tmp.path(), make_entry("Song C", "/c.mapp")).unwrap();

        let list = load_recent(tmp.path()).unwrap();
        assert_eq!(list[0].name, "Song C");
        assert_eq!(list[1].name, "Song B");
        assert_eq!(list[2].name, "Song A");
    }

    #[test]
    fn duplicate_path_is_deduplicated_and_moved_to_front() {
        let tmp = TempDir::new().unwrap();

        add_recent(tmp.path(), make_entry("Song A", "/a.mapp")).unwrap();
        add_recent(tmp.path(), make_entry("Song B", "/b.mapp")).unwrap();
        // Re-open "Song A" — it should jump to the front.
        add_recent(tmp.path(), make_entry("Song A v2", "/a.mapp")).unwrap();

        let list = load_recent(tmp.path()).unwrap();
        assert_eq!(list.len(), 2, "no duplicates allowed");
        assert_eq!(list[0].file_path, "/a.mapp");
        assert_eq!(list[0].name, "Song A v2", "name should be updated");
        assert_eq!(list[1].file_path, "/b.mapp");
    }

    #[test]
    fn list_is_capped_at_max_recent() {
        let tmp = TempDir::new().unwrap();

        for i in 0..=MAX_RECENT + 2 {
            let entry = make_entry(
                &format!("Song {}", i),
                &format!("/projects/song_{}.mapp", i),
            );
            add_recent(tmp.path(), entry).unwrap();
        }

        let list = load_recent(tmp.path()).unwrap();
        assert_eq!(list.len(), MAX_RECENT);
    }

    #[test]
    fn list_order_preserved_after_reload() {
        let tmp = TempDir::new().unwrap();

        for i in 0..5u32 {
            add_recent(
                tmp.path(),
                make_entry(&format!("Song {}", i), &format!("/s{}.mapp", i)),
            )
            .unwrap();
        }

        let list1 = load_recent(tmp.path()).unwrap();
        let list2 = load_recent(tmp.path()).unwrap();

        assert_eq!(list1.len(), list2.len());
        for (a, b) in list1.iter().zip(list2.iter()) {
            assert_eq!(a.file_path, b.file_path);
        }
    }

    #[test]
    fn corrupt_json_resets_gracefully() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(RECENT_FILE);
        fs::write(&path, b"not json at all").unwrap();

        // load_recent should not error — it returns an empty list.
        let list = load_recent(tmp.path()).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn add_recent_creates_app_data_dir_if_missing() {
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("nested").join("dir");
        // Directory does not exist yet.
        assert!(!nested.exists());

        add_recent(&nested, make_entry("X", "/x.mapp")).unwrap();
        assert!(nested.exists());
    }

    #[test]
    fn recent_projects_list_roundtrip_serialization() {
        let mut list = RecentProjectsList::default();
        list.push(make_entry("Alpha", "/alpha.mapp"));
        list.push(make_entry("Beta", "/beta.mapp"));

        let json = serde_json::to_string(&list).unwrap();
        let decoded: RecentProjectsList = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.entries.len(), 2);
        assert_eq!(decoded.entries[0].name, "Beta");
        assert_eq!(decoded.entries[1].name, "Alpha");
    }
}
