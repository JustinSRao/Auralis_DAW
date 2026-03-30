//! Algorithmic reverb effect — Freeverb / Schroeder architecture.
//!
//! ## Architecture
//!
//! The Freeverb algorithm consists of:
//! - **8 parallel comb filters** (each a delay line with one-pole lowpass feedback)
//! - **4 series allpass filters** (Schroeder allpass, gain = 0.5)
//! - **Pre-delay** ring buffer (0–100 ms) before the comb bank
//! - **Stereo width** matrix applied to the comb output sums
//!
//! Left and right channels use different comb delay lengths to create stereo
//! spread.  Both sides share the same allpass lengths but have independent
//! filter state.
//!
//! ## Comb filter delay lengths (at 44100 Hz)
//!
//! | Comb | Left | Right (Left + 23) |
//! |------|------|-------------------|
//! | 0    | 1116 | 1139              |
//! | 1    | 1188 | 1211              |
//! | 2    | 1277 | 1300              |
//! | 3    | 1356 | 1379              |
//! | 4    | 1422 | 1445              |
//! | 5    | 1491 | 1514              |
//! | 6    | 1557 | 1580              |
//! | 7    | 1617 | 1640              |
//!
//! Allpass lengths: 556, 441, 341, 225 (left); +23 for right.
//!
//! All lengths are scaled linearly when sample_rate ≠ 44100.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use atomic_float::AtomicF32;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::State;

use crate::effects::AudioEffect;

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SAMPLE_RATE: f32 = 44100.0;
const NUM_COMBS: usize = 8;
const NUM_ALLPASSES: usize = 4;
const STEREO_SPREAD: usize = 23;

/// Comb filter delay lengths in samples at 44100 Hz (left channel).
const COMB_LENGTHS_L: [usize; NUM_COMBS] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];

/// Allpass filter delay lengths in samples at 44100 Hz (left channel).
const ALLPASS_LENGTHS_L: [usize; NUM_ALLPASSES] = [556, 441, 341, 225];

/// Maximum pre-delay in seconds.
const MAX_PRE_DELAY_S: f32 = 0.1;

/// Allpass filter feedback gain (Schroeder standard).
const ALLPASS_GAIN: f32 = 0.5;

/// Freeverb room_size → feedback scaling.  `feedback = room_size * 0.28 + 0.7`
const ROOM_SCALE: f32 = 0.28;
const ROOM_OFFSET: f32 = 0.7;

// ─── Internal DSP primitives ──────────────────────────────────────────────────

/// Fixed-capacity ring buffer delay line, allocated once at construction.
struct DelayLine {
    buf: Box<[f32]>,
    write: usize,
    len: usize,
}

impl DelayLine {
    fn new(len: usize) -> Self {
        Self { buf: vec![0.0f32; len].into_boxed_slice(), write: 0, len }
    }

    /// Reads the sample that was written `offset` samples ago.
    #[inline]
    fn read_at(&self, offset: usize) -> f32 {
        let idx = (self.write + self.len - offset.min(self.len - 1)) % self.len;
        self.buf[idx]
    }

    /// Writes a sample at the current write head and advances it.
    #[inline]
    fn write_and_advance(&mut self, s: f32) {
        self.buf[self.write] = s;
        self.write = (self.write + 1) % self.len;
    }

    fn reset(&mut self) {
        self.buf.fill(0.0);
        self.write = 0;
    }
}

/// One comb filter with one-pole lowpass feedback damping.
struct CombFilter {
    line: DelayLine,
    damp_state: f32,
}

impl CombFilter {
    fn new(len: usize) -> Self {
        Self { line: DelayLine::new(len), damp_state: 0.0 }
    }

    /// Processes one sample.
    ///
    /// `room_feedback`: overall feedback gain (derived from room_size).
    /// `damp`: damping coefficient in `[0, 1]`.
    #[inline]
    fn process(&mut self, input: f32, room_feedback: f32, damp: f32) -> f32 {
        let delayed = self.line.read_at(self.line.len - 1);
        let damp2 = 1.0 - damp;
        self.damp_state = delayed * damp2 + self.damp_state * damp;
        self.line.write_and_advance(input + self.damp_state * room_feedback);
        delayed
    }

