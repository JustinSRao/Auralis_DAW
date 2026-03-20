//! Stereo delay effect — DSP implementation deferred to Sprint 19.
//!
//! The tempo-sync hook reads BPM from the transport clock rather than a global
//! static, so this file is created now to claim that API surface.  The full
//! delay DSP (feedback, diffusion, wet/dry mix) will be implemented in
//! Sprint 19 scope.

/// Returns the delay time in samples for a given note division, using the
/// current BPM from the transport clock.
///
/// This stub always returns 0 samples until Sprint 19 implements the full
/// delay DSP.
///
/// # Arguments
///
/// * `_bpm`           – Current tempo in beats per minute.
/// * `_note_division` – Rhythmic subdivision as a fraction of a beat
///                      (e.g. `0.25` for a quarter-note, `0.125` for an
///                      eighth-note).
/// * `_sample_rate`   – Audio sample rate in Hz.
///
/// # Full implementation (Sprint 19)
///
/// ```text
/// (60.0 / bpm * note_division * sample_rate) as u32
/// ```
pub fn tempo_sync_delay_samples(
    _bpm: f64,
    _note_division: f64,
    _sample_rate: u32,
) -> u32 {
    // Full implementation: Sprint 19
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stub_always_returns_zero() {
        assert_eq!(tempo_sync_delay_samples(120.0, 0.25, 44100), 0);
        assert_eq!(tempo_sync_delay_samples(60.0, 0.5, 48000), 0);
    }
}
