//! Biquad IIR filter — Direct Form II Transposed.
//!
//! Coefficient computation follows the Audio EQ Cookbook by Robert
//! Bristow-Johnson:
//! <https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html>

use std::f32::consts::PI;

// ─── Filter type ─────────────────────────────────────────────────────────────

/// Filter topology for a biquad section.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterType {
    /// Identity filter — passes signal unchanged.
    Bypass,
    /// Second-order Butterworth low-pass filter (12 dB/octave).
    LowPass,
    /// Second-order Butterworth high-pass filter (12 dB/octave).
    HighPass,
    /// Low-shelf boost/cut (unit shelf-slope S = 1).
    LowShelf,
    /// High-shelf boost/cut (unit shelf-slope S = 1).
    HighShelf,
    /// Peaking parametric EQ band.
    Peaking,
}

// ─── Coefficients ─────────────────────────────────────────────────────────────

/// Normalised biquad coefficients (a0 = 1.0).
///
/// Transfer function:
/// `H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²)`
#[derive(Clone, Copy, Debug)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    /// Normalised a1 (divided by a0).
    pub a1: f32,
    /// Normalised a2 (divided by a0).
    pub a2: f32,
}

impl Default for BiquadCoeffs {
    /// Identity/bypass — b0 = 1, all others = 0.
    fn default() -> Self {
        Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 }
    }
}

// ─── Coefficient computation ──────────────────────────────────────────────────

/// Computes biquad coefficients from user-facing parameters.
///
/// * `filter_type` — filter topology
/// * `freq`        — characteristic frequency in Hz (20–20 000 Hz)
/// * `gain_db`     — gain in dB; used by Peaking, LowShelf, HighShelf only
/// * `q`           — quality factor (0.1–10); used by Peaking only
/// * `sample_rate` — audio sample rate in Hz
pub fn compute_coeffs(
    filter_type: FilterType,
    freq: f32,
    gain_db: f32,
    q: f32,
    sample_rate: f32,
) -> BiquadCoeffs {
    match filter_type {
        FilterType::Bypass => BiquadCoeffs::default(),
        FilterType::Peaking => compute_peaking(freq, gain_db, q, sample_rate),
        FilterType::LowShelf => compute_low_shelf(freq, gain_db, sample_rate),
        FilterType::HighShelf => compute_high_shelf(freq, gain_db, sample_rate),
        FilterType::LowPass => compute_low_pass(freq, sample_rate),
        FilterType::HighPass => compute_high_pass(freq, sample_rate),
    }
}

