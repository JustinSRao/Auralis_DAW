//! Metronome click track audio node.
//!
//! [`MetronomeNode`] is a standard [`AudioNode`] that reads the current
//! playhead position and BPM from [`TransportAtomics`] and produces a short
//! sine burst on each beat boundary. Beat 1 of every bar is accented.
//!
//! The node is always present in the initial [`AudioGraph`]; it outputs silence
//! when disabled or when the transport is not playing.

use std::f32::consts::PI;
use std::sync::atomic::Ordering;

use super::graph::AudioNode;
use super::transport::TransportAtomics;

/// Duration of each click burst in milliseconds.
const CLICK_BURST_MS: f32 = 20.0;

/// MetronomeNode: generates an audible click track synchronized to the transport.
///
/// # Real-time safety
///
/// This node reads from [`TransportAtomics`] using atomic loads only — no
/// allocations, no blocking, no mutexes. All float values are encoded as
/// `f64::to_bits` in `AtomicU64` (decode with `f64::from_bits`).
///
/// # Click characteristics
///
/// - Beat 1 of each bar: amplitude = `volume × 0.9` (accent)
/// - All other beats: amplitude = `volume × 0.5`
/// - Waveform: sine wave at `pitch_hz` Hz
/// - Envelope: linear decay from full amplitude to zero over `CLICK_BURST_MS`
pub struct MetronomeNode {
    /// Shared transport atomics (read-only on audio thread).
    atomics: TransportAtomics,
    /// Last known sample rate, used to compute burst length.
    sample_rate: u32,
    /// Sine phase accumulator (0.0..1.0).
    click_phase: f32,
    /// Samples remaining in the current burst.
    click_remaining: u32,
    /// Amplitude for the current burst (accent vs. regular).
    click_amplitude: f32,
    /// Beat index at which the last click was triggered (prevents re-firing).
    last_beat_index: u64,
    /// Pre-computed burst length in samples.
    burst_samples: u32,
}

impl MetronomeNode {
    /// Creates a new `MetronomeNode` sharing the given [`TransportAtomics`].
    pub fn new(atomics: TransportAtomics, sample_rate: u32) -> Self {
        let burst_samples = burst_length_samples(sample_rate);
        Self {
            atomics,
            sample_rate,
            click_phase: 0.0,
            click_remaining: 0,
            click_amplitude: 0.0,
            last_beat_index: u64::MAX, // ensures the first beat always triggers
            burst_samples,
        }
    }
}

impl AudioNode for MetronomeNode {
    /// Processes one audio buffer.
    ///
    /// Detects beat boundaries by comparing the current beat index (derived
    /// from `playhead_samples / samples_per_beat`) against the last triggered
    /// beat index. When a new beat starts, a sine burst is fired.
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        // Recompute burst length if sample rate changed
        if sample_rate != self.sample_rate {
            self.sample_rate = sample_rate;
            self.burst_samples = burst_length_samples(sample_rate);
        }

        let enabled = self.atomics.metronome_enabled.load(Ordering::Acquire);
        let is_playing = self.atomics.is_playing.load(Ordering::Acquire);

        if !enabled || !is_playing {
            for s in output.iter_mut() {
                *s = 0.0;
            }
            self.click_remaining = 0;
            return;
        }

        // Read shared transport state (all atomic loads — no blocking)
        let playhead = self.atomics.playhead_samples.load(Ordering::Acquire);
        let spb = f64::from_bits(
            self.atomics.samples_per_beat_bits.load(Ordering::Acquire),
        );
        let beats_per_bar =
            self.atomics.time_sig_numerator.load(Ordering::Acquire) as u64;
        let volume = f64::from_bits(
            self.atomics.metronome_volume_bits.load(Ordering::Acquire),
        ) as f32;
        let pitch_hz = f64::from_bits(
            self.atomics.metronome_pitch_bits.load(Ordering::Acquire),
        ) as f32;

        // Guard against divide-by-zero (engine not yet fully configured)
        if spb < 1.0 {
            for s in output.iter_mut() {
                *s = 0.0;
            }
            return;
        }

        // Compute the beat index at the start of this buffer
        let current_beat_index = (playhead as f64 / spb) as u64;

        // Fire a click if we've crossed a beat boundary
        if current_beat_index != self.last_beat_index {
            self.last_beat_index = current_beat_index;
            self.click_remaining = self.burst_samples;
            self.click_phase = 0.0;

            // Accent beat 1 of each bar (beat index 0 within bar)
            let beat_within_bar = current_beat_index % beats_per_bar.max(1);
            self.click_amplitude = if beat_within_bar == 0 {
                (volume * 0.9).min(1.0)
            } else {
                volume * 0.5
            };
        }

        let ch = channels as usize;
        let phase_inc = pitch_hz / sample_rate as f32;

        for frame in output.chunks_exact_mut(ch) {
            let sample = if self.click_remaining > 0 {
                // Linear decay envelope
                let envelope =
                    self.click_remaining as f32 / self.burst_samples as f32;
                let s =
                    (self.click_phase * 2.0 * PI).sin() * self.click_amplitude * envelope;
                self.click_phase += phase_inc;
                if self.click_phase >= 1.0 {
                    self.click_phase -= 1.0;
                }
                self.click_remaining -= 1;
                s
            } else {
                0.0
            };

            for ch_sample in frame.iter_mut() {
                *ch_sample = sample;
            }
        }
    }

    fn name(&self) -> &str {
        "MetronomeNode"
    }
}

