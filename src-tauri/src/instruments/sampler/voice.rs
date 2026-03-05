use std::sync::Arc;
use std::sync::atomic::Ordering;

use super::decoder::SampleBuffer;
use super::zone::SamplerParams;
use crate::instruments::synth::envelope::Envelope;

/// Computes the playback pitch ratio for a sampler voice.
///
/// The ratio combines:
/// - Pitch transposition: `2^((played - root) / 12)`
/// - Sample-rate correction: `src_sr / engine_sr`
///
/// Multiply each frame advance by this value to play back at the correct pitch.
pub fn compute_pitch_ratio(played: u8, root: u8, src_sr: u32, engine_sr: f32) -> f64 {
    let semitones = played as f64 - root as f64;
    let pitch_mult = 2.0_f64.powf(semitones / 12.0);
    let sr_ratio = src_sr as f64 / engine_sr as f64;
    pitch_mult * sr_ratio
}

/// A single polyphonic sampler voice.
///
/// Each voice holds a reference to the zone's `SampleBuffer` and advances a
/// fractional frame position by `pitch_ratio` on every sample. Linear
/// interpolation between adjacent frames avoids aliasing artefacts.
///
/// The ADSR envelope is reused from the synth crate to apply amplitude shaping.
pub struct SamplerVoice {
    /// MIDI note currently playing, or `None` if the voice is idle.
    pub note: Option<u8>,
    /// Monotonic age stamp set at note-on (for LRU voice stealing).
    pub age: u64,
    /// Fractional frame position within the zone buffer.
    position: f64,
    /// Advance per sample = `2^(semitones/12) * (src_sr / engine_sr)`.
    pitch_ratio: f64,
    /// ADSR amplitude envelope.
    envelope: Envelope,
    /// Decoded audio buffer for the active zone (Arc shared with the zone store).
    zone_buffer: Option<Arc<SampleBuffer>>,
    /// Loop start frame index (copied from zone at note-on).
    loop_start: usize,
    /// Loop end frame index (copied from zone at note-on).
    loop_end: usize,
    /// Whether looping is enabled (copied from zone at note-on).
    loop_enabled: bool,
}

impl SamplerVoice {
    /// Creates a new idle voice.
    pub fn new() -> Self {
        Self {
            note: None,
            age: 0,
            position: 0.0,
            pitch_ratio: 1.0,
            envelope: Envelope::new(),
            zone_buffer: None,
            loop_start: 0,
            loop_end: 0,
            loop_enabled: false,
        }
    }

    /// Returns `true` if the voice is not currently producing audio.
    pub fn is_free(&self) -> bool {
        self.note.is_none() && self.envelope.is_idle()
    }

    /// Triggers this voice with the given note and zone buffer.
    ///
    /// `root_note` is the zone's root pitch; `played_note` is the actual
    /// MIDI note that triggered this voice.
    pub fn note_on(
        &mut self,
        played_note: u8,
        root_note: u8,
        buffer: Arc<SampleBuffer>,
        loop_start: usize,
        loop_end: usize,
        loop_enabled: bool,
        engine_sr: f32,
    ) {
        self.note = Some(played_note);
        self.position = 0.0;
        self.pitch_ratio = compute_pitch_ratio(played_note, root_note, buffer.sample_rate, engine_sr);
        self.loop_start = loop_start;
        self.loop_end = loop_end;
        self.loop_enabled = loop_enabled;
        self.zone_buffer = Some(buffer);
        self.envelope.note_on();
    }

    /// Starts the release phase for this voice.
    pub fn note_off(&mut self) {
        self.envelope.note_off();
    }

