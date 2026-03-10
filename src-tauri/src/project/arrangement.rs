//! Arrangement clip data structures for the song timeline.
//!
//! An [`ArrangementClip`] is a positioned instance of a [`Pattern`] placed on the
//! song timeline. Multiple clips may reference the same `pattern_id`, creating
//! repeated/linked instances.

use serde::{Deserialize, Serialize};

/// A single clip placed on the arrangement timeline.
///
/// Clips are lightweight references to patterns — they store only position and
/// sizing information. The actual MIDI or audio content lives in the pattern.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArrangementClip {
    /// Stable UUID for this clip placement.
    pub id: String,
    /// References a Pattern by its UUID.
    pub pattern_id: String,
    /// The track this clip lives on.
    pub track_id: String,
    /// Clip start position in bars (0-indexed).
    pub start_bar: f64,
    /// Clip length in bars. Defaults to the referenced pattern's `length_bars` on creation.
    pub length_bars: f64,
}

/// Root wrapper stored inside [`ProjectFile`] for all arrangement clip placements.
///
/// [`ProjectFile`]: crate::project::format::ProjectFile
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Arrangement {
    /// All clip placements across all tracks.
    #[serde(default)]
    pub clips: Vec<ArrangementClip>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_clip() -> ArrangementClip {
        ArrangementClip {
            id: "clip-001".to_string(),
            pattern_id: "pat-abc".to_string(),
            track_id: "track-1".to_string(),
            start_bar: 4.0,
            length_bars: 2.0,
        }
    }

    #[test]
    fn arrangement_clip_roundtrip_json() {
        let clip = make_clip();
        let json = serde_json::to_string(&clip).expect("serialize");
        let decoded: ArrangementClip = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(clip, decoded);
    }

    #[test]
    fn arrangement_clip_camel_case_fields() {
        let clip = make_clip();
        let json = serde_json::to_string(&clip).expect("serialize");
        assert!(json.contains("patternId"), "expected camelCase patternId");
        assert!(json.contains("trackId"), "expected camelCase trackId");
        assert!(json.contains("startBar"), "expected camelCase startBar");
        assert!(json.contains("lengthBars"), "expected camelCase lengthBars");
    }

    #[test]
    fn arrangement_default_is_empty() {
        let arr = Arrangement::default();
        assert!(arr.clips.is_empty());
    }

    #[test]
    fn arrangement_roundtrip_json() {
        let arr = Arrangement {
            clips: vec![make_clip()],
        };
        let json = serde_json::to_string(&arr).expect("serialize");
        let decoded: Arrangement = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(arr, decoded);
    }

    #[test]
    fn arrangement_deserializes_missing_clips_field_as_empty() {
        // Simulates a project file written before the `clips` field existed.
        let json = r#"{}"#;
        let arr: Arrangement = serde_json::from_str(json).expect("deserialize");
        assert!(arr.clips.is_empty());
    }
}
