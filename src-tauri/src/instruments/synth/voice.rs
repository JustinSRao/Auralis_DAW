use super::envelope::Envelope;
use super::filter::BiquadFilter;
use super::oscillator::{Oscillator, Waveform};
use super::lfo::destination;

/// Parameters passed to `SynthVoice::render` on every sample.
///
/// Callers snapshot atomics once per buffer (outside the per-sample loop) and
/// build this struct for each sample, filling in the current LFO outputs.
/// This avoids repeated atomic loads on the hot path.
pub struct RenderParams {
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
    /// Base filter cutoff in Hz before LFO modulation.
    pub cutoff: f32,
    /// Base filter resonance (0.0–1.0) before LFO modulation.
    pub resonance: f32,
    /// Filter envelope modulation amount (0.0–1.0).
    pub env_amount: f32,
    /// Master output volume (0.0–1.0).
    pub volume: f32,
    /// Oscillator detune in cents.
    pub detune: f32,
    /// Square wave pulse width (0.05–0.95).
    pub pulse_width: f32,
    /// Current LFO 1 output in `[-1.0, 1.0]`.
    pub lfo1_out: f32,
    /// Current LFO 2 output in `[-1.0, 1.0]`.
    pub lfo2_out: f32,
    /// LFO 1 depth (0.0–1.0).
    pub lfo1_depth: f32,
    /// LFO 2 depth (0.0–1.0).
    pub lfo2_depth: f32,
    /// LFO 1 destination: 0=Cutoff, 1=Pitch, 2=Amplitude, 3=Resonance.
    pub lfo1_dest: u8,
    /// LFO 2 destination: 0=Cutoff, 1=Pitch, 2=Amplitude, 3=Resonance.
    pub lfo2_dest: u8,
}

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

    /// Renders one sample for this voice using the pre-built `RenderParams`.
    ///
    /// Applies per-sample LFO modulation to pitch, cutoff, amplitude, and/or resonance
    /// depending on each LFO's `dest` field. Returns the output sample, or 0.0 if the
    /// voice just became idle this tick.
    pub fn render(&mut self, sample_rate: f32, params: &RenderParams) -> f32 {
        let waveform = Waveform::from_f32(params.waveform);

        let note = match self.note {
            Some(n) => n,
            None => return 0.0,
        };

        // --- Pitch modulation (semitone offset) ---
        let mut pitch_offset_semitones = params.detune / 100.0;
        apply_lfo_pitch(&mut pitch_offset_semitones, params.lfo1_out, params.lfo1_depth, params.lfo1_dest);
        apply_lfo_pitch(&mut pitch_offset_semitones, params.lfo2_out, params.lfo2_depth, params.lfo2_dest);

        let semitones = note as f32 - 69.0 + pitch_offset_semitones;
        let frequency = 440.0 * (semitones / 12.0).exp2();

        // --- Oscillator ---
        let osc_out = self.oscillator.tick(frequency, sample_rate, waveform, params.pulse_width);

        // --- Amplitude envelope ---
        let amp = self.amplitude_env.tick(
            sample_rate,
            params.attack,
            params.decay,
            params.sustain,
            params.release,
        );

        // --- Filter envelope (same ADSR times) ---
        let filter_env_level = self.filter_env.tick(
            sample_rate,
            params.attack,
            params.decay,
            params.sustain,
            params.release,
        );

        // --- Cutoff modulation ---
        let mut effective_cutoff = params.cutoff;
        apply_lfo_cutoff(&mut effective_cutoff, params.lfo1_out, params.lfo1_depth, params.lfo1_dest);
        apply_lfo_cutoff(&mut effective_cutoff, params.lfo2_out, params.lfo2_depth, params.lfo2_dest);

        // Apply filter envelope (exponential, up to 4 octaves)
        let modulated_cutoff = (effective_cutoff * (params.env_amount * filter_env_level * 4.0).exp2())
            .clamp(20.0, 20000.0);

        // --- Resonance modulation ---
        let mut effective_res = params.resonance;
        apply_lfo_resonance(&mut effective_res, params.lfo1_out, params.lfo1_depth, params.lfo1_dest);
        apply_lfo_resonance(&mut effective_res, params.lfo2_out, params.lfo2_depth, params.lfo2_dest);

        // --- Filter ---
        let filtered = self.filter.process(sample_rate, modulated_cutoff, effective_res, osc_out);

        // Clear note reference once the voice is fully silent
        if self.amplitude_env.is_idle() {
            self.note = None;
        }

        // --- Amplitude modulation ---
        let mut output = filtered * amp * params.volume;
        apply_lfo_amplitude(&mut output, params.lfo1_out, params.lfo1_depth, params.lfo1_dest);
        apply_lfo_amplitude(&mut output, params.lfo2_out, params.lfo2_depth, params.lfo2_dest);

        output
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-destination LFO application helpers (inlined for hot-path cleanliness)
// ────────────────────────────────────────────────────────────────────────────

/// Adds a pitch modulation offset (in semitones) if this LFO targets pitch.
///
/// ±2 semitones at full depth (depth=1.0).
#[inline(always)]
fn apply_lfo_pitch(pitch_semitones: &mut f32, lfo_out: f32, depth: f32, dest: u8) {
    if dest == destination::PITCH {
        *pitch_semitones += lfo_out * depth * 2.0;
    }
}

/// Multiplies the cutoff by an LFO-driven factor if this LFO targets cutoff.
#[inline(always)]
fn apply_lfo_cutoff(cutoff: &mut f32, lfo_out: f32, depth: f32, dest: u8) {
    if dest == destination::CUTOFF {
        *cutoff = (*cutoff * (1.0 + lfo_out * depth).max(0.0)).clamp(20.0, 20000.0);
    }
}

/// Scales amplitude by an LFO-driven factor if this LFO targets amplitude.
///
/// Tremolo formula: `output *= (1 - depth * 0.5 * (1 - lfo_out)).max(0)`.
/// At depth=1.0 and lfo_out=-1.0 the signal is silenced; at lfo_out=+1.0 it is unaffected.
#[inline(always)]
fn apply_lfo_amplitude(output: &mut f32, lfo_out: f32, depth: f32, dest: u8) {
    if dest == destination::AMPLITUDE {
        *output *= (1.0 - depth * 0.5 * (1.0 - lfo_out)).max(0.0);
    }
}

/// Adds LFO-driven resonance modulation if this LFO targets resonance.
#[inline(always)]
fn apply_lfo_resonance(resonance: &mut f32, lfo_out: f32, depth: f32, dest: u8) {
    if dest == destination::RESONANCE {
        *resonance = (*resonance + lfo_out * depth * (1.0 - *resonance)).clamp(0.0, 1.0);
    }
}

impl Default for SynthVoice {
    fn default() -> Self {
        Self::new()
    }
}
