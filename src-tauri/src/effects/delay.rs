//! Stereo delay effect with ping-pong, tempo sync, and high-cut feedback filter.
//!
//! ## Design
//!
//! `StereoDelay` uses two ring buffers (left and right), each pre-allocated to
//! `max_delay_samples = ceil(2.0 * sample_rate)` — 88 200 samples at 44100 Hz.
//! No allocation occurs during the audio callback.
//!
//! ### Ping-pong mode
//!
//! When enabled, the feedback from the left channel feeds back into the right
//! delay buffer and vice versa, causing echoes to alternate between channels.
//!
//! ### Tempo sync
//!
//! `DelayTimeMode::Sync` stores a `NoteDiv` enum.  The command layer converts
//! the division to samples using `tempo_sync_delay_samples` and stores the
//! result in `delay_samples: AtomicU32`.  The audio callback reads only the
//! pre-computed `AtomicU32` — no floating-point BPM lookup on the hot path.
//!
//! ### High-cut feedback filter
//!
//! A single-pole IIR low-pass filter (`y[n] = c * x[n] + (1-c) * y[n-1]`) sits
//! in the feedback path so that repeats gradually lose high-frequency content,
//! simulating tape-delay character.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use atomic_float::AtomicF32;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::effects::AudioEffect;

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SAMPLE_RATE: f32 = 44100.0;
/// Maximum supported delay time in seconds (pre-allocates ring buffers).
const MAX_DELAY_S: f32 = 2.0;
/// Feedback ceiling — avoids runaway oscillation.
const MAX_FEEDBACK: f32 = 0.99;
/// Default high-cut frequency in Hz.
const DEFAULT_HICUT_HZ: f32 = 8000.0;

// ─── Note division ────────────────────────────────────────────────────────────

/// Rhythmic subdivision for tempo-synced delay.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteDiv {
    Whole,
    Half,
    Quarter,
    Eighth,
    Sixteenth,
    ThirtySecond,
}

impl NoteDiv {
    /// Returns the number of beats this division occupies.
    pub fn beat_fraction(self) -> f64 {
        match self {
            NoteDiv::Whole => 4.0,
            NoteDiv::Half => 2.0,
            NoteDiv::Quarter => 1.0,
            NoteDiv::Eighth => 0.5,
            NoteDiv::Sixteenth => 0.25,
            NoteDiv::ThirtySecond => 0.125,
        }
    }
}

/// Delay time mode — either free-running milliseconds or BPM-locked.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum DelayTimeMode {
    /// Free-running delay time in milliseconds (1–2000).
    Ms { ms: f32 },
    /// Tempo-synced to a note division at the project BPM.
    Sync { div: NoteDiv },
}

/// Converts a note division and BPM to delay time in samples.
///
/// # Formula
///
/// ```text
/// (60.0 / bpm * note_division_beats * sample_rate) as u32
/// ```
///
/// # Examples
///
/// ```
/// use music_application_lib::effects::delay::tempo_sync_delay_samples;
/// // Quarter note at 120 BPM, 44100 Hz → 22050 samples
/// assert_eq!(tempo_sync_delay_samples(120.0, 1.0, 44100), 22050);
/// ```
pub fn tempo_sync_delay_samples(bpm: f64, note_division_beats: f64, sample_rate: u32) -> u32 {
    let seconds_per_beat = 60.0 / bpm.max(1.0);
    let delay_seconds = seconds_per_beat * note_division_beats;
    let samples = (delay_seconds * sample_rate as f64) as u32;
    samples.min(MAX_DELAY_S as u32 * sample_rate)
}

// ─── Atomics ──────────────────────────────────────────────────────────────────

/// Atomic parameter bundle for `StereoDelay`.
///
/// Written by Tauri commands; read lock-free by the audio callback.
pub struct DelayAtomics {
    /// Current delay in samples (pre-computed from mode + BPM by command layer).
    pub delay_samples: AtomicU32,
    pub feedback: AtomicF32,   // 0.0–0.99
    pub wet: AtomicF32,        // 0.0–1.0
    pub ping_pong: AtomicBool,
    /// 1-pole low-pass coefficient for the feedback high-cut filter.
    /// `coeff = 1.0 - exp(-2π * hicut_hz / sample_rate)`
    pub hicut_coeff: AtomicF32,
}

