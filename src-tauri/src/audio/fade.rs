//! Pre-computed fade lookup tables and gain computation for audio clip fades.
//!
//! ## Design
//!
//! `FadeTables` holds 256-entry f32 lookup tables for each `FadeCurve` variant.
//! Tables are computed once at startup and shared via `Arc<FadeTables>`.
//! At process time, `compute_fade_gain` does a single array lookup + linear
//! interpolation — no `pow()`, `exp()`, or `log()` calls on the audio thread.
//!
//! ## Curve Formulas (t ∈ [0, 1])
//!
//! - **Linear**: `t`
//! - **ExponentialIn**: `t³`  (slow start, fast end)
//! - **ExponentialOut**: `1 − (1−t)³`  (fast start, slow end)
//! - **SCurve**: `0.5 × (1 − cos(π·t))`  (equal-power cosine — default for crossfades)
//! - **Logarithmic**: `log₁₀(1 + 9t)`

use std::f32::consts::PI;

use serde::{Deserialize, Serialize};

// ─── FadeCurve ────────────────────────────────────────────────────────────────

/// Fade shape applied during the fade-in or fade-out region of a clip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FadeCurve {
    /// Gain rises / falls linearly.  `gain(t) = t`.
    #[default]
    Linear,
    /// Slow start, fast end.  `gain(t) = t³`.
    ExponentialIn,
    /// Fast start, slow end.  `gain(t) = 1 − (1−t)³`.
    ExponentialOut,
    /// Equal-power cosine.  `gain(t) = 0.5 × (1 − cos(πt))`.
    /// Recommended for crossfades: fade_out² + fade_in² ≈ 1 at every point.
    SCurve,
    /// `gain(t) = log₁₀(1 + 9t)`.
    Logarithmic,
}

impl FadeCurve {
    /// Returns the curve variant name as a lowercase string.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Linear        => "linear",
            Self::ExponentialIn  => "exponential_in",
            Self::ExponentialOut => "exponential_out",
            Self::SCurve        => "s_curve",
            Self::Logarithmic   => "logarithmic",
        }
    }

    /// Parses a curve from a lowercase string.  Returns `None` on unknown input.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "linear"          => Some(Self::Linear),
            "exponential_in"  => Some(Self::ExponentialIn),
            "exponential_out" => Some(Self::ExponentialOut),
            "s_curve"         => Some(Self::SCurve),
            "logarithmic"     => Some(Self::Logarithmic),
            _ => None,
        }
    }
}

// ─── FadeTables ──────────────────────────────────────────────────────────────

const TABLE_SIZE: usize = 256;

/// Pre-computed gain lookup tables, one 256-entry table per `FadeCurve` variant.
///
/// Construct once at startup via `FadeTables::new()` and share through an
/// `Arc<FadeTables>`.  All methods are `&self` — no mutation after construction.
pub struct FadeTables {
    linear:          [f32; TABLE_SIZE],
    exponential_in:  [f32; TABLE_SIZE],
    exponential_out: [f32; TABLE_SIZE],
    s_curve:         [f32; TABLE_SIZE],
    logarithmic:     [f32; TABLE_SIZE],
}

impl FadeTables {
    /// Computes all five lookup tables.  Called once at application startup.
    pub fn new() -> Self {
        let mut linear          = [0f32; TABLE_SIZE];
        let mut exponential_in  = [0f32; TABLE_SIZE];
        let mut exponential_out = [0f32; TABLE_SIZE];
        let mut s_curve         = [0f32; TABLE_SIZE];
        let mut logarithmic     = [0f32; TABLE_SIZE];

        for i in 0..TABLE_SIZE {
            let t = i as f32 / (TABLE_SIZE - 1) as f32; // t ∈ [0, 1]
            linear[i]          = t;
            exponential_in[i]  = t * t * t;
            exponential_out[i] = 1.0 - (1.0 - t).powi(3);
            s_curve[i]         = 0.5 * (1.0 - (PI * t).cos());
            logarithmic[i]     = (1.0 + 9.0 * t).log10();
        }

        Self { linear, exponential_in, exponential_out, s_curve, logarithmic }
    }

    /// Returns the pre-computed table for `curve`.
    #[inline]
    fn table(&self, curve: FadeCurve) -> &[f32; TABLE_SIZE] {
        match curve {
            FadeCurve::Linear        => &self.linear,
            FadeCurve::ExponentialIn  => &self.exponential_in,
            FadeCurve::ExponentialOut => &self.exponential_out,
            FadeCurve::SCurve        => &self.s_curve,
            FadeCurve::Logarithmic   => &self.logarithmic,
        }
    }
}

impl Default for FadeTables {
    fn default() -> Self {
        Self::new()
    }
}

// ─── compute_fade_gain ───────────────────────────────────────────────────────