/// Calculates click burst length in samples for a given sample rate.
#[inline]
fn burst_length_samples(sample_rate: u32) -> u32 {
    ((sample_rate as f32 * CLICK_BURST_MS) / 1000.0) as u32
}

// ---------------------------------------------------------------------------
// Unit tests (no audio hardware required)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::transport::TransportAtomics;
    use std::sync::atomic::Ordering;

    fn make_node(bpm: f64, sample_rate: u32) -> MetronomeNode {
        let atomics = TransportAtomics::new(bpm, sample_rate);
        MetronomeNode::new(atomics, sample_rate)
    }

    fn make_node_with_atomics(
        bpm: f64,
        sample_rate: u32,
    ) -> (MetronomeNode, TransportAtomics) {
        let atomics = TransportAtomics::new(bpm, sample_rate);
        let node = MetronomeNode::new(atomics.clone(), sample_rate);
        (node, atomics)
    }

    #[test]
    fn test_metronome_disabled_produces_silence() {
        let (mut node, atomics) = make_node_with_atomics(120.0, 44100);
        // metronome_enabled defaults to false
        atomics.is_playing.store(true, Ordering::Release);
        let mut output = vec![1.0f32; 256];
        node.process(&mut output, 44100, 1);
        assert!(output.iter().all(|&s| s == 0.0), "Disabled metronome should silence output");
    }

    #[test]
    fn test_metronome_stopped_produces_silence() {
        let (mut node, atomics) = make_node_with_atomics(120.0, 44100);
        atomics.metronome_enabled.store(true, Ordering::Release);
        // is_playing stays false (default)
        let mut output = vec![1.0f32; 256];
        node.process(&mut output, 44100, 1);
        assert!(output.iter().all(|&s| s == 0.0), "Stopped transport should silence metronome");
    }

    #[test]
    fn test_metronome_fires_on_first_beat() {
        let (mut node, atomics) = make_node_with_atomics(120.0, 44100);
        atomics.metronome_enabled.store(true, Ordering::Release);
        atomics.is_playing.store(true, Ordering::Release);
        // playhead at 0 (start of beat 0)
        atomics.playhead_samples.store(0, Ordering::Release);

        let mut output = vec![0.0f32; 256];
        node.process(&mut output, 44100, 1);

        // The first beat should have triggered a click — some samples should be nonzero
        let has_click = output.iter().any(|&s| s.abs() > 0.001);
        assert!(has_click, "First beat should produce a click burst");
    }

    #[test]
    fn test_metronome_does_not_refire_within_beat() {
        let (mut node, atomics) = make_node_with_atomics(120.0, 44100);
        atomics.metronome_enabled.store(true, Ordering::Release);
        atomics.is_playing.store(true, Ordering::Release);
        atomics.playhead_samples.store(0, Ordering::Release);

        // First buffer — fires a click
        let mut output1 = vec![0.0f32; 256];
        node.process(&mut output1, 44100, 1);

        // Second buffer — same beat (beat index 0), playhead advanced 256 samples
        // 22050 samples per beat at 120 BPM, so 256 samples is still beat 0
        atomics.playhead_samples.store(256, Ordering::Release);
        let mut output2 = vec![0.0f32; 256];
        node.process(&mut output2, 44100, 1);

        // The second buffer may contain tail of the first click, but no new accent
        // We check that last_beat_index is still 0 (not re-triggered)
        assert_eq!(node.last_beat_index, 0, "Should not re-trigger within same beat");
    }

    #[test]
    fn test_beat1_accent_is_louder() {
        let (mut node, atomics) = make_node_with_atomics(120.0, 44100);
        atomics.metronome_enabled.store(true, Ordering::Release);
        atomics.is_playing.store(true, Ordering::Release);
        // Set volume to 1.0 for easier math
        atomics
            .metronome_volume_bits
            .store(1.0_f64.to_bits(), Ordering::Release);

        // Beat 0 (bar 1, beat 1): accent amplitude should be 0.9
        atomics.playhead_samples.store(0, Ordering::Release);
        let mut output = vec![0.0f32; 1];
        node.process(&mut output, 44100, 1);
        let accent_amp = node.click_amplitude;

        // Beat 1: amplitude should be 0.5
        // Advance to beat 1 by setting playhead to samples_per_beat (22050 at 120 BPM)
        node.last_beat_index = u64::MAX; // reset to allow re-trigger for test
        atomics.playhead_samples.store(22050, Ordering::Release);
        node.process(&mut output, 44100, 1);
        let regular_amp = node.click_amplitude;

        assert!(
            accent_amp > regular_amp,
            "Accent (beat 1) amplitude {} should be louder than regular {} ",
            accent_amp,
            regular_amp
        );
    }

    #[test]
    fn test_burst_length_samples() {
        // 20ms at 44100 Hz = 882 samples
        assert_eq!(burst_length_samples(44100), 882);
        // 20ms at 48000 Hz = 960 samples
        assert_eq!(burst_length_samples(48000), 960);
    }

    #[test]
    fn test_node_name() {
        let node = make_node(120.0, 44100);
        assert_eq!(node.name(), "MetronomeNode");
    }
}
