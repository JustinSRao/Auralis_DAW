//! MIDI CC → parameter mapping registry and MIDI Learn state (Sprint 29).
//!
//! [`MappingRegistry`] holds a set of [`MidiMapping`] records that bind a
//! CC number + optional channel to a named automatable parameter. On each
//! incoming CC message the registry scales the value (0–127) to the
//! parameter's native range and writes it atomically.
//!
//! MIDI Learn mode is driven by [`PendingLearnState`]: the next CC received
//! while `Some(param_id)` is stored completes the mapping.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;

use atomic_float::AtomicF32;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A single CC → parameter binding, persisted in the project file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MidiMapping {
    /// Stable parameter identifier, e.g. `"synth.cutoff"`.
    pub param_id: String,
    /// CC number (0–127) that controls this parameter.
    pub cc: u8,
    /// MIDI channel (0-indexed). `None` = match any channel.
    pub channel: Option<u8>,
    /// Parameter's native minimum value.
    pub min_value: f32,
    /// Parameter's native maximum value.
    pub max_value: f32,
}

/// Event emitted when MIDI Learn captures a CC (sent over crossbeam channel
/// to a background task which then emits the Tauri event).
#[derive(Debug, Clone, Serialize)]
pub struct MidiLearnCompleteEvent {
    /// Parameter that was being learned.
    pub param_id: String,
    /// CC number that was captured.
    pub cc: u8,
    /// Channel the CC arrived on (0-indexed).
    pub channel: u8,
}

/// Tauri managed state type for the mapping registry.
pub type MappingRegistryState = Arc<Mutex<MappingRegistry>>;

/// Tauri managed state for the pending-learn parameter id.
pub type PendingLearnState = Arc<Mutex<Option<String>>>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/// Runtime registry mapping CC events to AtomicF32 parameter targets.
///
/// Thread-safety: all methods are called behind `Arc<Mutex<MappingRegistry>>`
/// managed state. The hot-path `dispatch_cc` acquires no additional locks —
/// it only performs `AtomicF32::store` calls.
pub struct MappingRegistry {
    /// Persisted mapping table (CC + channel → param_id).
    mappings: Vec<MidiMapping>,
    /// Live atomic write targets, keyed by `param_id`.
    targets: HashMap<String, Arc<AtomicF32>>,
}

impl MappingRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self {
            mappings: Vec::new(),
            targets: HashMap::new(),
        }
    }

    /// Registers an atomic write target for a parameter.
    ///
    /// Must be called after instrument creation so that CC dispatch can write
    /// to the live atomic. Calling again with the same `param_id` replaces the
    /// target (safe — just overwrites the `Arc`).
    pub fn register_target(&mut self, param_id: &str, atomic: Arc<AtomicF32>) {
        self.targets.insert(param_id.to_string(), atomic);
    }

    /// Adds or replaces a mapping for `param_id`.
    ///
    /// If a mapping with the same `param_id` already exists it is replaced.
    pub fn add_mapping(&mut self, mapping: MidiMapping) {
        if let Some(existing) = self.mappings.iter_mut().find(|m| m.param_id == mapping.param_id) {
            *existing = mapping;
        } else {
            self.mappings.push(mapping);
        }
    }

    /// Removes the mapping for `param_id`. Returns `true` if it existed.
    pub fn remove_mapping(&mut self, param_id: &str) -> bool {
        let before = self.mappings.len();
        self.mappings.retain(|m| m.param_id != param_id);
        self.mappings.len() < before
    }

    /// Returns a clone of all current mappings (for IPC / serialization).
    pub fn get_mappings(&self) -> Vec<MidiMapping> {
        self.mappings.clone()
    }

    /// Replaces the mapping table wholesale (called on project load).
    ///
    /// Pre-registered targets are preserved so that newly loaded mappings
    /// become live immediately if the instrument was already created.
    pub fn load_mappings(&mut self, mappings: Vec<MidiMapping>) {
        self.mappings = mappings;
    }

    /// Processes an incoming CC event.
    ///
    /// For each matching mapping the CC value (0–127) is linearly scaled to
    /// `[min_value, max_value]` and written to the registered `AtomicF32`.
    /// If no target is registered for a mapping's `param_id` the mapping is
    /// silently skipped (instrument not yet instantiated).
    ///
    /// Called from the midir callback thread — must not allocate or block.
    pub fn dispatch_cc(&self, channel: u8, controller: u8, value: u8) {
        for mapping in &self.mappings {
            if mapping.cc != controller {
                continue;
            }
            let channel_match = match mapping.channel {
                None => true,
                Some(ch) => ch == channel,
            };
            if !channel_match {
                continue;
            }
            if let Some(atomic) = self.targets.get(&mapping.param_id) {
                let normalized = value as f32 / 127.0;
                let param_value =
                    mapping.min_value + normalized * (mapping.max_value - mapping.min_value);
                atomic.store(param_value, Ordering::Relaxed);
            }
        }
    }
}

impl Default for MappingRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Synth parameter registration helper
// ---------------------------------------------------------------------------

