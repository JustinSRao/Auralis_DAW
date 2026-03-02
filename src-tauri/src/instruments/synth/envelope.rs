/// Amplitude below which a releasing voice is considered silent.
const SILENCE_THRESHOLD: f32 = 1e-4;

/// The current stage of the ADSR state machine.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EnvelopeState {
    /// No note active; output is 0.
    Idle,
    /// Rising from 0 (or current level on retrigger) to 1.0.
    Attack,
    /// Falling from 1.0 toward the sustain level.
    Decay,
    /// Holding at the sustain level while the key is held.
    Sustain,
    /// Falling from the current level to 0 after key release.
    Release,
}

/// ADSR amplitude envelope with a continuous-level retrigger to avoid clicks.
///
/// The envelope is driven sample-by-sample by calling [`tick`] once per sample.
/// Transitions between stages happen automatically based on the current level.
///
/// All state is internal — no allocations or locks.
pub struct Envelope {
    /// Current state machine stage.
    state: EnvelopeState,
    /// Current output level (0.0–1.0).
    level: f32,
}

impl Envelope {
    /// Creates a new idle envelope.
    pub fn new() -> Self {
        Self {
            state: EnvelopeState::Idle,
            level: 0.0,
        }
    }

    /// Triggers the envelope on a note-on event.
    ///
    /// Transitions to `Attack` from whatever the current level is, avoiding
    /// a discontinuous click on retrigger mid-release.
    pub fn note_on(&mut self) {
        self.state = EnvelopeState::Attack;
        // `level` is intentionally NOT reset so a retrigger carries forward
        // the current amplitude, preventing clicks.
    }

    /// Starts the release phase on a note-off event.
    ///
    /// If the envelope is already `Idle`, this is a no-op.
    pub fn note_off(&mut self) {
        if self.state != EnvelopeState::Idle {
            self.state = EnvelopeState::Release;
        }
    }

    /// Advances the envelope by one sample and returns the current output level.
    ///
    /// Parameters:
    /// - `sample_rate` — audio sample rate in Hz
    /// - `attack`  — attack time in seconds (> 0)
    /// - `decay`   — decay time in seconds (> 0)
    /// - `sustain` — sustain level (0.0–1.0)
    /// - `release` — release time in seconds (> 0)
    pub fn tick(
        &mut self,
        sample_rate: f32,
        attack: f32,
        decay: f32,
        sustain: f32,
        release: f32,
    ) -> f32 {
        match self.state {
            EnvelopeState::Idle => {
                self.level = 0.0;
            }
            EnvelopeState::Attack => {
                let attack_inc = 1.0 / (attack * sample_rate).max(1.0);
                self.level += attack_inc;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.state = EnvelopeState::Decay;
                }
            }
            EnvelopeState::Decay => {
                let decay_dec = (1.0 - sustain) / (decay * sample_rate).max(1.0);
                self.level -= decay_dec;
                if self.level <= sustain {
                    self.level = sustain;
                    self.state = EnvelopeState::Sustain;
                }
            }
            EnvelopeState::Sustain => {
                self.level = sustain;
            }
            EnvelopeState::Release => {
                // Proportional release: speed tracks current level so there is
                // no audible discontinuity when releasing from a partial level.
                let release_dec = self.level / (release * sample_rate).max(1.0);
                self.level -= release_dec;
                if self.level <= SILENCE_THRESHOLD {
                    self.level = 0.0;
                    self.state = EnvelopeState::Idle;
                }
            }
        }
        self.level
    }

    /// Returns `true` if the envelope is in the `Idle` state.
    pub fn is_idle(&self) -> bool {
        self.state == EnvelopeState::Idle
    }
}

impl Default for Envelope {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn test_idle_zero() {
        let mut env = Envelope::new();
        assert!(env.is_idle());
        let level = env.tick(SR, 0.01, 0.1, 0.7, 0.3);
        assert_eq!(level, 0.0);
    }

    #[test]
    fn test_attack_rises() {
        let mut env = Envelope::new();
        env.note_on();
        assert_eq!(env.state, EnvelopeState::Attack);

        // After 1 attack period of ticks the level should have risen
        let attack_secs = 0.1;
        let attack_samples = (attack_secs * SR) as usize;

        let mut last = 0.0f32;
        for _ in 0..attack_samples {
            let l = env.tick(SR, attack_secs, 0.1, 0.7, 0.3);
            // Level should be non-decreasing during attack
            assert!(l >= last - f32::EPSILON, "Level decreased during attack");
            last = l;
        }
        // After one full attack period, level should be at or near 1.0
        assert!(last >= 0.99, "Expected level near 1.0 after attack, got {}", last);
    }

    #[test]
    fn test_decay_falls() {
        let mut env = Envelope::new();
        env.note_on();
        // Rush through attack with tiny attack time
        for _ in 0..10 {
            env.tick(SR, 0.0001, 0.2, 0.5, 0.3);
        }
        // Should now be in Decay
        assert_eq!(env.state, EnvelopeState::Decay);

        let decay_secs = 0.2;
        let decay_samples = (decay_secs * SR) as usize;
        let mut last = 1.0f32;
        for _ in 0..decay_samples {
            let l = env.tick(SR, 0.0001, decay_secs, 0.5, 0.3);
            assert!(l <= last + f32::EPSILON, "Level increased during decay");
            last = l;
        }
        // Should have reached sustain (0.5) by now
        assert!(
            (last - 0.5).abs() < 0.01,
            "Expected sustain ~0.5 after decay, got {}",
            last
        );
    }

    #[test]
    fn test_release_fades() {
        let mut env = Envelope::new();
        env.note_on();
        // Push into sustain
        for _ in 0..10_000 {
            env.tick(SR, 0.001, 0.001, 0.8, 1.0);
        }
        assert_eq!(env.state, EnvelopeState::Sustain);

        env.note_off();
        assert_eq!(env.state, EnvelopeState::Release);

        // Run until idle
        let mut reached_idle = false;
        for _ in 0..100_000 {
            env.tick(SR, 0.001, 0.001, 0.8, 0.1);
            if env.is_idle() {
                reached_idle = true;
                break;
            }
        }
        assert!(reached_idle, "Envelope should have reached idle after release");
    }

    #[test]
    fn test_retrigger_mid_release() {
        let mut env = Envelope::new();
        // Start a note, let it reach sustain
        env.note_on();
        for _ in 0..5_000 {
            env.tick(SR, 0.001, 0.001, 0.7, 1.0);
        }
        // Release
        env.note_off();
        // Tick a few times into release
        for _ in 0..500 {
            env.tick(SR, 0.001, 0.001, 0.7, 0.5);
        }
        let level_before_retrigger = env.level;

        // Retrigger while still in release — should NOT click to zero
        env.note_on();
        assert_eq!(env.state, EnvelopeState::Attack);
        // Level should be preserved (no reset to zero)
        assert!(
            (env.level - level_before_retrigger).abs() < f32::EPSILON,
            "Retrigger should preserve level to avoid click"
        );
    }
}
