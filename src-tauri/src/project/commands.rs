//! Tauri IPC commands for project file management.
//!
//! All commands are registered in `lib.rs` via `tauri::generate_handler![]`.
//! Error values are stringified before crossing the IPC boundary so that the
//! TypeScript frontend can display them without extra deserialization.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::project::format::ProjectFile;
use crate::project::recent::RecentProject;
use crate::project::{io, recent};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Holds the currently-open project for auto-save and dirty-state tracking.
pub struct ProjectManager {
    /// The last version of the project marked dirty, awaiting auto-save.
    dirty_project: Option<ProjectFile>,
    /// The path the dirty project should be saved to on auto-save.
    dirty_path: Option<PathBuf>,
}

impl ProjectManager {
    /// Constructs a new, empty `ProjectManager`.
    pub fn new() -> Self {
        Self {
            dirty_project: None,
            dirty_path: None,
        }
    }

    /// Marks the project as dirty so the auto-save task can write it.
    ///
    /// Both the current project snapshot and the target save path must be
    /// provided.  Only the most recent call matters — a second `mark_dirty`
    /// before the auto-save fires replaces the previous snapshot.
    pub fn mark_dirty(&mut self, project: ProjectFile, path: PathBuf) {
        self.dirty_project = Some(project);
        self.dirty_path = Some(path);
    }

    /// Returns the dirty snapshot (project + path) and clears the dirty state.
    ///
    /// Returns `None` if the project has not been modified since the last
    /// auto-save (or if no path has been set yet).
    pub fn take_dirty_snapshot(&mut self) -> Option<(ProjectFile, PathBuf)> {
        match (self.dirty_project.take(), self.dirty_path.take()) {
            (Some(project), Some(path)) => Some((project, path)),
            (project, path) => {
                // Restore whatever was partially set.
                self.dirty_project = project;
                self.dirty_path = path;
                None
            }
        }
    }
}

impl Default for ProjectManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Type alias for the project manager managed state in Tauri.
pub type ProjectManagerState = Arc<Mutex<ProjectManager>>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/// Result returned by [`save_project`] on success.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    /// Whether the save completed without error.
    pub success: bool,
    /// The absolute path the file was saved to.
    pub file_path: String,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Creates a new, empty project with the given `name` and default settings.
///
/// The returned [`ProjectFile`] is not yet written to disk — call
/// [`save_project`] to persist it.
#[tauri::command]
pub fn new_project(name: String) -> Result<ProjectFile, String> {
    let mut project = ProjectFile::default();
    project.name = name;
    project.modified_at = Utc::now();
    Ok(project)
}

/// Saves `project` to `file_path` as a `.mapp` ZIP archive.
///
/// On success, the project is added to the recent-projects list and a
/// [`SaveResult`] is returned.  On failure the error message is forwarded to
/// the frontend.
#[tauri::command]
pub fn save_project(
    app_handle: AppHandle,
    project: ProjectFile,
    file_path: String,
) -> Result<SaveResult, String> {
    let path = PathBuf::from(&file_path);

    io::save_project(&project, &path, None).map_err(|e| e.to_string())?;

    // Update recent projects list.
    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let entry = RecentProject {
            name: project.name.clone(),
            file_path: file_path.clone(),
            modified_at: project.modified_at,
        };
        if let Err(e) = recent::add_recent(&app_data_dir, entry) {
            log::warn!("Failed to update recent projects list: {}", e);
        }
    }

    Ok(SaveResult {
        success: true,
        file_path,
    })
}

/// Loads a project from a `.mapp` file at `file_path`.
///
/// Schema migrations are applied automatically if the file was saved by an
/// older version of the application.
#[tauri::command]
pub fn load_project(
    app_handle: AppHandle,
    file_path: String,
) -> Result<ProjectFile, String> {
    let path = PathBuf::from(&file_path);

    let project = io::load_project(&path).map_err(|e| e.to_string())?;

    // Update recent projects list.
    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let entry = RecentProject {
            name: project.name.clone(),
            file_path,
            modified_at: project.modified_at,
        };
        if let Err(e) = recent::add_recent(&app_data_dir, entry) {
            log::warn!("Failed to update recent projects list: {}", e);
        }
    }

    Ok(project)
}

