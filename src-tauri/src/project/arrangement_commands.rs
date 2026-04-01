//! Tauri IPC commands for arrangement clip management.
//!
//! These commands are stateless: Rust validates inputs and assigns UUIDs.
//! The TypeScript `arrangementStore` is the authoritative source of clip state.

use tauri::command;
use uuid::Uuid;

use crate::project::arrangement::ArrangementClip;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Creates a new arrangement clip placement, assigning a fresh UUID.
///
/// # Errors
///
/// Returns an error string if any argument is invalid.
#[command]
pub fn add_arrangement_clip(
    pattern_id: String,
    track_id: String,
    start_bar: f64,
    length_bars: f64,
) -> Result<ArrangementClip, String> {
    if pattern_id.is_empty() {
        return Err("pattern_id must not be empty".to_string());
    }
    if track_id.is_empty() {
        return Err("track_id must not be empty".to_string());
    }
    if start_bar < 0.0 {
        return Err(format!("start_bar must be >= 0, got {start_bar}"));
    }
    if length_bars <= 0.0 {
        return Err(format!("length_bars must be > 0, got {length_bars}"));
    }

    Ok(ArrangementClip {
        id: Uuid::new_v4().to_string(),
        pattern_id,
        track_id,
        start_bar,
        length_bars,
        ..Default::default()
    })
}

/// Validates a clip move operation.
///
/// Returns `Ok(())` on success — the frontend applies the position update.
///
/// # Errors
///
/// Returns an error string if any argument is invalid.
#[command]
pub fn move_arrangement_clip(
    id: String,
    new_track_id: String,
    new_start_bar: f64,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("id must not be empty".to_string());
    }
    if new_track_id.is_empty() {
        return Err("new_track_id must not be empty".to_string());
    }
    if new_start_bar < 0.0 {
        return Err(format!("new_start_bar must be >= 0, got {new_start_bar}"));
    }
    Ok(())
}

/// Validates a clip resize operation.
///
/// Returns `Ok(())` on success — the frontend applies the length update.
///
/// # Errors
///
/// Returns an error string if any argument is invalid.
#[command]
pub fn resize_arrangement_clip(id: String, new_length_bars: f64) -> Result<(), String> {
    if id.is_empty() {
        return Err("id must not be empty".to_string());
    }
    if new_length_bars <= 0.0 {
        return Err(format!("new_length_bars must be > 0, got {new_length_bars}"));
    }
    Ok(())
}

/// Validates a clip deletion.
///
/// Returns `Ok(())` on success — the frontend removes the clip from its store.
///
/// # Errors
///
/// Returns an error string if `id` is empty.
#[command]
pub fn delete_arrangement_clip(id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("id must not be empty".to_string());
    }
    Ok(())
}

