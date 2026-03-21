//! Parametric EQ effect — 8-band biquad chain.
//!
//! Band layout (default configuration):
//!
//! | Index | Type       | Default Freq | Default State |
//! |-------|------------|-------------|---------------|
//! | 0     | HighPass   | 20 Hz       | disabled      |
//! | 1     | LowShelf   | 200 Hz      | enabled       |
//! | 2     | Peaking    | 500 Hz      | enabled       |
//! | 3     | Peaking    | 1 000 Hz    | enabled       |
//! | 4     | Peaking    | 4 000 Hz    | enabled       |
//! | 5     | Peaking    | 8 000 Hz    | enabled       |
//! | 6     | HighShelf  | 10 000 Hz   | enabled       |
//! | 7     | LowPass    | 20 000 Hz   | disabled      |
//!
//! HP and LP are disabled by default so the EQ is flat out of the box.
//! Sprint 21 (Effect Chain) will wire `ParametricEq` into the per-channel
//! insert slot.

pub mod biquad;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use biquad::{compute_coeffs, magnitude_db, BiquadCoeffs, BiquadFilter, FilterType};

// ─── Public constants ─────────────────────────────────────────────────────────

/// Total number of biquad bands in the parametric EQ.
pub const NUM_BANDS: usize = 8;

// ─── Parameter types ──────────────────────────────────────────────────────────

/// User-facing parameters for a single EQ band.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct EqBandParams {
    /// Filter topology (peaking, shelf, LP/HP, bypass).
    pub filter_type: FilterType,
    /// Characteristic frequency in Hz (20–20 000 Hz).
    pub frequency: f32,
    /// Gain in dB (−18 to +18).  Used by Peaking, LowShelf, HighShelf only.
    pub gain_db: f32,
    /// Quality factor (0.1–10.0).  Used by Peaking only.
    pub q: f32,
    /// Whether this band is active.  Disabled bands pass signal unchanged.
    pub enabled: bool,
}

impl EqBandParams {
    fn default_for_index(index: usize) -> Self {
        let (filter_type, frequency) = match index {
            0 => (FilterType::HighPass, 20.0),
            1 => (FilterType::LowShelf, 200.0),
            2 => (FilterType::Peaking, 500.0),
            3 => (FilterType::Peaking, 1000.0),
            4 => (FilterType::Peaking, 4000.0),
            5 => (FilterType::Peaking, 8000.0),
            6 => (FilterType::HighShelf, 10000.0),
            _ => (FilterType::LowPass, 20000.0),
        };
        // HP (0) and LP (7) are disabled by default → flat response
        let enabled = !matches!(index, 0 | 7);
        Self { filter_type, frequency, gain_db: 0.0, q: 1.0, enabled }
    }
}

/// One frequency/magnitude point for the response curve.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FreqPoint {
    /// Frequency in Hz.
    pub freq: f32,
    /// Combined magnitude in dB.
    pub db: f32,
}

/// Full serialisable EQ state returned by [`get_eq_state`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EqStateSnapshot {
    pub channel_id: String,
    pub bands: Vec<EqBandParams>,
}

// ─── AudioEffect trait ────────────────────────────────────────────────────────

/// Common interface for all insertable audio effects.
///
/// Sprint 21 (Effect Chain) will iterate over a `Vec<Box<dyn AudioEffect>>` per
/// channel and call `process_stereo` in the audio callback.
pub trait AudioEffect: Send + Sync {
    /// Processes one buffer of stereo audio in-place.
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Resets all internal state (call only when silence is guaranteed).
    fn reset(&mut self);
}

// ─── ParametricEq ─────────────────────────────────────────────────────────────

/// 8-band parametric EQ with independent stereo processing.
///
/// Each band has its own [`BiquadFilter`] instance for the left channel and
/// another for the right channel.  Both channels share the same coefficients
/// but maintain independent state to correctly handle mid-side content.
pub struct ParametricEq {
    /// Band parameters (source of truth for serialisation and UI).
    pub bands: [EqBandParams; NUM_BANDS],
    /// Per-band biquad filters for the left channel.
    filters_l: [BiquadFilter; NUM_BANDS],
    /// Per-band biquad filters for the right channel.
    filters_r: [BiquadFilter; NUM_BANDS],
    /// Audio sample rate in Hz.
    sample_rate: f32,
}