/// Peaking EQ.  S-domain transfer function:
/// `H(s) = (s² + s·(A/Q) + 1) / (s² + s/(A·Q) + 1)`
fn compute_peaking(freq: f32, gain_db: f32, q: f32, sample_rate: f32) -> BiquadCoeffs {
    // A = 10^(dBgain/40)
    let a = 10.0f32.powf(gain_db / 40.0);
    let w0 = 2.0 * PI * freq / sample_rate;
    let alpha = w0.sin() / (2.0 * q);

    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * w0.cos();
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    let a1 = -2.0 * w0.cos();
    let a2 = 1.0 - alpha / a;

    BiquadCoeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/// Low-shelf filter with unit shelf-slope (S = 1, Butterworth-like).
fn compute_low_shelf(freq: f32, gain_db: f32, sample_rate: f32) -> BiquadCoeffs {
    let a = 10.0f32.powf(gain_db / 40.0);
    let w0 = 2.0 * PI * freq / sample_rate;
    let cos_w0 = w0.cos();
    let sin_w0 = w0.sin();
    // S = 1 → alpha = sin(w0)/2 · √2
    let alpha = sin_w0 / 2.0 * 2.0f32.sqrt();
    let sqrt_a = a.sqrt();

    let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
    let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
    let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
    let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
    let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
    let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

    BiquadCoeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/// High-shelf filter with unit shelf-slope (S = 1, Butterworth-like).
fn compute_high_shelf(freq: f32, gain_db: f32, sample_rate: f32) -> BiquadCoeffs {
    let a = 10.0f32.powf(gain_db / 40.0);
    let w0 = 2.0 * PI * freq / sample_rate;
    let cos_w0 = w0.cos();
    let sin_w0 = w0.sin();
    // S = 1 → alpha = sin(w0)/2 · √2
    let alpha = sin_w0 / 2.0 * 2.0f32.sqrt();
    let sqrt_a = a.sqrt();

    let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
    let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
    let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
    let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
    let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
    let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

    BiquadCoeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/// Second-order Butterworth low-pass (Q = 1/√2, 12 dB/octave).
fn compute_low_pass(freq: f32, sample_rate: f32) -> BiquadCoeffs {
    // Q = 1/√2 — maximally flat (Butterworth)
    let q = std::f32::consts::FRAC_1_SQRT_2;
    let w0 = 2.0 * PI * freq / sample_rate;
    let cos_w0 = w0.cos();
    let alpha = w0.sin() / (2.0 * q);

    let b0 = (1.0 - cos_w0) / 2.0;
    let b1 = 1.0 - cos_w0;
    let b2 = (1.0 - cos_w0) / 2.0;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cos_w0;
    let a2 = 1.0 - alpha;

    BiquadCoeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/// Second-order Butterworth high-pass (Q = 1/√2, 12 dB/octave).
fn compute_high_pass(freq: f32, sample_rate: f32) -> BiquadCoeffs {
    let q = std::f32::consts::FRAC_1_SQRT_2;
    let w0 = 2.0 * PI * freq / sample_rate;
    let cos_w0 = w0.cos();
    let alpha = w0.sin() / (2.0 * q);

    let b0 = (1.0 + cos_w0) / 2.0;
    let b1 = -(1.0 + cos_w0);
    let b2 = (1.0 + cos_w0) / 2.0;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cos_w0;
    let a2 = 1.0 - alpha;

    BiquadCoeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

// ─── Filter instance ──────────────────────────────────────────────────────────

/// Single biquad IIR filter — Direct Form II Transposed.
///
/// Holds two delay-line state variables (`s1`, `s2`) for per-sample processing.
/// Coefficients can be updated at any time; state is preserved so there are no
/// discontinuities on parameter change.  Call [`reset`](BiquadFilter::reset)
/// only when the signal is guaranteed to be silent.
pub struct BiquadFilter {
    /// Current normalised coefficients.
    pub coeffs: BiquadCoeffs,
    /// State register w[n-1].
    s1: f32,
    /// State register w[n-2].
    s2: f32,
}

impl Default for BiquadFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl BiquadFilter {
    /// Creates a bypass filter (identity transfer function, zero state).
    pub fn new() -> Self {
        Self { coeffs: BiquadCoeffs::default(), s1: 0.0, s2: 0.0 }
    }

    /// Replaces coefficients without clearing state (parameter-change safe).
    pub fn set_coeffs(&mut self, coeffs: BiquadCoeffs) {
        self.coeffs = coeffs;
    }

    /// Processes one sample using Direct Form II Transposed:
    ///
    /// ```text
    /// y   = b0·x + s1
    /// s1' = b1·x − a1·y + s2
    /// s2' = b2·x − a2·y
    /// ```
    #[inline]
    pub fn process_sample(&mut self, x: f32) -> f32 {
        let y = self.coeffs.b0 * x + self.s1;
        self.s1 = self.coeffs.b1 * x - self.coeffs.a1 * y + self.s2;
        self.s2 = self.coeffs.b2 * x - self.coeffs.a2 * y;
        y
    }

    /// Resets internal state to zero.
    pub fn reset(&mut self) {
        self.s1 = 0.0;
        self.s2 = 0.0;
    }
}

// ─── Magnitude response ───────────────────────────────────────────────────────

/// Evaluates `|H(eʲω)|` in dB for a biquad at `freq_hz`.
///
/// Used for drawing the frequency-response canvas without running audio through
/// the filter.  Based on:
/// `H(eʲω) = (b0 + b1·e⁻ʲω + b2·e⁻²ʲω) / (1 + a1·e⁻ʲω + a2·e⁻²ʲω)`
pub fn magnitude_db(coeffs: &BiquadCoeffs, freq_hz: f32, sample_rate: f32) -> f32 {
    let w = 2.0 * PI * freq_hz / sample_rate;
    let cos_w = w.cos();
    let cos_2w = (2.0 * w).cos();
    let sin_w = w.sin();
    let sin_2w = (2.0 * w).sin();

    let num_re = coeffs.b0 + coeffs.b1 * cos_w + coeffs.b2 * cos_2w;
    let num_im = -(coeffs.b1 * sin_w + coeffs.b2 * sin_2w);
    let den_re = 1.0 + coeffs.a1 * cos_w + coeffs.a2 * cos_2w;
    let den_im = -(coeffs.a1 * sin_w + coeffs.a2 * sin_2w);

    let num_sq = num_re * num_re + num_im * num_im;
    let den_sq = den_re * den_re + den_im * den_im;

    if den_sq < 1e-30 {
        return 0.0;
    }
    10.0 * (num_sq / den_sq).log10()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn peaking_zero_gain_is_unity() {
        let c = compute_peaking(1000.0, 0.0, 1.0, SR);
        let db = magnitude_db(&c, 1000.0, SR);
        assert!(db.abs() < 0.01, "0 dB peaking → identity, got {db}");
    }

    #[test]
    fn peaking_plus6db_at_1khz() {
        let c = compute_peaking(1000.0, 6.0, 1.0, SR);
        let db = magnitude_db(&c, 1000.0, SR);
        assert!((db - 6.0).abs() < 0.1, "expected +6 dB at 1 kHz, got {db}");
    }

    #[test]
    fn peaking_minus6db_at_1khz() {
        let c = compute_peaking(1000.0, -6.0, 1.0, SR);
        let db = magnitude_db(&c, 1000.0, SR);
        assert!((db + 6.0).abs() < 0.1, "expected −6 dB at 1 kHz, got {db}");
    }

    #[test]
    fn peaking_high_q_narrow_bandwidth() {
        let c_hi = compute_peaking(1000.0, 6.0, 8.0, SR);
        let c_lo = compute_peaking(1000.0, 6.0, 0.5, SR);
        // At 500 Hz the high-Q band should cut less than the low-Q band
        let db_hi = magnitude_db(&c_hi, 500.0, SR);
        let db_lo = magnitude_db(&c_lo, 500.0, SR);
        assert!(db_hi < db_lo, "high-Q band should have less boost at 500 Hz");
    }

    #[test]
    fn low_shelf_boosts_lows() {
        let c = compute_low_shelf(200.0, 4.0, SR);
        let db_low = magnitude_db(&c, 20.0, SR);
        let db_high = magnitude_db(&c, 20000.0, SR);
        assert!(db_low > 3.5, "low-shelf should boost at 20 Hz, got {db_low}");
        assert!(db_high.abs() < 0.5, "low-shelf should be ~0 dB at 20 kHz, got {db_high}");
    }

    #[test]
    fn low_shelf_cuts_lows() {
        let c = compute_low_shelf(200.0, -4.0, SR);
        let db_low = magnitude_db(&c, 20.0, SR);
        assert!(db_low < -3.5, "low-shelf should cut at 20 Hz, got {db_low}");
    }

    #[test]
    fn high_shelf_boosts_highs() {
        let c = compute_high_shelf(10000.0, 4.0, SR);
        let db_high = magnitude_db(&c, 20000.0, SR);
        let db_low = magnitude_db(&c, 20.0, SR);
        assert!(db_high > 3.5, "high-shelf should boost at 20 kHz, got {db_high}");
        assert!(db_low.abs() < 0.5, "high-shelf should be ~0 dB at 20 Hz, got {db_low}");
    }

    #[test]
    fn low_pass_at_cutoff_is_minus3db() {
        let c = compute_low_pass(80.0, SR);
        let db = magnitude_db(&c, 80.0, SR);
        assert!((db + 3.0).abs() < 0.3, "LP cutoff should be −3 dB, got {db}");
    }

    #[test]
    fn low_pass_attenuates_above_cutoff() {
        let c = compute_low_pass(80.0, SR);
        // 4+ octaves above cutoff → ≥ 12 dB/oct × 4 = 48 dB attenuation
        let db = magnitude_db(&c, 1600.0, SR);
        assert!(db < -30.0, "LP should strongly attenuate at 1600 Hz, got {db}");
    }

    #[test]
    fn high_pass_at_cutoff_is_minus3db() {
        let c = compute_high_pass(80.0, SR);
        let db = magnitude_db(&c, 80.0, SR);
        assert!((db + 3.0).abs() < 0.3, "HP cutoff should be −3 dB, got {db}");
    }

    #[test]
    fn high_pass_attenuates_below_cutoff() {
        let c = compute_high_pass(80.0, SR);
        let db = magnitude_db(&c, 4.0, SR);
        assert!(db < -30.0, "HP should strongly attenuate at 4 Hz, got {db}");
    }

    #[test]
    fn bypass_is_unity_at_all_freqs() {
        let c = BiquadCoeffs::default();
        for freq in [20.0, 500.0, 1000.0, 10000.0, 20000.0] {
            let db = magnitude_db(&c, freq, SR);
            assert!(db.abs() < 0.01, "bypass should be 0 dB at {freq} Hz, got {db}");
        }
    }

    #[test]
    fn filter_process_bypass_passes_through() {
        let mut f = BiquadFilter::new();
        for x in [0.0f32, 0.5, -0.5, 1.0, -1.0] {
            let y = f.process_sample(x);
            assert!((y - x).abs() < 1e-6, "bypass should pass {x} unchanged, got {y}");
        }
    }

    #[test]
    fn filter_reset_clears_state() {
        let mut f = BiquadFilter::new();
        f.set_coeffs(compute_peaking(1000.0, 6.0, 1.0, SR));
        // Accumulate state
        for _ in 0..100 {
            f.process_sample(0.5);
        }
        f.reset();
        let y = f.process_sample(0.0);
        assert!(y.abs() < 1e-6, "after reset, zero input should yield zero output, got {y}");
    }

    #[test]
    fn filter_set_coeffs_updates_without_clearing_state() {
        let mut f = BiquadFilter::new();
        f.set_coeffs(compute_peaking(1000.0, 6.0, 1.0, SR));
        // Process a few samples to build state
        for _ in 0..10 {
            f.process_sample(0.1);
        }
        // Updating coefficients should not panic or reset state
        f.set_coeffs(compute_peaking(2000.0, 3.0, 1.0, SR));
        // Just ensure it doesn't panic
        f.process_sample(0.1);
    }
}
