use std::sync::atomic::Ordering;

use super::envelope::Envelope;
use super::filter::BiquadFilter;
use super::oscillator::{Oscillator, Waveform};
use super::params::SynthParams;

/// A single polyphonic voice in the synthesizer.
///
/// Each voice owns its oscillator, amplitude envelope, filter envelope, and filter.
/// Voices are never dynamically allocated — the synth holds a fixed array of 8.
pub struct SynthVoice {
    /// The MIDI note currently playing, or `None` if this voice is free.
    pub note: Option<u8>,
    /// The `global_age` value at the moment this voice was triggered (note-on timestamp).
    /// Voice stealing selects the voice with the smallest age (i.e., triggered longest ago).
    pub age: u64,
    /// Phase-accumulator oscillator.
    oscillator: Oscillator,
    /// Amplitude ADSR envelope.
    amplitude_env: Envelope,
    /// Filter modulation ADSR envelope (shares ADSR times with amplitude env).
    filter_env: Envelope,
    /// Biquad low-pass filter.
    filter: BiquadFilter,
}

impl SynthVoice {
    /// Creates a new idle voice.
    pub fn new() -> Self {
        Self {
            note: None,
            age: 0,
            oscillator: Oscillator::new(),
            amplitude_env: Envelope::new(),
            filter_env: Envelope::new(),
            filter: BiquadFilter::new(),
        }
    }

    /// Triggers a note-on for the given MIDI note number.
    ///
    /// Resets the oscillator phase to 0 and triggers both envelopes.
    /// `_sample_rate` is accepted for future use (pitch glide, etc.).
    pub fn note_on(&mut self, note: u8, _sample_rate: f32) {
        self.note = Some(note);
        self.oscillator.reset();
        self.amplitude_env.note_on();
        self.filter_env.note_on();
    }

    /// Triggers release on both envelopes.
    pub fn note_off(&mut self) {
        self.amplitude_env.note_off();
        self.filter_env.note_off();
    }

    /// Returns `true` if this voice's amplitude envelope is idle (voice is free to steal).
    pub fn is_free(&self) -> bool {
        self.amplitude_env.is_idle()
    }

    /// Renders one sample for this voice, reading parameters atomically from `params`.
    ///
    /// Returns the output sample, or 0.0 if the voice just became idle this tick.
    pub fn render(&mut self, sample_rate: f32, params: &SynthParams) -> f32 {
        // Read all params with Relaxed ordering — audio thread, no sync needed
        let waveform_f = params.waveform.load(Ordering::Relaxed);
        let attack = params.attack.load(Ordering::Relaxed);
        let decay = params.decay.load(Ordering::Relaxed);
        let sustain = params.sustain.load(Ordering::Relaxed);
        let release = params.release.load(Ordering::Relaxed);
        let cutoff = params.cutoff.load(Ordering::Relaxed);
        let resonance = params.resonance.load(Ordering::Relaxed);
        let env_amount = params.env_amount.load(Ordering::Relaxed);
        let volume = params.volume.load(Ordering::Relaxed);
        let detune = params.detune.load(Ordering::Relaxed);
        let pulse_width = params.pulse_width.load(Ordering::Relaxed);

        let waveform = Waveform::from_f32(waveform_f);

        // Compute frequency from MIDI note + detune cents
        let note = match self.note {
            Some(n) => n,
            None => return 0.0,
        };
        let semitones = note as f32 - 69.0 + detune / 100.0;
        let frequency = 440.0 * (semitones / 12.0).exp2();

        // Oscillator
        let osc_out = self.oscillator.tick(frequency, sample_rate, waveform, pulse_width);

        // Amplitude envelope
        let amp = self.amplitude_env.tick(sample_rate, attack, decay, sustain, release);

        // Filter envelope (same ADSR times)
        let filter_env_level = self.filter_env.tick(sample_rate, attack, decay, sustain, release);

        // Modulate cutoff: exponential scaling over up to 4 octaves
        let modulated_cutoff = (cutoff * (env_amount * filter_env_level * 4.0).exp2())
            .clamp(20.0, 20000.0);

        // Filter
        let filtered = self.filter.process(sample_rate, modulated_cutoff, resonance, osc_out);

        // Clear note reference once the voice is fully silent
        if self.amplitude_env.is_idle() {
            self.note = None;
        }

        filtered * amp * volume
    }
}

impl Default for SynthVoice {
    fn default() -> Self {
        Self::new()
    }
}