/// Registers all standard synth automation targets with their native ranges.
///
/// Call this after [`create_synth_instrument`] with the `SynthParams` atomics.
///
/// [`create_synth_instrument`]: crate::instruments::commands::create_synth_instrument
pub fn register_synth_targets(
    registry: &mut MappingRegistry,
    params: &crate::instruments::synth::params::SynthParams,
) {
    // Each tuple: (param_id, Arc<AtomicF32>) — ranges stored in `add_mapping`
    // but the registry only needs the atomic pointer here.
    for (param_id, atomic) in params.iter_automation_targets() {
        registry.register_target(&param_id, atomic);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_atomic(v: f32) -> Arc<AtomicF32> {
        Arc::new(AtomicF32::new(v))
    }

    fn make_mapping(param_id: &str, cc: u8, channel: Option<u8>, min: f32, max: f32) -> MidiMapping {
        MidiMapping {
            param_id: param_id.to_string(),
            cc,
            channel,
            min_value: min,
            max_value: max,
        }
    }

    #[test]
    fn test_cc_scaling_min() {
        let atomic = make_atomic(0.5);
        let mut reg = MappingRegistry::new();
        reg.register_target("synth.cutoff", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("synth.cutoff", 74, None, 20.0, 20000.0));
        reg.dispatch_cc(0, 74, 0);
        let v = atomic.load(Ordering::Relaxed);
        assert!((v - 20.0).abs() < 0.001, "Expected 20.0, got {v}");
    }

    #[test]
    fn test_cc_scaling_max() {
        let atomic = make_atomic(0.0);
        let mut reg = MappingRegistry::new();
        reg.register_target("synth.cutoff", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("synth.cutoff", 74, None, 20.0, 20000.0));
        reg.dispatch_cc(0, 74, 127);
        let v = atomic.load(Ordering::Relaxed);
        assert!((v - 20000.0).abs() < 0.1, "Expected 20000.0, got {v}");
    }

    #[test]
    fn test_cc_scaling_midpoint() {
        let atomic = make_atomic(0.0);
        let mut reg = MappingRegistry::new();
        reg.register_target("p", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("p", 10, None, 0.0, 1.0));
        reg.dispatch_cc(0, 10, 64);
        let v = atomic.load(Ordering::Relaxed);
        let expected = 64.0 / 127.0;
        assert!((v - expected).abs() < 0.001, "Expected {expected}, got {v}");
    }

    #[test]
    fn test_dispatch_no_match_does_nothing() {
        let atomic = make_atomic(0.5);
        let mut reg = MappingRegistry::new();
        reg.register_target("p", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("p", 10, None, 0.0, 1.0));
        // Different CC
        reg.dispatch_cc(0, 11, 64);
        let v = atomic.load(Ordering::Relaxed);
        assert!((v - 0.5).abs() < 0.001, "Atomic should be unchanged");
    }

    #[test]
    fn test_dispatch_channel_any() {
        let atomic = make_atomic(0.0);
        let mut reg = MappingRegistry::new();
        reg.register_target("p", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("p", 10, None, 0.0, 1.0));
        // channel = None means match all
        reg.dispatch_cc(5, 10, 127);
        assert!((atomic.load(Ordering::Relaxed) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_dispatch_channel_specific_match() {
        let atomic = make_atomic(0.0);
        let mut reg = MappingRegistry::new();
        reg.register_target("p", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("p", 10, Some(5), 0.0, 1.0));
        reg.dispatch_cc(5, 10, 127);
        assert!((atomic.load(Ordering::Relaxed) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_dispatch_channel_specific_no_match() {
        let atomic = make_atomic(0.0);
        let mut reg = MappingRegistry::new();
        reg.register_target("p", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("p", 10, Some(5), 0.0, 1.0));
        // CC on wrong channel
        reg.dispatch_cc(3, 10, 127);
        assert!((atomic.load(Ordering::Relaxed) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_add_mapping_overwrites_same_param() {
        let atomic = make_atomic(0.0);
        let mut reg = MappingRegistry::new();
        reg.register_target("p", Arc::clone(&atomic));
        reg.add_mapping(make_mapping("p", 10, None, 0.0, 1.0));
        reg.add_mapping(make_mapping("p", 20, None, 0.0, 2.0)); // replace
        assert_eq!(reg.mappings.len(), 1);
        assert_eq!(reg.mappings[0].cc, 20);
        assert!((reg.mappings[0].max_value - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_remove_mapping_returns_true_when_present() {
        let mut reg = MappingRegistry::new();
        reg.add_mapping(make_mapping("p", 10, None, 0.0, 1.0));
        assert!(reg.remove_mapping("p"));
        assert!(reg.mappings.is_empty());
    }

    #[test]
    fn test_remove_mapping_returns_false_when_absent() {
        let mut reg = MappingRegistry::new();
        assert!(!reg.remove_mapping("nonexistent"));
    }

    #[test]
    fn test_load_mappings_preserves_targets() {
        let atomic = make_atomic(0.0);
        let mut reg = MappingRegistry::new();
        reg.register_target("p", Arc::clone(&atomic));
        reg.load_mappings(vec![make_mapping("p", 10, None, 0.0, 1.0)]);
        reg.dispatch_cc(0, 10, 127);
        assert!((atomic.load(Ordering::Relaxed) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_dispatch_no_target_does_not_panic() {
        let mut reg = MappingRegistry::new();
        // Mapping exists but no registered target
        reg.add_mapping(make_mapping("orphan", 10, None, 0.0, 1.0));
        // Should not panic
        reg.dispatch_cc(0, 10, 64);
    }
}
