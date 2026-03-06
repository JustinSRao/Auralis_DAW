/// A fixed-capacity list of step indices that fired within a single audio buffer.
///
/// Avoids heap allocation on the audio thread. At 300 BPM with 32nd-note steps
/// and 256-sample buffers at 44100 Hz, at most a handful of steps fire per
/// buffer; 16 slots is always sufficient.
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

/// Sample-counting step clock for the step sequencer.
///
/// Mirrors the drum machine `StepClock` but adds a `time_div_factor` so the
/// step duration adapts to quarter, eighth, sixteenth, or thirty-second notes.
///
/// # Time-division mapping
/// | `time_div` (raw) | Factor | Note value  |
/// |------------------|--------|-------------|
/// | 4                | 1.0    | Quarter     |
/// | 8                | 2.0    | Eighth      |
/// | 16               | 4.0    | Sixteenth   |
/// | 32               | 8.0    | Thirty-second |
///
/// `time_div_factor = time_div as f32 / 4.0`
pub struct SequencerClock {
    /// Samples remaining before the next step fires.
    ///
    /// Initialized to `0` so step 0 fires immediately on the first call to
    /// [`advance`] after playback starts.
    samples_until_next: u64,
    /// Index of the step that fires when `samples_until_next` hits zero.
    pub current_step: u8,
    /// Number of active steps in the pattern (1–64).
    pub pattern_length: u8,
}

impl SequencerClock {
    /// Creates a new clock ready to fire step 0 on the first buffer.
    pub fn new() -> Self {
        Self {
            samples_until_next: 0,
            current_step: 0,
            pattern_length: 16,
        }
    }

    /// Resets the clock to step 0, firing immediately on the next advance.
    pub fn reset(&mut self) {
        self.samples_until_next = 0;
        self.current_step = 0;
    }

    /// Returns the step duration in samples for the given BPM and time-division factor.
    ///
    /// Formula: `(60 / bpm / time_div_factor) * sample_rate`
    ///
    /// Examples at 120 BPM, 44100 Hz:
    /// - Quarter note (factor 1.0): 22050 samples
    /// - Sixteenth note (factor 4.0): 5512 samples
    pub fn step_duration(bpm: f64, time_div_factor: f32, sample_rate: f32) -> u64 {
        ((60.0 / bpm.max(1.0) / time_div_factor as f64) * sample_rate as f64).max(1.0) as u64
    }

    /// Advances the clock by `buffer_len` samples and returns all step indices
    /// that fired within that window.
    ///
    /// Changes to `bpm` or `time_div_factor` take effect from the *next* step's
    /// duration computation — there is no mid-step jitter.
    pub fn advance(
        &mut self,
        buffer_len: u64,
        bpm: f64,
        time_div_factor: f32,
        sr: f32,
    ) -> FiredSteps {
        let mut fired = FiredSteps::new();
        let mut remaining = buffer_len;

        while self.samples_until_next <= remaining {
            remaining -= self.samples_until_next;
            let fired_step = self.current_step;
            fired.push(fired_step);

            // Advance to next step, wrapping at pattern_length
            self.current_step = (self.current_step + 1) % self.pattern_length.max(1);

            // Compute duration of the next step
            self.samples_until_next = Self::step_duration(bpm, time_div_factor, sr);
        }

        self.samples_until_next -= remaining;
        fired
    }
}

impl Default for SequencerClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BPM: f64 = 120.0;
    const SR: f32 = 44100.0;

    #[test]
    fn test_quarter_note_at_120bpm() {
        // 60 / 120 / 1.0 * 44100 = 22050
        let dur = SequencerClock::step_duration(BPM, 1.0, SR);
        assert_eq!(dur, 22050, "quarter note at 120 BPM should be 22050 samples");
    }

    #[test]
    fn test_sixteenth_note_at_120bpm() {
        // 60 / 120 / 4.0 * 44100 = 5512.5 -> 5512
        let dur = SequencerClock::step_duration(BPM, 4.0, SR);
        assert_eq!(dur, 5512, "sixteenth note at 120 BPM should be 5512 samples");
    }

    #[test]
    fn test_fires_on_first_buffer() {
        let mut clock = SequencerClock::new();
        let fired = clock.advance(1, BPM, 4.0, SR);
        assert!(!fired.is_empty(), "step 0 should fire on first buffer");
        let steps: Vec<u8> = fired.iter().collect();
        assert_eq!(steps[0], 0, "first step should be step 0");
    }

    #[test]
    fn test_wraps_at_pattern_length() {
        let mut clock = SequencerClock::new();
        clock.pattern_length = 4;
        let dur = SequencerClock::step_duration(BPM, 4.0, SR); // 5512 samples each

        // Advance enough to fire all 4 steps plus wrap back to step 0
        let total = dur * 5 + 1;
        let fired = clock.advance(total, BPM, 4.0, SR);
        let steps: Vec<u8> = fired.iter().collect();

        assert!(
            steps.iter().all(|&s| s < 4),
            "all steps should be < pattern_length, got {:?}",
            steps
        );
        let count_zero = steps.iter().filter(|&&s| s == 0).count();
        assert!(count_zero >= 1, "step 0 should appear at least once (wrap), got {:?}", steps);
    }

    #[test]
    fn test_time_div_change_next_step() {
        // Verify that time_div_factor changes take effect for the NEXT step duration
        // computed after a step fires, not retroactively for the already-scheduled step.
        //
        // When step 0 fires (factor=4.0 passed to advance), the clock sets step 1's
        // countdown to 5512 samples (16th note). Switching to factor=1.0 on the next
        // advance() call only affects step 2's countdown (set when step 1 fires).
        let mut clock = SequencerClock::new();
        clock.pattern_length = 8;

        // Fire step 0; clock schedules step 1 with factor=4.0 -> 5512 samples.
        let fired0 = clock.advance(1, BPM, 4.0, SR);
        assert!(!fired0.is_empty(), "step 0 should fire on first buffer");

        // Advance 5512 samples with factor=1.0. Step 1 fires because its countdown
        // was already set to 5512 (factor=1.0 here only sets step 2's countdown).
        let fired1 = clock.advance(5512, BPM, 1.0, SR);
        let steps1: Vec<u8> = fired1.iter().collect();
        assert!(
            steps1.contains(&1),
            "step 1 fires after its pre-scheduled 5512-sample countdown, got {:?}",
            steps1
        );

        // Step 2's countdown was set with factor=1.0 -> 22050 samples.
        // 5512 samples should not be enough to fire it.
        let fired_early = clock.advance(5512, BPM, 1.0, SR);
        assert!(
            fired_early.is_empty(),
            "step 2 should not fire after only 5512 of 22050 samples, got {:?}",
            fired_early.iter().collect::<Vec<_>>()
        );

        // Advance the remaining 22050 - 5512 = 16538 samples; step 2 should now fire.
        let fired2 = clock.advance(16538, BPM, 1.0, SR);
        let steps2: Vec<u8> = fired2.iter().collect();
        assert!(
            steps2.contains(&2),
            "step 2 fires after full quarter-note duration, got {:?}",
            steps2
        );
    }
}
