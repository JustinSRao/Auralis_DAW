/// A fixed-capacity list of step indices that fired within a single audio buffer.
///
/// Avoids heap allocation on the audio thread. At 300 BPM with 256-sample
/// buffers at 44100 Hz, at most ~11 steps can fire per buffer; 16 slots is
/// always sufficient.
pub struct FiredSteps {
    steps: [u8; 16],
    count: usize,
}

impl FiredSteps {
    fn new() -> Self {
        Self {
            steps: [0; 16],
            count: 0,
        }
    }

    fn push(&mut self, step: u8) {
        if self.count < 16 {
            self.steps[self.count] = step;
            self.count += 1;
        }
    }

    /// Iterates over all steps that fired in this buffer, in order.
    pub fn iter(&self) -> impl Iterator<Item = u8> + '_ {
        self.steps[..self.count].iter().copied()
    }

    /// Returns `true` if no steps fired.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
}

/// Sample-counting step clock for the drum machine.
///
/// Tracks how many samples remain before the next 16th-note step fires.
/// BPM and swing changes are applied at the start of each new step, so
/// mid-step BPM edits affect the *next* step's duration — no drift, no jumps.
///
/// # Swing
/// Swing delays the "upbeat" 16th notes (odd step indices: 1, 3, 5 …) by
/// `swing × step_duration` samples, giving the characteristic shuffle feel.
pub struct StepClock {
    /// Samples remaining before the next step fires.
    ///
    /// Initialized to `0` so the first step fires immediately on the first
    /// call to [`advance`] after [`play`](DrumMachine::play).
    samples_until_next: u64,
    /// Index of the step that will fire when `samples_until_next` reaches zero.
    pub next_step: u8,
    /// Total number of active steps in the pattern (16 or 32).
    pub pattern_length: u8,
}

impl StepClock {
    /// Creates a new clock ready to fire step 0 on the first buffer.
    pub fn new() -> Self {
        Self {
            samples_until_next: 0,
            next_step: 0,
            pattern_length: 16,
        }
    }

    /// Resets the clock to step 0, ready to fire immediately on next advance.
    pub fn reset(&mut self) {
        self.samples_until_next = 0;
        self.next_step = 0;
    }

    /// Returns the duration of a 16th-note step in samples.
    ///
    /// Formula: `(60 / bpm / 4) × sample_rate`
    /// where 4 = steps per beat (16th notes).
    fn step_duration(bpm: f32, sample_rate: f32) -> u64 {
        ((60.0 / bpm.max(1.0) / 4.0) * sample_rate).max(1.0) as u64
    }

    /// Returns the swing delay for a given step.
    ///
    /// Odd steps (1, 3, 5 …) are the upbeat 16th notes and are delayed by
    /// `swing × step_duration` samples. Even steps play on the grid.
    fn swing_offset(step_idx: u8, step_dur: u64, swing: f32) -> u64 {
        if step_idx % 2 == 1 {
            (swing.clamp(0.0, 0.5) * step_dur as f32) as u64
        } else {
            0
        }
    }

    /// Advances the clock by `buffer_len` samples and returns all steps that
    /// fired within that window.
    ///
    /// At typical settings (120 BPM, 256-sample buffer, 44100 Hz) at most one
    /// step fires per buffer; at extreme settings (300 BPM, 256 samples) up to
    /// ~11 steps may fire — all are captured without allocation.
    pub fn advance(
        &mut self,
        buffer_len: u64,
        bpm: f32,
        swing: f32,
        sample_rate: f32,
    ) -> FiredSteps {
        let mut fired = FiredSteps::new();
        let mut remaining = buffer_len;

        while self.samples_until_next <= remaining {
            remaining -= self.samples_until_next;
            let fired_step = self.next_step;
            fired.push(fired_step);

            // Advance to next step (guard pattern_length >= 1 to avoid division by zero)
            self.next_step = (self.next_step + 1) % self.pattern_length.max(1);

            // Compute duration of the NEXT step (swing applies to it now)
            let step_dur = Self::step_duration(bpm, sample_rate);
            let swing_off = Self::swing_offset(self.next_step, step_dur, swing);
            self.samples_until_next = step_dur + swing_off;
        }

        self.samples_until_next -= remaining;
        fired
    }
}