impl Default for DelayAtomics {
    fn default() -> Self {
        let default_coeff = hicut_coeff(DEFAULT_HICUT_HZ, DEFAULT_SAMPLE_RATE);
        Self {
            delay_samples: AtomicU32::new(
                (0.25 * DEFAULT_SAMPLE_RATE) as u32, // 250 ms default
            ),
            feedback: AtomicF32::new(0.4),
            wet: AtomicF32::new(0.3),
            ping_pong: AtomicBool::new(false),
            hicut_coeff: AtomicF32::new(default_coeff),
        }
    }
}

/// Computes the 1-pole low-pass coefficient for the given cut frequency.
///
/// Uses the formula `c = 1 - exp(-2π * fc / fs)`.
pub fn hicut_coeff(hicut_hz: f32, sample_rate: f32) -> f32 {
    let omega = 2.0 * std::f32::consts::PI * hicut_hz / sample_rate.max(1.0);
    1.0 - (-omega).exp()
}

/// Serialisable snapshot returned by [`get_delay_state`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DelayStateSnapshot {
    pub channel_id: String,
    pub delay_mode: DelayTimeMode,
    pub feedback: f32,
    pub wet: f32,
    pub ping_pong: bool,
    pub hicut_hz: f32,
}

// ─── StereoDelay ─────────────────────────────────────────────────────────────

/// Stereo delay with ping-pong, tempo sync, and high-cut feedback.
///
/// Ring buffers are pre-allocated to 2 seconds × sample_rate at construction.
pub struct StereoDelay {
    buf_l: Box<[f32]>,
    buf_r: Box<[f32]>,
    write_l: usize,
    write_r: usize,
    cap: usize,
    /// 1-pole LP filter state for left feedback path.
    hicut_state_l: f32,
    /// 1-pole LP filter state for right feedback path.
    hicut_state_r: f32,
    atomics: Arc<DelayAtomics>,
    sample_rate: f32,
    /// Stored mode for serialisation (not read on hot path).
    delay_mode: DelayTimeMode,
    /// Stored hicut_hz for serialisation.
    hicut_hz: f32,
}

impl StereoDelay {
    /// Creates a new `StereoDelay` at the given sample rate.
    pub fn new(sample_rate: f32) -> Self {
        let cap = (MAX_DELAY_S * sample_rate).ceil() as usize + 1;
        Self {
            buf_l: vec![0.0f32; cap].into_boxed_slice(),
            buf_r: vec![0.0f32; cap].into_boxed_slice(),
            write_l: 0,
            write_r: 0,
            cap,
            hicut_state_l: 0.0,
            hicut_state_r: 0.0,
            atomics: Arc::new(DelayAtomics::default()),
            sample_rate,
            delay_mode: DelayTimeMode::Ms { ms: 250.0 },
            hicut_hz: DEFAULT_HICUT_HZ,
        }
    }

    /// Returns a clone of the atomic handle for the Tauri command layer.
    pub fn atomics(&self) -> Arc<DelayAtomics> {
        Arc::clone(&self.atomics)
    }

    /// Returns the current delay mode (for serialisation only).
    pub fn delay_mode(&self) -> DelayTimeMode {
        self.delay_mode
    }

    /// Updates the delay mode and stores the pre-computed sample count.
    ///
    /// `bpm` is used only when `mode` is `Sync`; pass any value for `Ms` mode.
    pub fn set_delay_mode(&mut self, mode: DelayTimeMode, bpm: f64) {
        self.delay_mode = mode;
        let samples = match mode {
            DelayTimeMode::Ms { ms } => {
                let s = (ms / 1000.0 * self.sample_rate) as u32;
                s.min(self.cap as u32 - 1)
            }
            DelayTimeMode::Sync { div } => {
                tempo_sync_delay_samples(bpm, div.beat_fraction(), self.sample_rate as u32)
                    .min(self.cap as u32 - 1)
            }
        };
        self.atomics.delay_samples.store(samples, Ordering::Relaxed);
    }

    /// Updates the high-cut frequency and recomputes the filter coefficient.
    pub fn set_hicut_hz(&mut self, hz: f32) {
        let hz = hz.clamp(500.0, 20000.0);
        self.hicut_hz = hz;
        self.atomics.hicut_coeff.store(hicut_coeff(hz, self.sample_rate), Ordering::Relaxed);
    }

