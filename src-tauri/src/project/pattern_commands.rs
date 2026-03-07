//! Tauri IPC commands for pattern management.
//!
//! # Design: Stateless Rust backend
//!
//! Rust acts as a pure validator and UUID generator. No managed pattern list
//! state lives in the Rust process. The TypeScript `patternStore` (Zustand)
//! is the single source of truth for the in-memory pattern collection.
//!
//! Each command either:
//! - Creates a new entity and returns it so the frontend can add it to its store, or
//! - Validates an operation and returns `Ok(())` so the frontend can apply it safely.
//!
//! All validation errors are returned as `Err(String)`, which Tauri serialises
//! as a JavaScript exception on the frontend.

use tauri::command;
use uuid::Uuid;

use super::pattern::Pattern;

/// The set of valid `length_bars` values. Must be a power of two in [1, 32].
const VALID_LENGTHS: &[u8] = &[1, 2, 4, 8, 16, 32];

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Creates a new empty MIDI pattern for the given track, returning the full
/// [`Pattern`] struct (including the generated UUID) for the frontend to add
/// to its store.
///
/// # Errors
///
/// Returns an error string if:
/// - `name` is empty or consists only of whitespace.
/// - `name` exceeds 128 characters.
/// - `track_id` is empty or consists only of whitespace.
#[command]
pub fn create_pattern(track_id: String, name: String) -> Result<Pattern, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Pattern name cannot be empty".to_string());
    }
    if name.len() > 128 {
        return Err("Pattern name too long (max 128 chars)".to_string());
    }
    let track_id = track_id.trim().to_string();
    if track_id.is_empty() {
        return Err("track_id cannot be empty".to_string());
    }
    Ok(Pattern::new_midi(name, track_id))
}

/// Validates that a pattern rename operation is permissible.
///
/// The actual rename is applied by the frontend store. This command enforces
/// naming invariants at the backend boundary.
///
/// # Errors
///
/// Returns an error string if:
/// - `id` is empty or whitespace.
/// - `name` is empty or consists only of whitespace.
/// - `name` exceeds 128 characters.
#[command]
pub fn rename_pattern(id: String, name: String) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("id cannot be empty".to_string());
    }
    let name = name.trim();
    if name.is_empty() {
        return Err("Pattern name cannot be empty".to_string());
    }
    if name.len() > 128 {
        return Err("Pattern name too long (max 128 chars)".to_string());
    }
    Ok(())
}

/// Duplicates an existing pattern: assigns a new UUID and appends " (copy)"
/// to the name, then returns the copy for the frontend to add to its store.
///
/// The copy is truncated at 128 characters if the appended suffix would push
/// the name beyond that limit.
///
/// # Errors
///
/// Returns an error string if the supplied `pattern.id` is empty.
#[command]
pub fn duplicate_pattern(pattern: Pattern) -> Result<Pattern, String> {
    if pattern.id.is_empty() {
        return Err("id cannot be empty".to_string());
    }
    let mut copy_name = format!("{} (copy)", pattern.name);
    copy_name.truncate(128);
    Ok(Pattern {
        id: Uuid::new_v4().to_string(),
        name: copy_name,
        track_id: pattern.track_id,
        length_bars: pattern.length_bars,
        content: pattern.content,
    })
}

/// Validates a pattern deletion request.
///
/// The actual removal is applied by the frontend store. This command confirms
/// the `id` is non-empty.
///
/// # Errors
///
/// Returns an error string if `id` is empty or whitespace.
#[command]
pub fn delete_pattern(id: String) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("id cannot be empty".to_string());
    }
    Ok(())
}

