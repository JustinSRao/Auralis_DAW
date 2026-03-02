use atomic_float::AtomicF32;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// All synthesis parameters stored as atomic floats for lock-free access from the audio thread.
///
/// The main thread writes to these via `Arc<AtomicF32>` stores; the audio thread reads
/// them with `Ordering::Relaxed` on every voice render. No mutex required.
pub struct SynthParams {
    /// Oscillator waveform: 0.0=Saw, 1.0=Square, 2.0=Sine, 3.0=Triangle
    pub waveform: Arc<AtomicF32>,
    /// Amplitude envelope attack time in seconds (0.001–4.0).
    pub attack: Arc<AtomicF32>,
    /// Amplitude envelope decay time in seconds (0.001–4.0).
    pub decay: Arc<AtomicF32>,
    /// Amplitude envelope sustain level (0.0–1.0).
    pub sustain: Arc<AtomicF32>,
    /// Amplitude envelope release time in seconds (0.001–8.0).
    pub release: Arc<AtomicF32>,
    /// Filter cutoff frequency in Hz (20.0–20000.0).
    pub cutoff: Arc<AtomicF32>,
    /// Filter resonance (0.0–1.0 maps to Q 0.5–20.0).
    pub resonance: Arc<AtomicF32>,
    /// Filter envelope modulation amount (0.0–1.0).
    pub env_amount: Arc<AtomicF32>,
    /// Master output volume (0.0–1.0).
    pub volume: Arc<AtomicF32>,
    /// Oscillator detune in cents (-100.0–100.0).
    pub detune: Arc<AtomicF32>,
    /// Square wave pulse width (0.05–0.95).
    pub pulse_width: Arc<AtomicF32>,
}

impl SynthParams {
    /// Creates a new `SynthParams` with all defaults and wraps in an `Arc`.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            waveform: Arc::new(AtomicF32::new(0.0)),
            attack: Arc::new(AtomicF32::new(0.01)),
            decay: Arc::new(AtomicF32::new(0.1)),
            sustain: Arc::new(AtomicF32::new(0.7)),
            release: Arc::new(AtomicF32::new(0.3)),
            cutoff: Arc::new(AtomicF32::new(8000.0)),
            resonance: Arc::new(AtomicF32::new(0.0)),
            env_amount: Arc::new(AtomicF32::new(0.0)),
            volume: Arc::new(AtomicF32::new(0.7)),
            detune: Arc::new(AtomicF32::new(0.0)),
            pulse_width: Arc::new(AtomicF32::new(0.5)),
        })
    }
}

impl Default for SynthParams {
    fn default() -> Self {
        Self {
            waveform: Arc::new(AtomicF32::new(0.0)),
            attack: Arc::new(AtomicF32::new(0.01)),
            decay: Arc::new(AtomicF32::new(0.1)),
            sustain: Arc::new(AtomicF32::new(0.7)),
            release: Arc::new(AtomicF32::new(0.3)),
            cutoff: Arc::new(AtomicF32::new(8000.0)),
            resonance: Arc::new(AtomicF32::new(0.0)),
            env_amount: Arc::new(AtomicF32::new(0.0)),
            volume: Arc::new(AtomicF32::new(0.7)),
            detune: Arc::new(AtomicF32::new(0.0)),
            pulse_width: Arc::new(AtomicF32::new(0.5)),
        }
    }
}

/// Serializable snapshot of `SynthParams`, safe to send across IPC.
///
/// Created by reading each atomic at a point in time — not guaranteed to be
/// perfectly consistent across fields, but close enough for UI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynthParamSnapshot {
    /// Oscillator waveform index (0=Saw, 1=Square, 2=Sine, 3=Triangle).
    pub waveform: f32,
    /// Attack time in seconds.
    pub attack: f32,
    /// Decay time in seconds.
    pub decay: f32,
    /// Sustain level (0.0–1.0).
    pub sustain: f32,
    /// Release time in seconds.
    pub release: f32,
    /// Filter cutoff in Hz.
    pub cutoff: f32,
    /// Filter resonance (0.0–1.0).
    pub resonance: f32,
    /// Filter envelope modulation amount (0.0–1.0).
    pub env_amount: f32,
    /// Master volume (0.0–1.0).
    pub volume: f32,
    /// Oscillator detune in cents.
    pub detune: f32,
    /// Square wave pulse width (0.05–0.95).
    pub pulse_width: f32,
}

impl SynthParamSnapshot {
    /// Reads all parameters from a `SynthParams` into a snapshot.
    pub fn from_params(p: &SynthParams) -> Self {
        Self {
            waveform: p.waveform.load(Ordering::Relaxed),
            attack: p.attack.load(Ordering::Relaxed),
            decay: p.decay.load(Ordering::Relaxed),
            sustain: p.sustain.load(Ordering::Relaxed),
            release: p.release.load(Ordering::Relaxed),
            cutoff: p.cutoff.load(Ordering::Relaxed),
            resonance: p.resonance.load(Ordering::Relaxed),
            env_amount: p.env_amount.load(Ordering::Relaxed),
            volume: p.volume.load(Ordering::Relaxed),
            detune: p.detune.load(Ordering::Relaxed),
            pulse_width: p.pulse_width.load(Ordering::Relaxed),
        }
    }
}

/// Sets a single synth parameter by name.
///
/// Returns an error string if the parameter name is unrecognized.
pub fn set_param_by_name(params: &SynthParams, name: &str, value: f32) -> Result<(), String> {
    match name {
        "waveform" => params.waveform.store(value.clamp(0.0, 3.0), Ordering::Relaxed),
        "attack" => params.attack.store(value.clamp(0.001, 4.0), Ordering::Relaxed),
        "decay" => params.decay.store(value.clamp(0.001, 4.0), Ordering::Relaxed),
        "sustain" => params.sustain.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "release" => params.release.store(value.clamp(0.001, 8.0), Ordering::Relaxed),
        "cutoff" => params.cutoff.store(value.clamp(20.0, 20000.0), Ordering::Relaxed),
        "resonance" => params.resonance.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "env_amount" => params.env_amount.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "volume" => params.volume.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "detune" => params.detune.store(value.clamp(-100.0, 100.0), Ordering::Relaxed),
        "pulse_width" => params.pulse_width.store(value.clamp(0.05, 0.95), Ordering::Relaxed),
        _ => return Err(format!("Unknown synth parameter: '{}'", name)),
    }
    Ok(())
}
