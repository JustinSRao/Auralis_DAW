//! Dynamics processing suite — Compressor, BrickwallLimiter, NoiseGate.
//!
//! ## Shared primitive: EnvelopeFollower
//!
//! All three processors use the same ballistic envelope follower.  The
//! time-constant formula is:
//!
//! ```text
//! coeff = exp(-1.0 / (time_ms * sample_rate / 1000.0))
//! ```
//!
//! A coefficient of 0.0 means instantaneous response; a coefficient close
//! to 1.0 means very slow response.
//!
//! ## Compressor
//!
//! Signal chain: `|input|` → envelope follower → gain computer (threshold +
//! ratio + soft-knee) → gain applied to dry signal → makeup gain.
//!
//! Soft-knee: When the input level is within `knee/2 dB` of the threshold,
//! a quadratic blend smooths the gain computer output between 1:1 and the
//! target ratio.
//!
//! ## BrickwallLimiter
//!
//! Peak-hold with release envelope.  When a sample's absolute value exceeds
//! the ceiling, the gain is set immediately to `ceiling / peak`.  The gain
//! then recovers toward 1.0 with the release time constant.
//!
//! ## NoiseGate
//!
//! Four-state machine: `Open → Closing → Closed → Opening`.  When the
//! envelope falls below threshold the gate starts closing; when it rises
//! above threshold + hysteresis the gate starts opening.  The range
//! parameter sets the minimum gain when closed (0 dB → full attenuation
//! mapped from -90 to 0 dB range).

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use atomic_float::AtomicF32;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::effects::AudioEffect;

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SAMPLE_RATE: f32 = 44100.0;

// ─── EnvelopeFollower ─────────────────────────────────────────────────────────

/// Ballistic peak/RMS envelope follower.
///
/// Uses separate attack and release coefficients so the detector can track
/// fast transients while releasing slowly (or vice versa).
pub struct EnvelopeFollower {
    level: f32,
    attack_coeff: f32,
    release_coeff: f32,
}

/// Computes a ballistic time-constant coefficient.
///
/// `coeff = exp(-1.0 / (time_ms * sample_rate / 1000.0))`
pub fn ballistic_coeff(time_ms: f32, sample_rate: f32) -> f32 {
    if time_ms <= 0.0 {
        return 0.0;
    }
    (-1.0 / (time_ms * sample_rate / 1000.0)).exp()
}

impl EnvelopeFollower {
    pub fn new(attack_ms: f32, release_ms: f32, sample_rate: f32) -> Self {
        Self {
            level: 0.0,
            attack_coeff: ballistic_coeff(attack_ms, sample_rate),
            release_coeff: ballistic_coeff(release_ms, sample_rate),
        }
    }

    pub fn update_coeffs(&mut self, attack_ms: f32, release_ms: f32, sample_rate: f32) {
        self.attack_coeff = ballistic_coeff(attack_ms, sample_rate);
        self.release_coeff = ballistic_coeff(release_ms, sample_rate);
    }

    /// Processes one sample and returns the current envelope level (linear).
    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let abs = input.abs();
        let coeff = if abs > self.level { self.attack_coeff } else { self.release_coeff };
        self.level = coeff * self.level + (1.0 - coeff) * abs;
        self.level
    }

    pub fn reset(&mut self) {
        self.level = 0.0;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

#[inline]
fn linear_to_db(linear: f32) -> f32 {
    if linear <= 1e-9 { -180.0 } else { 20.0 * linear.log10() }
}

#[inline]
fn db_to_linear(db: f32) -> f32 {
    10.0f32.powf(db / 20.0)
}

// ─── Compressor ───────────────────────────────────────────────────────────────

/// Atomic parameter bundle for `Compressor`.
pub struct CompressorAtomics {
    pub threshold_db: AtomicF32,  // -60.0 – 0.0
    pub ratio: AtomicF32,         // 1.0 – 100.0 (∞:1 = 100)
    pub attack_ms: AtomicF32,     // 0.1 – 300.0
    pub release_ms: AtomicF32,    // 10.0 – 3000.0
    pub knee_db: AtomicF32,       // 0.0 – 12.0
    pub makeup_db: AtomicF32,     // -12.0 – +24.0
    pub enabled: AtomicF32,       // 1.0 = on, 0.0 = bypass
    /// Current gain reduction in dB (positive = reducing). Written by audio thread.
    pub gain_reduction_db: AtomicF32,
}

impl Default for CompressorAtomics {
    fn default() -> Self {
        Self {
            threshold_db: AtomicF32::new(-18.0),
            ratio: AtomicF32::new(4.0),
            attack_ms: AtomicF32::new(10.0),
            release_ms: AtomicF32::new(100.0),
            knee_db: AtomicF32::new(2.0),
            makeup_db: AtomicF32::new(0.0),
            enabled: AtomicF32::new(1.0),
            gain_reduction_db: AtomicF32::new(0.0),
        }
    }
}

/// Serialisable snapshot for `get_compressor_state`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompressorStateSnapshot {
    pub channel_id: String,
    pub threshold_db: f32,
    pub ratio: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
    pub knee_db: f32,
    pub makeup_db: f32,
    pub enabled: bool,
    pub gain_reduction_db: f32,
}

