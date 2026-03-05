use serde::{Deserialize, Serialize};

/// Maximum number of pads in the drum machine.
pub const MAX_PADS: usize = 16;

/// Maximum number of steps in a pattern (supports both 16 and 32-step modes).
pub const MAX_STEPS: usize = 32;

/// A single step in the drum pattern grid.
///
/// Stored as a compact value type that fits in a 2-D array without allocation.
#[derive(Debug, Clone, Copy, Default)]
pub struct DrumStep {
    /// Whether this step triggers its pad's sample.
    pub active: bool,
    /// Velocity for this step (1–127), used to scale the pad's amplitude.
    pub velocity: u8,
}

/// The complete 16-pad × 32-step pattern grid.
///
/// Stored as a flat 2-D array on the audio thread. Writes arrive via the
/// `DrumCommand` channel; no locks are needed during rendering.
pub struct DrumPattern {
    /// `steps[pad_idx][step_idx]` — 16 pads × 32 steps.
    pub steps: [[DrumStep; MAX_STEPS]; MAX_PADS],
}

impl DrumPattern {
    /// Creates a new pattern with all steps inactive and velocity 100.
    pub fn new() -> Self {
        Self {
            steps: [[DrumStep {
                active: false,
                velocity: 100,
            }; MAX_STEPS]; MAX_PADS],
        }
    }

    /// Sets a single step's active state and velocity.
    ///
    /// Silently ignores out-of-range indices.
    pub fn set_step(&mut self, pad_idx: u8, step_idx: u8, active: bool, velocity: u8) {
        let p = pad_idx as usize;
        let s = step_idx as usize;
        if p < MAX_PADS && s < MAX_STEPS {
            self.steps[p][s].active = active;
            self.steps[p][s].velocity = velocity.clamp(1, 127);
        }
    }

    /// Returns the step at the given pad and step indices.
    ///
    /// Returns a default (inactive) step for out-of-range indices.
    pub fn get_step(&self, pad_idx: u8, step_idx: u8) -> DrumStep {
        let p = pad_idx as usize;
        let s = step_idx as usize;
        if p < MAX_PADS && s < MAX_STEPS {
            self.steps[p][s]
        } else {
            DrumStep::default()
        }
    }
}

impl Default for DrumPattern {
    fn default() -> Self {
        Self::new()
    }
}

// ── Serializable snapshot types ───────────────────────────────────────────────

/// Serializable snapshot of a single step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrumStepSnapshot {
    /// Whether the step is active.
    pub active: bool,
    /// Step velocity (1–127).
    pub velocity: u8,
}

/// Serializable snapshot of a single pad's state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrumPadSnapshot {
    /// Zero-based pad index (0–15).
    pub idx: u8,
    /// Human-readable pad name (typically the sample filename).
    pub name: String,
    /// Whether a sample is loaded into this pad.
    pub has_sample: bool,
    /// Step grid for this pad (length matches the current pattern_length).
    pub steps: Vec<DrumStepSnapshot>,
}

impl DrumPadSnapshot {
    /// Creates a default empty pad snapshot with `pattern_length` inactive steps.
    pub fn default_for_idx(idx: u8, pattern_length: usize) -> Self {
        Self {
            idx,
            name: format!("Pad {}", idx + 1),
            has_sample: false,
            steps: (0..pattern_length)
                .map(|_| DrumStepSnapshot {
                    active: false,
                    velocity: 100,
                })
                .collect(),
        }
    }
}

/// Full serializable snapshot of the drum machine state.
///
/// Returned by `get_drum_state` and used for project file serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrumMachineSnapshot {
    /// Current playback tempo in BPM.
    pub bpm: f32,
    /// Swing amount (0.0–0.5).
    pub swing: f32,
    /// Active pattern length (16 or 32).
    pub pattern_length: u8,
    /// Whether the drum machine is currently playing.
    pub playing: bool,
    /// Index of the step currently highlighted as the playhead.
    pub current_step: u8,
    /// Per-pad state including step grid.
    pub pads: Vec<DrumPadSnapshot>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_pattern_all_inactive() {
        let pattern = DrumPattern::new();
        for p in 0..MAX_PADS {
            for s in 0..MAX_STEPS {
                let step = pattern.get_step(p as u8, s as u8);
                assert!(!step.active, "Step [{p}][{s}] should be inactive by default");
            }
        }
    }

    #[test]
    fn test_new_pattern_default_velocity_100() {
        let pattern = DrumPattern::new();
        let step = pattern.get_step(0, 0);
        assert_eq!(step.velocity, 100, "Default velocity should be 100");
    }

    #[test]
    fn test_set_step_activates_step() {
        let mut pattern = DrumPattern::new();
        pattern.set_step(0, 0, true, 100);
        assert!(pattern.get_step(0, 0).active, "Step should be active after set_step");
    }

    #[test]
    fn test_set_step_velocity_stored() {
        let mut pattern = DrumPattern::new();
        pattern.set_step(3, 7, true, 80);
        let step = pattern.get_step(3, 7);
        assert_eq!(step.velocity, 80, "Velocity should be stored correctly");
    }

    #[test]
    fn test_set_step_velocity_clamped_to_127() {
        let mut pattern = DrumPattern::new();
        pattern.set_step(0, 0, true, 200); // 200 > 127, should clamp
        assert_eq!(
            pattern.get_step(0, 0).velocity,
            127,
            "Velocity should clamp to 127"
        );
    }

    #[test]
    fn test_set_step_velocity_clamped_minimum_1() {
        let mut pattern = DrumPattern::new();
        pattern.set_step(0, 0, true, 0); // 0 < 1, should clamp
        assert_eq!(
            pattern.get_step(0, 0).velocity,
            1,
            "Velocity should clamp to minimum 1"
        );
    }

    #[test]
    fn test_set_step_out_of_bounds_ignored() {
        let mut pattern = DrumPattern::new();
        // These should not panic
        pattern.set_step(16, 0, true, 100); // pad out of range
        pattern.set_step(0, 32, true, 100); // step out of range
        pattern.set_step(255, 255, true, 100);
    }

    #[test]
    fn test_get_step_out_of_bounds_returns_default() {
        let pattern = DrumPattern::new();
        let step = pattern.get_step(16, 0);
        assert!(!step.active, "Out-of-bounds step should return inactive default");
    }

    #[test]
    fn test_set_step_deactivate() {
        let mut pattern = DrumPattern::new();
        pattern.set_step(0, 0, true, 100);
        pattern.set_step(0, 0, false, 100);
        assert!(!pattern.get_step(0, 0).active, "Step should be deactivated");
    }

    #[test]
    fn test_pad_snapshot_default() {
        let snap = DrumPadSnapshot::default_for_idx(3, 16);
        assert_eq!(snap.idx, 3);
        assert_eq!(snap.name, "Pad 4");
        assert!(!snap.has_sample);
        assert_eq!(snap.steps.len(), 16);
        assert!(snap.steps.iter().all(|s| !s.active));
    }
}