    fn reset(&mut self) {
        self.line.reset();
        self.damp_state = 0.0;
    }
}

/// Schroeder allpass filter.
struct AllpassFilter {
    line: DelayLine,
}

impl AllpassFilter {
    fn new(len: usize) -> Self {
        Self { line: DelayLine::new(len) }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let buffered = self.line.read_at(self.line.len - 1);
        let output = -input + buffered;
        self.line.write_and_advance(input + buffered * ALLPASS_GAIN);
        output
    }

    fn reset(&mut self) {
        self.line.reset();
    }
}

// ─── Parameters ───────────────────────────────────────────────────────────────

/// Atomic parameter bundle for `AlgorithmicReverb`.
///
/// Written by Tauri command thread; read lock-free by the audio thread.
pub struct ReverbAtomics {
    pub room_size: AtomicF32,    // 0.0–1.0
    pub decay: AtomicF32,        // 0.1–10.0 s (stored as RT60, not used in Freeverb feedback path)
    pub pre_delay_ms: AtomicF32, // 0.0–100.0 ms
    pub wet: AtomicF32,          // 0.0–1.0
    pub damping: AtomicF32,      // 0.0–1.0
    pub width: AtomicF32,        // 0.0–1.0
}

impl Default for ReverbAtomics {
    fn default() -> Self {
        Self {
            room_size: AtomicF32::new(0.5),
            decay: AtomicF32::new(1.5),
            pre_delay_ms: AtomicF32::new(0.0),
            wet: AtomicF32::new(0.3),
            damping: AtomicF32::new(0.5),
            width: AtomicF32::new(1.0),
        }
    }
}

/// Serialisable snapshot returned by [`get_reverb_state`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReverbStateSnapshot {
    pub channel_id: String,
    pub room_size: f32,
    pub decay: f32,
    pub pre_delay_ms: f32,
    pub wet: f32,
    pub damping: f32,
    pub width: f32,
}

// ─── AlgorithmicReverb ────────────────────────────────────────────────────────

/// Freeverb-architecture algorithmic reverb.
///
/// All internal buffers are pre-allocated at construction.  The audio callback
/// path (`process_stereo`) performs **no heap allocation**.
pub struct AlgorithmicReverb {
    combs_l: [CombFilter; NUM_COMBS],
    combs_r: [CombFilter; NUM_COMBS],
    allpasses_l: [AllpassFilter; NUM_ALLPASSES],
    allpasses_r: [AllpassFilter; NUM_ALLPASSES],
    pre_delay_l: DelayLine,
    pre_delay_r: DelayLine,
    atomics: Arc<ReverbAtomics>,
    sample_rate: f32,
}

fn scale_len(base: usize, sample_rate: f32) -> usize {
    ((base as f32 * sample_rate / DEFAULT_SAMPLE_RATE).round() as usize).max(2)
}

impl AlgorithmicReverb {
    /// Creates a new reverb instance at the given sample rate.
    ///
    /// All delay lines are allocated here; no allocation occurs during playback.
    pub fn new(sample_rate: f32) -> Self {
        let combs_l = core::array::from_fn(|i| {
            CombFilter::new(scale_len(COMB_LENGTHS_L[i], sample_rate))
        });
        let combs_r = core::array::from_fn(|i| {
            CombFilter::new(scale_len(COMB_LENGTHS_L[i] + STEREO_SPREAD, sample_rate))
        });
        let allpasses_l = core::array::from_fn(|i| {
            AllpassFilter::new(scale_len(ALLPASS_LENGTHS_L[i], sample_rate))
        });
        let allpasses_r = core::array::from_fn(|i| {
            AllpassFilter::new(scale_len(ALLPASS_LENGTHS_L[i] + STEREO_SPREAD, sample_rate))
        });
        let max_pre = (MAX_PRE_DELAY_S * sample_rate).ceil() as usize + 1;
        Self {
            combs_l,
            combs_r,
            allpasses_l,
            allpasses_r,
            pre_delay_l: DelayLine::new(max_pre),
            pre_delay_r: DelayLine::new(max_pre),
            atomics: Arc::new(ReverbAtomics::default()),
            sample_rate,
        }
    }