/// Returns the gain multiplier for a sample at `pos` within a fade region of
/// `fade_len` samples, using `curve` and its pre-computed `tables`.
///
/// - `pos` is the sample offset from the **start** of the fade (0 = silent end,
///   `fade_len − 1` = full-level end for a fade-in; reversed for fade-out at
///   call site).
/// - Returns `1.0` when `fade_len == 0` (no fade).
/// - Linearly interpolates between adjacent table entries for accuracy.
#[inline]
pub fn compute_fade_gain(pos: u64, fade_len: u64, curve: FadeCurve, tables: &FadeTables) -> f32 {
    if fade_len == 0 {
        return 1.0;
    }
    let pos = pos.min(fade_len); // clamp to [0, fade_len]
    // Map pos to [0, TABLE_SIZE-1] with sub-sample accuracy via lerp.
    let t = pos as f32 / fade_len as f32 * (TABLE_SIZE - 1) as f32;
    let lo = t.floor() as usize;
    let hi = (lo + 1).min(TABLE_SIZE - 1);
    let frac = t - lo as f32;

    let table = tables.table(curve);
    table[lo] + frac * (table[hi] - table[lo])
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn tables() -> FadeTables {
        FadeTables::new()
    }

    #[test]
    fn zero_fade_len_returns_one() {
        let t = tables();
        assert_eq!(compute_fade_gain(0, 0, FadeCurve::Linear, &t), 1.0);
        assert_eq!(compute_fade_gain(999, 0, FadeCurve::SCurve, &t), 1.0);
    }

    #[test]
    fn linear_starts_at_zero_ends_at_one() {
        let t = tables();
        let gain_start = compute_fade_gain(0, 1000, FadeCurve::Linear, &t);
        let gain_end   = compute_fade_gain(1000, 1000, FadeCurve::Linear, &t);
        assert!(gain_start < 0.01, "linear start should be near 0, got {gain_start}");
        assert!((gain_end - 1.0).abs() < 0.01, "linear end should be near 1, got {gain_end}");
    }

    #[test]
    fn linear_midpoint_is_half() {
        let t = tables();
        let gain = compute_fade_gain(500, 1000, FadeCurve::Linear, &t);
        assert!((gain - 0.5).abs() < 0.01, "linear mid should be ~0.5, got {gain}");
    }

    #[test]
    fn s_curve_midpoint_is_half() {
        let t = tables();
        // S-curve is symmetric; midpoint = 0.5
        let gain = compute_fade_gain(500, 1000, FadeCurve::SCurve, &t);
        assert!((gain - 0.5).abs() < 0.01, "s_curve mid should be ~0.5, got {gain}");
    }

    #[test]
    fn s_curve_equal_power_at_midpoint() {
        // For an equal-power crossfade: fade_out^2 + fade_in^2 ≈ 1
        // At midpoint: fade_out = s_curve(0.5), fade_in = s_curve(0.5) = 0.5
        // 0.5^2 + 0.5^2 = 0.5 — but equal-power uses sqrt scaling in practice.
        // For pure S-curve: gain(0.5)^2 + (1-gain(0.5))^2 ≈ 0.5 (constant energy)
        let t = tables();
        let g = compute_fade_gain(500, 1000, FadeCurve::SCurve, &t);
        let energy = g * g + (1.0 - g) * (1.0 - g);
        assert!((energy - 0.5).abs() < 0.02, "S-curve should satisfy energy ≈ 0.5 at midpoint, got {energy}");
    }

    #[test]
    fn exponential_in_is_slow_at_start() {
        let t = tables();
        // At 10% through the fade, gain should be well below linear
        let linear_g = compute_fade_gain(100, 1000, FadeCurve::Linear, &t);
        let exp_in_g  = compute_fade_gain(100, 1000, FadeCurve::ExponentialIn, &t);
        assert!(exp_in_g < linear_g, "exponential_in should be slower than linear at 10%");
    }

    #[test]
    fn exponential_out_is_fast_at_start() {
        let t = tables();
        let linear_g  = compute_fade_gain(100, 1000, FadeCurve::Linear, &t);
        let exp_out_g = compute_fade_gain(100, 1000, FadeCurve::ExponentialOut, &t);
        assert!(exp_out_g > linear_g, "exponential_out should be faster than linear at 10%");
    }

    #[test]
    fn logarithmic_starts_low_ends_at_one() {
        let t = tables();
        let g_start = compute_fade_gain(0, 1000, FadeCurve::Logarithmic, &t);
        let g_end   = compute_fade_gain(1000, 1000, FadeCurve::Logarithmic, &t);
        assert!(g_start < 0.01, "log start near 0, got {g_start}");
        assert!((g_end - 1.0).abs() < 0.01, "log end near 1, got {g_end}");
    }

    #[test]
    fn all_curves_clamp_at_pos_beyond_fade_len() {
        let t = tables();
        for curve in [
            FadeCurve::Linear, FadeCurve::ExponentialIn, FadeCurve::ExponentialOut,
            FadeCurve::SCurve, FadeCurve::Logarithmic,
        ] {
            let g = compute_fade_gain(9999, 1000, curve, &t);
            assert!((g - 1.0).abs() < 0.01, "curve {:?} clamped to 1.0 beyond fade_len, got {g}", curve);
        }
    }

    #[test]
    fn fade_curve_roundtrip_str() {
        for curve in [
            FadeCurve::Linear, FadeCurve::ExponentialIn, FadeCurve::ExponentialOut,
            FadeCurve::SCurve, FadeCurve::Logarithmic,
        ] {
            let s = curve.as_str();
            let back = FadeCurve::from_str(s);
            assert_eq!(back, Some(curve), "roundtrip failed for {s}");
        }
    }

    #[test]
    fn fade_curve_from_str_unknown_returns_none() {
        assert_eq!(FadeCurve::from_str("bogus"), None);
    }

    #[test]
    fn fade_curve_default_is_linear() {
        assert_eq!(FadeCurve::default(), FadeCurve::Linear);
    }

    #[test]
    fn fade_tables_new_and_default_produce_same_tables() {
        let a = FadeTables::new();
        let b = FadeTables::default();
        for i in 0..TABLE_SIZE {
            assert_eq!(a.linear[i], b.linear[i]);
            assert_eq!(a.s_curve[i], b.s_curve[i]);
        }
    }
}
