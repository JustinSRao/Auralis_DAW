use std::sync::Arc;

use crate::instruments::sampler::decoder::SampleBuffer;
use crate::instruments::sampler::voice::SamplerVoice;
use crate::instruments::sampler::zone::SamplerParams;

/// Number of simultaneous voices per pad.
///
/// Two voices handle the case where a fast pattern retriggers a pad before the
/// previous hit has fully decayed (e.g., 32nd-note rolls). The second voice
/// starts while the first is still in its release phase.
const PAD_VOICES: usize = 2;

/// A single drum pad: a named sample slot with a two-voice playback pool.
///
/// Sample playback reuses `SamplerVoice` from Sprint 7. Drum hits are one-shot
/// (no looping); the voice silences itself when it reaches the end of the
/// buffer, so `note_off` is never called after a trigger.
///
/// Velocity is applied as a scalar to the voice's output, independent of the
/// shared `SamplerParams` volume so that per-step dynamics are preserved.
pub struct DrumPad {
    /// Fixed two-voice pool — never reallocated after construction.
    voices: [SamplerVoice; PAD_VOICES],
    /// Per-voice velocity scale (0.0–1.0) set at trigger time.
    velocity_scales: [f32; PAD_VOICES],
    /// The loaded sample buffer, or `None` if no sample is assigned.
    pub buffer: Option<Arc<SampleBuffer>>,
    /// Human-readable pad name (typically the source filename).
    pub name: String,
}

impl DrumPad {
    /// Creates a new, silent pad with no loaded sample.
    pub fn new() -> Self {
        Self {
            voices: [SamplerVoice::new(), SamplerVoice::new()],
            velocity_scales: [1.0; PAD_VOICES],
            buffer: None,
            name: String::new(),
        }
    }

    /// Returns `true` if a sample is currently loaded.
    pub fn has_sample(&self) -> bool {
        self.buffer.is_some()
    }

    /// Loads a new sample buffer, replacing any previously loaded sample.
    pub fn load_sample(&mut self, name: String, buffer: Arc<SampleBuffer>) {
        self.name = name;
        self.buffer = Some(buffer);
    }

    /// Triggers a one-shot hit at the given velocity (1–127).
    ///
    /// Prefers a free voice; if both are busy, voice 0 is restarted (oldest
    /// voice steal). The velocity maps linearly to an amplitude scale:
    /// 127 → 1.0, 64 → ~0.5, 1 → ~0.008.
    ///
    /// Does nothing if no sample is loaded.
    pub fn trigger(&mut self, velocity: u8, sample_rate: f32) {
        let buffer = match &self.buffer {
            Some(b) => Arc::clone(b),
            None => return,
        };

        // Find a free voice, or steal voice 0 (oldest)
        let idx = self
            .voices
            .iter()
            .position(|v| v.is_free())
            .unwrap_or(0);

        // played_note == root_note (60) → pitch ratio 1.0, no transposition
        self.voices[idx].note_on(60, 60, buffer, 0, 0, false, sample_rate);
        self.velocity_scales[idx] = velocity as f32 / 127.0;
    }

    /// Renders a single stereo frame [L, R] from all active voices.
    ///
    /// The `params` supply the ADSR envelope shape and master volume;
    /// each voice's output is additionally scaled by its velocity.
    pub fn render(&mut self, sample_rate: f32, params: &SamplerParams) -> [f32; 2] {
        let mut l = 0.0_f32;
        let mut r = 0.0_f32;

        for (i, voice) in self.voices.iter_mut().enumerate() {
            if !voice.is_free() {
                let [vl, vr] = voice.render(sample_rate, params);
                l += vl * self.velocity_scales[i];
                r += vr * self.velocity_scales[i];
            }
        }

        [l, r]
    }
}

impl Default for DrumPad {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instruments::sampler::decoder::SampleBuffer;
    use crate::instruments::sampler::zone::SamplerParams;

    fn make_buffer(frames: usize) -> Arc<SampleBuffer> {
        let mut samples = vec![0.0f32; frames * 2];
        for i in 0..frames {
            let v = (i as f32 / frames as f32) * 2.0 - 1.0;
            samples[i * 2] = v;
            samples[i * 2 + 1] = v;
        }
        Arc::new(SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: frames,
        })
    }

    fn drum_params() -> Arc<SamplerParams> {
        use std::sync::atomic::Ordering;
        let p = SamplerParams::new();
        p.attack.store(0.001, Ordering::Relaxed);
        p.decay.store(0.001, Ordering::Relaxed);
        p.sustain.store(1.0, Ordering::Relaxed);
        p.release.store(0.05, Ordering::Relaxed);
        p.volume.store(1.0, Ordering::Relaxed);
        p
    }

    #[test]
    fn test_new_pad_no_sample() {
        let pad = DrumPad::new();
        assert!(!pad.has_sample(), "New pad should have no sample");
        assert!(pad.name.is_empty());
    }

    #[test]
    fn test_trigger_without_sample_does_nothing() {
        let mut pad = DrumPad::new();
        let params = drum_params();
        // Trigger with no sample — must not panic
        pad.trigger(100, 44100.0);
        let [l, r] = pad.render(44100.0, &params);
        assert_eq!(l, 0.0, "No sample → silence");
        assert_eq!(r, 0.0, "No sample → silence");
    }

    #[test]
    fn test_load_sample_sets_name_and_buffer() {
        let mut pad = DrumPad::new();
        let buf = make_buffer(1024);
        pad.load_sample("kick.wav".to_string(), buf);
        assert!(pad.has_sample());
        assert_eq!(pad.name, "kick.wav");
    }

    #[test]
    fn test_trigger_produces_audio() {
        let mut pad = DrumPad::new();
        let params = drum_params();
        pad.load_sample("kick.wav".to_string(), make_buffer(4096));
        pad.trigger(100, 44100.0);

        let mut total_energy = 0.0_f32;
        for _ in 0..4096 {
            let [l, r] = pad.render(44100.0, &params);
            total_energy += l.abs() + r.abs();
        }
        assert!(
            total_energy > 1e-4,
            "Triggered pad should produce audio, got energy {}",
            total_energy
        );
    }

    #[test]
    fn test_velocity_affects_amplitude() {
        let mut pad_loud = DrumPad::new();
        let mut pad_soft = DrumPad::new();
        let params = drum_params();

        let buf = make_buffer(4096);
        pad_loud.load_sample("kick.wav".to_string(), Arc::clone(&buf));
        pad_soft.load_sample("kick.wav".to_string(), Arc::clone(&buf));

        pad_loud.trigger(127, 44100.0); // full velocity
        pad_soft.trigger(32, 44100.0); // quiet

        // Measure a single frame
        let [ll, _] = pad_loud.render(44100.0, &params);
        let [sl, _] = pad_soft.render(44100.0, &params);

        // loud should be louder than soft
        assert!(
            ll.abs() > sl.abs(),
            "Higher velocity should produce louder output: loud={}, soft={}",
            ll,
            sl
        );
    }

    #[test]
    fn test_two_voices_active_simultaneously() {
        let mut pad = DrumPad::new();
        let _params = drum_params();
        let buf = make_buffer(8192);
        pad.load_sample("hihat.wav".to_string(), Arc::clone(&buf));

        // Trigger twice in quick succession — both voices should be active
        pad.trigger(100, 44100.0);
        pad.trigger(100, 44100.0);

        // Both voices should produce audio (neither is free yet)
        let active = pad.voices.iter().filter(|v| !v.is_free()).count();
        assert_eq!(active, 2, "Both voices should be active after double-trigger");
    }
}
