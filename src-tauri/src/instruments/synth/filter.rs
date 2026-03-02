use std::f32::consts::TAU;

/// Threshold below which filter state variables are flushed to zero.
///
/// Denormal floats (very small values near machine epsilon) can cause
/// performance degradation on some CPUs. Flushing prevents this.
const DENORMAL_THRESHOLD: f32 = 1e-25;

/// Biquad low-pass filter in Direct Form II Transposed.
///
/// Coefficients are recomputed lazily — only when cutoff or resonance
/// change by more than a small epsilon. This avoids the `cos`/`sin`
/// overhead on every sample while still tracking smooth parameter changes.
///
/// Real-time safe: no allocations, no locks, no heap use.
pub struct BiquadFilter {
    /// Feed-forward coefficient 0 (normalised).
    b0: f32,
    /// Feed-forward coefficient 1 (normalised).
    b1: f32,
    /// Feed-forward coefficient 2 (normalised).
    b2: f32,
    /// Feed-back coefficient 1 (normalised, negated convention).
    a1: f32,
    /// Feed-back coefficient 2 (normalised, negated convention).
    a2: f32,
    /// State variable 1 (DF2T first delay element).
    s1: f32,
    /// State variable 2 (DF2T second delay element).
    s2: f32,
    /// Cutoff frequency at which coefficients were last computed (Hz).
    last_cutoff: f32,
    /// Resonance at which coefficients were last computed.
    last_resonance: f32,
}

impl BiquadFilter {
    /// Creates a new filter initialised to a neutral (pass-all) state.
    pub fn new() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            s1: 0.0,
            s2: 0.0,
            last_cutoff: -1.0,    // sentinel: forces initial coefficient computation
            last_resonance: -1.0,
        }
    }

    /// Computes biquad low-pass coefficients using the audio-EQ-cookbook formula.
    ///
    /// `cutoff` is the cutoff frequency in Hz, `resonance` maps [0.0–1.0] to Q [0.5–20.0].
    fn compute_coefficients(&mut self, sample_rate: f32, cutoff: f32, resonance: f32) {
        let omega = TAU * cutoff / sample_rate;
        let q = 0.5 + resonance * 19.5;
        let alpha = omega.sin() / (2.0 * q);
        let cos_omega = omega.cos();

        let b0_raw = (1.0 - cos_omega) / 2.0;
        let b1_raw = 1.0 - cos_omega;
        let b2_raw = b0_raw;
        let a0_raw = 1.0 + alpha;
        let a1_raw = -2.0 * cos_omega;
        let a2_raw = 1.0 - alpha;

        // Normalise by a0
        self.b0 = b0_raw / a0_raw;
        self.b1 = b1_raw / a0_raw;
        self.b2 = b2_raw / a0_raw;
        self.a1 = a1_raw / a0_raw;
        self.a2 = a2_raw / a0_raw;

        self.last_cutoff = cutoff;
        self.last_resonance = resonance;
    }

    /// Processes one sample through the low-pass filter.
    ///
    /// Coefficients are recomputed only if `cutoff` or `resonance` differ
    /// from the last computed values by more than a small epsilon.
    pub fn process(
        &mut self,
        sample_rate: f32,
        cutoff: f32,
        resonance: f32,
        input: f32,
    ) -> f32 {
        // Lazy coefficient update
        let cutoff_changed = (cutoff - self.last_cutoff).abs() > 0.01;
        let res_changed = (resonance - self.last_resonance).abs() > 0.0001;
        if cutoff_changed || res_changed {
            self.compute_coefficients(sample_rate, cutoff, resonance);
        }

        // Direct Form II Transposed
        let output = self.b0 * input + self.s1;
        self.s1 = self.b1 * input - self.a1 * output + self.s2;
        self.s2 = self.b2 * input - self.a2 * output;

        // Flush denormals to prevent CPU slowdown
        if self.s1.abs() < DENORMAL_THRESHOLD {
            self.s1 = 0.0;
        }
        if self.s2.abs() < DENORMAL_THRESHOLD {
            self.s2 = 0.0;
        }

        output
    }
}

impl Default for BiquadFilter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn test_lowpass_no_nan() {
        let mut filter = BiquadFilter::new();
        // Feed noise through the filter — output must never be NaN or Inf
        for i in 0..4096 {
            let input = ((i as f32) * 0.1).sin();
            let out = filter.process(SR, 1000.0, 0.5, input);
            assert!(
                out.is_finite(),
                "Filter produced non-finite output: {} at sample {}",
                out,
                i
            );
        }
    }

    #[test]
    fn test_coefficients_recompute_on_cutoff_change() {
        let mut filter = BiquadFilter::new();
        // Force initial computation
        filter.process(SR, 1000.0, 0.0, 0.0);
        let b0_first = filter.b0;

        // Different cutoff → coefficients must differ
        filter.process(SR, 5000.0, 0.0, 0.0);
        let b0_second = filter.b0;

        assert!(
            (b0_first - b0_second).abs() > 0.001,
            "Coefficients should change when cutoff changes"
        );
    }
}