    /// Returns the stored hicut_hz value.
    pub fn hicut_hz(&self) -> f32 {
        self.hicut_hz
    }
}

impl AudioEffect for StereoDelay {
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        // Read params once per buffer.
        let delay_samples = (self.atomics.delay_samples.load(Ordering::Relaxed) as usize)
            .min(self.cap - 1)
            .max(1);
        let feedback = self.atomics.feedback.load(Ordering::Relaxed).clamp(0.0, MAX_FEEDBACK);
        let wet = self.atomics.wet.load(Ordering::Relaxed).clamp(0.0, 1.0);
        let ping_pong = self.atomics.ping_pong.load(Ordering::Relaxed);
        let coeff = self.atomics.hicut_coeff.load(Ordering::Relaxed).clamp(0.0, 1.0);
        let dry = 1.0 - wet;

        let n = left.len().min(right.len());
        for i in 0..n {
            let in_l = left[i];
            let in_r = right[i];

            // Read from ring buffers at `delay_samples` ago.
            let read_l = (self.write_l + self.cap - delay_samples) % self.cap;
            let read_r = (self.write_r + self.cap - delay_samples) % self.cap;
            let delayed_l = self.buf_l[read_l];
            let delayed_r = self.buf_r[read_r];

            // Apply 1-pole high-cut LP on the feedback path.
            self.hicut_state_l = coeff * delayed_l + (1.0 - coeff) * self.hicut_state_l;
            self.hicut_state_r = coeff * delayed_r + (1.0 - coeff) * self.hicut_state_r;

            // Write new samples into ring buffers (with feedback).
            if ping_pong {
                // Crossed: left fb feeds right buffer, right fb feeds left buffer.
                self.buf_l[self.write_l] = in_l + feedback * self.hicut_state_r;
                self.buf_r[self.write_r] = in_r + feedback * self.hicut_state_l;
            } else {
                self.buf_l[self.write_l] = in_l + feedback * self.hicut_state_l;
                self.buf_r[self.write_r] = in_r + feedback * self.hicut_state_r;
            }

            // Advance write heads.
            self.write_l = (self.write_l + 1) % self.cap;
            self.write_r = (self.write_r + 1) % self.cap;

            // Mix dry + wet.
            left[i] = in_l * dry + self.hicut_state_l * wet;
            right[i] = in_r * dry + self.hicut_state_r * wet;
        }
    }

    fn reset(&mut self) {
        self.buf_l.fill(0.0);
        self.buf_r.fill(0.0);
        self.write_l = 0;
        self.write_r = 0;
        self.hicut_state_l = 0.0;
        self.hicut_state_r = 0.0;
    }

    fn get_params(&self) -> serde_json::Value {
        let a = &self.atomics;
        serde_json::json!({
            "delay_mode": serde_json::to_value(&self.delay_mode).unwrap_or(serde_json::Value::Null),
            "feedback": a.feedback.load(Ordering::Relaxed),
            "wet": a.wet.load(Ordering::Relaxed),
            "ping_pong": a.ping_pong.load(Ordering::Relaxed),
            "hicut_hz": self.hicut_hz,
        })
    }

    fn set_params(&mut self, params: &serde_json::Value) {
        if let Some(v) = params["feedback"].as_f64() {
            self.atomics.feedback.store((v as f32).clamp(0.0, 0.99), Ordering::Relaxed);
        }
        if let Some(v) = params["wet"].as_f64() {
            self.atomics.wet.store((v as f32).clamp(0.0, 1.0), Ordering::Relaxed);
        }
        if let Some(v) = params["ping_pong"].as_bool() {
            self.atomics.ping_pong.store(v, Ordering::Relaxed);
        }
        if let Some(v) = params["hicut_hz"].as_f64() {
            self.set_hicut_hz(v as f32);
        }
        if let Ok(mode) = serde_json::from_value::<DelayTimeMode>(params["delay_mode"].clone()) {
            self.set_delay_mode(mode, 120.0);
        }
    }
}

// ─── Tauri state ──────────────────────────────────────────────────────────────

