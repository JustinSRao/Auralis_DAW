//! Instrument and effect preset system (Sprint 34).
//!
//! ## Architecture
//!
//! - **Factory presets** — embedded at compile time, read-only.
//! - **User presets** — stored on disk in `{app_data_dir}/presets/{type}/`.
//! - **`PresetManager`** — stateless async file-system operations shared via `Arc`.
//! - **6 Tauri commands** — list, load, save, delete, capture (from live params), apply.

pub mod factory;
pub mod manager;
pub mod mod_types;

pub use manager::PresetManager;
pub use mod_types::{Preset, PresetMeta, PresetType};

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::effects::AudioEffect;
use crate::effects::delay::DelayStore;
use crate::effects::dynamics::CompressorStore;
use crate::effects::eq::EqStore;
use crate::effects::reverb::ReverbStore;
use crate::instruments::commands::{
    DrumAtomicsState, DrumCmdTxState, DrumPatternShadowState,
    SamplerState, SynthState,
};
use crate::instruments::drum_machine::DrumCommand;
use crate::instruments::synth::lfo::{set_lfo_param_by_name, LfoParamsState};
use crate::instruments::synth::params::set_param_by_name as synth_set_param;
use crate::instruments::sampler::zone::set_param_by_name as sampler_set_param;

/// Managed state alias for the preset manager.
///
/// `PresetManager` is stateless (pure filesystem I/O with no mutable fields),
/// so a plain `Arc` provides safe shared access without any `Mutex` overhead.
pub type PresetManagerState = Arc<PresetManager>;

// ─── list_presets ─────────────────────────────────────────────────────────────

/// Returns metadata for all presets of the given type.
///
/// Factory presets come first (alphabetical), then user presets (alphabetical).
/// Does not return parameter data — use `load_preset` for that.
#[tauri::command]
pub async fn list_presets(
    preset_type: PresetType,
    manager: State<'_, PresetManagerState>,
) -> Result<Vec<PresetMeta>, String> {
    manager.list(preset_type).await.map_err(|e| e.to_string())
}

// ─── load_preset ─────────────────────────────────────────────────────────────

/// Loads a single preset by type + name and returns its full parameter data.
#[tauri::command]
pub async fn load_preset(
    preset_type: PresetType,
    name: String,
    manager: State<'_, PresetManagerState>,
) -> Result<Preset, String> {
    manager.load(preset_type, &name).await.map_err(|e| e.to_string())
}

// ─── save_preset ─────────────────────────────────────────────────────────────

/// Saves a user preset to disk.
///
/// Returns an error if the name matches a factory preset.
#[tauri::command]
pub async fn save_preset(
    preset: Preset,
    manager: State<'_, PresetManagerState>,
) -> Result<(), String> {
    manager.save(&preset).await.map_err(|e| e.to_string())
}

// ─── delete_preset ───────────────────────────────────────────────────────────

/// Deletes a user preset by type + name.
///
/// Returns an error if the name is a factory preset.
#[tauri::command]
pub async fn delete_preset(
    preset_type: PresetType,
    name: String,
    manager: State<'_, PresetManagerState>,
) -> Result<(), String> {
    manager.delete(preset_type, &name).await.map_err(|e| e.to_string())
}

// ─── capture_preset ──────────────────────────────────────────────────────────

/// Captures current live parameter state and returns it as a `Preset` ready for saving.
///
/// The caller provides a `name`; the preset is NOT saved automatically — use
/// `save_preset` after the user confirms the name.
///
/// `channel_id` is used for effects presets (identifies which channel's effect to capture).
/// It is ignored for instrument presets.
#[tauri::command]
pub fn capture_preset(
    preset_type: PresetType,
    name: String,
    channel_id: Option<String>,
    // All managed state — always available since registered in lib.rs setup
    synth: State<'_, SynthState>,
    lfo_params: State<'_, LfoParamsState>,
    sampler: State<'_, SamplerState>,
    drum_atomics: State<'_, DrumAtomicsState>,
    drum_shadow: State<'_, DrumPatternShadowState>,
    eq_store: State<'_, EqStore>,
    reverb_store: State<'_, ReverbStore>,
    delay_store: State<'_, DelayStore>,
    compressor_store: State<'_, CompressorStore>,
) -> Result<Preset, String> {
    let params = match preset_type {
        PresetType::Synth => capture_synth(synth, lfo_params)?,
        PresetType::Sampler => capture_sampler(sampler)?,
        PresetType::DrumMachine => capture_drum(drum_atomics, drum_shadow)?,
        PresetType::Eq => capture_eq(eq_store, channel_id.as_deref())?,
        PresetType::Reverb => capture_reverb(reverb_store, channel_id.as_deref())?,
        PresetType::Delay => capture_delay(delay_store, channel_id.as_deref())?,
        PresetType::Compressor => capture_compressor(compressor_store, channel_id.as_deref())?,
    };
    Ok(Preset {
        name,
        preset_type,
        params,
        is_factory: false,
    })
}