/// Feed-forward RMS compressor with soft-knee and makeup gain.
pub struct Compressor {
    envelope: EnvelopeFollower,
    atomics: Arc<CompressorAtomics>,
    sample_rate: f32,
}

impl Compressor {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            envelope: EnvelopeFollower::new(10.0, 100.0, sample_rate),
            atomics: Arc::new(CompressorAtomics::default()),
            sample_rate,
        }
    }

    pub fn atomics(&self) -> Arc<CompressorAtomics> {
        Arc::clone(&self.atomics)
    }

    /// Computes gain reduction for the given input level in dB.
    ///
    /// Uses a soft-knee quadratic blend within `knee/2` dB of the threshold.
    fn compute_gain_db(level_db: f32, threshold_db: f32, ratio: f32, knee_db: f32) -> f32 {
        let slope = 1.0 / ratio - 1.0; // negative for compression
        let half_knee = knee_db / 2.0;
        let overshoot = level_db - threshold_db;

        if overshoot < -half_knee {
            // Below knee — no compression
            0.0
        } else if overshoot > half_knee {
            // Above knee — full compression
            slope * overshoot
        } else {
            // In the knee — quadratic blend
            slope * (overshoot + half_knee).powi(2) / (2.0 * knee_db.max(0.001))
        }
    }
}

impl AudioEffect for Compressor {
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        let threshold_db = self.atomics.threshold_db.load(Ordering::Relaxed).clamp(-60.0, 0.0);
        let ratio = self.atomics.ratio.load(Ordering::Relaxed).clamp(1.0, 100.0);
        let attack_ms = self.atomics.attack_ms.load(Ordering::Relaxed).clamp(0.1, 300.0);
        let release_ms = self.atomics.release_ms.load(Ordering::Relaxed).clamp(10.0, 3000.0);
        let knee_db = self.atomics.knee_db.load(Ordering::Relaxed).clamp(0.0, 12.0);
        let makeup_db = self.atomics.makeup_db.load(Ordering::Relaxed).clamp(-12.0, 24.0);
        let enabled = self.atomics.enabled.load(Ordering::Relaxed) >= 0.5;

        self.envelope.update_coeffs(attack_ms, release_ms, self.sample_rate);

        if !enabled {
            self.atomics.gain_reduction_db.store(0.0, Ordering::Relaxed);
            return;
        }

        let makeup_linear = db_to_linear(makeup_db);
        let mut max_gr = 0.0f32;

        let n = left.len().min(right.len());
        for i in 0..n {
            // Use the louder of the two channels as the detection signal.
            let detected = left[i].abs().max(right[i].abs());
            let env = self.envelope.process(detected);
            let level_db = linear_to_db(env);
            let gain_db = Self::compute_gain_db(level_db, threshold_db, ratio, knee_db);
            let gain_linear = db_to_linear(gain_db) * makeup_linear;
            left[i] *= gain_linear;
            right[i] *= gain_linear;
            // gain_db is negative (reduction); store as positive dB
            if -gain_db > max_gr {
                max_gr = -gain_db;
            }
        }

        self.atomics.gain_reduction_db.store(max_gr, Ordering::Relaxed);
    }

    fn reset(&mut self) {
        self.envelope.reset();
        self.atomics.gain_reduction_db.store(0.0, Ordering::Relaxed);
    }

    fn get_params(&self) -> serde_json::Value {
        let a = &self.atomics;
        serde_json::json!({
            "threshold_db": a.threshold_db.load(Ordering::Relaxed),
            "ratio": a.ratio.load(Ordering::Relaxed),
            "attack_ms": a.attack_ms.load(Ordering::Relaxed),
            "release_ms": a.release_ms.load(Ordering::Relaxed),
            "knee_db": a.knee_db.load(Ordering::Relaxed),
            "makeup_db": a.makeup_db.load(Ordering::Relaxed),
            "enabled": a.enabled.load(Ordering::Relaxed) >= 0.5,
        })
    }

    fn set_params(&mut self, params: &serde_json::Value) {
        let a = &self.atomics;
        macro_rules! set_f32 {
            ($key:expr, $atomic:expr, $lo:expr, $hi:expr) => {
                if let Some(v) = params[$key].as_f64() {
                    $atomic.store((v as f32).clamp($lo, $hi), Ordering::Relaxed);
                }
            };
        }
        set_f32!("threshold_db", a.threshold_db, -60.0, 0.0);
        set_f32!("ratio",        a.ratio,         1.0, 100.0);
        set_f32!("attack_ms",    a.attack_ms,     0.1, 300.0);
        set_f32!("release_ms",   a.release_ms,    10.0, 3000.0);
        set_f32!("knee_db",      a.knee_db,       0.0, 12.0);
        set_f32!("makeup_db",    a.makeup_db,    -12.0, 24.0);
        if let Some(v) = params["enabled"].as_bool() {
            a.enabled.store(if v { 1.0 } else { 0.0 }, Ordering::Relaxed);
        }
    }
}