impl ParametricEq {
    /// Creates an EQ with default band layout at the given sample rate.
    pub fn new(sample_rate: f32) -> Self {
        let bands = core::array::from_fn(EqBandParams::default_for_index);
        let mut filters_l: [BiquadFilter; NUM_BANDS] =
            core::array::from_fn(|_| BiquadFilter::new());
        let mut filters_r: [BiquadFilter; NUM_BANDS] =
            core::array::from_fn(|_| BiquadFilter::new());

        // Pre-compute coefficients for all enabled default bands.
        for (i, band) in bands.iter().enumerate() {
            if band.enabled {
                let coeffs =
                    compute_coeffs(band.filter_type, band.frequency, band.gain_db, band.q, sample_rate);
                filters_l[i].set_coeffs(coeffs);
                filters_r[i].set_coeffs(coeffs);
            }
        }

        Self { bands, filters_l, filters_r, sample_rate }
    }

    /// Replaces one band's parameters and recomputes its biquad coefficients.
    pub fn set_band(&mut self, index: usize, params: EqBandParams) {
        if index >= NUM_BANDS {
            return;
        }
        self.bands[index] = params;
        if params.enabled {
            let coeffs = compute_coeffs(
                params.filter_type,
                params.frequency,
                params.gain_db,
                params.q,
                self.sample_rate,
            );
            self.filters_l[index].set_coeffs(coeffs);
            self.filters_r[index].set_coeffs(coeffs);
        } else {
            // Disabled → identity
            let bypass = BiquadCoeffs::default();
            self.filters_l[index].set_coeffs(bypass);
            self.filters_r[index].set_coeffs(bypass);
        }
    }

    /// Enables or disables a single band.
    ///
    /// When re-enabled, coefficients are recomputed from the stored parameters.
    pub fn enable_band(&mut self, index: usize, enabled: bool) {
        if index >= NUM_BANDS {
            return;
        }
        self.bands[index].enabled = enabled;
        let coeffs = if enabled {
            let band = &self.bands[index];
            compute_coeffs(band.filter_type, band.frequency, band.gain_db, band.q, self.sample_rate)
        } else {
            BiquadCoeffs::default()
        };
        self.filters_l[index].set_coeffs(coeffs);
        self.filters_r[index].set_coeffs(coeffs);
    }

    /// Processes one mono sample through all active bands in series.
    #[inline]
    pub fn process_sample_mono(&mut self, x: f32) -> f32 {
        let mut y = x;
        for (i, filter) in self.filters_l.iter_mut().enumerate() {
            if self.bands[i].enabled {
                y = filter.process_sample(y);
            }
        }
        y
    }

    /// Evaluates the combined magnitude response (in dB) at `freq_hz`.
    pub fn magnitude_response_db(&self, freq_hz: f32) -> f32 {
        let mut total_db = 0.0f32;
        for (i, band) in self.bands.iter().enumerate() {
            if band.enabled {
                total_db +=
                    magnitude_db(&self.filters_l[i].coeffs, freq_hz, self.sample_rate);
            }
        }
        total_db
    }

    /// Computes `n_points` log-spaced magnitude response points between 20 Hz
    /// and 20 kHz.
    pub fn frequency_response_curve(&self, n_points: usize) -> Vec<FreqPoint> {
        let log_lo = 20.0f32.log10();
        let log_hi = 20_000.0f32.log10();
        (0..n_points)
            .map(|i| {
                let t = i as f32 / (n_points - 1).max(1) as f32;
                let freq = 10.0f32.powf(log_lo + t * (log_hi - log_lo));
                FreqPoint { freq, db: self.magnitude_response_db(freq) }
            })
            .collect()
    }
}