/// Returns the most-recently-used project list (up to 10 entries).
#[tauri::command]
pub fn get_recent_projects(
    app_handle: AppHandle,
) -> Result<Vec<RecentProject>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    recent::load_recent(&app_data_dir).map_err(|e| e.to_string())
}

/// Marks `project` as dirty so the background auto-save task can persist it.
///
/// This should be called whenever the user makes a change that has not yet
/// been saved to disk.  The `file_path` must be the current save path; if the
/// project has never been saved, pass an empty string and no auto-save will
/// be attempted.
#[tauri::command]
pub fn mark_project_dirty(
    project: ProjectFile,
    file_path: String,
    state: State<'_, ProjectManagerState>,
) -> Result<(), String> {
    if file_path.is_empty() {
        return Ok(());
    }

    let mut mgr = state.lock().map_err(|e| e.to_string())?;
    mgr.mark_dirty(project, PathBuf::from(file_path));
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::format::ProjectFile;
    use std::path::PathBuf;

    // -----------------------------------------------------------------------
    // ProjectManager tests
    // -----------------------------------------------------------------------

    #[test]
    fn new_project_manager_has_no_dirty_state() {
        let mut mgr = ProjectManager::new();
        assert!(mgr.take_dirty_snapshot().is_none());
    }

    #[test]
    fn mark_dirty_then_take_returns_snapshot() {
        let mut mgr = ProjectManager::new();
        let project = ProjectFile::default();
        let path = PathBuf::from("/tmp/test.mapp");

        mgr.mark_dirty(project.clone(), path.clone());
        let snapshot = mgr.take_dirty_snapshot();

        assert!(snapshot.is_some());
        let (saved_project, saved_path) = snapshot.unwrap();
        assert_eq!(saved_project.id, project.id);
        assert_eq!(saved_path, path);
    }

    #[test]
    fn take_dirty_snapshot_clears_dirty_state() {
        let mut mgr = ProjectManager::new();
        mgr.mark_dirty(ProjectFile::default(), PathBuf::from("/tmp/p.mapp"));

        let _first = mgr.take_dirty_snapshot();
        let second = mgr.take_dirty_snapshot();

        assert!(second.is_none(), "dirty state must be cleared after take");
    }

    #[test]
    fn mark_dirty_twice_returns_latest_project() {
        let mut mgr = ProjectManager::new();

        let mut p1 = ProjectFile::default();
        p1.name = "Version 1".to_string();

        let mut p2 = ProjectFile::default();
        p2.name = "Version 2".to_string();

        let path = PathBuf::from("/tmp/p.mapp");
        mgr.mark_dirty(p1, path.clone());
        mgr.mark_dirty(p2.clone(), path);

        let snapshot = mgr.take_dirty_snapshot().unwrap();
        assert_eq!(snapshot.0.name, "Version 2");
    }

    // -----------------------------------------------------------------------
    // new_project command
    // -----------------------------------------------------------------------

    #[test]
    fn new_project_command_sets_name() {
        let result = new_project("My Track".to_string());
        assert!(result.is_ok());
        let project = result.unwrap();
        assert_eq!(project.name, "My Track");
    }

    #[test]
    fn new_project_command_generates_unique_ids() {
        let p1 = new_project("A".to_string()).unwrap();
        let p2 = new_project("B".to_string()).unwrap();
        assert_ne!(p1.id, p2.id);
    }

    #[test]
    fn new_project_command_uses_current_schema() {
        let project = new_project("Schema Test".to_string()).unwrap();
        assert_eq!(
            project.schema_version,
            crate::project::version::CURRENT_SCHEMA
        );
    }
}