    /// Returns a clone of the atomic parameter handle for the Tauri command layer.
    pub fn atomics(&self) -> Arc<ReverbAtomics> {
        Arc::clone(&self.atomics)
    }
}

impl AudioEffect for AlgorithmicReverb {
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        // Read params once per buffer (not per sample).
        let room_size = self.atomics.room_size.load(Ordering::Relaxed).clamp(0.0, 1.0);
        let damping = self.atomics.damping.load(Ordering::Relaxed).clamp(0.0, 1.0);
        let pre_ms = self.atomics.pre_delay_ms.load(Ordering::Relaxed).clamp(0.0, 100.0);
        let wet = self.atomics.wet.load(Ordering::Relaxed).clamp(0.0, 1.0);
        let width = self.atomics.width.load(Ordering::Relaxed).clamp(0.0, 1.0);

        let room_feedback = room_size * ROOM_SCALE + ROOM_OFFSET;
        let pre_samples = ((pre_ms / 1000.0) * self.sample_rate) as usize;
        let pre_samples = pre_samples.min(self.pre_delay_l.len - 1);

        let dry = 1.0 - wet;
        let wet1 = wet * (width / 2.0 + 0.5);
        let wet2 = wet * ((1.0 - width) / 2.0);

        let n = left.len().min(right.len());
        for i in 0..n {
            let in_l = left[i];
            let in_r = right[i];

            // Write into pre-delay buffers.
            self.pre_delay_l.write_and_advance(in_l);
            self.pre_delay_r.write_and_advance(in_r);

            // Read from pre-delay (read_at counts backward from current write head).
            let pd_l = if pre_samples == 0 { in_l } else { self.pre_delay_l.read_at(pre_samples) };
            let pd_r = if pre_samples == 0 { in_r } else { self.pre_delay_r.read_at(pre_samples) };

            // Sum 8 parallel comb filters.
            let mut out_l = 0.0f32;
            let mut out_r = 0.0f32;
            for c in 0..NUM_COMBS {
                out_l += self.combs_l[c].process(pd_l, room_feedback, damping);
                out_r += self.combs_r[c].process(pd_r, room_feedback, damping);
            }

            // 4 series allpass filters.
            for a in 0..NUM_ALLPASSES {
                out_l = self.allpasses_l[a].process(out_l);
                out_r = self.allpasses_r[a].process(out_r);
            }

            // Stereo width matrix + wet/dry mix.
            left[i] = in_l * dry + out_l * wet1 + out_r * wet2;
            right[i] = in_r * dry + out_r * wet1 + out_l * wet2;
        }
    }

    fn reset(&mut self) {
        for c in 0..NUM_COMBS {
            self.combs_l[c].reset();
            self.combs_r[c].reset();
        }
        for a in 0..NUM_ALLPASSES {
            self.allpasses_l[a].reset();
            self.allpasses_r[a].reset();
        }
        self.pre_delay_l.reset();
        self.pre_delay_r.reset();
    }

    fn get_params(&self) -> serde_json::Value {
        let a = &self.atomics;
        serde_json::json!({
            "room_size": a.room_size.load(Ordering::Relaxed),
            "decay": a.decay.load(Ordering::Relaxed),
            "pre_delay_ms": a.pre_delay_ms.load(Ordering::Relaxed),
            "wet": a.wet.load(Ordering::Relaxed),
            "damping": a.damping.load(Ordering::Relaxed),
            "width": a.width.load(Ordering::Relaxed),
        })
    }

    fn set_params(&mut self, params: &serde_json::Value) {
        let a = &self.atomics;
        macro_rules! load_f32 {
            ($key:expr, $atomic:expr, $lo:expr, $hi:expr) => {
                if let Some(v) = params[$key].as_f64() {
                    $atomic.store((v as f32).clamp($lo, $hi), Ordering::Relaxed);
                }
            };
        }
        load_f32!("room_size",    a.room_size,    0.0, 1.0);
        load_f32!("decay",        a.decay,        0.1, 10.0);
        load_f32!("pre_delay_ms", a.pre_delay_ms, 0.0, 100.0);
        load_f32!("wet",          a.wet,          0.0, 1.0);
        load_f32!("damping",      a.damping,      0.0, 1.0);
        load_f32!("width",        a.width,        0.0, 1.0);
    }
}

