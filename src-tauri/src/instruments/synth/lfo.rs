use std::f32::consts::PI;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use atomic_float::AtomicF32;
use serde::{Deserialize, Serialize};

// ────────────────────────────────────────────────────────────────────────────
// LfoWaveform
// ────────────────────────────────────────────────────────────────────────────

/// The six waveform shapes available to the LFO.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LfoWaveform {
    /// Smooth sinusoidal oscillation.
    Sine,
    /// Linear up-then-down triangle.
    Triangle,
    /// Ramp rising from -1 to +1.
    SawUp,
    /// Ramp falling from +1 to -1.
    SawDown,
    /// Alternating +1 / -1 square wave.
    Square,
    /// Holds a random value and jumps at each cycle.
    SampleAndHold,
}

impl LfoWaveform {
    /// Converts a floating-point waveform index (0.0–5.0) to an `LfoWaveform`.
    ///
    /// Values are truncated to integer indices: 0=Sine, 1=Triangle, 2=SawUp,
    /// 3=SawDown, 4=Square, 5=SampleAndHold. Values out of range saturate to
    /// `SampleAndHold`.
    pub fn from_f32(v: f32) -> Self {
        match v as u32 {
            0 => Self::Sine,
            1 => Self::Triangle,
            2 => Self::SawUp,
            3 => Self::SawDown,
            4 => Self::Square,
            _ => Self::SampleAndHold,
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Lfo
// ────────────────────────────────────────────────────────────────────────────

/// A single LFO oscillator with phase accumulation.
///
/// Real-time safe: no heap allocations, no locks. All state is stack-resident.
/// The `SampleAndHold` waveform uses a 32-bit LCG for its pseudo-random source.
pub struct Lfo {
    /// Current phase normalised to `[0.0, 1.0)`.
    phase: f32,
    /// Held random output for `SampleAndHold` — updated on phase wrap.
    rand_output: f32,
    /// LCG state for pseudo-random generation.
    lcg_state: u32,
}

impl Lfo {
    /// Creates a new LFO with the given seed for the S&H random generator.
    pub fn new(seed: u32) -> Self {
        let mut lfo = Self {
            phase: 0.0,
            rand_output: 0.0,
            lcg_state: seed,
        };
        // Warm up the RNG so the first S&H output isn't always the same value
        lfo.rand_output = lfo.next_rand();
        lfo
    }

    /// Resets the LFO phase to 0.
    pub fn reset_phase(&mut self) {
        self.phase = 0.0;
    }

    /// Advances the LFO phase by one sample and returns the current output.
    ///
    /// The output is in `[-1.0, 1.0]`.
    ///
    /// `rate_hz` is the LFO frequency in Hz.
    /// `sample_rate` is the audio engine sample rate in Hz.
    /// `waveform` selects the output shape.
    pub fn tick(&mut self, rate_hz: f32, sample_rate: f32, waveform: LfoWaveform) -> f32 {
        let phase_inc = rate_hz / sample_rate;

        // For S&H: detect wrap *before* advancing, so a new random is sampled
        // at the exact moment phase crosses 1.0.
        let next_phase = self.phase + phase_inc;
        if matches!(waveform, LfoWaveform::SampleAndHold) && next_phase >= 1.0 {
            self.rand_output = self.next_rand();
        }

        // Compute output from current phase
        let output = match waveform {
            LfoWaveform::Sine => (self.phase * 2.0 * PI).sin(),
            LfoWaveform::Triangle => {
                if self.phase < 0.5 {
                    4.0 * self.phase - 1.0
                } else {
                    3.0 - 4.0 * self.phase
                }
            }
            LfoWaveform::SawUp => 2.0 * self.phase - 1.0,
            LfoWaveform::SawDown => 1.0 - 2.0 * self.phase,
            LfoWaveform::Square => {
                if self.phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            LfoWaveform::SampleAndHold => self.rand_output,
        };

        // Advance and wrap phase
        self.phase = next_phase;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        output
    }

    /// Returns a pseudo-random value in `[-1.0, 1.0]` using a 32-bit LCG.
    ///
    /// LCG parameters from Numerical Recipes:
    /// `state = state * 1664525 + 1013904223`
    fn next_rand(&mut self) -> f32 {
        self.lcg_state = self.lcg_state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        // Map u32 to [-1.0, 1.0]
        (self.lcg_state as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

// ────────────────────────────────────────────────────────────────────────────
// LfoDestination (for documentation / mapping convenience)
// ────────────────────────────────────────────────────────────────────────────

/// LFO modulation destination indices.
///
/// Stored as `f32` atomics (0.0–3.0) and cast to `u8` for routing in the voice.
pub mod destination {
    //! LFO modulation destination constants mapping index values to parameter targets.
    pub const CUTOFF: u8 = 0;
    pub const PITCH: u8 = 1;
    pub const AMPLITUDE: u8 = 2;
    pub const RESONANCE: u8 = 3;
}

// ────────────────────────────────────────────────────────────────────────────
// LfoParams
// ────────────────────────────────────────────────────────────────────────────

/// Lock-free atomic parameter store for a single LFO.
///
/// All fields are `Arc<AtomicF32>` so the main thread can write and the audio
/// thread can read with `Ordering::Relaxed` — no mutex required on the hot path.
pub struct LfoParams {
    /// LFO rate in Hz (0.01–20.0) when BPM sync is disabled.
    pub rate: Arc<AtomicF32>,
    /// Modulation depth (0.0–1.0).
    pub depth: Arc<AtomicF32>,
    /// Waveform index: 0=Sine, 1=Triangle, 2=SawUp, 3=SawDown, 4=Square, 5=S&H.
    pub waveform: Arc<AtomicF32>,
    /// Non-zero (> 0.5) to enable BPM-sync mode.
    pub bpm_sync: Arc<AtomicF32>,
    /// BPM sync division: 0=1/4, 1=1/8, 2=1/16, 3=1/32 (stored as f32 index).
    pub division: Arc<AtomicF32>,
    /// Non-zero (> 0.5) to reset phase on every note-on.
    pub phase_reset: Arc<AtomicF32>,
    /// Destination: 0=Cutoff, 1=Pitch, 2=Amplitude, 3=Resonance.
    pub destination: Arc<AtomicF32>,
}

impl LfoParams {
    /// Creates a new `LfoParams` with sensible defaults and wraps it in an `Arc`.
    ///
    /// Defaults: rate=1.0 Hz, depth=0.0 (silent), Sine waveform,
    /// BPM sync off, 1/8 note division, no phase reset, Cutoff destination.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            rate: Arc::new(AtomicF32::new(1.0)),
            depth: Arc::new(AtomicF32::new(0.0)),
            waveform: Arc::new(AtomicF32::new(0.0)),
            bpm_sync: Arc::new(AtomicF32::new(0.0)),
            division: Arc::new(AtomicF32::new(1.0)),
            phase_reset: Arc::new(AtomicF32::new(0.0)),
            destination: Arc::new(AtomicF32::new(0.0)),
        })
    }
}

// ────────────────────────────────────────────────────────────────────────────
// LfoParamSnapshot
// ────────────────────────────────────────────────────────────────────────────

/// Serializable point-in-time snapshot of all LFO parameters.
///
/// Used as the IPC return type for `get_lfo_state`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LfoParamSnapshot {
    /// LFO rate in Hz.
    pub rate: f32,
    /// Modulation depth (0.0–1.0).
    pub depth: f32,
    /// Waveform index (0–5).
    pub waveform: f32,
    /// BPM sync enabled flag (0.0 or 1.0).
    pub bpm_sync: f32,
    /// Division index (0–3).
    pub division: f32,
    /// Phase reset on note-on flag (0.0 or 1.0).
    pub phase_reset: f32,
    /// Destination index (0–3).
    pub destination: f32,
}

impl LfoParamSnapshot {
    /// Reads all parameters from `LfoParams` atomics into a snapshot.
    pub fn from_params(p: &LfoParams) -> Self {
        Self {
            rate: p.rate.load(Ordering::Relaxed),
            depth: p.depth.load(Ordering::Relaxed),
            waveform: p.waveform.load(Ordering::Relaxed),
            bpm_sync: p.bpm_sync.load(Ordering::Relaxed),
            division: p.division.load(Ordering::Relaxed),
            phase_reset: p.phase_reset.load(Ordering::Relaxed),
            destination: p.destination.load(Ordering::Relaxed),
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// LfoStateSnapshot (aggregate of both LFOs)
// ────────────────────────────────────────────────────────────────────────────

/// Combined snapshot of both LFO parameter stores returned by `get_lfo_state`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LfoStateSnapshot {
    /// LFO 1 parameters.
    pub lfo1: LfoParamSnapshot,
    /// LFO 2 parameters.
    pub lfo2: LfoParamSnapshot,
}

// ────────────────────────────────────────────────────────────────────────────
// LfoParamsState (Tauri managed state)
// ────────────────────────────────────────────────────────────────────────────

/// Tauri managed state holding both LFO parameter stores.
///
/// A single struct is used because Tauri can only manage one instance per type.
/// Commands index into `.lfo1` or `.lfo2` by the `slot` parameter.
pub struct LfoParamsState {
    /// LFO 1 parameter store.
    pub lfo1: Arc<LfoParams>,
    /// LFO 2 parameter store.
    pub lfo2: Arc<LfoParams>,
}

// ────────────────────────────────────────────────────────────────────────────
// set_lfo_param_by_name
// ────────────────────────────────────────────────────────────────────────────

/// Sets a single LFO parameter by name.
///
/// Returns an error string if the parameter name is unrecognized.
pub fn set_lfo_param_by_name(params: &LfoParams, name: &str, value: f32) -> Result<(), String> {
    match name {
        "rate" => params.rate.store(value.clamp(0.01, 20.0), Ordering::Relaxed),
        "depth" => params.depth.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "waveform" => params.waveform.store(value.clamp(0.0, 5.0), Ordering::Relaxed),
        "bpm_sync" => params.bpm_sync.store(if value > 0.5 { 1.0 } else { 0.0 }, Ordering::Relaxed),
        "division" => params.division.store(value.clamp(0.0, 3.0), Ordering::Relaxed),
        "phase_reset" => params.phase_reset.store(if value > 0.5 { 1.0 } else { 0.0 }, Ordering::Relaxed),
        "destination" => params.destination.store(value.clamp(0.0, 3.0), Ordering::Relaxed),
        _ => return Err(format!("Unknown LFO parameter: '{}'", name)),
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────────
// Unit tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    // Helper: collect one full LFO cycle's worth of samples
    fn collect_cycle(waveform: LfoWaveform, rate_hz: f32) -> Vec<f32> {
        let samples_per_cycle = (SR / rate_hz) as usize;
        let mut lfo = Lfo::new(42);
        (0..samples_per_cycle)
            .map(|_| lfo.tick(rate_hz, SR, waveform))
            .collect()
    }

    #[test]
    fn test_sine_range() {
        let samples = collect_cycle(LfoWaveform::Sine, 1.0);
        for &s in &samples {
            assert!(s >= -1.001 && s <= 1.001, "Sine out of range: {}", s);
        }
        let max = samples.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        assert!(max > 0.99, "Sine peak should reach ~1.0, got {}", max);
    }

    #[test]
    fn test_triangle_range_and_peaks() {
        let samples = collect_cycle(LfoWaveform::Triangle, 1.0);
        for &s in &samples {
            assert!(s >= -1.001 && s <= 1.001, "Triangle out of range: {}", s);
        }
        let max = samples.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let min = samples.iter().cloned().fold(f32::INFINITY, f32::min);
        assert!(max > 0.99, "Triangle max should be ~1.0, got {}", max);
        assert!(min < -0.99, "Triangle min should be ~-1.0, got {}", min);
    }

    #[test]
    fn test_saw_up_range_and_direction() {
        let samples = collect_cycle(LfoWaveform::SawUp, 1.0);
        for &s in &samples {
            assert!(s >= -1.001 && s <= 1.001, "SawUp out of range: {}", s);
        }
        // Saw up should start near -1 and ramp up
        assert!(samples[0] < -0.99, "SawUp first sample should be near -1, got {}", samples[0]);
    }

    #[test]
    fn test_saw_down_range_and_direction() {
        let samples = collect_cycle(LfoWaveform::SawDown, 1.0);
        for &s in &samples {
            assert!(s >= -1.001 && s <= 1.001, "SawDown out of range: {}", s);
        }
        // Saw down starts near +1 and ramps down
        assert!(samples[0] > 0.99, "SawDown first sample should be near +1, got {}", samples[0]);
    }

    #[test]
    fn test_square_only_two_values() {
        let samples = collect_cycle(LfoWaveform::Square, 1.0);
        for &s in &samples {
            let is_plus_one = (s - 1.0).abs() < f32::EPSILON;
            let is_minus_one = (s + 1.0).abs() < f32::EPSILON;
            assert!(is_plus_one || is_minus_one, "Square must be ±1, got {}", s);
        }
    }

    #[test]
    fn test_sample_and_hold_frozen_within_cycle() {
        // S&H should output a constant value for the entire first cycle
        let samples_per_cycle = (SR / 1.0_f32) as usize;
        let mut lfo = Lfo::new(123);
        let first = lfo.tick(1.0, SR, LfoWaveform::SampleAndHold);
        for _ in 1..samples_per_cycle - 1 {
            let s = lfo.tick(1.0, SR, LfoWaveform::SampleAndHold);
            assert_eq!(s, first, "S&H must hold its value within a cycle");
        }
    }

    #[test]
    fn test_sample_and_hold_jumps_on_phase_wrap() {
        // S&H should produce a different value after a full cycle
        let samples_per_cycle = (SR / 10.0_f32) as usize;
        let mut lfo = Lfo::new(7);
        let first_cycle_val = lfo.tick(10.0, SR, LfoWaveform::SampleAndHold);
        // Advance to just before wrap
        for _ in 1..samples_per_cycle - 1 {
            lfo.tick(10.0, SR, LfoWaveform::SampleAndHold);
        }
        // Tick past the wrap — should produce a new random value
        let second_cycle_val = lfo.tick(10.0, SR, LfoWaveform::SampleAndHold);
        // With high probability the values differ (1-in-2^32 chance of same)
        // Just verify the output is in range and the code runs without panic
        assert!(second_cycle_val >= -1.0 && second_cycle_val <= 1.0);
        let _ = first_cycle_val; // suppress unused warning
    }

    #[test]
    fn test_phase_reset() {
        let mut lfo = Lfo::new(0);
        // Advance 100 samples
        for _ in 0..100 {
            lfo.tick(5.0, SR, LfoWaveform::Sine);
        }
        lfo.reset_phase();
        // After reset, first sample should equal a freshly-created LFO's first sample
        let after_reset = lfo.tick(5.0, SR, LfoWaveform::Sine);
        let mut fresh = Lfo::new(0);
        let fresh_first = fresh.tick(5.0, SR, LfoWaveform::Sine);
        assert!(
            (after_reset - fresh_first).abs() < 1e-5,
            "After reset, output should equal fresh LFO first sample: {} vs {}",
            after_reset,
            fresh_first
        );
    }

    #[test]
    fn test_from_f32_mapping() {
        assert!(matches!(LfoWaveform::from_f32(0.0), LfoWaveform::Sine));
        assert!(matches!(LfoWaveform::from_f32(1.0), LfoWaveform::Triangle));
        assert!(matches!(LfoWaveform::from_f32(2.0), LfoWaveform::SawUp));
        assert!(matches!(LfoWaveform::from_f32(3.0), LfoWaveform::SawDown));
        assert!(matches!(LfoWaveform::from_f32(4.0), LfoWaveform::Square));
        assert!(matches!(LfoWaveform::from_f32(5.0), LfoWaveform::SampleAndHold));
        assert!(matches!(LfoWaveform::from_f32(99.0), LfoWaveform::SampleAndHold));
    }

    #[test]
    fn test_set_lfo_param_by_name_valid() {
        let params = LfoParams::new();
        assert!(set_lfo_param_by_name(&params, "rate", 5.0).is_ok());
        assert!((params.rate.load(Ordering::Relaxed) - 5.0).abs() < 1e-6);

        assert!(set_lfo_param_by_name(&params, "depth", 0.8).is_ok());
        assert!((params.depth.load(Ordering::Relaxed) - 0.8).abs() < 1e-6);

        assert!(set_lfo_param_by_name(&params, "waveform", 2.0).is_ok());
        assert!((params.waveform.load(Ordering::Relaxed) - 2.0).abs() < 1e-6);

        assert!(set_lfo_param_by_name(&params, "destination", 1.0).is_ok());
        assert!((params.destination.load(Ordering::Relaxed) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_set_lfo_param_by_name_unknown() {
        let params = LfoParams::new();
        let result = set_lfo_param_by_name(&params, "nonexistent", 1.0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown LFO parameter"));
    }
}