// ─── apply_preset ────────────────────────────────────────────────────────────

/// Applies a loaded preset's parameters to the live instrument/effect state.
///
/// `channel_id` is used for effects presets (identifies which channel's effect to update).
/// It is ignored for instrument presets.
#[tauri::command]
pub fn apply_preset(
    preset: Preset,
    channel_id: Option<String>,
    // All managed state — always available since registered in lib.rs setup
    synth: State<'_, SynthState>,
    lfo_params: State<'_, LfoParamsState>,
    sampler: State<'_, SamplerState>,
    drum_atomics: State<'_, DrumAtomicsState>,
    drum_cmd_tx: State<'_, DrumCmdTxState>,
    drum_shadow: State<'_, DrumPatternShadowState>,
    eq_store: State<'_, EqStore>,
    reverb_store: State<'_, ReverbStore>,
    delay_store: State<'_, DelayStore>,
    compressor_store: State<'_, CompressorStore>,
) -> Result<(), String> {
    match preset.preset_type {
        PresetType::Synth => apply_synth(&preset.params, synth, lfo_params),
        PresetType::Sampler => apply_sampler(&preset.params, sampler),
        PresetType::DrumMachine => apply_drum(&preset.params, drum_atomics, drum_cmd_tx, drum_shadow),
        PresetType::Eq => apply_eq(&preset.params, eq_store, channel_id.as_deref()),
        PresetType::Reverb => apply_reverb(&preset.params, reverb_store, channel_id.as_deref()),
        PresetType::Delay => apply_delay(&preset.params, delay_store, channel_id.as_deref()),
        PresetType::Compressor => apply_compressor(&preset.params, compressor_store, channel_id.as_deref()),
    }
}

// ─── Capture helpers ──────────────────────────────────────────────────────────

fn capture_synth(
    synth: State<'_, SynthState>,
    lfo_params: State<'_, LfoParamsState>,
) -> Result<Value, String> {
    use std::sync::atomic::Ordering;
    let lfo = lfo_params;

    let lfo1 = serde_json::json!({
        "rate": lfo.lfo1.rate.load(Ordering::Relaxed),
        "depth": lfo.lfo1.depth.load(Ordering::Relaxed),
        "waveform": lfo.lfo1.waveform.load(Ordering::Relaxed),
        "bpm_sync": lfo.lfo1.bpm_sync.load(Ordering::Relaxed),
        "division": lfo.lfo1.division.load(Ordering::Relaxed),
        "phase_reset": lfo.lfo1.phase_reset.load(Ordering::Relaxed),
        "destination": lfo.lfo1.destination.load(Ordering::Relaxed),
    });
    let lfo2 = serde_json::json!({
        "rate": lfo.lfo2.rate.load(Ordering::Relaxed),
        "depth": lfo.lfo2.depth.load(Ordering::Relaxed),
        "waveform": lfo.lfo2.waveform.load(Ordering::Relaxed),
        "bpm_sync": lfo.lfo2.bpm_sync.load(Ordering::Relaxed),
        "division": lfo.lfo2.division.load(Ordering::Relaxed),
        "phase_reset": lfo.lfo2.phase_reset.load(Ordering::Relaxed),
        "destination": lfo.lfo2.destination.load(Ordering::Relaxed),
    });

    Ok(serde_json::json!({
        "waveform": synth.waveform.load(Ordering::Relaxed),
        "attack": synth.attack.load(Ordering::Relaxed),
        "decay": synth.decay.load(Ordering::Relaxed),
        "sustain": synth.sustain.load(Ordering::Relaxed),
        "release": synth.release.load(Ordering::Relaxed),
        "cutoff": synth.cutoff.load(Ordering::Relaxed),
        "resonance": synth.resonance.load(Ordering::Relaxed),
        "env_amount": synth.env_amount.load(Ordering::Relaxed),
        "volume": synth.volume.load(Ordering::Relaxed),
        "detune": synth.detune.load(Ordering::Relaxed),
        "pulse_width": synth.pulse_width.load(Ordering::Relaxed),
        "lfo1": lfo1,
        "lfo2": lfo2,
    }))
}

fn capture_sampler(sampler: State<'_, SamplerState>) -> Result<Value, String> {
    use std::sync::atomic::Ordering;
    let s = sampler;
    Ok(serde_json::json!({
        "attack": s.attack.load(Ordering::Relaxed),
        "decay": s.decay.load(Ordering::Relaxed),
        "sustain": s.sustain.load(Ordering::Relaxed),
        "release": s.release.load(Ordering::Relaxed),
        "volume": s.volume.load(Ordering::Relaxed),
    }))
}

