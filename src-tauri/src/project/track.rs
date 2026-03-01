//! Runtime track model for the DAW track management API.
//!
//! This module defines [`Track`] and [`TrackKind`], the lightweight runtime
//! representation used by the track list UI and IPC commands. These types are
//! distinct from [`crate::project::format::TrackData`], which is the full
//! on-disk serialisation format (clips, automation, effect chains, etc.).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Identifies the composition role of a track.
///
/// Distinct from `format::TrackType` which is the on-disk serialisation format.
/// `TrackKind` is the runtime classification used by the track management API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum TrackKind {
    /// Records and plays back audio clips from audio input.
    Audio,
    /// Drives a software instrument via MIDI note clips.
    Midi,
    /// Convenience wrapper: combined MIDI sequencing + inline instrument assignment.
    Instrument,
}

/// Runtime representation of a DAW track used by the track management commands.
///
/// This is the lightweight model for the track list UI. It is distinct from
/// `format::TrackData` which is the full on-disk format including clips, automation,
/// and effect chains.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// Display name shown in the track list header.
    pub name: String,
    /// Composition role of this track.
    pub kind: TrackKind,
    /// CSS hex colour string (e.g. `"#3B82F6"`).
    pub color: String,
    /// Fader level. `1.0` = unity gain, range `[0.0, 2.0]`.
    pub volume: f64,
    /// Stereo pan. `0.0` = centre, range `[-1.0, 1.0]`.
    pub pan: f64,
    /// When `true` the track is silenced in the mix.
    pub muted: bool,
    /// When `true` all non-soloed tracks are silenced.
    pub soloed: bool,
    /// When `true` the track accepts live input recording.
    pub armed: bool,
    /// UUID of the assigned software instrument, if any.
    pub instrument_id: Option<String>,
}

impl Track {
    /// Creates a new `Track` with a generated UUID and sensible defaults.
    pub fn new(name: impl Into<String>, kind: TrackKind) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            kind,
            color: "#3B82F6".to_string(),
            volume: 1.0,
            pan: 0.0,
            muted: false,
            soloed: false,
            armed: false,
            instrument_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_new_generates_valid_uuid() {
        let track = Track::new("Test", TrackKind::Midi);
        assert_eq!(track.id.len(), 36); // UUID v4 is 36 chars with hyphens
        assert!(track.id.contains('-'));
    }

    #[test]
    fn track_new_has_correct_defaults() {
        let track = Track::new("My Track", TrackKind::Audio);
        assert_eq!(track.name, "My Track");
        assert_eq!(track.volume, 1.0);
        assert_eq!(track.pan, 0.0);
        assert!(!track.muted);
        assert!(!track.soloed);
        assert!(!track.armed);
        assert!(track.instrument_id.is_none());
        assert_eq!(track.color, "#3B82F6");
    }

    #[test]
    fn track_kind_serialises_to_pascal_case() {
        let json = serde_json::to_string(&TrackKind::Instrument).unwrap();
        assert_eq!(json, "\"Instrument\"");
    }

    #[test]
    fn track_serialises_and_deserialises() {
        let original = Track::new("Piano", TrackKind::Instrument);
        let json = serde_json::to_string(&original).unwrap();
        let restored: Track = serde_json::from_str(&json).unwrap();
        assert_eq!(original.id, restored.id);
        assert_eq!(original.name, restored.name);
        assert_eq!(original.kind, restored.kind);
    }

    #[test]
    fn two_tracks_get_unique_ids() {
        let a = Track::new("A", TrackKind::Audio);
        let b = Track::new("B", TrackKind::Audio);
        assert_ne!(a.id, b.id);
    }
}
