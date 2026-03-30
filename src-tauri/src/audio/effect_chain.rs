//! Per-channel effect chain with bypass and wet/dry per slot.
//!
//! Each mixer channel owns an `EffectChain` that holds up to 16 ordered
//! `EffectSlot`s.  Processing is strictly linear (insert order).
//!
//! ## Design
//!
//! - Slots are added/removed outside the audio thread (Tauri command thread) while the
//!   chain is held behind a `Mutex`.  The audio callback locks the same `Mutex` briefly
//!   each buffer; since operations are O(n) and n ≤ 16, contention is negligible.
//! - Wet/dry blending uses pre-allocated scratch buffers (`Vec<f32>` sized at
//!   construction) so no allocation occurs on the hot path.
//! - Bypassed slots skip `process_stereo` entirely — zero CPU cost.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::effects::{
    AudioEffect,
    dynamics::{BrickwallLimiter, Compressor, NoiseGate},
    eq::ParametricEq,
    reverb::AlgorithmicReverb,
    delay::StereoDelay,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SLOTS: usize = 16;
const DEFAULT_SAMPLE_RATE: f32 = 44100.0;
/// Pre-allocated scratch buffer size in samples.  Must be ≥ any expected buffer size.
const SCRATCH_BUF_SAMPLES: usize = 8192;

// ─── EffectType ───────────────────────────────────────────────────────────────

/// Identifies which DSP algorithm a slot runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectType {
    Eq8Band,
    Reverb,
    Delay,
    Compressor,
    Limiter,
    Gate,
}

impl EffectType {
    /// Instantiates the corresponding DSP unit at the given sample rate.
    fn make_effect(&self, sample_rate: f32) -> Box<dyn AudioEffect> {
        match self {
            EffectType::Eq8Band   => Box::new(ParametricEq::new(sample_rate)),
            EffectType::Reverb    => Box::new(AlgorithmicReverb::new(sample_rate)),
            EffectType::Delay     => Box::new(StereoDelay::new(sample_rate)),
            EffectType::Compressor => Box::new(Compressor::new(sample_rate)),
            EffectType::Limiter   => Box::new(BrickwallLimiter::new(sample_rate)),
            EffectType::Gate      => Box::new(NoiseGate::new(sample_rate)),
        }
    }
}

// ─── EffectSlot ───────────────────────────────────────────────────────────────

/// One insert slot in an `EffectChain`.
pub struct EffectSlot {
    /// Unique ID returned to the frontend so it can reference this slot.
    pub slot_id: String,
    /// Which DSP algorithm this slot runs.
    pub effect_type: EffectType,
    /// The DSP instance.
    pub effect: Box<dyn AudioEffect>,
    /// When `true` the slot is skipped entirely during `process`.
    pub bypass: bool,
    /// 0.0 = fully dry, 1.0 = fully wet.  Values between blend in parallel.
    pub wet_dry: f32,
    // Pre-allocated scratch buffers for wet/dry blending (heap-allocated once at slot creation).
    scratch_l: Vec<f32>,
    scratch_r: Vec<f32>,
}

impl EffectSlot {
    fn new(effect_type: EffectType, sample_rate: f32) -> Self {
        let effect = effect_type.make_effect(sample_rate);
        Self {
            slot_id: Uuid::new_v4().to_string(),
            effect_type,
            effect,
            bypass: false,
            wet_dry: 1.0,
            scratch_l: vec![0.0f32; SCRATCH_BUF_SAMPLES],
            scratch_r: vec![0.0f32; SCRATCH_BUF_SAMPLES],
        }
    }
}

// ─── EffectChain ──────────────────────────────────────────────────────────────

/// Linear insert chain for one mixer channel.
pub struct EffectChain {
    pub slots: Vec<EffectSlot>,
    sample_rate: f32,
}