impl AudioEffect for ParametricEq {
    /// Processes stereo audio in-place; left and right channels run through
    /// independent biquad state but share the same coefficients.
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            for (i, (fl, fr)) in
                self.filters_l.iter_mut().zip(self.filters_r.iter_mut()).enumerate()
            {
                if self.bands[i].enabled {
                    *l = fl.process_sample(*l);
                    *r = fr.process_sample(*r);
                }
            }
        }
    }

    fn reset(&mut self) {
        for (fl, fr) in self.filters_l.iter_mut().zip(self.filters_r.iter_mut()) {
            fl.reset();
            fr.reset();
        }
    }
}

// ─── Tauri state ──────────────────────────────────────────────────────────────

/// Per-channel EQ store: `channel_id → ParametricEq`.
///
/// Entries are created lazily the first time a channel's EQ is accessed.
/// Sprint 21 (Effect Chain) will manage explicit creation/teardown.
pub type EqStoreInner = HashMap<String, ParametricEq>;
pub type EqStore = Arc<Mutex<EqStoreInner>>;

const DEFAULT_SAMPLE_RATE: f32 = 44100.0;

fn get_or_create<'a>(store: &'a mut EqStoreInner, channel_id: &str) -> &'a mut ParametricEq {
    store
        .entry(channel_id.to_owned())
        .or_insert_with(|| ParametricEq::new(DEFAULT_SAMPLE_RATE))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Sets (or replaces) a single EQ band for the given channel.
///
/// Creates the EQ entry lazily if it does not yet exist for `channel_id`.
#[tauri::command]
pub fn set_eq_band(
    channel_id: String,
    band_index: usize,
    params: EqBandParams,
    state: State<EqStore>,
) -> Result<(), String> {
    if band_index >= NUM_BANDS {
        return Err(format!("band_index {band_index} out of range 0–{}", NUM_BANDS - 1));
    }
    let mut store = state.lock().map_err(|e| e.to_string())?;
    get_or_create(&mut store, &channel_id).set_band(band_index, params);
    Ok(())
}

/// Enables or disables a single EQ band for the given channel.
#[tauri::command]
pub fn enable_eq_band(
    channel_id: String,
    band_index: usize,
    enabled: bool,
    state: State<EqStore>,
) -> Result<(), String> {
    if band_index >= NUM_BANDS {
        return Err(format!("band_index {band_index} out of range 0–{}", NUM_BANDS - 1));
    }
    let mut store = state.lock().map_err(|e| e.to_string())?;
    get_or_create(&mut store, &channel_id).enable_band(band_index, enabled);
    Ok(())
}

/// Returns the full EQ state snapshot for the given channel.
///
/// If no EQ exists for the channel yet, returns the default configuration.
#[tauri::command]
pub fn get_eq_state(
    channel_id: String,
    state: State<EqStore>,
) -> Result<EqStateSnapshot, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let eq = get_or_create(&mut store, &channel_id);
    Ok(EqStateSnapshot { channel_id, bands: eq.bands.to_vec() })
}