/// Validates and confirms a pattern length change.
///
/// Accepted values are 1, 2, 4, 8, 16, or 32 bars. The actual update is
/// applied by the frontend store.
///
/// # Errors
///
/// Returns an error string if:
/// - `id` is empty or whitespace.
/// - `length_bars` is not one of the accepted values.
#[command]
pub fn set_pattern_length(id: String, length_bars: u8) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("id cannot be empty".to_string());
    }
    if !VALID_LENGTHS.contains(&length_bars) {
        return Err(format!(
            "Invalid length_bars: {length_bars}. Must be one of: 1, 2, 4, 8, 16, 32"
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::pattern::PatternContent;

    // --- create_pattern ---

    #[test]
    fn create_pattern_returns_pattern_with_uuid() {
        let p = create_pattern("track-1".to_string(), "Verse".to_string()).unwrap();
        assert_eq!(p.name, "Verse");
        assert_eq!(p.track_id, "track-1");
        assert_eq!(p.id.len(), 36);
        assert!(Uuid::parse_str(&p.id).is_ok());
    }

    #[test]
    fn create_pattern_trims_name_and_track_id() {
        let p = create_pattern("  track-1  ".to_string(), "  Chorus  ".to_string()).unwrap();
        assert_eq!(p.name, "Chorus");
        assert_eq!(p.track_id, "track-1");
    }

    #[test]
    fn create_pattern_rejects_empty_name() {
        let err = create_pattern("track-1".to_string(), "   ".to_string()).unwrap_err();
        assert!(err.contains("empty"), "expected 'empty' in: {err}");
    }

    #[test]
    fn create_pattern_rejects_name_over_128_chars() {
        let long_name = "a".repeat(129);
        let err = create_pattern("track-1".to_string(), long_name).unwrap_err();
        assert!(err.contains("128"), "expected '128' in: {err}");
    }

    #[test]
    fn create_pattern_accepts_name_at_exactly_128_chars() {
        let name = "a".repeat(128);
        let p = create_pattern("track-1".to_string(), name.clone()).unwrap();
        assert_eq!(p.name, name);
    }

    #[test]
    fn create_pattern_rejects_empty_track_id() {
        let err = create_pattern("   ".to_string(), "Pattern 1".to_string()).unwrap_err();
        assert!(err.contains("track_id"), "expected 'track_id' in: {err}");
    }

    #[test]
    fn create_pattern_default_content_is_midi_with_no_notes() {
        let p = create_pattern("track-1".to_string(), "New Pattern".to_string()).unwrap();
        match &p.content {
            PatternContent::Midi { notes } => assert!(notes.is_empty()),
            _ => panic!("expected Midi content"),
        }
    }

    #[test]
    fn create_pattern_default_length_is_4() {
        let p = create_pattern("track-1".to_string(), "New Pattern".to_string()).unwrap();
        assert_eq!(p.length_bars, 4);
    }

    // --- rename_pattern ---

    #[test]
    fn rename_pattern_accepts_valid_inputs() {
        assert!(rename_pattern("some-uuid".to_string(), "New Name".to_string()).is_ok());
    }

    #[test]
    fn rename_pattern_rejects_empty_id() {
        let err = rename_pattern("".to_string(), "Name".to_string()).unwrap_err();
        assert!(err.contains("id"), "expected 'id' in: {err}");
    }

    #[test]
    fn rename_pattern_rejects_whitespace_id() {
        let err = rename_pattern("   ".to_string(), "Name".to_string()).unwrap_err();
        assert!(err.contains("id"), "expected 'id' in: {err}");
    }

    #[test]
    fn rename_pattern_rejects_empty_name() {
        let err = rename_pattern("some-uuid".to_string(), "  ".to_string()).unwrap_err();
        assert!(err.contains("empty"), "expected 'empty' in: {err}");
    }

    #[test]
    fn rename_pattern_rejects_name_over_128_chars() {
        let err = rename_pattern("some-uuid".to_string(), "b".repeat(129)).unwrap_err();
        assert!(err.contains("128"), "expected '128' in: {err}");
    }

    // --- duplicate_pattern ---

    #[test]
    fn duplicate_pattern_generates_different_uuid() {
        let original = Pattern::new_midi("Verse", "track-1");
        let copy = duplicate_pattern(original.clone()).unwrap();
        assert_ne!(copy.id, original.id);
        assert_eq!(copy.id.len(), 36);
        assert!(Uuid::parse_str(&copy.id).is_ok());
    }

    #[test]
    fn duplicate_pattern_appends_copy_suffix() {
        let original = Pattern::new_midi("Verse", "track-1");
        let copy = duplicate_pattern(original).unwrap();
        assert_eq!(copy.name, "Verse (copy)");
    }

    #[test]
    fn duplicate_pattern_preserves_track_id_and_length() {
        let mut original = Pattern::new_midi("Verse", "track-99");
        original.length_bars = 8;
        let copy = duplicate_pattern(original).unwrap();
        assert_eq!(copy.track_id, "track-99");
        assert_eq!(copy.length_bars, 8);
    }

    #[test]
    fn duplicate_pattern_truncates_name_to_128_chars() {
        // name of 124 chars + " (copy)" = 131 > 128 → must truncate to 128
        let original = Pattern::new_midi("a".repeat(124), "track-1");
        let copy = duplicate_pattern(original).unwrap();
        assert_eq!(copy.name.len(), 128);
    }

    #[test]
    fn duplicate_pattern_rejects_empty_id() {
        let mut p = Pattern::new_midi("Test", "track-1");
        p.id = "".to_string();
        let err = duplicate_pattern(p).unwrap_err();
        assert!(err.contains("id"), "expected 'id' in: {err}");
    }

    // --- delete_pattern ---

    #[test]
    fn delete_pattern_accepts_valid_id() {
        assert!(delete_pattern("some-uuid".to_string()).is_ok());
    }

    #[test]
    fn delete_pattern_rejects_empty_id() {
        let err = delete_pattern("".to_string()).unwrap_err();
        assert!(err.contains("id"), "expected 'id' in: {err}");
    }

    #[test]
    fn delete_pattern_rejects_whitespace_id() {
        let err = delete_pattern("   ".to_string()).unwrap_err();
        assert!(err.contains("id"), "expected 'id' in: {err}");
    }

    // --- set_pattern_length ---

    #[test]
    fn set_pattern_length_accepts_all_valid_values() {
        for &len in &[1u8, 2, 4, 8, 16, 32] {
            assert!(
                set_pattern_length("uuid".to_string(), len).is_ok(),
                "expected Ok for length_bars={len}"
            );
        }
    }

    #[test]
    fn set_pattern_length_rejects_invalid_values() {
        for &len in &[0u8, 3, 5, 6, 7, 9, 10, 15, 17, 33, 64, 128] {
            let err = set_pattern_length("uuid".to_string(), len).unwrap_err();
            assert!(
                err.contains("Invalid length_bars"),
                "expected error for length_bars={len}: {err}"
            );
        }
    }

    #[test]
    fn set_pattern_length_rejects_empty_id() {
        let err = set_pattern_length("".to_string(), 4).unwrap_err();
        assert!(err.contains("id"), "expected 'id' in: {err}");
    }
}