// ─── BrickwallLimiter ─────────────────────────────────────────────────────────

/// Atomic parameter bundle for `BrickwallLimiter`.
pub struct LimiterAtomics {
    pub ceiling_db: AtomicF32,    // -12.0 – 0.0
    pub release_ms: AtomicF32,    // 1.0 – 1000.0
    pub enabled: AtomicF32,
    pub gain_reduction_db: AtomicF32,
}

impl Default for LimiterAtomics {
    fn default() -> Self {
        Self {
            ceiling_db: AtomicF32::new(-0.3),
            release_ms: AtomicF32::new(50.0),
            enabled: AtomicF32::new(1.0),
            gain_reduction_db: AtomicF32::new(0.0),
        }
    }
}

/// Serialisable snapshot for `get_limiter_state`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LimiterStateSnapshot {
    pub channel_id: String,
    pub ceiling_db: f32,
    pub release_ms: f32,
    pub enabled: bool,
    pub gain_reduction_db: f32,
}

/// Brick-wall peak limiter with release envelope.
///
/// The gain envelope snaps to `ceiling / peak` on any over-threshold sample
/// and then recovers toward 1.0 with the release time constant.
pub struct BrickwallLimiter {
    /// Current gain applied by the limiter (linear).
    gain: f32,
    release_coeff: f32,
    atomics: Arc<LimiterAtomics>,
    sample_rate: f32,
}

impl BrickwallLimiter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            gain: 1.0,
            release_coeff: ballistic_coeff(50.0, sample_rate),
            atomics: Arc::new(LimiterAtomics::default()),
            sample_rate,
        }
    }

    pub fn atomics(&self) -> Arc<LimiterAtomics> {
        Arc::clone(&self.atomics)
    }
}

impl AudioEffect for BrickwallLimiter {
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        let ceiling_db = self.atomics.ceiling_db.load(Ordering::Relaxed).clamp(-12.0, 0.0);
        let release_ms = self.atomics.release_ms.load(Ordering::Relaxed).clamp(1.0, 1000.0);
        let enabled = self.atomics.enabled.load(Ordering::Relaxed) >= 0.5;

        self.release_coeff = ballistic_coeff(release_ms, self.sample_rate);

        if !enabled {
            self.atomics.gain_reduction_db.store(0.0, Ordering::Relaxed);
            return;
        }

        let ceiling_linear = db_to_linear(ceiling_db);
        let mut max_gr = 0.0f32;

        let n = left.len().min(right.len());
        for i in 0..n {
            // 1. Look-ahead-free peak detection with current gain applied.
            let would_be_peak = left[i].abs().max(right[i].abs()) * self.gain;
            if would_be_peak > ceiling_linear && would_be_peak > 1e-9 {
                // Reduce gain further to keep output at ceiling.
                self.gain *= ceiling_linear / would_be_peak;
            }

            // 2. Apply gain to this sample.
            left[i] *= self.gain;
            right[i] *= self.gain;

            // 3. Release: gain recovers toward 1.0 for the NEXT sample.
            self.gain = self.release_coeff * self.gain + (1.0 - self.release_coeff) * 1.0;
            self.gain = self.gain.min(1.0);

            let gr = -linear_to_db(self.gain).min(0.0);
            if gr > max_gr {
                max_gr = gr;
            }
        }

        self.atomics.gain_reduction_db.store(max_gr, Ordering::Relaxed);
    }

    fn reset(&mut self) {
        self.gain = 1.0;
        self.atomics.gain_reduction_db.store(0.0, Ordering::Relaxed);
    }

    fn get_params(&self) -> serde_json::Value {
        let a = &self.atomics;
        serde_json::json!({
            "ceiling_db": a.ceiling_db.load(Ordering::Relaxed),
            "release_ms": a.release_ms.load(Ordering::Relaxed),
            "enabled": a.enabled.load(Ordering::Relaxed) >= 0.5,
        })
    }

    fn set_params(&mut self, params: &serde_json::Value) {
        let a = &self.atomics;
        if let Some(v) = params["ceiling_db"].as_f64() {
            a.ceiling_db.store((v as f32).clamp(-12.0, 0.0), Ordering::Relaxed);
        }
        if let Some(v) = params["release_ms"].as_f64() {
            a.release_ms.store((v as f32).clamp(1.0, 1000.0), Ordering::Relaxed);
        }
        if let Some(v) = params["enabled"].as_bool() {
            a.enabled.store(if v { 1.0 } else { 0.0 }, Ordering::Relaxed);
        }
    }
}

// ─── NoiseGate ────────────────────────────────────────────────────────────────