impl EffectChain {
    /// Creates an empty chain at the given sample rate.
    pub fn new(sample_rate: f32) -> Self {
        Self { slots: Vec::with_capacity(MAX_SLOTS), sample_rate }
    }

    /// Processes `left` and `right` buffers through every non-bypassed slot in order.
    ///
    /// No allocation occurs here; scratch buffers were pre-allocated at slot creation.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len()).min(SCRATCH_BUF_SAMPLES);

        for slot in &mut self.slots {
            if slot.bypass {
                continue;
            }

            let wd = slot.wet_dry;

            if (wd - 1.0).abs() < f32::EPSILON {
                // Fully wet: process in-place, no scratch needed.
                slot.effect.process_stereo(&mut left[..n], &mut right[..n]);
            } else {
                // Parallel blend: copy dry signal, process wet copy, mix.
                slot.scratch_l[..n].copy_from_slice(&left[..n]);
                slot.scratch_r[..n].copy_from_slice(&right[..n]);

                slot.effect.process_stereo(
                    &mut slot.scratch_l[..n],
                    &mut slot.scratch_r[..n],
                );

                let dry = 1.0 - wd;
                for i in 0..n {
                    left[i]  = left[i]  * dry + slot.scratch_l[i] * wd;
                    right[i] = right[i] * dry + slot.scratch_r[i] * wd;
                }
            }
        }
    }

    /// Adds a new slot of the given type at `position` (appends if None or out-of-range).
    /// Returns the new slot's ID.
    pub fn add_slot(&mut self, effect_type: EffectType, position: Option<usize>) -> String {
        if self.slots.len() >= MAX_SLOTS {
            // Return empty string; callers check for length before adding.
            return String::new();
        }
        let slot = EffectSlot::new(effect_type, self.sample_rate);
        let id = slot.slot_id.clone();
        match position {
            Some(i) if i < self.slots.len() => self.slots.insert(i, slot),
            _ => self.slots.push(slot),
        }
        id
    }

    /// Removes the slot with the given ID.  Returns `true` if found and removed.
    pub fn remove_slot(&mut self, slot_id: &str) -> bool {
        if let Some(pos) = self.slots.iter().position(|s| s.slot_id == slot_id) {
            self.slots.remove(pos);
            true
        } else {
            false
        }
    }

    /// Moves slot at `from_index` to `to_index`.
    pub fn move_slot(&mut self, from_index: usize, to_index: usize) {
        let len = self.slots.len();
        if from_index >= len || to_index >= len || from_index == to_index {
            return;
        }
        let slot = self.slots.remove(from_index);
        self.slots.insert(to_index, slot);
    }

    /// Sets bypass for the slot with the given ID.
    pub fn set_bypass(&mut self, slot_id: &str, bypass: bool) {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            slot.bypass = bypass;
        }
    }

    /// Sets wet/dry for the slot with the given ID.
    pub fn set_wet_dry(&mut self, slot_id: &str, wet_dry: f32) {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            slot.wet_dry = wet_dry.clamp(0.0, 1.0);
        }
    }

    /// Returns a serialisable snapshot of the current chain state.
    pub fn snapshot(&self, channel_id: &str) -> ChainStateSnapshot {
        ChainStateSnapshot {
            channel_id: channel_id.to_owned(),
            slots: self.slots.iter().map(|s| SlotStateSnapshot {
                slot_id:     s.slot_id.clone(),
                effect_type: s.effect_type.clone(),
                bypass:      s.bypass,
                wet_dry:     s.wet_dry,
            }).collect(),
        }
    }

    /// Saves the current chain as a preset (params + layout).
    pub fn to_preset(&self) -> Vec<SlotPreset> {
        self.slots.iter().map(|s| SlotPreset {
            effect_type: s.effect_type.clone(),
            bypass:      s.bypass,
            wet_dry:     s.wet_dry,
            params:      s.effect.get_params(),
        }).collect()
    }

    /// Loads a preset, replacing all current slots.
    pub fn load_preset(&mut self, preset: &[SlotPreset]) {
        self.slots.clear();
        for entry in preset.iter().take(MAX_SLOTS) {
            let mut slot = EffectSlot::new(entry.effect_type.clone(), self.sample_rate);
            slot.bypass  = entry.bypass;
            slot.wet_dry = entry.wet_dry;
            slot.effect.set_params(&entry.params);
            self.slots.push(slot);
        }
    }
}

