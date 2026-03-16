//! MIDI recording session management.
//!
//! Handles real-time MIDI input capture to pattern notes. The recorder
//! runs a drain thread that reads `TimestampedMidiEvent` from a crossbeam
//! channel, converts NoteOn/NoteOff pairs into `PatternMidiNote` with beat
//! positions derived from `TransportAtomics`, and emits Tauri events for
//! the frontend to update the pattern store in real time.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use uuid::Uuid;

use crate::audio::transport::TransportAtomics;
use crate::project::pattern::PatternMidiNote;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Minimum note duration in beats (equivalent to 1 tick at 960 PPQ).
pub const MIN_NOTE_DURATION_BEATS: f64 = 4.0 / 960.0;

// ---------------------------------------------------------------------------
// Quantize / mode enums
// ---------------------------------------------------------------------------

/// Quantize grid applied to recorded note start times.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordQuantize {
    /// No quantization — notes land at raw beat position.
    Off,
    /// Snap to quarter-note grid (1 beat).
    Quarter,
    /// Snap to eighth-note grid (0.5 beat).
    Eighth,
    /// Snap to sixteenth-note grid (0.25 beat).
    Sixteenth,
    /// Snap to thirty-second-note grid (0.125 beat).
    ThirtySecond,
}

/// Whether recording overwrites existing notes or adds on top.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordMode {
    /// Erase existing pattern notes before recording begins.
    Replace,
    /// Keep existing pattern notes and mix new notes on top.
    Overdub,
}

// ---------------------------------------------------------------------------
// Pending note (NoteOn awaiting NoteOff)
// ---------------------------------------------------------------------------

/// A NoteOn event awaiting its matching NoteOff.
#[derive(Debug, Clone)]
pub struct PendingNote {
    /// MIDI pitch `[0, 127]`.
    pub pitch: u8,
    /// MIDI channel `[0, 15]`.
    pub channel: u8,
    /// MIDI velocity `[1, 127]`.
    pub velocity: u8,
    /// Beat position at the time of NoteOn (quantized if applicable).
    pub start_beats: f64,
}

// ---------------------------------------------------------------------------
// Recording session
// ---------------------------------------------------------------------------

/// Active recording session state shared between the command handler and drain thread.
#[derive(Debug)]
pub struct RecordSession {
    /// Pattern being recorded into.
    pub pattern_id: String,
    /// Track that owns the pattern.
    pub track_id: String,
    /// Quantize grid for incoming note start times.
    pub quantize: RecordQuantize,
    /// Overdub or replace mode.
    pub mode: RecordMode,
    /// Transport beat position when recording started.
    pub session_start_beats: f64,
    /// Map of `(channel, pitch)` → pending NoteOn.
    pub pending: HashMap<(u8, u8), PendingNote>,
}

/// Handle stored in managed state while a recording is active.
pub struct RecorderHandle {
    /// Active session state.
    pub session: RecordSession,
}

/// Managed state type: `Some(handle)` while recording, `None` otherwise.
pub type MidiRecorderState = Arc<Mutex<Option<RecorderHandle>>>;

// ---------------------------------------------------------------------------
// Tauri event payload types
// ---------------------------------------------------------------------------

/// Emitted when a note is fully recorded (NoteOff received).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedNoteEvent {
    /// The pattern the note was recorded into.
    pub pattern_id: String,
    /// The completed note.
    pub note: PatternMidiNote,
}

/// Emitted when recording starts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStartedEvent {
    /// The pattern being recorded into.
    pub pattern_id: String,
    /// The owning track.
    pub track_id: String,
    /// `"replace"` or `"overdub"`.
    pub mode: String,
}

/// Emitted when recording stops (after all pending notes flushed).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStoppedEvent {
    /// The pattern that was being recorded into.
    pub pattern_id: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Snaps `beat` to the nearest grid boundary defined by `quantize`.