/// Gate state machine states.
#[derive(Clone, Copy, PartialEq, Debug)]
enum GateState {
    Open,
    Closing,
    Closed,
    Opening,
}

/// Atomic parameter bundle for `NoiseGate`.
pub struct GateAtomics {
    pub threshold_db: AtomicF32,  // -80.0 – 0.0
    pub attack_ms: AtomicF32,     // 0.1 – 100.0
    pub hold_ms: AtomicF32,       // 0.0 – 2000.0
    pub release_ms: AtomicF32,    // 10.0 – 4000.0
    pub range_db: AtomicF32,      // -90.0 – 0.0 (attenuation when closed)
    pub enabled: AtomicF32,
    pub gain_reduction_db: AtomicF32,
}

impl Default for GateAtomics {
    fn default() -> Self {
        Self {
            threshold_db: AtomicF32::new(-40.0),
            attack_ms: AtomicF32::new(1.0),
            hold_ms: AtomicF32::new(50.0),
            release_ms: AtomicF32::new(100.0),
            range_db: AtomicF32::new(-60.0),
            enabled: AtomicF32::new(1.0),
            gain_reduction_db: AtomicF32::new(0.0),
        }
    }
}

/// Serialisable snapshot for `get_gate_state`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GateStateSnapshot {
    pub channel_id: String,
    pub threshold_db: f32,
    pub attack_ms: f32,
    pub hold_ms: f32,
    pub release_ms: f32,
    pub range_db: f32,
    pub enabled: bool,
    pub gain_reduction_db: f32,
}

/// Four-state noise gate with attack/hold/release.
pub struct NoiseGate {
    envelope: EnvelopeFollower,
    state: GateState,
    /// Current gate gain (linear, between `range_linear` and 1.0).
    gate_gain: f32,
    /// Samples remaining in Hold state.
    hold_counter: u32,
    atomics: Arc<GateAtomics>,
    sample_rate: f32,
}

impl NoiseGate {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            envelope: EnvelopeFollower::new(1.0, 100.0, sample_rate),
            state: GateState::Open,
            gate_gain: 1.0,
            hold_counter: 0,
            atomics: Arc::new(GateAtomics::default()),
            sample_rate,
        }
    }

    pub fn atomics(&self) -> Arc<GateAtomics> {
        Arc::clone(&self.atomics)
    }
}

impl AudioEffect for NoiseGate {
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        let threshold_db = self.atomics.threshold_db.load(Ordering::Relaxed).clamp(-80.0, 0.0);
        let attack_ms = self.atomics.attack_ms.load(Ordering::Relaxed).clamp(0.1, 100.0);
        let hold_ms = self.atomics.hold_ms.load(Ordering::Relaxed).clamp(0.0, 2000.0);
        let release_ms = self.atomics.release_ms.load(Ordering::Relaxed).clamp(10.0, 4000.0);
        let range_db = self.atomics.range_db.load(Ordering::Relaxed).clamp(-90.0, 0.0);
        let enabled = self.atomics.enabled.load(Ordering::Relaxed) >= 0.5;

        self.envelope.update_coeffs(5.0, release_ms, self.sample_rate);

        if !enabled {
            self.atomics.gain_reduction_db.store(0.0, Ordering::Relaxed);
            return;
        }

        let threshold_linear = db_to_linear(threshold_db);
        let range_linear = db_to_linear(range_db);
        let attack_coeff = ballistic_coeff(attack_ms, self.sample_rate);
        let release_coeff = ballistic_coeff(release_ms, self.sample_rate);
        let hold_samples = (hold_ms / 1000.0 * self.sample_rate) as u32;
        // Hysteresis: open when 3 dB above threshold to prevent chatter
        let open_threshold = threshold_linear * db_to_linear(3.0);

        let mut max_gr = 0.0f32;

        let n = left.len().min(right.len());
        for i in 0..n {
            let detected = left[i].abs().max(right[i].abs());
            let env = self.envelope.process(detected);

            self.state = match self.state {
                GateState::Open => {
                    if env < threshold_linear {
                        self.hold_counter = hold_samples;
                        GateState::Closing
                    } else {
                        GateState::Open
                    }
                }
                GateState::Closing => {
                    if env >= open_threshold {
                        GateState::Opening
                    } else if self.hold_counter > 0 {
                        self.hold_counter -= 1;
                        GateState::Closing
                    } else {
                        GateState::Closed
                    }
                }
                GateState::Closed => {
                    if env >= open_threshold {
                        GateState::Opening
                    } else {
                        GateState::Closed
                    }
                }
                GateState::Opening => {
                    if env < threshold_linear {
                        GateState::Closing
                    } else {
                        GateState::Opening
                    }
                }
            };

            // Smooth gate gain toward target
            let target = match self.state {
                GateState::Open | GateState::Opening => 1.0,
                GateState::Closed | GateState::Closing => range_linear,
            };

            let coeff = if target > self.gate_gain { attack_coeff } else { release_coeff };
            self.gate_gain = coeff * self.gate_gain + (1.0 - coeff) * target;
            self.gate_gain = self.gate_gain.clamp(range_linear, 1.0);

            left[i] *= self.gate_gain;
            right[i] *= self.gate_gain;

            let gr = -linear_to_db(self.gate_gain).min(0.0);
            if gr > max_gr {
                max_gr = gr;
            }
        }