// ─── Snapshots & presets ─────────────────────────────────────────────────────

/// Serialisable state for one slot (no DSP params — just layout).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlotStateSnapshot {
    pub slot_id:     String,
    pub effect_type: EffectType,
    pub bypass:      bool,
    pub wet_dry:     f32,
}

/// Full chain state for one channel.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChainStateSnapshot {
    pub channel_id: String,
    pub slots:      Vec<SlotStateSnapshot>,
}

/// One slot as stored in a preset (includes DSP params).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlotPreset {
    pub effect_type: EffectType,
    pub bypass:      bool,
    pub wet_dry:     f32,
    pub params:      serde_json::Value,
}

// ─── Tauri state ─────────────────────────────────────────────────────────────

/// Per-channel chain map.
pub type ChainStoreInner = HashMap<String, EffectChain>;
/// Shared chain store managed by Tauri.
pub type ChainStore = Arc<Mutex<ChainStoreInner>>;

/// Named preset store: `preset_name → Vec<SlotPreset>`.
pub type PresetStoreInner = HashMap<String, Vec<SlotPreset>>;
/// Shared preset store managed by Tauri.
pub type PresetStore = Arc<Mutex<PresetStoreInner>>;

fn get_or_create<'a>(
    store: &'a mut ChainStoreInner,
    channel_id: &str,
) -> &'a mut EffectChain {
    store
        .entry(channel_id.to_owned())
        .or_insert_with(|| EffectChain::new(DEFAULT_SAMPLE_RATE))
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// Adds an effect of the given type to a channel's chain.
///
/// `position` is an optional zero-based insert index; if absent the effect is appended.
/// Returns the new slot's UUID string.
#[tauri::command]
pub fn add_effect_to_chain(
    channel_id: String,
    effect_type: EffectType,
    position: Option<usize>,
    state: State<'_, ChainStore>,
) -> Result<String, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let chain = get_or_create(&mut store, &channel_id);
    let slot_id = chain.add_slot(effect_type, position);
    if slot_id.is_empty() {
        Err(format!("Effect chain for channel '{channel_id}' is full (max {MAX_SLOTS} slots)"))
    } else {
        Ok(slot_id)
    }
}

/// Removes the slot identified by `slot_id` from the channel's chain.
#[tauri::command]
pub fn remove_effect_from_chain(
    channel_id: String,
    slot_id: String,
    state: State<'_, ChainStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let chain = get_or_create(&mut store, &channel_id);
    if chain.remove_slot(&slot_id) {
        Ok(())
    } else {
        Err(format!("Slot '{slot_id}' not found in channel '{channel_id}'"))
    }
}

/// Moves a slot from `from_index` to `to_index` within the channel's chain.
#[tauri::command]
pub fn move_effect_in_chain(
    channel_id: String,
    from_index: usize,
    to_index: usize,
    state: State<'_, ChainStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let chain = get_or_create(&mut store, &channel_id);
    chain.move_slot(from_index, to_index);
    Ok(())
}

/// Sets the bypass state for a single slot.
#[tauri::command]
pub fn bypass_effect(
    channel_id: String,
    slot_id: String,
    bypass: bool,
    state: State<'_, ChainStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let chain = get_or_create(&mut store, &channel_id);
    chain.set_bypass(&slot_id, bypass);
    Ok(())
}