/// Returns 200 log-spaced frequency-response points for canvas rendering.
#[tauri::command]
pub fn get_eq_frequency_response(
    channel_id: String,
    state: State<EqStore>,
) -> Result<Vec<FreqPoint>, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let eq = get_or_create(&mut store, &channel_id);
    Ok(eq.frequency_response_curve(200))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn new_eq_has_correct_band_count() {
        let eq = ParametricEq::new(SR);
        assert_eq!(eq.bands.len(), NUM_BANDS);
    }

    #[test]
    fn default_bands_have_zero_gain() {
        let eq = ParametricEq::new(SR);
        for band in &eq.bands {
            assert_eq!(band.gain_db, 0.0);
        }
    }

    #[test]
    fn hp_and_lp_disabled_by_default() {
        let eq = ParametricEq::new(SR);
        assert!(!eq.bands[0].enabled, "Band 0 (HP) should be disabled by default");
        assert!(!eq.bands[7].enabled, "Band 7 (LP) should be disabled by default");
    }

    #[test]
    fn middle_bands_enabled_by_default() {
        let eq = ParametricEq::new(SR);
        for i in 1..=6 {
            assert!(eq.bands[i].enabled, "Band {i} should be enabled by default");
        }
    }

    #[test]
    fn set_band_updates_params() {
        let mut eq = ParametricEq::new(SR);
        let p = EqBandParams {
            filter_type: FilterType::Peaking,
            frequency: 2000.0,
            gain_db: 6.0,
            q: 1.5,
            enabled: true,
        };
        eq.set_band(3, p);
        assert_eq!(eq.bands[3].frequency, 2000.0);
        assert_eq!(eq.bands[3].gain_db, 6.0);
        assert_eq!(eq.bands[3].q, 1.5);
    }

    #[test]
    fn set_band_out_of_range_is_noop() {
        let mut eq = ParametricEq::new(SR);
        let p = EqBandParams {
            filter_type: FilterType::Peaking,
            frequency: 1000.0,
            gain_db: 0.0,
            q: 1.0,
            enabled: true,
        };
        // Must not panic
        eq.set_band(NUM_BANDS + 5, p);
    }

    #[test]
    fn enable_band_disables_band() {
        let mut eq = ParametricEq::new(SR);
        assert!(eq.bands[2].enabled);
        eq.enable_band(2, false);
        assert!(!eq.bands[2].enabled);
    }

    #[test]
    fn enable_band_re_enables_band() {
        let mut eq = ParametricEq::new(SR);
        eq.enable_band(0, true);
        assert!(eq.bands[0].enabled);
    }

    #[test]
    fn all_bypassed_passes_signal_unchanged() {
        let mut eq = ParametricEq::new(SR);
        for i in 0..NUM_BANDS {
            eq.enable_band(i, false);
        }
        let y = eq.process_sample_mono(0.5);
        assert!((y - 0.5).abs() < 1e-5, "all-bypass EQ should pass 0.5 unchanged, got {y}");
    }

    #[test]
    fn peaking_band_boosts_at_target_frequency() {
        let mut eq = ParametricEq::new(SR);
        for i in 0..NUM_BANDS {
            eq.enable_band(i, false);
        }
        let p = EqBandParams {
            filter_type: FilterType::Peaking,
            frequency: 1000.0,
            gain_db: 6.0,
            q: 1.0,
            enabled: true,
        };
        eq.set_band(3, p);
        let db = eq.magnitude_response_db(1000.0);
        assert!((db - 6.0).abs() < 0.2, "expected ~+6 dB at 1 kHz, got {db}");
    }

    #[test]
    fn frequency_response_curve_returns_correct_count() {
        let eq = ParametricEq::new(SR);
        let curve = eq.frequency_response_curve(200);
        assert_eq!(curve.len(), 200);
    }

    #[test]
    fn frequency_response_first_point_near_20hz() {
        let eq = ParametricEq::new(SR);
        let curve = eq.frequency_response_curve(200);
        assert!((curve[0].freq - 20.0).abs() < 0.5, "first point should be ~20 Hz");
    }

    #[test]
    fn frequency_response_last_point_near_20khz() {
        let eq = ParametricEq::new(SR);
        let curve = eq.frequency_response_curve(200);
        assert!((curve[199].freq - 20_000.0).abs() < 5.0, "last point should be ~20 kHz");
    }

    #[test]
    fn process_stereo_runs_without_panic() {
        let mut eq = ParametricEq::new(SR);
        let mut left = vec![0.5f32; 256];
        let mut right = vec![0.3f32; 256];
        eq.process_stereo(&mut left, &mut right);
        // Just check no NaNs
        assert!(left.iter().all(|s| s.is_finite()));
        assert!(right.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn reset_clears_filter_state() {
        let mut eq = ParametricEq::new(SR);
        let p = EqBandParams {
            filter_type: FilterType::Peaking,
            frequency: 1000.0,
            gain_db: 12.0,
            q: 1.0,
            enabled: true,
        };
        eq.set_band(3, p);
        // Process samples to build state
        for _ in 0..100 {
            eq.process_sample_mono(0.5);
        }
        eq.reset();
        // After reset, zero input should yield zero output
        let y = eq.process_sample_mono(0.0);
        assert!(y.abs() < 1e-5, "after reset, zero input should give ~0, got {y}");
    }
}
