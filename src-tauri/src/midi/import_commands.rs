//! Tauri IPC commands for MIDI file import.
//!
//! # Design
//!
//! Follows the same stateless pattern as `pattern_commands.rs`: Rust parses,
//! validates, and generates UUIDs; the TypeScript `patternStore` is the single
//! source of truth for in-memory state.
//!
//! Two commands:
//! - [`import_midi_file`] — parse a `.mid` file, return [`MidiFileInfo`].
//! - [`create_patterns_from_import`] — receive user-confirmed track payloads,
//!   create [`Pattern`] structs with fresh UUIDs, return them for the frontend
//!   to inject into the pattern store.

use tauri::command;
use uuid::Uuid;

use crate::project::pattern::{Pattern, PatternContent, PatternMidiNote};
use super::import::{ImportedNote, MidiFileInfo, MidiImporter};

// ---------------------------------------------------------------------------
// IPC payload types
// ---------------------------------------------------------------------------

/// Per-track payload sent from the frontend after the user confirms the import
/// dialog.  One payload produces one [`Pattern`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTrackPayload {
    /// 0-based MIDI track index (for identification, not used in pattern creation).
    pub midi_track_index: usize,
    /// User-supplied pattern name.  Non-empty, max 128 chars.
    pub pattern_name: String,
    /// DAW track UUID to assign the created pattern to.
    pub track_id: String,
    /// The notes to embed (the subset the user chose to import).
    pub notes: Vec<ImportedNote>,
    /// Desired length in bars.  Must be one of: 1, 2, 4, 8, 16, 32.
    pub length_bars: u8,
}

// Valid pattern length values (mirrors `pattern_commands.rs`).
const VALID_LENGTHS: &[u8] = &[1, 2, 4, 8, 16, 32];

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Parses a `.mid` file and returns its tracks with notes already converted
/// to beat positions.
///
/// `path` must be an absolute filesystem path.  The command is synchronous
/// file I/O on the Tauri async thread pool — no audio thread involvement.
///
/// # Errors
///
/// Returns an error string on read failure, malformed MIDI data, or unsupported
/// file format (Type 2).
#[command]
pub fn import_midi_file(path: String) -> Result<MidiFileInfo, String> {
    MidiImporter::parse_file(std::path::Path::new(&path))
}