        self.atomics.gain_reduction_db.store(max_gr, Ordering::Relaxed);
    }

    fn reset(&mut self) {
        self.envelope.reset();
        self.state = GateState::Open;
        self.gate_gain = 1.0;
        self.hold_counter = 0;
        self.atomics.gain_reduction_db.store(0.0, Ordering::Relaxed);
    }

    fn get_params(&self) -> serde_json::Value {
        let a = &self.atomics;
        serde_json::json!({
            "threshold_db": a.threshold_db.load(Ordering::Relaxed),
            "attack_ms":    a.attack_ms.load(Ordering::Relaxed),
            "hold_ms":      a.hold_ms.load(Ordering::Relaxed),
            "release_ms":   a.release_ms.load(Ordering::Relaxed),
            "range_db":     a.range_db.load(Ordering::Relaxed),
            "enabled":      a.enabled.load(Ordering::Relaxed) >= 0.5,
        })
    }

    fn set_params(&mut self, params: &serde_json::Value) {
        let a = &self.atomics;
        macro_rules! set_f32 {
            ($key:expr, $atomic:expr, $lo:expr, $hi:expr) => {
                if let Some(v) = params[$key].as_f64() {
                    $atomic.store((v as f32).clamp($lo, $hi), Ordering::Relaxed);
                }
            };
        }
        set_f32!("threshold_db", a.threshold_db, -80.0,   0.0);
        set_f32!("attack_ms",    a.attack_ms,     0.1,  100.0);
        set_f32!("hold_ms",      a.hold_ms,       0.0, 2000.0);
        set_f32!("release_ms",   a.release_ms,   10.0, 4000.0);
        set_f32!("range_db",     a.range_db,    -90.0,    0.0);
        if let Some(v) = params["enabled"].as_bool() {
            a.enabled.store(if v { 1.0 } else { 0.0 }, Ordering::Relaxed);
        }
    }
}

// ─── Tauri state ──────────────────────────────────────────────────────────────

/// Per-channel compressor store.
pub type CompressorStoreInner = HashMap<String, Compressor>;
pub type CompressorStore = Arc<Mutex<CompressorStoreInner>>;

/// Per-channel limiter store.
pub type LimiterStoreInner = HashMap<String, BrickwallLimiter>;
pub type LimiterStore = Arc<Mutex<LimiterStoreInner>>;

/// Per-channel noise gate store.
pub type GateStoreInner = HashMap<String, NoiseGate>;
pub type GateStore = Arc<Mutex<GateStoreInner>>;

fn get_or_create_compressor<'a>(
    store: &'a mut CompressorStoreInner,
    id: &str,
    sr: f32,
) -> &'a mut Compressor {
    store.entry(id.to_owned()).or_insert_with(|| Compressor::new(sr))
}

fn get_or_create_limiter<'a>(
    store: &'a mut LimiterStoreInner,
    id: &str,
    sr: f32,
) -> &'a mut BrickwallLimiter {
    store.entry(id.to_owned()).or_insert_with(|| BrickwallLimiter::new(sr))
}

fn get_or_create_gate<'a>(
    store: &'a mut GateStoreInner,
    id: &str,
    sr: f32,
) -> &'a mut NoiseGate {
    store.entry(id.to_owned()).or_insert_with(|| NoiseGate::new(sr))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Sets a single compressor parameter.
///
/// `param_name`: `"threshold_db"`, `"ratio"`, `"attack_ms"`, `"release_ms"`,
/// `"knee_db"`, `"makeup_db"`, `"enabled"`.
#[tauri::command]
pub fn set_compressor_param(
    channel_id: String,
    param_name: String,
    value: f32,
    state: State<'_, CompressorStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let c = get_or_create_compressor(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = c.atomics();
    match param_name.as_str() {
        "threshold_db" => a.threshold_db.store(value.clamp(-60.0, 0.0), Ordering::Relaxed),
        "ratio"        => a.ratio.store(value.clamp(1.0, 100.0), Ordering::Relaxed),
        "attack_ms"    => a.attack_ms.store(value.clamp(0.1, 300.0), Ordering::Relaxed),
        "release_ms"   => a.release_ms.store(value.clamp(10.0, 3000.0), Ordering::Relaxed),
        "knee_db"      => a.knee_db.store(value.clamp(0.0, 12.0), Ordering::Relaxed),
        "makeup_db"    => a.makeup_db.store(value.clamp(-12.0, 24.0), Ordering::Relaxed),
        "enabled"      => a.enabled.store(value, Ordering::Relaxed),
        other => return Err(format!("unknown compressor param: {other}")),
    }
    Ok(())
}