/// Per-channel delay store: `channel_id → StereoDelay`.
pub type DelayStoreInner = HashMap<String, StereoDelay>;
/// Shared delay store managed by Tauri.
pub type DelayStore = Arc<Mutex<DelayStoreInner>>;

fn get_or_create<'a>(
    store: &'a mut DelayStoreInner,
    channel_id: &str,
    sample_rate: f32,
) -> &'a mut StereoDelay {
    store
        .entry(channel_id.to_owned())
        .or_insert_with(|| StereoDelay::new(sample_rate))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Sets a single delay parameter for the given channel.
///
/// `param_name` is one of:
/// - `"delay_ms"` — free-running delay time in ms (1–2000); switches to Ms mode
/// - `"feedback"` — feedback amount (0.0–0.99)
/// - `"wet"` — wet/dry mix (0.0–1.0)
/// - `"ping_pong"` — 1.0 = on, 0.0 = off
/// - `"hicut_hz"` — high-cut frequency (500–20000 Hz)
///
/// For tempo sync, use [`set_delay_sync`].
#[tauri::command]
pub fn set_delay_param(
    channel_id: String,
    param_name: String,
    value: f32,
    state: State<'_, DelayStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let delay = get_or_create(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    match param_name.as_str() {
        "delay_ms" => {
            let ms = value.clamp(1.0, 2000.0);
            delay.set_delay_mode(DelayTimeMode::Ms { ms }, 120.0);
        }
        "feedback" => {
            delay.atomics().feedback.store(value.clamp(0.0, MAX_FEEDBACK), Ordering::Relaxed);
        }
        "wet" => {
            delay.atomics().wet.store(value.clamp(0.0, 1.0), Ordering::Relaxed);
        }
        "ping_pong" => {
            delay.atomics().ping_pong.store(value >= 0.5, Ordering::Relaxed);
        }
        "hicut_hz" => {
            delay.set_hicut_hz(value);
        }
        other => return Err(format!("unknown delay param: {other}")),
    }
    Ok(())
}

