//! Punch In/Out recording controller for the DAW.
//!
//! [`PunchController`] tracks the punch region (in/out points) and emits
//! [`PunchAction`] values when the playhead crosses those boundaries during
//! playback. The controller is polled from a background Tokio task at ~50 Hz
//! (every 20 ms); it never runs on the real-time audio thread.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Punch in/out marker positions expressed in both beats and samples.
///
/// Beat values are authoritative; sample values are derived and recomputed
/// whenever the BPM changes via [`PunchController::recalculate_samples`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PunchMarkers {
    /// Punch-in position in beats (recording starts here).
    pub punch_in_beats: f64,
    /// Punch-out position in beats (recording stops here).
    pub punch_out_beats: f64,
    /// Punch-in position in samples (derived from beats + BPM).
    pub punch_in_samples: u64,
    /// Punch-out position in samples (derived from beats + BPM).
    pub punch_out_samples: u64,
}

/// Action requested by [`PunchController::tick`].
///
/// The caller (punch watcher task in `lib.rs`) acts on these to start or stop
/// the audio recorder without the controller needing to own any recorder state.
#[derive(Debug, Clone, PartialEq)]
pub enum PunchAction {
    /// Playhead crossed the punch-in point — start audio recording.
    StartAudioRecording,
    /// Playhead crossed the punch-out point — stop audio recording.
    StopAudioRecording,
    /// Playhead crossed the punch-in point — start MIDI recording (deferred).
    StartMidiRecording,
    /// Playhead crossed the punch-out point — stop MIDI recording (deferred).
    StopMidiRecording,
    /// No action required this tick.
    Nothing,
}

/// Manages punch in/out state and produces [`PunchAction`] values.
///
/// This struct is **not** on the audio thread. It is polled by a background
/// Tokio task at ~50 Hz and wrapped in `Arc<Mutex<>>` for Tauri managed state.
pub struct PunchController {
    /// Current punch region markers.
    pub markers: PunchMarkers,
    /// Whether punch recording mode is enabled at all.
    pub punch_enabled: bool,
    /// Number of bars to play back before the punch-in point so the performer
    /// has context before recording begins.
    ///
    /// **Not yet active at runtime.** The field is persisted in the project file
    /// and surfaced in the UI; actual pre-roll transport seeking is deferred to
    /// a future sprint.
    pub pre_roll_bars: u32,
    /// Whether the recorder is currently inside an active punch region.
    recording_active: bool,
}

/// Type alias for [`PunchController`] wrapped in `Arc<Mutex<>>` for Tauri.
pub type PunchControllerState = Arc<Mutex<PunchController>>;

// ---------------------------------------------------------------------------
// PunchController implementation
// ---------------------------------------------------------------------------

impl PunchController {
    /// Creates a new controller with default settings.
    ///
    /// Defaults: punch disabled, 2 pre-roll bars, punch-in at beat 0, punch-out at beat 8.
    pub fn new() -> Self {
        Self {
            markers: PunchMarkers {
                punch_in_beats: 0.0,
                punch_out_beats: 8.0,
                punch_in_samples: 0,
                punch_out_samples: 0,
            },
            punch_enabled: false,
            pre_roll_bars: 2,
            recording_active: false,
        }
    }

    /// Evaluates the current playhead position and returns the action to take.
    ///
    /// # Arguments
    /// * `playhead_samples` – current playhead position read from the transport atomics.
    /// * `is_playing` – whether the transport is currently playing.
    /// * `recorder_is_active` – whether the audio recorder is already in the recording state.
    ///
    /// The controller uses `recorder_is_active` to synchronise its internal
    /// `recording_active` flag with the true recorder state, so it handles
    /// cases where recording was started or stopped externally.
    pub fn tick(
        &mut self,
        playhead_samples: u64,
        is_playing: bool,
        recorder_is_active: bool,
    ) -> PunchAction {
        if !self.punch_enabled || !is_playing {
            return PunchAction::Nothing;
        }

        // If punch-in equals punch-out, the region is degenerate — do nothing.
        if self.markers.punch_in_samples >= self.markers.punch_out_samples {
            return PunchAction::Nothing;
        }

        // Check punch-in: playhead has reached or passed punch-in, not yet recording.
        if !self.recording_active
            && !recorder_is_active
            && playhead_samples >= self.markers.punch_in_samples
            && playhead_samples < self.markers.punch_out_samples
        {
            self.recording_active = true;
            return PunchAction::StartAudioRecording;
        }

        // Check punch-out: playhead has reached or passed punch-out, currently recording.
        if (self.recording_active || recorder_is_active)
            && playhead_samples >= self.markers.punch_out_samples
        {
            self.recording_active = false;
            return PunchAction::StopAudioRecording;
        }

        PunchAction::Nothing
    }