impl Default for StepClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BPM: f32 = 120.0;
    const SR: f32 = 44100.0;
    // 16th-note step duration at 120 BPM, 44100 Hz = 5512 samples
    fn step_dur() -> u64 {
        StepClock::step_duration(BPM, SR)
    }

    #[test]
    fn test_step_fires_immediately_on_first_buffer() {
        let mut clock = StepClock::new();
        let fired = clock.advance(256, BPM, 0.0, SR);
        // Step 0 should fire immediately (samples_until_next starts at 0)
        assert!(!fired.is_empty(), "Step 0 should fire on first buffer");
        let steps: Vec<u8> = fired.iter().collect();
        assert_eq!(steps[0], 0, "First step should be step 0");
    }

    #[test]
    fn test_step_advances_after_full_duration() {
        let mut clock = StepClock::new();
        let dur = step_dur();

        // Consume first immediate fire
        clock.advance(1, BPM, 0.0, SR);

        // Advance by exactly one step duration — step 1 should fire
        let fired = clock.advance(dur, BPM, 0.0, SR);
        let steps: Vec<u8> = fired.iter().collect();
        assert!(
            steps.contains(&1),
            "Step 1 should fire after one step duration, got {:?}",
            steps
        );
    }

    #[test]
    fn test_pattern_wraps_at_length() {
        let mut clock = StepClock::new();
        clock.pattern_length = 4;
        let dur = step_dur();

        // Fire all 4 steps by advancing 5 step durations
        let fired = clock.advance(dur * 5 + 1, BPM, 0.0, SR);
        let steps: Vec<u8> = fired.iter().collect();

        // All steps should be in range 0..4, and step 0 should appear twice
        assert!(
            steps.iter().all(|&s| s < 4),
            "All steps should be < pattern_length, got {:?}",
            steps
        );
        let count_zero = steps.iter().filter(|&&s| s == 0).count();
        assert!(count_zero >= 1, "Step 0 should appear at least once on wrap");
    }

    #[test]
    fn test_swing_delays_odd_steps() {
        // With 25% swing, step 1 fires at (step_dur + swing_offset) after step 0,
        // where swing_offset = swing * step_dur.
        // Without swing, step 1 fires at exactly step_dur.
        //
        // This test verifies: advancing by only (step_dur - 1) after step 0 should NOT
        // fire step 1 when swing is applied, because step 1 is delayed.
        let dur = step_dur();
        let swing = 0.25_f32;

        let mut clock_swing = StepClock::new();
        // Consume the initial immediate fire of step 0
        clock_swing.advance(1, BPM, swing, SR);

        // Advance by (dur - 1) samples — with swing, step 1 is not due yet
        // (it fires at dur + swing_offset, which is well beyond dur - 1)
        let fired = clock_swing.advance(dur - 1, BPM, swing, SR);
        let steps: Vec<u8> = fired.iter().collect();
        assert!(
            !steps.contains(&1),
            "With swing, step 1 should not fire at less than step_dur samples, got {:?}",
            steps
        );
    }

    #[test]
    fn test_reset_returns_to_step_zero() {
        let mut clock = StepClock::new();
        // Advance past step 0
        clock.advance(step_dur() * 3, BPM, 0.0, SR);
        let step_before = clock.next_step;
        assert!(step_before > 0, "Should have advanced past step 0");

        clock.reset();
        assert_eq!(clock.next_step, 0, "After reset, next_step should be 0");
        assert_eq!(
            clock.samples_until_next, 0,
            "After reset, should fire immediately"
        );
    }

    #[test]
    fn test_multiple_steps_per_buffer() {
        let mut clock = StepClock::new();
        let dur = step_dur();

        // Feed 4 step durations worth of samples in one call
        let fired = clock.advance(dur * 4 + 1, BPM, 0.0, SR);
        let steps: Vec<u8> = fired.iter().collect();

        // Should have fired steps 0, 1, 2, 3 (and maybe 4 depending on timing)
        assert!(
            steps.len() >= 4,
            "Should fire at least 4 steps, got {:?}",
            steps
        );
    }

    #[test]
    fn test_step_duration_increases_at_lower_bpm() {
        let dur_fast = StepClock::step_duration(180.0, SR);
        let dur_slow = StepClock::step_duration(60.0, SR);
        assert!(
            dur_slow > dur_fast,
            "Slower BPM should have longer step duration"
        );
    }
}