/// Creates a duplicate of an existing clip at a new bar position.
///
/// The source clip is identified by `source_id` (for validation), but the
/// new clip's content is fully specified by the remaining parameters.
///
/// # Errors
///
/// Returns an error string if any argument is invalid.
#[command]
pub fn duplicate_arrangement_clip(
    source_id: String,
    new_start_bar: f64,
    pattern_id: String,
    track_id: String,
    length_bars: f64,
) -> Result<ArrangementClip, String> {
    if source_id.is_empty() {
        return Err("source_id must not be empty".to_string());
    }
    if pattern_id.is_empty() {
        return Err("pattern_id must not be empty".to_string());
    }
    if track_id.is_empty() {
        return Err("track_id must not be empty".to_string());
    }
    if new_start_bar < 0.0 {
        return Err(format!("new_start_bar must be >= 0, got {new_start_bar}"));
    }
    if length_bars <= 0.0 {
        return Err(format!("length_bars must be > 0, got {length_bars}"));
    }

    Ok(ArrangementClip {
        id: Uuid::new_v4().to_string(),
        pattern_id,
        track_id,
        start_bar: new_start_bar,
        length_bars,
        ..Default::default()
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- add_arrangement_clip ---

    #[test]
    fn add_clip_valid_returns_clip_with_uuid() {
        let clip = add_arrangement_clip(
            "pat-1".to_string(),
            "track-1".to_string(),
            0.0,
            4.0,
        )
        .expect("should succeed");
        assert!(!clip.id.is_empty());
        assert_eq!(clip.pattern_id, "pat-1");
        assert_eq!(clip.track_id, "track-1");
        assert_eq!(clip.start_bar, 0.0);
        assert_eq!(clip.length_bars, 4.0);
        // UUID should be parseable
        assert!(Uuid::parse_str(&clip.id).is_ok());
    }

    #[test]
    fn add_clip_empty_pattern_id_errors() {
        let result = add_arrangement_clip("".to_string(), "track-1".to_string(), 0.0, 4.0);
        assert!(result.is_err());
    }

    #[test]
    fn add_clip_empty_track_id_errors() {
        let result = add_arrangement_clip("pat-1".to_string(), "".to_string(), 0.0, 4.0);
        assert!(result.is_err());
    }

    #[test]
    fn add_clip_negative_start_bar_errors() {
        let result = add_arrangement_clip("pat-1".to_string(), "track-1".to_string(), -1.0, 4.0);
        assert!(result.is_err());
    }

    #[test]
    fn add_clip_zero_length_errors() {
        let result = add_arrangement_clip("pat-1".to_string(), "track-1".to_string(), 0.0, 0.0);
        assert!(result.is_err());
    }

    #[test]
    fn add_clip_negative_length_errors() {
        let result = add_arrangement_clip("pat-1".to_string(), "track-1".to_string(), 0.0, -2.0);
        assert!(result.is_err());
    }

    // --- move_arrangement_clip ---

    #[test]
    fn move_clip_valid_returns_ok() {
        assert!(move_arrangement_clip("clip-1".to_string(), "track-2".to_string(), 8.0).is_ok());
    }

    #[test]
    fn move_clip_empty_id_errors() {
        assert!(move_arrangement_clip("".to_string(), "track-2".to_string(), 8.0).is_err());
    }

    #[test]
    fn move_clip_empty_track_id_errors() {
        assert!(move_arrangement_clip("clip-1".to_string(), "".to_string(), 8.0).is_err());
    }

    #[test]
    fn move_clip_negative_start_errors() {
        assert!(move_arrangement_clip("clip-1".to_string(), "track-2".to_string(), -1.0).is_err());
    }

    // --- resize_arrangement_clip ---

    #[test]
    fn resize_clip_valid_returns_ok() {
        assert!(resize_arrangement_clip("clip-1".to_string(), 8.0).is_ok());
    }

    #[test]
    fn resize_clip_empty_id_errors() {
        assert!(resize_arrangement_clip("".to_string(), 8.0).is_err());
    }

    #[test]
    fn resize_clip_zero_length_errors() {
        assert!(resize_arrangement_clip("clip-1".to_string(), 0.0).is_err());
    }

    // --- delete_arrangement_clip ---

    #[test]
    fn delete_clip_valid_returns_ok() {
        assert!(delete_arrangement_clip("clip-1".to_string()).is_ok());
    }

    #[test]
    fn delete_clip_empty_id_errors() {
        assert!(delete_arrangement_clip("".to_string()).is_err());
    }

    // --- duplicate_arrangement_clip ---

    #[test]
    fn duplicate_clip_valid_returns_new_clip_with_uuid() {
        let clip = duplicate_arrangement_clip(
            "clip-src".to_string(),
            8.0,
            "pat-1".to_string(),
            "track-1".to_string(),
            4.0,
        )
        .expect("should succeed");
        assert!(!clip.id.is_empty());
        assert_ne!(clip.id, "clip-src");
        assert_eq!(clip.start_bar, 8.0);
        assert_eq!(clip.length_bars, 4.0);
    }

    #[test]
    fn duplicate_clip_empty_source_id_errors() {
        assert!(duplicate_arrangement_clip(
            "".to_string(),
            8.0,
            "pat-1".to_string(),
            "track-1".to_string(),
            4.0,
        )
        .is_err());
    }
}
