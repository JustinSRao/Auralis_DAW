//! Tauri IPC commands for track management.
//!
//! # Design: Stateless Rust backend
//!
//! Rust acts as a pure validator and UUID generator. No managed track list state
//! lives in the Rust process. The TypeScript `trackStore` (Zustand) is the single
//! source of truth for the in-memory track list.
//!
//! Each command either:
//! - Creates a new entity and returns it so the frontend can add it to its store, or
//! - Validates an operation and returns `Ok(())` so the frontend can apply it safely.
//!
//! All validation errors are returned as `Err(String)`, which Tauri serialises as a
//! JavaScript exception on the frontend.

use tauri::command;

use crate::project::track::{Track, TrackKind};

/// Creates a new track with the given kind and name, returning the full [`Track`]
/// struct (including the generated UUID) for the frontend to add to its store.
///
/// # Errors
///
/// Returns an error string if `name` is empty or exceeds 64 characters.
#[command]
pub fn create_track(kind: TrackKind, name: String) -> Result<Track, String> {
    if name.trim().is_empty() {
        return Err("Track name cannot be empty".to_string());
    }
    if name.len() > 64 {
        return Err("Track name cannot exceed 64 characters".to_string());
    }
    Ok(Track::new(name.trim(), kind))
}

/// Validates that a track rename operation is permissible.
///
/// The actual rename is applied by the frontend store. This command enforces the
/// naming invariants at the backend boundary.
///
/// # Errors
///
/// Returns an error string if `id` is empty, or if `name` is empty or exceeds
/// 64 characters.
#[command]
pub fn rename_track(id: String, name: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("Track ID cannot be empty".to_string());
    }
    if name.trim().is_empty() {
        return Err("Track name cannot be empty".to_string());
    }
    if name.len() > 64 {
        return Err("Track name cannot exceed 64 characters".to_string());
    }
    Ok(())
}

/// Validates a track deletion request.
///
/// # Errors
///
/// Returns an error string if `id` is empty.
#[command]
pub fn delete_track(id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("Track ID cannot be empty".to_string());
    }
    Ok(())
}

/// Validates a track reorder operation.
///
/// Checks that the provided ID list is non-empty and contains no duplicates.
/// The frontend is responsible for ensuring the IDs match its current track list.
///
/// # Errors
///
/// Returns an error string if `ids` is empty or contains duplicates.
#[command]
pub fn reorder_tracks(ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Err("Track order cannot be empty".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for id in &ids {
        if !seen.insert(id.as_str()) {
            return Err(format!("Duplicate track ID in reorder list: {id}"));
        }
    }
    Ok(())
}

/// Validates a track colour assignment.
///
/// Accepts CSS hex colours in `#RRGGBB` or `#RGB` format.
///
/// # Errors
///
/// Returns an error string if `id` is empty or `color` is not a valid CSS hex
/// colour string.
#[command]
pub fn set_track_color(id: String, color: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("Track ID cannot be empty".to_string());
    }
    let c = color.trim();
    let valid = (c.starts_with('#') && c.len() == 7) || (c.starts_with('#') && c.len() == 4);
    if !valid {
        return Err(format!(
            "Invalid colour format: {color}. Expected #RRGGBB or #RGB"
        ));
    }
    // Validate that all characters after '#' are valid hexadecimal digits.
    if !c[1..].chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(format!("Invalid colour value: {color}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- create_track ---

    #[test]
    fn create_track_returns_track_with_correct_name_and_kind() {
        let track = create_track(TrackKind::Audio, "Drums".to_string()).unwrap();
        assert_eq!(track.name, "Drums");
        assert_eq!(track.kind, TrackKind::Audio);
        assert_eq!(track.id.len(), 36);
    }

    #[test]
    fn create_track_trims_whitespace_from_name() {
        let track = create_track(TrackKind::Midi, "  Piano  ".to_string()).unwrap();
        assert_eq!(track.name, "Piano");
    }

    #[test]
    fn create_track_rejects_empty_name() {
        let err = create_track(TrackKind::Audio, "   ".to_string()).unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn create_track_rejects_name_over_64_chars() {
        let long_name = "a".repeat(65);
        let err = create_track(TrackKind::Audio, long_name).unwrap_err();
        assert!(err.contains("64"));
    }

    #[test]
    fn create_track_accepts_name_at_exactly_64_chars() {
        let name = "a".repeat(64);
        let track = create_track(TrackKind::Instrument, name.clone()).unwrap();
        assert_eq!(track.name, name);
    }

    // --- rename_track ---

    #[test]
    fn rename_track_accepts_valid_inputs() {
        assert!(rename_track("some-uuid".to_string(), "New Name".to_string()).is_ok());
    }

    #[test]
    fn rename_track_rejects_empty_id() {
        let err = rename_track("".to_string(), "Name".to_string()).unwrap_err();
        assert!(err.contains("ID"));
    }

    #[test]
    fn rename_track_rejects_empty_name() {
        let err = rename_track("some-uuid".to_string(), "  ".to_string()).unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn rename_track_rejects_name_over_64_chars() {
        let err = rename_track("some-uuid".to_string(), "b".repeat(65)).unwrap_err();
        assert!(err.contains("64"));
    }

    // --- delete_track ---

    #[test]
    fn delete_track_accepts_valid_id() {
        assert!(delete_track("some-uuid".to_string()).is_ok());
    }

    #[test]
    fn delete_track_rejects_empty_id() {
        let err = delete_track("".to_string()).unwrap_err();
        assert!(err.contains("ID"));
    }

    // --- reorder_tracks ---

    #[test]
    fn reorder_tracks_accepts_unique_ids() {
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert!(reorder_tracks(ids).is_ok());
    }

    #[test]
    fn reorder_tracks_rejects_empty_list() {
        let err = reorder_tracks(vec![]).unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn reorder_tracks_rejects_duplicate_ids() {
        let ids = vec!["a".to_string(), "b".to_string(), "a".to_string()];
        let err = reorder_tracks(ids).unwrap_err();
        assert!(err.contains("Duplicate"));
    }

    // --- set_track_color ---

    #[test]
    fn set_track_color_accepts_rrggbb_format() {
        assert!(set_track_color("uuid".to_string(), "#3B82F6".to_string()).is_ok());
    }

    #[test]
    fn set_track_color_accepts_rgb_short_format() {
        assert!(set_track_color("uuid".to_string(), "#F0A".to_string()).is_ok());
    }

    #[test]
    fn set_track_color_rejects_empty_id() {
        let err = set_track_color("".to_string(), "#FFFFFF".to_string()).unwrap_err();
        assert!(err.contains("ID"));
    }

    #[test]
    fn set_track_color_rejects_missing_hash() {
        let err = set_track_color("uuid".to_string(), "3B82F6".to_string()).unwrap_err();
        assert!(err.contains("Invalid colour format"));
    }

    #[test]
    fn set_track_color_rejects_invalid_hex_digits() {
        let err = set_track_color("uuid".to_string(), "#GGGGGG".to_string()).unwrap_err();
        assert!(err.contains("Invalid colour value"));
    }

    #[test]
    fn set_track_color_rejects_wrong_length() {
        // 5 hex digits is neither #RGB (4 total) nor #RRGGBB (7 total)
        let err = set_track_color("uuid".to_string(), "#12345".to_string()).unwrap_err();
        assert!(err.contains("Invalid colour format"));
    }
}
