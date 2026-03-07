//! Pattern data structures for the `.mapp` project file format.
//!
//! A [`Pattern`] is a named, reusable musical region that belongs to a track.
//! Patterns hold either MIDI note data or a reference to an audio file.
//! They are stored in [`crate::project::format::ProjectFile::patterns`] and
//! referenced from timeline clips via `ClipContent::Pattern { pattern_id }`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Alias for the string UUID that uniquely identifies a pattern.
pub type PatternId = String;

/// A single MIDI note stored within a pattern.
///
/// Field names use `camelCase` JSON serialization to match the TypeScript
/// `MidiNote` type used by the piano roll store, enabling zero-transform
/// round-trips across the IPC boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatternMidiNote {
    /// Stable string UUID for this note within the pattern.
    pub id: String,
    /// MIDI pitch number `[0, 127]`. Middle C = 60.
    pub pitch: u8,
    /// Note start position in beats from the pattern start.
    pub start_beats: f64,
    /// Note duration in beats. Minimum: 1/960 of a beat.
    pub duration_beats: f64,
    /// MIDI velocity `[1, 127]`.
    pub velocity: u8,
    /// MIDI channel `[0, 15]` (0-indexed).
    pub channel: u8,
}

/// The content variant stored inside a [`Pattern`].
///
/// Uses Serde's internally-tagged enum representation so the JSON contains a
/// `"type"` discriminator field alongside the payload fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum PatternContent {
    /// MIDI pattern containing an ordered list of note events.
    Midi {
        /// All MIDI notes in this pattern.
        notes: Vec<PatternMidiNote>,
    },
    /// Audio pattern that references a file on disk.
    Audio {
        /// Absolute or project-relative path to the audio file.
        file_path: String,
    },
}

/// A named, reusable musical pattern belonging to a single track.
///
/// Patterns are the unit of composition in the arrangement view. A pattern
/// can appear multiple times on the timeline (via `ClipContent::Pattern`),
/// and editing it updates all placements simultaneously.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    /// Unique string UUID for this pattern.
    pub id: PatternId,
    /// Human-readable display name shown in the pattern browser.
    pub name: String,
    /// ID of the track that owns this pattern.
    pub track_id: String,
    /// Pattern length in bars. Must be one of: 1, 2, 4, 8, 16, 32.
    pub length_bars: u8,
    /// The musical content of this pattern (MIDI notes or audio file path).
    pub content: PatternContent,
}

impl Pattern {
    /// Creates a new empty MIDI pattern with a generated UUID.
    ///
    /// The pattern starts with zero notes and a default length of 4 bars.
    pub fn new_midi(name: impl Into<String>, track_id: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            track_id: track_id.into(),
            length_bars: 4,
            content: PatternContent::Midi { notes: Vec::new() },
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_new_midi_creates_empty_notes() {
        let p = Pattern::new_midi("Intro", "track-1");
        assert_eq!(p.name, "Intro");
        assert_eq!(p.track_id, "track-1");
        assert_eq!(p.length_bars, 4);
        match &p.content {
            PatternContent::Midi { notes } => assert!(notes.is_empty()),
            _ => panic!("expected Midi content"),
        }
    }

    #[test]
    fn pattern_new_midi_generates_uuid() {
        let p = Pattern::new_midi("Test", "track-1");
        // UUIDs are 36 characters: 8-4-4-4-12 with dashes
        assert_eq!(p.id.len(), 36);
        assert!(Uuid::parse_str(&p.id).is_ok());
    }

    #[test]
    fn pattern_midi_note_roundtrip_json() {
        let note = PatternMidiNote {
            id: Uuid::new_v4().to_string(),
            pitch: 60,
            start_beats: 0.0,
            duration_beats: 1.0,
            velocity: 100,
            channel: 0,
        };
        let json = serde_json::to_string(&note).expect("serialize failed");
        let decoded: PatternMidiNote = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(note, decoded);
    }

    #[test]
    fn pattern_midi_note_uses_camel_case_json_keys() {
        let note = PatternMidiNote {
            id: "test-id".to_string(),
            pitch: 64,
            start_beats: 2.0,
            duration_beats: 0.5,
            velocity: 80,
            channel: 1,
        };
        let json = serde_json::to_string(&note).expect("serialize");
        // camelCase keys expected
        assert!(json.contains("startBeats"), "expected startBeats in JSON");
        assert!(json.contains("durationBeats"), "expected durationBeats in JSON");
        // snake_case keys must NOT appear
        assert!(!json.contains("start_beats"), "unexpected start_beats in JSON");
        assert!(!json.contains("duration_beats"), "unexpected duration_beats in JSON");
    }

    #[test]
    fn pattern_roundtrip_json() {
        let mut pattern = Pattern::new_midi("Verse A", "track-abc");
        if let PatternContent::Midi { notes } = &mut pattern.content {
            notes.push(PatternMidiNote {
                id: Uuid::new_v4().to_string(),
                pitch: 60,
                start_beats: 0.0,
                duration_beats: 1.0,
                velocity: 100,
                channel: 0,
            });
        }
        let json = serde_json::to_string(&pattern).expect("serialize failed");
        let decoded: Pattern = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(pattern, decoded);
    }

    #[test]
    fn pattern_audio_content_roundtrip_json() {
        let pattern = Pattern {
            id: Uuid::new_v4().to_string(),
            name: "Loop".to_string(),
            track_id: "track-2".to_string(),
            length_bars: 2,
            content: PatternContent::Audio {
                file_path: "/samples/loop.wav".to_string(),
            },
        };
        let json = serde_json::to_string(&pattern).expect("serialize");
        let decoded: Pattern = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(pattern, decoded);
    }
}