/// Returns the current compressor state snapshot.
#[tauri::command]
pub fn get_compressor_state(
    channel_id: String,
    state: State<'_, CompressorStore>,
) -> Result<CompressorStateSnapshot, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let c = get_or_create_compressor(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = c.atomics();
    Ok(CompressorStateSnapshot {
        channel_id,
        threshold_db: a.threshold_db.load(Ordering::Relaxed),
        ratio:        a.ratio.load(Ordering::Relaxed),
        attack_ms:    a.attack_ms.load(Ordering::Relaxed),
        release_ms:   a.release_ms.load(Ordering::Relaxed),
        knee_db:      a.knee_db.load(Ordering::Relaxed),
        makeup_db:    a.makeup_db.load(Ordering::Relaxed),
        enabled:      a.enabled.load(Ordering::Relaxed) >= 0.5,
        gain_reduction_db: a.gain_reduction_db.load(Ordering::Relaxed),
    })
}

/// Sets a single limiter parameter.
///
/// `param_name`: `"ceiling_db"`, `"release_ms"`, `"enabled"`.
#[tauri::command]
pub fn set_limiter_param(
    channel_id: String,
    param_name: String,
    value: f32,
    state: State<'_, LimiterStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let l = get_or_create_limiter(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = l.atomics();
    match param_name.as_str() {
        "ceiling_db" => a.ceiling_db.store(value.clamp(-12.0, 0.0), Ordering::Relaxed),
        "release_ms" => a.release_ms.store(value.clamp(1.0, 1000.0), Ordering::Relaxed),
        "enabled"    => a.enabled.store(value, Ordering::Relaxed),
        other => return Err(format!("unknown limiter param: {other}")),
    }
    Ok(())
}

/// Returns the current limiter state snapshot.
#[tauri::command]
pub fn get_limiter_state(
    channel_id: String,
    state: State<'_, LimiterStore>,
) -> Result<LimiterStateSnapshot, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let l = get_or_create_limiter(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = l.atomics();
    Ok(LimiterStateSnapshot {
        channel_id,
        ceiling_db: a.ceiling_db.load(Ordering::Relaxed),
        release_ms: a.release_ms.load(Ordering::Relaxed),
        enabled:    a.enabled.load(Ordering::Relaxed) >= 0.5,
        gain_reduction_db: a.gain_reduction_db.load(Ordering::Relaxed),
    })
}

/// Sets a single noise gate parameter.
///
/// `param_name`: `"threshold_db"`, `"attack_ms"`, `"hold_ms"`, `"release_ms"`,
/// `"range_db"`, `"enabled"`.
#[tauri::command]
pub fn set_gate_param(
    channel_id: String,
    param_name: String,
    value: f32,
    state: State<'_, GateStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let g = get_or_create_gate(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = g.atomics();
    match param_name.as_str() {
        "threshold_db" => a.threshold_db.store(value.clamp(-80.0, 0.0), Ordering::Relaxed),
        "attack_ms"    => a.attack_ms.store(value.clamp(0.1, 100.0), Ordering::Relaxed),
        "hold_ms"      => a.hold_ms.store(value.clamp(0.0, 2000.0), Ordering::Relaxed),
        "release_ms"   => a.release_ms.store(value.clamp(10.0, 4000.0), Ordering::Relaxed),
        "range_db"     => a.range_db.store(value.clamp(-90.0, 0.0), Ordering::Relaxed),
        "enabled"      => a.enabled.store(value, Ordering::Relaxed),
        other => return Err(format!("unknown gate param: {other}")),
    }
    Ok(())
}