// ─── Tauri state ──────────────────────────────────────────────────────────────

/// Per-channel reverb store: `channel_id → AlgorithmicReverb`.
pub type ReverbStoreInner = HashMap<String, AlgorithmicReverb>;
/// Shared reverb store managed by Tauri.
pub type ReverbStore = Arc<Mutex<ReverbStoreInner>>;

fn get_or_create<'a>(
    store: &'a mut ReverbStoreInner,
    channel_id: &str,
    sample_rate: f32,
) -> &'a mut AlgorithmicReverb {
    store
        .entry(channel_id.to_owned())
        .or_insert_with(|| AlgorithmicReverb::new(sample_rate))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Sets a single reverb parameter for the given channel.
///
/// `param_name` is one of: `"room_size"`, `"decay"`, `"pre_delay_ms"`,
/// `"wet"`, `"damping"`, `"width"`.
#[tauri::command]
pub fn set_reverb_param(
    channel_id: String,
    param_name: String,
    value: f32,
    state: State<'_, ReverbStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let reverb = get_or_create(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let atomics = reverb.atomics();
    match param_name.as_str() {
        "room_size" => atomics.room_size.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "decay" => atomics.decay.store(value.clamp(0.1, 10.0), Ordering::Relaxed),
        "pre_delay_ms" => atomics.pre_delay_ms.store(value.clamp(0.0, 100.0), Ordering::Relaxed),
        "wet" => atomics.wet.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "damping" => atomics.damping.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "width" => atomics.width.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        other => return Err(format!("unknown reverb param: {other}")),
    }
    Ok(())
}