/// Sets the delay to tempo-sync mode for the given channel.
///
/// `bpm` is the current project BPM; `note_div` is one of:
/// `"whole"`, `"half"`, `"quarter"`, `"eighth"`, `"sixteenth"`, `"thirty_second"`.
#[tauri::command]
pub fn set_delay_sync(
    channel_id: String,
    note_div: String,
    bpm: f64,
    state: State<'_, DelayStore>,
) -> Result<(), String> {
    let div = match note_div.as_str() {
        "whole" => NoteDiv::Whole,
        "half" => NoteDiv::Half,
        "quarter" => NoteDiv::Quarter,
        "eighth" => NoteDiv::Eighth,
        "sixteenth" => NoteDiv::Sixteenth,
        "thirty_second" => NoteDiv::ThirtySecond,
        other => return Err(format!("unknown note division: {other}")),
    };
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let delay = get_or_create(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    delay.set_delay_mode(DelayTimeMode::Sync { div }, bpm);
    Ok(())
}

/// Returns the current delay state snapshot for the given channel.
#[tauri::command]
pub fn get_delay_state(
    channel_id: String,
    state: State<'_, DelayStore>,
) -> Result<DelayStateSnapshot, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let delay = get_or_create(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = delay.atomics();
    Ok(DelayStateSnapshot {
        channel_id,
        delay_mode: delay.delay_mode(),
        feedback: a.feedback.load(Ordering::Relaxed),
        wet: a.wet.load(Ordering::Relaxed),
        ping_pong: a.ping_pong.load(Ordering::Relaxed),
        hicut_hz: delay.hicut_hz(),
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    fn make_delay() -> StereoDelay {
        StereoDelay::new(SR)
    }

    // ── tempo_sync_delay_samples ──────────────────────────────────────────────

    #[test]
    fn quarter_note_at_120bpm_44100hz() {
        // 60/120 * 1.0 * 44100 = 22050
        assert_eq!(tempo_sync_delay_samples(120.0, 1.0, 44100), 22050);
    }

    #[test]
    fn half_note_at_120bpm() {
        // 60/120 * 2.0 * 44100 = 44100
        assert_eq!(tempo_sync_delay_samples(120.0, 2.0, 44100), 44100);
    }

    #[test]
    fn eighth_note_at_120bpm() {
        // 60/120 * 0.5 * 44100 = 11025
        assert_eq!(tempo_sync_delay_samples(120.0, 0.5, 44100), 11025);
    }

    #[test]
    fn note_div_beat_fractions_are_correct() {
        assert_eq!(NoteDiv::Whole.beat_fraction(), 4.0);
        assert_eq!(NoteDiv::Half.beat_fraction(), 2.0);
        assert_eq!(NoteDiv::Quarter.beat_fraction(), 1.0);
        assert_eq!(NoteDiv::Eighth.beat_fraction(), 0.5);
        assert_eq!(NoteDiv::Sixteenth.beat_fraction(), 0.25);
        assert_eq!(NoteDiv::ThirtySecond.beat_fraction(), 0.125);
    }

    // ── Buffer allocation ─────────────────────────────────────────────────────

    #[test]
    fn new_delay_allocates_correct_buffer_size() {
        let d = make_delay();
        // ceil(2.0 * 44100) + 1 = 88201
        assert_eq!(d.cap, 88201);
        assert_eq!(d.buf_l.len(), 88201);
        assert_eq!(d.buf_r.len(), 88201);
    }

    // ── Wet/dry ───────────────────────────────────────────────────────────────

    #[test]
    fn wet_zero_passes_dry_unchanged() {
        let mut d = make_delay();
        d.atomics().wet.store(0.0, Ordering::Relaxed);
        let mut left = vec![0.5f32; 256];
        let mut right = vec![0.3f32; 256];
        d.process_stereo(&mut left, &mut right);
        for &s in &left {
            assert!((s - 0.5).abs() < 1e-5, "expected 0.5, got {s}");
        }
        for &s in &right {
            assert!((s - 0.3).abs() < 1e-5, "expected 0.3, got {s}");
        }
    }

    // ── Delay timing ──────────────────────────────────────────────────────────

    #[test]
    fn echo_appears_at_expected_sample_offset() {
        let mut d = make_delay();
        let delay_samples: u32 = 500;
        d.atomics().delay_samples.store(delay_samples, Ordering::Relaxed);
        d.atomics().feedback.store(0.0, Ordering::Relaxed);
        d.atomics().wet.store(1.0, Ordering::Relaxed);

        let n = (delay_samples as usize) + 50;
        let mut left = vec![0.0f32; n];
        let mut right = vec![0.0f32; n];
        left[0] = 1.0;

        d.process_stereo(&mut left, &mut right);

        // Before the delay, the wet output (hicut_state_l) should be silent.
        for &s in &left[1..delay_samples as usize] {
            assert!(
                s.abs() < 1e-5,
                "no echo before delay_samples, got {s}"
            );
        }
        // At or after delay_samples, there should be echo energy.
        let echo_energy: f32 = left[delay_samples as usize..].iter().map(|s| s * s).sum();
        assert!(echo_energy > 0.0, "echo should appear after delay_samples");
    }

    // ── Feedback ──────────────────────────────────────────────────────────────

    #[test]
    fn feedback_clamped_to_max() {
        let mut d = make_delay();
        let a = d.atomics();
        a.feedback.store(1.5_f32.clamp(0.0, MAX_FEEDBACK), Ordering::Relaxed);
        assert!(
            a.feedback.load(Ordering::Relaxed) <= MAX_FEEDBACK,
            "feedback must not exceed {MAX_FEEDBACK}"
        );
    }

    #[test]
    fn feedback_zero_gives_single_echo() {
        let mut d = make_delay();
        let delay_samples: u32 = 100;
        d.atomics().delay_samples.store(delay_samples, Ordering::Relaxed);
        d.atomics().feedback.store(0.0, Ordering::Relaxed);
        d.atomics().wet.store(1.0, Ordering::Relaxed);

        let n = (delay_samples as usize) * 3;
        let mut left = vec![0.0f32; n];
        let mut right = vec![0.0f32; n];
        left[0] = 1.0;
        d.process_stereo(&mut left, &mut right);

        // After the first echo, energy should return to zero (no feedback).
        let after_first_echo = &left[(delay_samples as usize + 20)..];
        let residual: f32 = after_first_echo.iter().map(|s| s * s).sum();
        assert!(
            residual < 1e-6,
            "no second echo with feedback=0, residual={residual}"
        );
    }

    // ── Ping-pong ─────────────────────────────────────────────────────────────

    #[test]
    fn ping_pong_crosses_channels() {
        // Ping-pong works in two hops:
        //   hop 1 (at delay_samples):     left input → left buffer → right buffer (crossed fb)
        //   hop 2 (at 2 × delay_samples): right buffer → right wet output
        // So the right channel echo appears at 2 × delay_samples, not 1.
        let mut d = make_delay();
        let delay_samples: u32 = 100;
        d.atomics().delay_samples.store(delay_samples, Ordering::Relaxed);
        d.atomics().feedback.store(0.5, Ordering::Relaxed);
        d.atomics().wet.store(1.0, Ordering::Relaxed);
        d.atomics().ping_pong.store(true, Ordering::Relaxed);

        let n = (delay_samples as usize) * 4;
        let mut left = vec![0.0f32; n];
        let mut right = vec![0.0f32; n];
        left[0] = 1.0; // only left channel has input

        d.process_stereo(&mut left, &mut right);

        // Right channel echo energy appears after the second delay hop.
        let start = delay_samples as usize * 2;
        let right_energy: f32 = right[start..].iter().map(|s| s * s).sum();
        assert!(
            right_energy > 0.0,
            "ping-pong: right channel should have echo energy after 2×delay, got {right_energy}"
        );
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    #[test]
    fn reset_clears_both_buffers() {
        let mut d = make_delay();
        d.atomics().wet.store(1.0, Ordering::Relaxed);
        d.atomics().feedback.store(0.8, Ordering::Relaxed);
        let mut left = vec![1.0f32; 2048];
        let mut right = vec![1.0f32; 2048];
        d.process_stereo(&mut left, &mut right);
        d.reset();
        let mut left2 = vec![0.0f32; 512];
        let mut right2 = vec![0.0f32; 512];
        d.process_stereo(&mut left2, &mut right2);
        let energy: f32 = left2.iter().chain(right2.iter()).map(|s| s * s).sum();
        assert!(energy < 1e-10, "after reset, silence should produce silence, energy={energy}");
    }

    // ── High-cut ──────────────────────────────────────────────────────────────

    #[test]
    fn hicut_coeff_range() {
        let c = hicut_coeff(8000.0, 44100.0);
        assert!(c > 0.0 && c < 1.0, "hicut_coeff should be in (0,1): {c}");
    }

    #[test]
    fn higher_hicut_hz_gives_larger_coeff() {
        let c_low = hicut_coeff(1000.0, 44100.0);
        let c_high = hicut_coeff(10000.0, 44100.0);
        assert!(c_high > c_low, "higher cutoff → larger coefficient: {c_high} vs {c_low}");
    }

    // ── Serde round-trip ──────────────────────────────────────────────────────

    #[test]
    fn delay_time_mode_ms_serde_round_trip() {
        let mode = DelayTimeMode::Ms { ms: 250.0 };
        let json = serde_json::to_string(&mode).unwrap();
        assert!(json.contains("\"mode\":\"ms\""), "json={json}");
        let back: DelayTimeMode = serde_json::from_str(&json).unwrap();
        assert_eq!(back, mode);
    }

    #[test]
    fn delay_time_mode_sync_serde_round_trip() {
        let mode = DelayTimeMode::Sync { div: NoteDiv::Quarter };
        let json = serde_json::to_string(&mode).unwrap();
        assert!(json.contains("\"mode\":\"sync\""), "json={json}");
        let back: DelayTimeMode = serde_json::from_str(&json).unwrap();
        assert_eq!(back, mode);
    }

    // ── No NaN ────────────────────────────────────────────────────────────────

    #[test]
    fn process_stereo_no_nan_with_feedback() {
        let mut d = make_delay();
        d.atomics().feedback.store(0.9, Ordering::Relaxed);
        d.atomics().wet.store(0.5, Ordering::Relaxed);
        let mut left: Vec<f32> = (0..4096).map(|i| ((i as f32) * 0.01).sin()).collect();
        let mut right: Vec<f32> = (0..4096).map(|i| ((i as f32) * 0.013).cos()).collect();
        d.process_stereo(&mut left, &mut right);
        assert!(left.iter().all(|s| s.is_finite()));
        assert!(right.iter().all(|s| s.is_finite()));
    }
}
