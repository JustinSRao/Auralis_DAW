//! Automation playback engine.
//!
//! [`AutomationEngine`] is an [`AudioNode`] that must be the **first node added to
//! the audio graph** so that parameter values are written before downstream
//! instrument nodes read them in the same callback.
//!
//! The engine reads the authoritative playhead position from [`TransportAtomics`]
//! (written by the [`TransportClock`](crate::audio::transport::TransportClock)) and
//! evaluates all enabled lanes at that tick position, writing results to
//! registered `Arc<AtomicF32>` targets.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use atomic_float::AtomicF32;
use crossbeam_channel::Receiver;

use crate::audio::graph::AudioNode;
use crate::audio::transport::TransportAtomics;

use super::lane::{AutomationLane, Interp};
use super::record::AutomationRecordEvent;

/// Type alias for a parameter identifier string (e.g. `"synth.cutoff"`).
pub type ParameterId = String;

/// Commands sent to [`AutomationEngine`] via its dedicated bounded channel.
///
/// The channel is drained at the top of every `process()` call, so commands
/// take effect within one audio buffer period (≤ 6 ms at default settings).
pub enum AutomationCommand {
    /// Load or replace an automation lane.
    SetLane(AutomationLane),
    /// Remove the lane identified by `(pattern_id, parameter_id)`.
    RemoveLane {
        /// Pattern UUID.
        pattern_id: String,
        /// Parameter key.
        parameter_id: String,
    },
    /// Apply a batch of record events into the active lane for each parameter.
    FlushRecordEvents(Vec<AutomationRecordEvent>),
    /// Enable or disable record capture mode.
    SetRecordEnabled(bool),
    /// Notify the engine of an explicit seek (tick derived from `TransportAtomics`).
    ///
    /// This is a no-op in the current implementation because the engine always
    /// reads the tick from `TransportAtomics.playhead_samples`.  Kept for API
    /// compatibility with future seek-reset needs.
    SetCurrentTick(u64),
    /// Register an `Arc<AtomicF32>` write target for the given parameter id.
    ///
    /// Called after an instrument is instantiated so the engine knows where to
    /// write evaluated values.
    RegisterTarget {
        /// Parameter key matching an `AutomationLane::parameter_id`.
        parameter_id: String,
        /// Shared atomic owned by the instrument's parameter store.
        target: Arc<AtomicF32>,
    },
}

/// Audio node that evaluates automation lanes and writes parameter values each callback.
///
/// This node produces **no audio output** — it leaves the `output` buffer
/// unchanged and only performs atomic writes to registered parameter targets.
pub struct AutomationEngine {
    /// Active lanes keyed by `"pattern_id::parameter_id"`.
    lanes: HashMap<String, AutomationLane>,
    /// Write targets keyed by `parameter_id`.
    targets: HashMap<ParameterId, Arc<AtomicF32>>,
    /// Shared transport atomics — supplies playhead position and BPM.
    transport: TransportAtomics,
    /// Command receiver; drained at the start of every `process()`.
    cmd_rx: Receiver<AutomationCommand>,
    /// Whether record mode is currently active.
    record_enabled: bool,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Builds the HashMap key for a `(pattern_id, parameter_id)` pair.
#[inline]
fn lane_key(pattern_id: &str, parameter_id: &str) -> String {
    format!("{}::{}", pattern_id, parameter_id)
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

impl AutomationEngine {
    /// Creates a new `AutomationEngine`.
    ///
    /// `transport` is a cheap clone of the shared [`TransportAtomics`] (all
    /// fields are `Arc<Atomic*>`).  `cmd_rx` is the receiving end of a
    /// `crossbeam_channel::bounded(256)` channel whose sender lives in
    /// `AutomationCmdTxState` managed state.
    pub fn new(transport: TransportAtomics, cmd_rx: Receiver<AutomationCommand>) -> Self {
        Self {
            lanes: HashMap::with_capacity(16),
            targets: HashMap::with_capacity(16),
            transport,
            cmd_rx,
            record_enabled: false,
        }
    }

    /// Converts the authoritative sample position to ticks (480 PPQN).
    #[inline]
    fn playhead_tick(&self) -> u64 {
        let playhead_samples =
            self.transport.playhead_samples.load(Ordering::Relaxed);
        let samples_per_beat =
            f64::from_bits(self.transport.samples_per_beat_bits.load(Ordering::Relaxed));
        if samples_per_beat < 1.0 {
            return 0;
        }
        const TICKS_PER_BEAT: f64 = 480.0;
        let samples_per_tick = samples_per_beat / TICKS_PER_BEAT;
        (playhead_samples as f64 / samples_per_tick) as u64
    }

    /// Drains the command channel and applies all pending commands.
    ///
    /// Called at the top of every `process()`. Uses `try_recv` — never blocks.
    fn drain_commands(&mut self) {
        while let Ok(cmd) = self.cmd_rx.try_recv() {
            match cmd {
                AutomationCommand::SetLane(lane) => {
                    let key = lane_key(&lane.pattern_id, &lane.parameter_id);
                    self.lanes.insert(key, lane);
                }
                AutomationCommand::RemoveLane { pattern_id, parameter_id } => {
                    let key = lane_key(&pattern_id, &parameter_id);
                    self.lanes.remove(&key);
                }
                AutomationCommand::FlushRecordEvents(events) => {
                    for evt in events {
                        // Insert the event into every matching lane
                        // (parameter_id match, enabled).  Pattern-scoping is
                        // enforced by the frontend sending only relevant parameter_ids.
                        for lane in self.lanes.values_mut() {
                            if lane.parameter_id == evt.parameter_id && lane.enabled {
                                lane.insert_point(
                                    evt.tick,
                                    evt.value,
                                    Interp::Linear,
                                );
                            }
                        }
                    }
                }
                AutomationCommand::SetRecordEnabled(enabled) => {
                    self.record_enabled = enabled;
                }
                AutomationCommand::SetCurrentTick(_) => {
                    // No-op: tick is derived from TransportAtomics each callback.
                }
                AutomationCommand::RegisterTarget { parameter_id, target } => {
                    self.targets.insert(parameter_id, target);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// AudioNode impl
// ---------------------------------------------------------------------------

impl AudioNode for AutomationEngine {
    /// Drains commands, evaluates all enabled lanes at the current transport tick,
    /// and writes results to registered `Arc<AtomicF32>` targets.
    ///
    /// Does **not** write to `output` — this is a pure parameter-write node.
    fn process(&mut self, _output: &mut [f32], _sample_rate: u32, _channels: u16) {
        self.drain_commands();

        let tick = self.playhead_tick();

        for lane in self.lanes.values() {
            if !lane.enabled {
                continue;
            }
            if let Some(value) = lane.evaluate(tick) {
                if let Some(target) = self.targets.get(&lane.parameter_id) {
                    target.store(value, Ordering::Relaxed);
                }
            }
        }
    }

    fn name(&self) -> &str {
        "AutomationEngine"
    }
}