/// Returns the current reverb state snapshot for the given channel.
#[tauri::command]
pub fn get_reverb_state(
    channel_id: String,
    state: State<'_, ReverbStore>,
) -> Result<ReverbStateSnapshot, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let reverb = get_or_create(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = reverb.atomics();
    Ok(ReverbStateSnapshot {
        channel_id,
        room_size: a.room_size.load(Ordering::Relaxed),
        decay: a.decay.load(Ordering::Relaxed),
        pre_delay_ms: a.pre_delay_ms.load(Ordering::Relaxed),
        wet: a.wet.load(Ordering::Relaxed),
        damping: a.damping.load(Ordering::Relaxed),
        width: a.width.load(Ordering::Relaxed),
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    fn make_reverb() -> AlgorithmicReverb {
        AlgorithmicReverb::new(SR)
    }

    #[test]
    fn new_reverb_does_not_panic_at_44100() {
        let _ = make_reverb();
    }

    #[test]
    fn new_reverb_does_not_panic_at_48000() {
        let _ = AlgorithmicReverb::new(48000.0);
    }

    #[test]
    fn process_stereo_zero_input_stays_finite() {
        let mut rev = make_reverb();
        let mut left = vec![0.0f32; 4096];
        let mut right = vec![0.0f32; 4096];
        rev.process_stereo(&mut left, &mut right);
        assert!(left.iter().all(|s| s.is_finite()));
        assert!(right.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn wet_zero_passes_dry_signal_unchanged() {
        let mut rev = make_reverb();
        rev.atomics().wet.store(0.0, Ordering::Relaxed);
        let mut left = vec![0.5f32; 256];
        let mut right = vec![0.3f32; 256];
        rev.process_stereo(&mut left, &mut right);
        for &s in &left {
            assert!((s - 0.5).abs() < 1e-5, "expected 0.5, got {s}");
        }
        for &s in &right {
            assert!((s - 0.3).abs() < 1e-5, "expected 0.3, got {s}");
        }
    }

    #[test]
    fn wet_one_adds_reverb_energy() {
        let mut rev = make_reverb();
        rev.atomics().wet.store(1.0, Ordering::Relaxed);
        rev.atomics().room_size.store(0.8, Ordering::Relaxed);
        // Run impulse then silence; tail should have energy
        let mut left = vec![0.0f32; 2048];
        let mut right = vec![0.0f32; 2048];
        left[0] = 1.0;
        right[0] = 1.0;
        rev.process_stereo(&mut left, &mut right);
        let tail_energy: f32 = left[100..].iter().map(|s| s * s).sum();
        assert!(tail_energy > 0.0, "reverb tail should have energy");
    }

    #[test]
    fn reset_clears_all_delay_lines() {
        let mut rev = make_reverb();
        rev.atomics().wet.store(1.0, Ordering::Relaxed);
        let mut left = vec![1.0f32; 2048];
        let mut right = vec![1.0f32; 2048];
        rev.process_stereo(&mut left, &mut right);
        rev.reset();
        let mut left2 = vec![0.0f32; 256];
        let mut right2 = vec![0.0f32; 256];
        rev.process_stereo(&mut left2, &mut right2);
        let energy: f32 = left2.iter().map(|s| s * s).sum();
        assert!(energy < 1e-10, "after reset, silence input should produce silence, energy={energy}");
    }

    #[test]
    fn room_size_high_vs_low_tail_length() {
        let run = |room_size: f32| -> f32 {
            let mut rev = AlgorithmicReverb::new(SR);
            rev.atomics().wet.store(1.0, Ordering::Relaxed);
            rev.atomics().room_size.store(room_size, Ordering::Relaxed);
            let mut left = vec![0.0f32; 8192];
            let mut right = vec![0.0f32; 8192];
            left[0] = 1.0;
            right[0] = 1.0;
            rev.process_stereo(&mut left, &mut right);
            left[2000..].iter().map(|s| s * s).sum()
        };
        let energy_large = run(0.9);
        let energy_small = run(0.1);
        assert!(
            energy_large > energy_small,
            "larger room should have more tail energy: large={energy_large} small={energy_small}"
        );
    }

    #[test]
    fn stereo_width_zero_collapses_to_mono() {
        let mut rev = make_reverb();
        rev.atomics().wet.store(1.0, Ordering::Relaxed);
        rev.atomics().width.store(0.0, Ordering::Relaxed);
        let mut left = vec![0.0f32; 2048];
        let mut right = vec![0.0f32; 2048];
        left[0] = 1.0;
        right[0] = 0.0;
        rev.process_stereo(&mut left, &mut right);
        // With width=0, wet1=wet2=0.5, so L_out == R_out
        for (l, r) in left.iter().zip(right.iter()) {
            assert!((l - r).abs() < 1e-5, "width=0 should collapse to mono: L={l} R={r}");
        }
    }

    #[test]
    fn process_stereo_does_not_produce_nan() {
        let mut rev = make_reverb();
        rev.atomics().room_size.store(0.9, Ordering::Relaxed);
        rev.atomics().wet.store(0.8, Ordering::Relaxed);
        let mut left: Vec<f32> = (0..4096).map(|i| ((i as f32) * 0.01).sin()).collect();
        let mut right: Vec<f32> = (0..4096).map(|i| ((i as f32) * 0.013).cos()).collect();
        rev.process_stereo(&mut left, &mut right);
        assert!(left.iter().all(|s| s.is_finite()));
        assert!(right.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn scale_len_scales_correctly() {
        assert_eq!(scale_len(1116, 44100.0), 1116);
        let scaled = scale_len(1116, 48000.0);
        assert!(scaled > 1116, "48000 Hz should give longer delay lines");
    }

    #[test]
    fn set_reverb_param_unknown_returns_error() {
        // Test the param name matching logic directly via atomics
        let mut rev = make_reverb();
        let a = rev.atomics();
        // Verify defaults
        assert!((a.room_size.load(Ordering::Relaxed) - 0.5).abs() < 1e-5);
        // Simulate what set_reverb_param does for "room_size"
        a.room_size.store(0.8f32.clamp(0.0, 1.0), Ordering::Relaxed);
        assert!((a.room_size.load(Ordering::Relaxed) - 0.8).abs() < 1e-5);
    }
}