    /// Renders a single stereo frame [L, R] and advances internal state.
    ///
    /// Returns `[0.0, 0.0]` if the voice has no buffer or the envelope is idle.
    /// When the sample reaches its end (non-looped) the envelope is released
    /// and the voice transitions to idle naturally.
    pub fn render(&mut self, sample_rate: f32, params: &SamplerParams) -> [f32; 2] {
        let buffer = match self.zone_buffer.as_ref() {
            Some(b) => b,
            None => return [0.0, 0.0],
        };

        if self.envelope.is_idle() && self.note.is_none() {
            return [0.0, 0.0];
        }

        let frame_count = buffer.frame_count;
        if frame_count == 0 {
            return [0.0, 0.0];
        }

        // Handle loop wrap before reading the sample
        if self.loop_enabled
            && self.loop_end > self.loop_start
            && self.position as usize >= self.loop_end
        {
            let overshoot = self.position - self.loop_end as f64;
            self.position = self.loop_start as f64 + overshoot;
        }

        // End-of-sample (non-looped): release and go idle
        if self.position as usize >= frame_count {
            self.envelope.note_off();
            self.note = None;
            self.zone_buffer = None;
            return [0.0, 0.0];
        }

        let frame_int = self.position as usize;
        let frac = (self.position - frame_int as f64) as f32;
        let next_frame = (frame_int + 1).min(frame_count - 1);

        let s0_l = buffer.samples[frame_int * 2];
        let s0_r = buffer.samples[frame_int * 2 + 1];
        let s1_l = buffer.samples[next_frame * 2];
        let s1_r = buffer.samples[next_frame * 2 + 1];

        let out_l = s0_l + (s1_l - s0_l) * frac;
        let out_r = s0_r + (s1_r - s0_r) * frac;

        self.position += self.pitch_ratio;

        let attack = params.attack.load(Ordering::Relaxed);
        let decay = params.decay.load(Ordering::Relaxed);
        let sustain = params.sustain.load(Ordering::Relaxed);
        let release = params.release.load(Ordering::Relaxed);
        let volume = params.volume.load(Ordering::Relaxed);

        let amp = self.envelope.tick(sample_rate, attack, decay, sustain, release);

        // Clear note ref when envelope finishes
        if self.envelope.is_idle() {
            self.note = None;
            self.zone_buffer = None;
        }

        [out_l * amp * volume, out_r * amp * volume]
    }
}

impl Default for SamplerVoice {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use super::super::decoder::SampleBuffer;

    fn make_buffer(frames: usize) -> Arc<SampleBuffer> {
        let mut samples = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let v = (i as f32 / frames as f32) * 2.0 - 1.0;
            samples.push(v);
            samples.push(v);
        }
        Arc::new(SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: frames,
        })
    }

    #[test]
    fn test_pitch_ratio_unison() {
        // played == root → ratio should equal sr_ratio exactly
        let engine_sr = 44100.0f32;
        let ratio = compute_pitch_ratio(60, 60, 44100, engine_sr);
        let expected = 44100.0 / engine_sr as f64; // = 1.0
        assert!(
            (ratio - expected).abs() < 1e-9,
            "Unison ratio should be {}, got {}",
            expected,
            ratio
        );
    }

    #[test]
    fn test_pitch_ratio_octave_up() {
        // +12 semitones → ratio should be 2× the sr_ratio
        let engine_sr = 44100.0f32;
        let ratio = compute_pitch_ratio(72, 60, 44100, engine_sr);
        let expected = 2.0 * (44100.0 / engine_sr as f64);
        assert!(
            (ratio - expected).abs() < 1e-9,
            "Octave-up ratio should be {}, got {}",
            expected,
            ratio
        );
    }

    #[test]
    fn test_voice_silence_when_idle() {
        let mut voice = SamplerVoice::new();
        let params = SamplerParams::new();
        // No note_on — should produce silence
        let out = voice.render(44100.0, &params);
        assert_eq!(out, [0.0, 0.0], "Idle voice should produce silence");
    }

    #[test]
    fn test_voice_produces_audio_on_note_on() {
        let mut voice = SamplerVoice::new();
        let params = SamplerParams::new();
        let buffer = make_buffer(4096);
        voice.note_on(60, 60, buffer, 0, 0, false, 44100.0);

        let mut got_nonzero = false;
        for _ in 0..4096 {
            let [l, r] = voice.render(44100.0, &params);
            if l.abs() > 1e-6 || r.abs() > 1e-6 {
                got_nonzero = true;
                break;
            }
        }
        assert!(got_nonzero, "Voice should produce non-zero audio after note_on");
    }

    #[test]
    fn test_voice_is_free_before_note_on() {
        let voice = SamplerVoice::new();
        assert!(voice.is_free(), "New voice should be free");
    }
}