/// Sets the wet/dry ratio for a single slot (0.0 = dry, 1.0 = wet).
#[tauri::command]
pub fn set_effect_wet_dry(
    channel_id: String,
    slot_id: String,
    wet_dry: f32,
    state: State<'_, ChainStore>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let chain = get_or_create(&mut store, &channel_id);
    chain.set_wet_dry(&slot_id, wet_dry);
    Ok(())
}

/// Returns the current chain layout (slot IDs, types, bypass, wet/dry).
#[tauri::command]
pub fn get_chain_state(
    channel_id: String,
    state: State<'_, ChainStore>,
) -> Result<ChainStateSnapshot, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let chain = get_or_create(&mut store, &channel_id);
    Ok(chain.snapshot(&channel_id))
}

/// Saves the channel's current chain configuration as a named preset.
#[tauri::command]
pub fn save_chain_preset(
    channel_id: String,
    preset_name: String,
    chain_state: State<'_, ChainStore>,
    preset_state: State<'_, PresetStore>,
) -> Result<(), String> {
    let chain_store = chain_state.lock().map_err(|e| e.to_string())?;
    let chain = chain_store.get(&channel_id)
        .ok_or_else(|| format!("No chain found for channel '{channel_id}'"))?;
    let preset = chain.to_preset();
    drop(chain_store);
    let mut presets = preset_state.lock().map_err(|e| e.to_string())?;
    presets.insert(preset_name, preset);
    Ok(())
}

/// Loads a named preset onto the channel's chain, replacing its current configuration.
#[tauri::command]
pub fn load_chain_preset(
    channel_id: String,
    preset_name: String,
    chain_state: State<'_, ChainStore>,
    preset_state: State<'_, PresetStore>,
) -> Result<(), String> {
    let presets = preset_state.lock().map_err(|e| e.to_string())?;
    let preset = presets.get(&preset_name)
        .ok_or_else(|| format!("Preset '{preset_name}' not found"))?
        .clone();
    drop(presets);
    let mut chain_store = chain_state.lock().map_err(|e| e.to_string())?;
    let chain = get_or_create(&mut chain_store, &channel_id);
    chain.load_preset(&preset);
    Ok(())
}