/// Creates [`Pattern`] structs from user-confirmed import payloads.
///
/// For each payload a new UUID is generated and the [`ImportedNote`] list is
/// converted to [`PatternMidiNote`] entries (each with its own UUID).
/// The created patterns are returned for the frontend to add to `patternStore`.
///
/// # Errors
///
/// Returns an error string if any payload has:
/// - An empty or whitespace-only `pattern_name`.
/// - A `pattern_name` exceeding 128 characters.
/// - An empty or whitespace-only `track_id`.
/// - A `length_bars` not in `[1, 2, 4, 8, 16, 32]`.
#[command]
pub fn create_patterns_from_import(
    payloads: Vec<ImportTrackPayload>,
) -> Result<Vec<Pattern>, String> {
    let mut patterns = Vec::with_capacity(payloads.len());

    for payload in payloads {
        // Validate name
        let name = payload.pattern_name.trim().to_string();
        if name.is_empty() {
            return Err("Pattern name cannot be empty".to_string());
        }
        if name.len() > 128 {
            return Err("Pattern name too long (max 128 chars)".to_string());
        }

        // Validate track_id
        let track_id = payload.track_id.trim().to_string();
        if track_id.is_empty() {
            return Err("track_id cannot be empty".to_string());
        }

        // Validate length_bars
        if !VALID_LENGTHS.contains(&payload.length_bars) {
            return Err(format!(
                "Invalid length_bars: {}. Must be one of: 1, 2, 4, 8, 16, 32",
                payload.length_bars
            ));
        }

        // Convert ImportedNote → PatternMidiNote (add UUIDs)
        let notes: Vec<PatternMidiNote> = payload
            .notes
            .into_iter()
            .map(|n| PatternMidiNote {
                id: Uuid::new_v4().to_string(),
                pitch: n.pitch,
                start_beats: n.start_beats,
                duration_beats: n.duration_beats,
                velocity: n.velocity,
                channel: n.channel,
            })
            .collect();

        patterns.push(Pattern {
            id: Uuid::new_v4().to_string(),
            name,
            track_id,
            length_bars: payload.length_bars,
            content: PatternContent::Midi { notes },
            automation: std::collections::HashMap::new(),
        });
    }

    Ok(patterns)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_note(pitch: u8, start: f64, dur: f64) -> ImportedNote {
        ImportedNote {
            pitch,
            velocity: 100,
            channel: 0,
            start_beats: start,
            duration_beats: dur,
        }
    }

    fn make_payload(name: &str, track_id: &str, notes: Vec<ImportedNote>, length: u8) -> ImportTrackPayload {
        ImportTrackPayload {
            midi_track_index: 0,
            pattern_name: name.to_string(),
            track_id: track_id.to_string(),
            notes,
            length_bars: length,
        }
    }

    #[test]
    fn create_patterns_returns_patterns_with_uuids() {
        let payload = make_payload("Verse", "track-1", vec![make_note(60, 0.0, 1.0)], 4);
        let patterns = create_patterns_from_import(vec![payload]).unwrap();
        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].name, "Verse");
        assert_eq!(patterns[0].track_id, "track-1");
        assert_eq!(patterns[0].id.len(), 36);
        assert!(Uuid::parse_str(&patterns[0].id).is_ok());
    }

    #[test]
    fn create_patterns_converts_notes_with_uuids() {
        let payload = make_payload("A", "t1", vec![make_note(60, 0.0, 1.0), make_note(64, 1.0, 0.5)], 4);
        let patterns = create_patterns_from_import(vec![payload]).unwrap();
        match &patterns[0].content {
            PatternContent::Midi { notes } => {
                assert_eq!(notes.len(), 2);
                assert_eq!(notes[0].pitch, 60);
                assert_eq!(notes[1].pitch, 64);
                // Each note gets its own UUID
                assert_ne!(notes[0].id, notes[1].id);
                assert_eq!(notes[0].id.len(), 36);
            }
            _ => panic!("expected Midi content"),
        }
    }

    #[test]
    fn create_patterns_rejects_empty_name() {
        let payload = make_payload("  ", "track-1", vec![], 4);
        let err = create_patterns_from_import(vec![payload]).unwrap_err();
        assert!(err.contains("empty"), "got: {err}");
    }

    #[test]
    fn create_patterns_rejects_long_name() {
        let payload = make_payload(&"x".repeat(129), "track-1", vec![], 4);
        let err = create_patterns_from_import(vec![payload]).unwrap_err();
        assert!(err.contains("128"), "got: {err}");
    }

    #[test]
    fn create_patterns_rejects_empty_track_id() {
        let payload = make_payload("A", "  ", vec![], 4);
        let err = create_patterns_from_import(vec![payload]).unwrap_err();
        assert!(err.contains("track_id"), "got: {err}");
    }

    #[test]
    fn create_patterns_rejects_invalid_length() {
        let payload = make_payload("A", "t1", vec![], 3);
        let err = create_patterns_from_import(vec![payload]).unwrap_err();
        assert!(err.contains("Invalid length_bars"), "got: {err}");
    }

    #[test]
    fn create_patterns_accepts_all_valid_lengths() {
        for &len in &[1u8, 2, 4, 8, 16, 32] {
            let payload = make_payload("A", "t1", vec![], len);
            assert!(create_patterns_from_import(vec![payload]).is_ok(), "failed for length={len}");
        }
    }

    #[test]
    fn create_patterns_handles_multiple_payloads() {
        let payloads = vec![
            make_payload("Track A", "t1", vec![make_note(60, 0.0, 1.0)], 4),
            make_payload("Track B", "t2", vec![make_note(64, 0.0, 2.0)], 8),
        ];
        let patterns = create_patterns_from_import(payloads).unwrap();
        assert_eq!(patterns.len(), 2);
        assert_ne!(patterns[0].id, patterns[1].id);
    }

    #[test]
    fn create_patterns_from_empty_payloads_returns_empty_vec() {
        let patterns = create_patterns_from_import(vec![]).unwrap();
        assert!(patterns.is_empty());
    }
}