/// Returns the current noise gate state snapshot.
#[tauri::command]
pub fn get_gate_state(
    channel_id: String,
    state: State<'_, GateStore>,
) -> Result<GateStateSnapshot, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let g = get_or_create_gate(&mut store, &channel_id, DEFAULT_SAMPLE_RATE);
    let a = g.atomics();
    Ok(GateStateSnapshot {
        channel_id,
        threshold_db: a.threshold_db.load(Ordering::Relaxed),
        attack_ms:    a.attack_ms.load(Ordering::Relaxed),
        hold_ms:      a.hold_ms.load(Ordering::Relaxed),
        release_ms:   a.release_ms.load(Ordering::Relaxed),
        range_db:     a.range_db.load(Ordering::Relaxed),
        enabled:      a.enabled.load(Ordering::Relaxed) >= 0.5,
        gain_reduction_db: a.gain_reduction_db.load(Ordering::Relaxed),
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    // ── EnvelopeFollower ─────────────────────────────────────────────────────

    #[test]
    fn ballistic_coeff_zero_time_returns_zero() {
        assert_eq!(ballistic_coeff(0.0, SR), 0.0);
    }

    #[test]
    fn ballistic_coeff_increases_with_time() {
        let c10 = ballistic_coeff(10.0, SR);
        let c100 = ballistic_coeff(100.0, SR);
        assert!(c100 > c10, "longer time → larger coeff");
    }

    #[test]
    fn envelope_follower_tracks_impulse() {
        let mut ef = EnvelopeFollower::new(0.1, 100.0, SR);
        let level = ef.process(1.0);
        assert!(level > 0.0, "envelope should track 1.0 impulse");
    }

    #[test]
    fn envelope_follower_reset_clears_level() {
        let mut ef = EnvelopeFollower::new(1.0, 100.0, SR);
        for _ in 0..100 { ef.process(1.0); }
        ef.reset();
        assert_eq!(ef.level, 0.0);
    }

    // ── Compressor ────────────────────────────────────────────────────────────

    #[test]
    fn compressor_below_threshold_passes_unchanged() {
        let mut c = Compressor::new(SR);
        c.atomics().threshold_db.store(-6.0, Ordering::Relaxed);
        c.atomics().makeup_db.store(0.0, Ordering::Relaxed);
        // -20 dBFS input should be well below -6 dBFS threshold
        let val = 0.1f32; // ≈ -20 dBFS
        let mut left = vec![val; 2048];
        let mut right = vec![val; 2048];
        c.process_stereo(&mut left, &mut right);
        // After warmup, output should be close to input (no compression)
        let last_samples = &left[1800..];
        for &s in last_samples {
            assert!((s - val).abs() < 0.01, "no compression below threshold, got {s}");
        }
    }

    #[test]
    fn compressor_above_threshold_reduces_gain() {
        let mut c = Compressor::new(SR);
        c.atomics().threshold_db.store(-20.0, Ordering::Relaxed);
        c.atomics().ratio.store(4.0, Ordering::Relaxed);
        c.atomics().attack_ms.store(0.1, Ordering::Relaxed);
        c.atomics().release_ms.store(100.0, Ordering::Relaxed);
        c.atomics().knee_db.store(0.0, Ordering::Relaxed);
        c.atomics().makeup_db.store(0.0, Ordering::Relaxed);
        // 0 dBFS input (1.0) is well above -20 dBFS threshold
        let mut left = vec![1.0f32; 4096];
        let mut right = vec![1.0f32; 4096];
        c.process_stereo(&mut left, &mut right);
        // After envelope warmup, output should be significantly lower than 1.0
        let mean_out: f32 = left[2000..].iter().sum::<f32>() / 2096.0;
        assert!(mean_out < 0.8, "compressor should reduce gain, mean_out={mean_out}");
    }

    #[test]
    fn compressor_makeup_gain_increases_output() {
        let run = |makeup_db: f32| -> f32 {
            let mut c = Compressor::new(SR);
            c.atomics().threshold_db.store(-20.0, Ordering::Relaxed);
            c.atomics().ratio.store(4.0, Ordering::Relaxed);
            c.atomics().attack_ms.store(0.1, Ordering::Relaxed);
            c.atomics().makeup_db.store(makeup_db, Ordering::Relaxed);
            let mut left = vec![1.0f32; 4096];
            let mut right = vec![1.0f32; 4096];
            c.process_stereo(&mut left, &mut right);
            left[2000..].iter().sum::<f32>() / 2096.0
        };
        assert!(run(6.0) > run(0.0), "+6 dB makeup should raise output");
    }

    #[test]
    fn compressor_bypass_passes_signal_unchanged() {
        let mut c = Compressor::new(SR);
        c.atomics().enabled.store(0.0, Ordering::Relaxed);
        let mut left = vec![0.5f32; 256];
        let mut right = vec![0.3f32; 256];
        c.process_stereo(&mut left, &mut right);
        for &s in &left { assert!((s - 0.5).abs() < 1e-5); }
        for &s in &right { assert!((s - 0.3).abs() < 1e-5); }
    }

    #[test]
    fn compressor_gain_reduction_atomics_updated() {
        let mut c = Compressor::new(SR);
        c.atomics().threshold_db.store(-20.0, Ordering::Relaxed);
        c.atomics().ratio.store(4.0, Ordering::Relaxed);
        c.atomics().attack_ms.store(0.1, Ordering::Relaxed);
        let mut left = vec![1.0f32; 4096];
        let mut right = vec![1.0f32; 4096];
        c.process_stereo(&mut left, &mut right);
        let gr = c.atomics().gain_reduction_db.load(Ordering::Relaxed);
        assert!(gr > 0.0, "gain reduction should be positive: {gr}");
    }

    #[test]
    fn compute_gain_db_above_threshold_no_knee() {
        // 4:1 ratio, threshold -20 dBFS, input -10 dBFS (10 dB over) → GR = 10 * (1/4 - 1) = -7.5 dB
        let gr = Compressor::compute_gain_db(-10.0, -20.0, 4.0, 0.0);
        assert!((gr - (-7.5)).abs() < 0.1, "expected -7.5 dB, got {gr}");
    }

    #[test]
    fn compute_gain_db_below_threshold_is_zero() {
        let gr = Compressor::compute_gain_db(-30.0, -20.0, 4.0, 0.0);
        assert_eq!(gr, 0.0);
    }

    #[test]
    fn compressor_no_nan_on_sine_wave() {
        let mut c = Compressor::new(SR);
        let mut left: Vec<f32> = (0..4096).map(|i| ((i as f32 * 0.1).sin())).collect();
        let mut right = left.clone();
        c.process_stereo(&mut left, &mut right);
        assert!(left.iter().all(|s| s.is_finite()));
    }

    // ── BrickwallLimiter ──────────────────────────────────────────────────────

    #[test]
    fn limiter_clamps_peak_to_ceiling() {
        let mut l = BrickwallLimiter::new(SR);
        l.atomics().ceiling_db.store(-6.0, Ordering::Relaxed);
        l.atomics().release_ms.store(100.0, Ordering::Relaxed);
        let ceiling_linear = db_to_linear(-6.0);
        // Impulse at 0 dBFS
        let mut left = vec![0.0f32; 1024];
        let mut right = vec![0.0f32; 1024];
        left[0] = 1.0;
        right[0] = 1.0;
        l.process_stereo(&mut left, &mut right);
        for &s in &left {
            assert!(s.abs() <= ceiling_linear + 1e-5, "sample {s} exceeds ceiling {ceiling_linear}");
        }
    }

    #[test]
    fn limiter_bypass_passes_signal_unchanged() {
        let mut l = BrickwallLimiter::new(SR);
        l.atomics().enabled.store(0.0, Ordering::Relaxed);
        let mut left = vec![0.5f32; 256];
        let mut right = vec![0.5f32; 256];
        l.process_stereo(&mut left, &mut right);
        for &s in &left { assert!((s - 0.5).abs() < 1e-5); }
    }

    #[test]
    fn limiter_no_nan() {
        let mut l = BrickwallLimiter::new(SR);
        let mut left: Vec<f32> = (0..4096).map(|i| ((i as f32 * 0.01).sin() * 2.0)).collect();
        let mut right = left.clone();
        l.process_stereo(&mut left, &mut right);
        assert!(left.iter().all(|s| s.is_finite()));
    }

    // ── NoiseGate ─────────────────────────────────────────────────────────────

    #[test]
    fn gate_open_passes_loud_signal() {
        let mut g = NoiseGate::new(SR);
        g.atomics().threshold_db.store(-40.0, Ordering::Relaxed);
        g.atomics().range_db.store(-60.0, Ordering::Relaxed);
        // Loud signal well above threshold
        let val = 0.5f32; // ≈ -6 dBFS
        let mut left = vec![val; 4096];
        let mut right = vec![val; 4096];
        g.process_stereo(&mut left, &mut right);
        // After warmup, gate should be open — output close to input
        let mean_out: f32 = left[2000..].iter().sum::<f32>() / 2096.0;
        assert!(mean_out > 0.4, "gate should pass loud signal, mean_out={mean_out}");
    }

    #[test]
    fn gate_closed_attenuates_quiet_signal() {
        let mut g = NoiseGate::new(SR);
        g.atomics().threshold_db.store(-20.0, Ordering::Relaxed);
        g.atomics().range_db.store(-60.0, Ordering::Relaxed);
        g.atomics().release_ms.store(10.0, Ordering::Relaxed);
        g.atomics().hold_ms.store(0.0, Ordering::Relaxed);
        // Very quiet signal below threshold
        let val = 0.001f32; // ≈ -60 dBFS
        let mut left = vec![val; 8192];
        let mut right = vec![val; 8192];
        g.process_stereo(&mut left, &mut right);
        let mean_out: f32 = left[4000..].iter().sum::<f32>() / 4192.0;
        assert!(mean_out < val * 0.1, "gate should attenuate quiet signal, mean_out={mean_out}");
    }

    #[test]
    fn gate_reset_returns_to_open() {
        let mut g = NoiseGate::new(SR);
        g.state = GateState::Closed;
        g.gate_gain = 0.001;
        g.reset();
        assert_eq!(g.state, GateState::Open);
        assert_eq!(g.gate_gain, 1.0);
    }

    #[test]
    fn gate_bypass_passes_unchanged() {
        let mut g = NoiseGate::new(SR);
        g.atomics().enabled.store(0.0, Ordering::Relaxed);
        let mut left = vec![0.001f32; 256];
        let mut right = vec![0.001f32; 256];
        g.process_stereo(&mut left, &mut right);
        for &s in &left { assert!((s - 0.001).abs() < 1e-7); }
    }

    #[test]
    fn gate_no_nan() {
        let mut g = NoiseGate::new(SR);
        let mut left: Vec<f32> = (0..4096).map(|i| ((i as f32 * 0.01).sin() * 0.01)).collect();
        let mut right = left.clone();
        g.process_stereo(&mut left, &mut right);
        assert!(left.iter().all(|s| s.is_finite()));
    }
}
