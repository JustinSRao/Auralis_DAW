use serde::{Deserialize, Serialize};

/// Maximum number of steps in a sequencer pattern.
pub const MAX_SEQ_STEPS: usize = 64;

/// A single step in the sequencer pattern.
///
/// All fields are plain values — no heap allocation. The audio thread owns
/// a fixed array of `MAX_SEQ_STEPS` steps with no dynamic allocation.
#[derive(Debug, Clone, Copy)]
pub struct SequencerStep {
    /// Whether this step fires when the playhead reaches it.
    pub enabled: bool,
    /// MIDI note number (0–127). Default is middle C (60).
    pub note: u8,
    /// MIDI velocity (0–127). Default 100.
    pub velocity: u8,
    /// Gate length as a fraction of one step duration (0.0–1.0). Default 0.8.
    pub gate: f32,
    /// Probability that this step fires (0–100). Default 100 = always.
    pub probability: u8,
}

impl Default for SequencerStep {
    fn default() -> Self {
        Self {
            enabled: false,
            note: 60,
            velocity: 100,
            gate: 0.8,
            probability: 100,
        }
    }
}

/// Serializable mirror of [`SequencerStep`] for IPC snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequencerStepSnapshot {
    /// Whether this step fires.
    pub enabled: bool,
    /// MIDI note number.
    pub note: u8,
    /// MIDI velocity.
    pub velocity: u8,
    /// Gate fraction (0.0–1.0).
    pub gate: f32,
    /// Fire probability (0–100).
    pub probability: u8,
}

impl Default for SequencerStepSnapshot {
    fn default() -> Self {
        Self {
            enabled: false,
            note: 60,
            velocity: 100,
            gate: 0.8,
            probability: 100,
        }
    }
}

impl SequencerStepSnapshot {
    /// Converts this snapshot into an audio-thread [`SequencerStep`].
    pub fn to_step(&self) -> SequencerStep {
        SequencerStep {
            enabled: self.enabled,
            note: self.note,
            velocity: self.velocity,
            gate: self.gate,
            probability: self.probability,
        }
    }
}

impl From<&SequencerStep> for SequencerStepSnapshot {
    fn from(s: &SequencerStep) -> Self {
        Self {
            enabled: s.enabled,
            note: s.note,
            velocity: s.velocity,
            gate: s.gate,
            probability: s.probability,
        }
    }
}

/// Full serializable snapshot of sequencer state for the `get_sequencer_state` IPC command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequencerSnapshot {
    /// Whether the sequencer is currently playing.
    pub playing: bool,
    /// The index of the step that most recently fired.
    pub current_step: u8,
    /// How many steps are active in the pattern (1–64).
    pub pattern_length: u8,
    /// Step resolution: 4 = quarter, 8 = eighth, 16 = sixteenth, 32 = thirty-second.
    pub time_div: u8,
    /// Global transpose offset in semitones (-48 to +48).
    pub transpose: i8,
    /// All steps (length == pattern_length).
    pub steps: Vec<SequencerStepSnapshot>,
}