/// Returns the names of all saved presets.
#[tauri::command]
pub fn list_chain_presets(
    state: State<'_, PresetStore>,
) -> Result<Vec<String>, String> {
    let presets = state.lock().map_err(|e| e.to_string())?;
    Ok(presets.keys().cloned().collect())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_chain() -> EffectChain {
        EffectChain::new(44100.0)
    }

    #[test]
    fn add_and_get_slot() {
        let mut chain = make_chain();
        let id = chain.add_slot(EffectType::Gate, None);
        assert!(!id.is_empty());
        assert_eq!(chain.slots.len(), 1);
        assert_eq!(chain.slots[0].slot_id, id);
    }

    #[test]
    fn add_at_position() {
        let mut chain = make_chain();
        chain.add_slot(EffectType::Compressor, None);
        chain.add_slot(EffectType::Reverb, None);
        chain.add_slot(EffectType::Gate, Some(1));
        assert_eq!(chain.slots[0].effect_type, EffectType::Compressor);
        assert_eq!(chain.slots[1].effect_type, EffectType::Gate);
        assert_eq!(chain.slots[2].effect_type, EffectType::Reverb);
    }

    #[test]
    fn remove_slot() {
        let mut chain = make_chain();
        let id = chain.add_slot(EffectType::Limiter, None);
        assert!(chain.remove_slot(&id));
        assert_eq!(chain.slots.len(), 0);
        assert!(!chain.remove_slot(&id)); // removing twice returns false
    }

    #[test]
    fn move_slot() {
        let mut chain = make_chain();
        chain.add_slot(EffectType::Eq8Band, None);
        chain.add_slot(EffectType::Compressor, None);
        chain.add_slot(EffectType::Reverb, None);
        // Move index 2 (Reverb) to index 0
        chain.move_slot(2, 0);
        assert_eq!(chain.slots[0].effect_type, EffectType::Reverb);
        assert_eq!(chain.slots[1].effect_type, EffectType::Eq8Band);
        assert_eq!(chain.slots[2].effect_type, EffectType::Compressor);
    }

    #[test]
    fn bypass_slot() {
        let mut chain = make_chain();
        let id = chain.add_slot(EffectType::Gate, None);
        chain.set_bypass(&id, true);
        assert!(chain.slots[0].bypass);
        chain.set_bypass(&id, false);
        assert!(!chain.slots[0].bypass);
    }

    #[test]
    fn wet_dry_clamps() {
        let mut chain = make_chain();
        let id = chain.add_slot(EffectType::Delay, None);
        chain.set_wet_dry(&id, 1.5);
        assert!((chain.slots[0].wet_dry - 1.0).abs() < 1e-6);
        chain.set_wet_dry(&id, -0.5);
        assert!((chain.slots[0].wet_dry).abs() < 1e-6);
    }

    #[test]
    fn process_does_not_panic_empty_chain() {
        let mut chain = make_chain();
        let mut l = vec![0.5f32; 256];
        let mut r = vec![0.5f32; 256];
        chain.process(&mut l, &mut r);
        // Signal unchanged
        assert!((l[0] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn bypass_slot_passes_signal_unchanged() {
        let mut chain = make_chain();
        // Compressor with heavy settings
        let id = chain.add_slot(EffectType::Compressor, None);
        chain.set_bypass(&id, true);
        let mut l = vec![0.8f32; 256];
        let mut r = vec![0.8f32; 256];
        chain.process(&mut l, &mut r);
        // Bypassed — signal unchanged
        assert!((l[0] - 0.8).abs() < 1e-4);
    }

    #[test]
    fn preset_round_trip() {
        let mut chain = make_chain();
        chain.add_slot(EffectType::Compressor, None);
        chain.add_slot(EffectType::Reverb, None);
        let preset = chain.to_preset();
        assert_eq!(preset.len(), 2);
        assert_eq!(preset[0].effect_type, EffectType::Compressor);
        assert_eq!(preset[1].effect_type, EffectType::Reverb);

        let mut chain2 = make_chain();
        chain2.load_preset(&preset);
        assert_eq!(chain2.slots.len(), 2);
        assert_eq!(chain2.slots[0].effect_type, EffectType::Compressor);
    }

    #[test]
    fn max_slots_limit() {
        let mut chain = make_chain();
        for _ in 0..MAX_SLOTS {
            chain.add_slot(EffectType::Gate, None);
        }
        // Adding one more returns empty ID
        let id = chain.add_slot(EffectType::Gate, None);
        assert!(id.is_empty());
        assert_eq!(chain.slots.len(), MAX_SLOTS);
    }

    #[test]
    fn snapshot_reflects_state() {
        let mut chain = make_chain();
        let id = chain.add_slot(EffectType::Eq8Band, None);
        chain.set_bypass(&id, true);
        chain.set_wet_dry(&id, 0.5);
        let snap = chain.snapshot("ch1");
        assert_eq!(snap.channel_id, "ch1");
        assert_eq!(snap.slots.len(), 1);
        assert!(snap.slots[0].bypass);
        assert!((snap.slots[0].wet_dry - 0.5).abs() < 1e-6);
    }

    #[test]
    fn wet_dry_blend_passes_signal() {
        let mut chain = make_chain();
        let id = chain.add_slot(EffectType::Eq8Band, None);
        chain.set_wet_dry(&id, 0.0); // fully dry
        let mut l = vec![0.5f32; 256];
        let mut r = vec![0.5f32; 256];
        chain.process(&mut l, &mut r);
        // Fully dry — EQ has no effect on flat signal at default settings
        assert!((l[0] - 0.5).abs() < 0.05);
    }
}