///
/// When `quantize` is `Off`, returns `beat` unchanged.
pub fn snap_beat(beat: f64, quantize: RecordQuantize) -> f64 {
    let grid = match quantize {
        RecordQuantize::Off => return beat,
        RecordQuantize::Quarter => 1.0,
        RecordQuantize::Eighth => 0.5,
        RecordQuantize::Sixteenth => 0.25,
        RecordQuantize::ThirtySecond => 0.125,
    };
    (beat / grid).round() * grid
}

/// Reads the current beat position from the transport atomics.
///
/// Uses `Relaxed` ordering — a few microseconds of staleness is acceptable
/// for recording; the audio thread updates these atomics every buffer period.
pub fn current_beat_position(atomics: &TransportAtomics) -> f64 {
    use std::sync::atomic::Ordering;
    let samples = atomics.playhead_samples.load(Ordering::Relaxed);
    let spb_bits = atomics.samples_per_beat_bits.load(Ordering::Relaxed);
    let spb = f64::from_bits(spb_bits);
    if spb == 0.0 {
        return 0.0;
    }
    samples as f64 / spb
}

/// Emits a `"midi-recorded-note"` Tauri event for a completed note.
///
/// The note duration is clamped to at least `MIN_NOTE_DURATION_BEATS`.
pub fn emit_note(app_handle: &tauri::AppHandle, pattern_id: &str, pending: &PendingNote, end_beats: f64) {
    let duration = (end_beats - pending.start_beats).max(MIN_NOTE_DURATION_BEATS);
    let note = PatternMidiNote {
        id: Uuid::new_v4().to_string(),
        pitch: pending.pitch,
        start_beats: pending.start_beats,
        duration_beats: duration,
        velocity: pending.velocity,
        channel: pending.channel,
    };
    let payload = RecordedNoteEvent {
        pattern_id: pattern_id.to_string(),
        note,
    };
    if let Err(e) = app_handle.emit("midi-recorded-note", &payload) {
        log::warn!("Failed to emit midi-recorded-note: {}", e);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_beat_off_returns_unchanged() {
        assert!((snap_beat(1.337, RecordQuantize::Off) - 1.337).abs() < 1e-9);
    }

    #[test]
    fn snap_beat_quarter_snaps_correctly() {
        assert!((snap_beat(0.4, RecordQuantize::Quarter) - 0.0).abs() < 1e-9);
        assert!((snap_beat(0.6, RecordQuantize::Quarter) - 1.0).abs() < 1e-9);
        assert!((snap_beat(1.5, RecordQuantize::Quarter) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn snap_beat_eighth_snaps_correctly() {
        assert!((snap_beat(0.2, RecordQuantize::Eighth) - 0.0).abs() < 1e-9);
        assert!((snap_beat(0.3, RecordQuantize::Eighth) - 0.5).abs() < 1e-9);
        assert!((snap_beat(0.75, RecordQuantize::Eighth) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn snap_beat_sixteenth_snaps_correctly() {
        assert!((snap_beat(0.1, RecordQuantize::Sixteenth) - 0.0).abs() < 1e-9);
        assert!((snap_beat(0.13, RecordQuantize::Sixteenth) - 0.25).abs() < 1e-9);
    }

    #[test]
    fn snap_beat_thirty_second_snaps_correctly() {
        assert!((snap_beat(0.06, RecordQuantize::ThirtySecond) - 0.0).abs() < 1e-9);
        assert!((snap_beat(0.065, RecordQuantize::ThirtySecond) - 0.125).abs() < 1e-9);
    }

    #[test]
    fn min_note_duration_is_positive() {
        assert!(MIN_NOTE_DURATION_BEATS > 0.0);
    }

    #[test]
    fn current_beat_at_zero() {
        let atomics = TransportAtomics::new(120.0, 44100);
        let beat = current_beat_position(&atomics);
        assert!((beat - 0.0).abs() < 1e-9);
    }
}