fn capture_drum(
    drum_atomics: State<'_, DrumAtomicsState>,
    drum_shadow: State<'_, DrumPatternShadowState>,
) -> Result<Value, String> {
    use std::sync::atomic::Ordering;
    let atomics = drum_atomics;
    let shadow = drum_shadow;

    let bpm = atomics.bpm.load(Ordering::Relaxed);
    let swing = atomics.swing.load(Ordering::Relaxed);
    let pattern_length = atomics.pattern_length.load(Ordering::Relaxed);

    let pads = shadow
        .lock()
        .map_err(|e| format!("Failed to lock drum shadow: {}", e))?
        .iter()
        .map(|pad| {
            serde_json::json!({
                "name": pad.name,
                "steps": pad.steps.iter().map(|s| serde_json::json!({
                    "active": s.active,
                    "velocity": s.velocity,
                })).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "bpm": bpm,
        "swing": swing,
        "pattern_length": pattern_length,
        "pads": pads,
    }))
}

fn capture_eq(
    eq_store: State<'_, EqStore>,
    channel_id: Option<&str>,
) -> Result<Value, String> {
    let store = eq_store;
    let ch = channel_id.unwrap_or("default");
    let guard = store.lock().map_err(|e| format!("Failed to lock EQ store: {}", e))?;
    let eq = guard.get(ch).ok_or_else(|| format!("No EQ for channel '{}'", ch))?;
    Ok(eq.get_params())
}

fn capture_reverb(
    reverb_store: State<'_, ReverbStore>,
    channel_id: Option<&str>,
) -> Result<Value, String> {
    let store = reverb_store;
    let ch = channel_id.unwrap_or("default");
    let guard = store.lock().map_err(|e| format!("Failed to lock reverb store: {}", e))?;
    let reverb = guard.get(ch).ok_or_else(|| format!("No reverb for channel '{}'", ch))?;
    Ok(reverb.get_params())
}

fn capture_delay(
    delay_store: State<'_, DelayStore>,
    channel_id: Option<&str>,
) -> Result<Value, String> {
    let store = delay_store;
    let ch = channel_id.unwrap_or("default");
    let guard = store.lock().map_err(|e| format!("Failed to lock delay store: {}", e))?;
    let delay = guard.get(ch).ok_or_else(|| format!("No delay for channel '{}'", ch))?;
    Ok(delay.get_params())
}

fn capture_compressor(
    compressor_store: State<'_, CompressorStore>,
    channel_id: Option<&str>,
) -> Result<Value, String> {
    let store = compressor_store;
    let ch = channel_id.unwrap_or("default");
    let guard = store.lock().map_err(|e| format!("Failed to lock compressor store: {}", e))?;
    let comp = guard.get(ch).ok_or_else(|| format!("No compressor for channel '{}'", ch))?;
    Ok(comp.get_params())
}

// ─── Apply helpers ────────────────────────────────────────────────────────────

fn apply_synth(
    params: &Value,
    synth: State<'_, SynthState>,
    lfo_params: State<'_, LfoParamsState>,
) -> Result<(), String> {
    let lfo = lfo_params;

    let top_level_keys = ["waveform", "attack", "decay", "sustain", "release",
                           "cutoff", "resonance", "env_amount", "volume", "detune", "pulse_width"];

    for key in &top_level_keys {
        if let Some(v) = params.get(key).and_then(|v| v.as_f64()) {
            synth_set_param(&synth, key, v as f32)
                .map_err(|e| format!("Failed to set synth.{}: {}", key, e))?;
        }
    }

    // Apply LFO 1 params
    if let Some(lfo1_val) = params.get("lfo1") {
        let lfo_keys = ["rate", "depth", "waveform", "bpm_sync", "division", "phase_reset", "destination"];
        for key in &lfo_keys {
            if let Some(v) = lfo1_val.get(key).and_then(|v| v.as_f64()) {
                set_lfo_param_by_name(&lfo.lfo1, key, v as f32)
                    .map_err(|e| format!("Failed to set lfo1.{}: {}", key, e))?;
            }
        }
    }

    // Apply LFO 2 params
    if let Some(lfo2_val) = params.get("lfo2") {
        let lfo_keys = ["rate", "depth", "waveform", "bpm_sync", "division", "phase_reset", "destination"];
        for key in &lfo_keys {
            if let Some(v) = lfo2_val.get(key).and_then(|v| v.as_f64()) {
                set_lfo_param_by_name(&lfo.lfo2, key, v as f32)
                    .map_err(|e| format!("Failed to set lfo2.{}: {}", key, e))?;
            }
        }
    }

    Ok(())
}

fn apply_sampler(
    params: &Value,
    sampler: State<'_, SamplerState>,
) -> Result<(), String> {
    for key in &["attack", "decay", "sustain", "release", "volume"] {
        if let Some(v) = params.get(key).and_then(|v| v.as_f64()) {
            sampler_set_param(&sampler, key, v as f32)
                .map_err(|e| format!("Failed to set sampler.{}: {}", key, e))?;
        }
    }
    Ok(())
}

fn apply_drum(
    params: &Value,
    drum_atomics: State<'_, DrumAtomicsState>,
    drum_cmd_tx: State<'_, DrumCmdTxState>,
    drum_shadow: State<'_, DrumPatternShadowState>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    let atomics = drum_atomics;
    let cmd_tx = drum_cmd_tx;
    let shadow = drum_shadow;

    if let Some(bpm) = params.get("bpm").and_then(|v| v.as_f64()) {
        atomics.bpm.store((bpm as f32).clamp(1.0, 300.0), Ordering::Relaxed);
    }
    if let Some(swing) = params.get("swing").and_then(|v| v.as_f64()) {
        atomics.swing.store((swing as f32).clamp(0.0, 0.5), Ordering::Relaxed);
    }

    // Acquire the lock once and send all drum commands within a single lock hold
    // to eliminate the race window between SetPatternLength and pad step commands.
    let guard = cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;

    let mut shadow_guard = shadow
        .lock()
        .map_err(|e| format!("Failed to lock drum shadow: {}", e))?;

    // Apply pattern length
    if let Some(length) = params.get("pattern_length").and_then(|v| v.as_u64()) {
        // Drum machine only supports pattern lengths of 16 or 32 steps; quantize to the nearest valid value.
        let clamped: u8 = if length <= 16 { 16 } else { 32 };
        if let Some(tx) = guard.as_ref() {
            let _ = tx.try_send(DrumCommand::SetPatternLength { length: clamped });
        }
    }

    // Apply pad steps
    if let Some(pads_val) = params.get("pads").and_then(|v| v.as_array()) {
        for (pad_idx, pad_val) in pads_val.iter().enumerate().take(16) {
            if let Some(steps_arr) = pad_val.get("steps").and_then(|v| v.as_array()) {
                for (step_idx, step_val) in steps_arr.iter().enumerate().take(32) {
                    let active = step_val.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                    let raw_velocity = step_val.get("velocity").and_then(|v| v.as_u64()).unwrap_or(100);
                    let velocity = raw_velocity.clamp(1, 127) as u8;

                    if let Some(tx) = guard.as_ref() {
                        let _ = tx.try_send(DrumCommand::SetStep {
                            pad_idx: pad_idx as u8,
                            step_idx: step_idx as u8,
                            active,
                            velocity,
                        });
                    }

                    // Update shadow
                    if let Some(pad) = shadow_guard.get_mut(pad_idx) {
                        if let Some(step) = pad.steps.get_mut(step_idx) {
                            step.active = active;
                            step.velocity = velocity;
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

fn apply_eq(
    params: &Value,
    eq_store: State<'_, EqStore>,
    channel_id: Option<&str>,
) -> Result<(), String> {
    let store = eq_store;
    let ch = channel_id.unwrap_or("default");
    let mut guard = store.lock().map_err(|e| format!("Failed to lock EQ store: {}", e))?;
    if let Some(eq) = guard.get_mut(ch) {
        eq.set_params(params);
    }
    Ok(())
}

fn apply_reverb(
    params: &Value,
    reverb_store: State<'_, ReverbStore>,
    channel_id: Option<&str>,
) -> Result<(), String> {
    let store = reverb_store;
    let ch = channel_id.unwrap_or("default");
    let mut guard = store.lock().map_err(|e| format!("Failed to lock reverb store: {}", e))?;
    if let Some(reverb) = guard.get_mut(ch) {
        reverb.set_params(params);
    }
    Ok(())
}

fn apply_delay(
    params: &Value,
    delay_store: State<'_, DelayStore>,
    channel_id: Option<&str>,
) -> Result<(), String> {
    let store = delay_store;
    let ch = channel_id.unwrap_or("default");
    let mut guard = store.lock().map_err(|e| format!("Failed to lock delay store: {}", e))?;
    if let Some(delay) = guard.get_mut(ch) {
        delay.set_params(params);
    }
    Ok(())
}

fn apply_compressor(
    params: &Value,
    compressor_store: State<'_, CompressorStore>,
    channel_id: Option<&str>,
) -> Result<(), String> {
    let store = compressor_store;
    let ch = channel_id.unwrap_or("default");
    let mut guard = store.lock().map_err(|e| format!("Failed to lock compressor store: {}", e))?;
    if let Some(comp) = guard.get_mut(ch) {
        comp.set_params(params);
    }
    Ok(())
}