    /// Recomputes sample positions from beat values at the given samples-per-beat rate.
    pub fn recalculate_samples(&mut self, samples_per_beat: f64) {
        self.markers.punch_in_samples = (self.markers.punch_in_beats * samples_per_beat) as u64;
        self.markers.punch_out_samples = (self.markers.punch_out_beats * samples_per_beat) as u64;
    }

    /// Sets the punch-in point in beats and recomputes the sample position.
    pub fn set_punch_in(&mut self, beats: f64, spb: f64) {
        self.markers.punch_in_beats = beats.max(0.0);
        self.recalculate_samples(spb);
    }

    /// Sets the punch-out point in beats and recomputes the sample position.
    pub fn set_punch_out(&mut self, beats: f64, spb: f64) {
        self.markers.punch_out_beats = beats.max(0.0);
        self.recalculate_samples(spb);
    }
}

impl Default for PunchController {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_controller() -> PunchController {
        let mut ctrl = PunchController::new();
        // Enable punch and set a region: in at sample 1000, out at sample 5000
        ctrl.punch_enabled = true;
        ctrl.markers.punch_in_samples = 1000;
        ctrl.markers.punch_out_samples = 5000;
        ctrl
    }

    #[test]
    fn tick_returns_nothing_when_punch_disabled() {
        let mut ctrl = PunchController::new();
        ctrl.punch_enabled = false;
        ctrl.markers.punch_in_samples = 100;
        ctrl.markers.punch_out_samples = 500;
        let action = ctrl.tick(200, true, false);
        assert_eq!(action, PunchAction::Nothing);
    }

    #[test]
    fn tick_returns_nothing_when_not_playing() {
        let mut ctrl = make_controller();
        let action = ctrl.tick(2000, false, false);
        assert_eq!(action, PunchAction::Nothing);
    }

    #[test]
    fn tick_starts_recording_at_punch_in() {
        let mut ctrl = make_controller();
        // Playhead exactly at punch-in
        let action = ctrl.tick(1000, true, false);
        assert_eq!(action, PunchAction::StartAudioRecording);
        assert!(ctrl.recording_active);
    }

    #[test]
    fn tick_stops_recording_at_punch_out() {
        let mut ctrl = make_controller();
        // Simulate that recording was already started
        ctrl.recording_active = true;
        // Playhead at or past punch-out
        let action = ctrl.tick(5000, true, true);
        assert_eq!(action, PunchAction::StopAudioRecording);
        assert!(!ctrl.recording_active);
    }

    #[test]
    fn tick_handles_punch_in_equals_punch_out_gracefully() {
        let mut ctrl = PunchController::new();
        ctrl.punch_enabled = true;
        ctrl.markers.punch_in_samples = 1000;
        ctrl.markers.punch_out_samples = 1000; // degenerate region
        let action = ctrl.tick(1000, true, false);
        assert_eq!(action, PunchAction::Nothing);
    }

    #[test]
    fn recalculate_samples_correct_at_120bpm() {
        // At 120 BPM with 44100 Hz: spb = 44100 * 60 / 120 = 22050
        let spb = 22050.0_f64;
        let mut ctrl = PunchController::new();
        ctrl.markers.punch_in_beats = 4.0;
        ctrl.markers.punch_out_beats = 8.0;
        ctrl.recalculate_samples(spb);
        assert_eq!(ctrl.markers.punch_in_samples, (4.0 * spb) as u64);
        assert_eq!(ctrl.markers.punch_out_samples, (8.0 * spb) as u64);
    }

    #[test]
    fn set_punch_in_updates_samples() {
        let spb = 22050.0_f64;
        let mut ctrl = PunchController::new();
        ctrl.markers.punch_out_beats = 8.0;
        ctrl.markers.punch_out_samples = (8.0 * spb) as u64;
        ctrl.set_punch_in(2.0, spb);
        assert_eq!(ctrl.markers.punch_in_beats, 2.0);
        assert_eq!(ctrl.markers.punch_in_samples, (2.0 * spb) as u64);
    }
}
