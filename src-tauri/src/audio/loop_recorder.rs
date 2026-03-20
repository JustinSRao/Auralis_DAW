//! Loop record controller for detecting loop boundaries during recording.
//!
//! [`LoopRecordController`] monitors the transport playhead position and
//! emits [`LoopRecordAction`] values when the playhead wraps at the loop
//! end boundary. This is the trigger for creating a new take.
//!
//! The controller is polled at ~50 Hz from a background Tokio task. It is
//! never on the real-time audio thread.

use std::sync::{Arc, Mutex};

/// Action emitted by [`LoopRecordController::tick`].
#[derive(Debug, Clone, PartialEq)]
pub enum LoopRecordAction {
    /// Playhead wrapped at loop boundary — finalize current take and start next.
    LoopWrapped,
    /// No action required this tick.
    Nothing,
}

/// Detects loop boundary crossings during active recording.
///
/// Wrapped in `Arc<Mutex<>>` for Tauri managed state, polled at ~50 Hz.
pub struct LoopRecordController {
    /// Whether loop recording is currently in progress.
    pub recording_active: bool,
    /// Which track is being loop-recorded into.
    pub track_id: Option<String>,
    /// Loop start in samples (recomputed on BPM change).
    pub loop_start_samples: u64,
    /// Loop end in samples (recomputed on BPM change).
    pub loop_end_samples: u64,
    /// Loop start in beats (authoritative).
    pub loop_start_beats: f64,
    /// Loop end in beats (authoritative).
    pub loop_end_beats: f64,
    /// Whether the transport loop is currently enabled.
    pub loop_enabled: bool,
    /// Previous playhead position for wrap detection.
    last_position: u64,
    /// Whether the previous tick saw the transport as playing.
    was_playing: bool,
}

pub type LoopRecordControllerState = Arc<Mutex<LoopRecordController>>;

impl LoopRecordController {
    pub fn new() -> Self {
        Self {
            recording_active: false,
            track_id: None,
            loop_start_samples: 0,
            loop_end_samples: 0,
            loop_start_beats: 0.0,
            loop_end_beats: 0.0,
            loop_enabled: false,
            last_position: 0,
            was_playing: false,
        }
    }

    /// Called each tick (~50 Hz). Returns the action to take.
    pub fn tick(&mut self, playhead_samples: u64, is_playing: bool) -> LoopRecordAction {
        if !self.recording_active || !self.loop_enabled || !is_playing {
            self.last_position = playhead_samples;
            self.was_playing = is_playing;
            return LoopRecordAction::Nothing;
        }

        // Degenerate loop region: do nothing
        if self.loop_start_samples >= self.loop_end_samples {
            self.last_position = playhead_samples;
            return LoopRecordAction::Nothing;
        }

        let wrapped = if self.was_playing {
            // Wrap detected: position went backward (loop reset) or jumped back to start
            playhead_samples < self.last_position
                || (self.last_position < self.loop_end_samples
                    && playhead_samples >= self.loop_end_samples)
        } else {
            false
        };

        self.last_position = playhead_samples;
        self.was_playing = is_playing;

        if wrapped {
            LoopRecordAction::LoopWrapped
        } else {
            LoopRecordAction::Nothing
        }
    }

    /// Updates loop region from transport snapshot values.
    pub fn update_loop_region(
        &mut self,
        loop_start_samples: u64,
        loop_end_samples: u64,
        loop_start_beats: f64,
        loop_end_beats: f64,
        loop_enabled: bool,
    ) {
        self.loop_start_samples = loop_start_samples;
        self.loop_end_samples = loop_end_samples;
        self.loop_start_beats = loop_start_beats;
        self.loop_end_beats = loop_end_beats;
        self.loop_enabled = loop_enabled;
    }

    /// Recomputes sample positions from beat values at the new BPM.
    pub fn recalculate_samples(&mut self, samples_per_beat: f64) {
        self.loop_start_samples = (self.loop_start_beats * samples_per_beat) as u64;
        self.loop_end_samples = (self.loop_end_beats * samples_per_beat) as u64;
    }

    /// Starts loop recording for the given track.
    pub fn start(&mut self, track_id: String) {
        self.recording_active = true;
        self.track_id = Some(track_id);
        self.last_position = 0;
    }

    /// Stops loop recording.
    pub fn stop(&mut self) {
        self.recording_active = false;
        self.track_id = None;
    }
}

impl Default for LoopRecordController {
    fn default() -> Self { Self::new() }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    fn make_controller() -> LoopRecordController {
        let mut ctrl = LoopRecordController::new();
        ctrl.recording_active = true;
        ctrl.loop_enabled = true;
        ctrl.loop_start_samples = 0;
        ctrl.loop_end_samples = 44100 * 4; // 4 seconds
        ctrl.loop_start_beats = 0.0;
        ctrl.loop_end_beats = 8.0;
        ctrl
    }

    #[test]
    fn tick_nothing_when_not_recording() {
        let mut ctrl = make_controller();
        ctrl.recording_active = false;
        assert_eq!(ctrl.tick(1000, true), LoopRecordAction::Nothing);
    }

    #[test]
    fn tick_nothing_when_loop_disabled() {
        let mut ctrl = make_controller();
        ctrl.loop_enabled = false;
        assert_eq!(ctrl.tick(1000, true), LoopRecordAction::Nothing);
    }

    #[test]
    fn tick_nothing_when_not_playing() {
        let mut ctrl = make_controller();
        assert_eq!(ctrl.tick(1000, false), LoopRecordAction::Nothing);
    }

    #[test]
    fn tick_detects_position_regression_as_wrap() {
        let mut ctrl = make_controller();
        ctrl.was_playing = true;
        // Simulate moving forward then backward (loop wrap)
        ctrl.tick(10000, true); // advance — sets last_position = 10000
        let action = ctrl.tick(100, true); // position jumped back = wrap
        assert_eq!(action, LoopRecordAction::LoopWrapped);
    }

    #[test]
    fn tick_no_wrap_when_moving_forward() {
        let mut ctrl = make_controller();
        ctrl.was_playing = true;
        ctrl.tick(1000, true);
        let action = ctrl.tick(2000, true);
        assert_eq!(action, LoopRecordAction::Nothing);
    }

    #[test]
    fn tick_degenerate_loop_region_returns_nothing() {
        let mut ctrl = make_controller();
        ctrl.loop_start_samples = 5000;
        ctrl.loop_end_samples = 5000; // degenerate
        ctrl.was_playing = true;
        ctrl.tick(5000, true);
        assert_eq!(ctrl.tick(100, true), LoopRecordAction::Nothing);
    }

    #[test]
    fn recalculate_samples_at_120bpm() {
        let spb = 22050.0_f64; // 44100 / 2 = 22050 samples per beat at 120 BPM
        let mut ctrl = LoopRecordController::new();
        ctrl.loop_start_beats = 0.0;
        ctrl.loop_end_beats = 4.0;
        ctrl.recalculate_samples(spb);
        assert_eq!(ctrl.loop_start_samples, 0);
        assert_eq!(ctrl.loop_end_samples, (4.0 * spb) as u64);
    }

    #[test]
    fn start_sets_recording_active() {
        let mut ctrl = LoopRecordController::new();
        ctrl.start("track-1".to_string());
        assert!(ctrl.recording_active);
        assert_eq!(ctrl.track_id, Some("track-1".to_string()));
    }

    #[test]
    fn stop_clears_state() {
        let mut ctrl = LoopRecordController::new();
        ctrl.start("track-1".to_string());
        ctrl.stop();
        assert!(!ctrl.recording_active);
        assert!(ctrl.track_id.is_none());
    }
}
