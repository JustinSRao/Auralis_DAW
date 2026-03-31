//! Group bus channel strip (Sprint 42).
//!
//! A `GroupBus` is a named, numbered mixer bus that accepts contributions from
//! multiple `MixerChannel`s and/or other group buses, applies a full signal
//! chain (fader, pan, mute, solo), then routes its output to either the master
//! bus or another group bus.
//!
//! ## Buffer lifecycle (per audio callback)
//!
//! 1. `clear_input()` — called by `Mixer::process` at the start of each callback.
//! 2. `accumulate(buffer)` — called once per assigned channel / upstream bus.
//! 3. `process(send_bufs, solo_any)` — applies fader/pan/mute/solo to the
//!    accumulated input; result is in `output_scratch`.
//! 4. Caller (`Mixer::process`) scatters `output_scratch` to the next target.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use atomic_float::AtomicF32;
use std::sync::atomic::AtomicBool;

use super::channel::MixerChannel;
use super::routing::{GroupBusId, OutputTarget, MAX_GROUP_BUSES};

/// Pre-allocated buffer capacity: 4096 stereo frames (covers any realistic
/// buffer size up to 4096 without reallocation).
const BUF_CAPACITY: usize = 4096 * 2;

/// A group bus channel strip.
///
/// Wraps a `MixerChannel` for its signal-processing path and adds an
/// `input_accumulator` buffer that receives contributions from assigned
/// channels and upstream buses.
pub struct GroupBus {
    /// Unique identifier (0–7).
    pub id: GroupBusId,
    /// Human-readable name (e.g. "Drums", "Vocals").
    pub name: String,
    /// Signal chain: fader, pan, mute, solo, peak metering.
    pub channel: MixerChannel,
    /// Routing target for this bus's output (encoded as u8; see `OutputTarget`).
    pub output_target: Arc<std::sync::atomic::AtomicU8>,
    /// Accumulated stereo input from assigned sources this callback.
    pub input_accumulator: Vec<f32>,
    /// Pre-allocated output buffer written by `process()`.
    pub(super) output_scratch: Vec<f32>,
}

impl GroupBus {
    /// Creates a new `GroupBus` with the given `id` and `name`.
    ///
    /// Both `input_accumulator` and `output_scratch` are pre-allocated to
    /// `BUF_CAPACITY` so the audio callback never allocates.
    pub fn new(id: GroupBusId, name: impl Into<String>) -> Self {
        let channel_id = format!("group-bus-{}", id);
        let name_str: String = name.into();
        Self {
            id,
            name: name_str.clone(),
            channel: MixerChannel::new(channel_id, name_str),
            output_target: Arc::new(std::sync::atomic::AtomicU8::new(OutputTarget::Master.to_u8())),
            input_accumulator: vec![0.0; BUF_CAPACITY],
            output_scratch: vec![0.0; BUF_CAPACITY],
        }
    }

    /// Clears the input accumulator at the start of each audio callback.
    #[inline]
    pub fn clear_input(&mut self) {
        self.input_accumulator.fill(0.0);
    }

    /// Accumulates `buffer` into `input_accumulator`.
    ///
    /// Called once per assigned source channel or upstream group bus.
    #[inline]
    pub fn accumulate(&mut self, buffer: &[f32]) {
        let n = self.input_accumulator.len().min(buffer.len());
        for i in 0..n {
            self.input_accumulator[i] += buffer[i];
        }
    }

    /// Reads from `input` (provided by the caller to avoid borrow aliasing),
    /// runs the `MixerChannel` signal chain, and writes the result into
    /// `output_scratch`.
    ///
    /// The caller must pass a slice that was copied from `self.input_accumulator`
    /// into a separate buffer to avoid mutable aliasing.
    pub fn process(
        &mut self,
        input: &[f32],
        send_bufs: &mut [Vec<f32>],
        solo_any: bool,
    ) {
        self.output_scratch.fill(0.0);
        self.channel.process_into(input, &mut self.output_scratch, send_bufs, solo_any);
    }

    /// Returns the current `OutputTarget` for this bus.
    pub fn output_target(&self) -> OutputTarget {
        OutputTarget::from_u8(self.output_target.load(Ordering::Relaxed))
    }
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_bus() -> GroupBus {
        GroupBus::new(0, "Test Bus")
    }

    fn silence(n_frames: usize) -> Vec<f32> {
        vec![0.0; n_frames * 2]
    }

    fn constant(n_frames: usize, val: f32) -> Vec<f32> {
        vec![val; n_frames * 2]
    }

    #[test]
    fn new_defaults_to_master_output() {
        let bus = make_bus();
        assert_eq!(bus.output_target(), OutputTarget::Master);
    }

    #[test]
    fn clear_input_zeros_accumulator() {
        let mut bus = make_bus();
        bus.input_accumulator[0] = 1.0;
        bus.clear_input();
        assert!(bus.input_accumulator.iter().all(|&s| s == 0.0));
    }

    #[test]
    fn accumulate_sums_contributions() {
        let mut bus = make_bus();
        bus.clear_input();
        bus.accumulate(&constant(8, 0.4));
        bus.accumulate(&constant(8, 0.3));
        for i in 0..16 {
            assert!((bus.input_accumulator[i] - 0.7).abs() < 1e-5,
                "expected 0.7 at index {}", i);
        }
    }

    #[test]
    fn process_zero_channels_produces_silence() {
        let mut bus = make_bus();
        bus.clear_input();
        let input = silence(256);
        let mut send_bufs = vec![vec![0.0f32; 512]; 4];
        bus.process(&input, &mut send_bufs, false);
        assert!(bus.output_scratch[..512].iter().all(|&s| s.abs() < 1e-6));
    }

    #[test]
    fn process_passes_signal_with_unity_fader() {
        let mut bus = make_bus();
        bus.clear_input();
        let input = constant(8, 1.0);
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        bus.process(&input[..16], &mut send_bufs, false);
        // Equal-power pan at center: each channel ≈ cos(π/4) ≈ 0.707
        let gain = std::f32::consts::FRAC_PI_4.cos();
        assert!((bus.output_scratch[0] - gain).abs() < 1e-4);
    }

    #[test]
    fn process_mute_produces_silence() {
        let mut bus = make_bus();
        bus.channel.mute.store(true, Ordering::Relaxed);
        let input = constant(8, 1.0);
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        bus.process(&input[..16], &mut send_bufs, false);
        assert!(bus.output_scratch[..16].iter().all(|&s| s.abs() < 1e-6));
    }

    #[test]
    fn process_fader_zero_produces_silence() {
        let mut bus = make_bus();
        bus.channel.fader.store(0.0, Ordering::Relaxed);
        let input = constant(8, 1.0);
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        bus.process(&input[..16], &mut send_bufs, false);
        assert!(bus.output_scratch[..16].iter().all(|&s| s.abs() < 1e-6));
    }
}
