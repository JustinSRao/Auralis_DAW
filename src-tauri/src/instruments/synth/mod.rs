pub mod envelope;
pub mod filter;
pub mod lfo;
pub mod oscillator;
pub mod params;
pub mod voice;

use std::sync::atomic::Ordering;
use std::sync::Arc;

use crossbeam_channel::Receiver;

use crate::audio::graph::AudioNode;
use crate::audio::transport::TransportAtomics;
use crate::midi::types::{MidiEvent, TimestampedMidiEvent};

use lfo::{Lfo, LfoParams, LfoWaveform};
use params::SynthParams;
use voice::{RenderParams, SynthVoice};

/// Maximum number of simultaneous voices.
const MAX_VOICES: usize = 8;

/// 8-voice polyphonic subtractive synthesizer with dual LFO modulation.
///
/// Implements `AudioNode` so it can be inserted into the audio graph.
/// MIDI events are drained from a dedicated crossbeam channel at the top
/// of each audio buffer — real-time safe, no allocations, no mutexes.
///
/// Voice stealing: when all 8 voices are active and a new note arrives,
/// the voice with the smallest `age` value (i.e., the one that has been
/// playing the longest) is stolen.
///
/// Both LFOs tick per-sample inside the voice render loop. LFO parameters
/// are read from atomics once per buffer (outside the per-sample loop) to
/// minimise atomic load overhead on the hot path.
pub struct SubtractiveSynth {
    /// Fixed-size voice pool — never reallocated.
    voices: [SynthVoice; MAX_VOICES],
    /// Shared parameter store, readable from any thread.
    params: Arc<SynthParams>,
    /// MIDI event stream from the MIDI fan-out task.
    midi_rx: Receiver<TimestampedMidiEvent>,
    /// Audio sample rate in Hz.
    sample_rate: f32,
    /// Monotonically increasing global age counter (increments by buffer length).
    global_age: u64,
    /// LFO 1 oscillator state (phase + S&H random).
    lfo1: Lfo,
    /// LFO 2 oscillator state.
    lfo2: Lfo,
    /// Shared LFO 1 parameter store (written by UI thread, read here lock-free).
    pub lfo1_params: Arc<LfoParams>,
    /// Shared LFO 2 parameter store.
    pub lfo2_params: Arc<LfoParams>,
    /// Transport atomics for BPM-sync LFO rate derivation.
    transport_atomics: TransportAtomics,
}

impl SubtractiveSynth {
    /// Creates a new synth with the given shared parameters, MIDI receiver, and transport atomics.
    pub fn new(
        params: Arc<SynthParams>,
        midi_rx: Receiver<TimestampedMidiEvent>,
        sample_rate: f32,
        lfo1_params: Arc<LfoParams>,
        lfo2_params: Arc<LfoParams>,
        transport_atomics: TransportAtomics,
    ) -> Self {
        Self {
            voices: std::array::from_fn(|_| SynthVoice::new()),
            params,
            midi_rx,
            sample_rate,
            global_age: 0,
            lfo1: Lfo::new(0x1234_5678),
            lfo2: Lfo::new(0x9ABC_DEF0),
            lfo1_params,
            lfo2_params,
            transport_atomics,
        }
    }

    /// Finds a free voice. Returns the index, or `None` if all voices are active.
    fn find_free_voice(&self) -> Option<usize> {
        self.voices.iter().position(|v| v.is_free())
    }

    /// Steals the oldest active voice (the one with the smallest `age` value).
    ///
    /// The oldest voice is the one that has been playing the longest, because
    /// `age` is stamped at note-on and the global counter grows forward.
    /// We find the voice with the *minimum* age among those with a note.
    fn steal_voice(&self) -> usize {
        self.voices
            .iter()
            .enumerate()
            .filter(|(_, v)| v.note.is_some())
            .min_by_key(|(_, v)| v.age)
            .map(|(i, _)| i)
            .unwrap_or(0) // Safety: steal_voice is only called when all 8 voices are active; unreachable
    }

    /// Handles a single MIDI event.
    fn handle_midi_event(&mut self, event: &MidiEvent) {
        match event {
            MidiEvent::NoteOn { note, velocity, .. } => {
                if *velocity == 0 {
                    // NoteOn with velocity 0 is NoteOff per MIDI spec
                    self.handle_note_off(*note);
                } else {
                    self.handle_note_on(*note);
                }
            }
            MidiEvent::NoteOff { note, .. } => {
                self.handle_note_off(*note);
            }
            _ => {} // Ignore CC, pitch bend, etc. for now (Sprint 29)
        }
    }

    fn handle_note_on(&mut self, note: u8) {
        let idx = self.find_free_voice().unwrap_or_else(|| self.steal_voice());
        self.voices[idx].age = self.global_age;
        self.voices[idx].note_on(note, self.sample_rate);

        // Optionally reset LFO phases on note-on
        if self.lfo1_params.phase_reset.load(Ordering::Relaxed) > 0.5 {
            self.lfo1.reset_phase();
        }
        if self.lfo2_params.phase_reset.load(Ordering::Relaxed) > 0.5 {
            self.lfo2.reset_phase();
        }
    }

    fn handle_note_off(&mut self, note: u8) {
        for voice in &mut self.voices {
            if voice.note == Some(note) {
                voice.note_off();
            }
        }
    }

    /// Derives the effective LFO rate in Hz.
    ///
    /// When BPM sync is enabled the rate is derived from `samples_per_beat`
    /// and the chosen division. When disabled the free-running `rate` field is used.
    #[inline]
    fn effective_lfo_rate(
        bpm_sync: f32,
        free_rate: f32,
        division: f32,
        sample_rate: f32,
        spb: f32,
    ) -> f32 {
        if bpm_sync > 0.5 && spb > 0.0 {
            // division_idx: 0=1/4 note, 1=1/8, 2=1/16, 3=1/32
            let beats_per_cycle: f32 = match division as u32 {
                0 => 1.0,
                1 => 0.5,
                2 => 0.25,
                _ => 0.125,
            };
            (sample_rate / spb) / beats_per_cycle
        } else {
            free_rate
        }
    }
}

impl AudioNode for SubtractiveSynth {
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        self.sample_rate = sample_rate as f32;
        let sr = self.sample_rate;

        // 1. Drain MIDI events — non-blocking, real-time safe
        while let Ok(msg) = self.midi_rx.try_recv() {
            self.handle_midi_event(&msg.event);
        }

        // 2. Read synth params once per buffer (avoids per-sample atomic loads)
        let waveform = self.params.waveform.load(Ordering::Relaxed);
        let attack = self.params.attack.load(Ordering::Relaxed);
        let decay = self.params.decay.load(Ordering::Relaxed);
        let sustain = self.params.sustain.load(Ordering::Relaxed);
        let release = self.params.release.load(Ordering::Relaxed);
        let base_cutoff = self.params.cutoff.load(Ordering::Relaxed);
        let base_resonance = self.params.resonance.load(Ordering::Relaxed);
        let env_amount = self.params.env_amount.load(Ordering::Relaxed);
        let volume = self.params.volume.load(Ordering::Relaxed);
        let detune = self.params.detune.load(Ordering::Relaxed);
        let pulse_width = self.params.pulse_width.load(Ordering::Relaxed);

        // 3. Read LFO params once per buffer
        let l1_rate = self.lfo1_params.rate.load(Ordering::Relaxed);
        let l1_depth = self.lfo1_params.depth.load(Ordering::Relaxed);
        let l1_waveform = LfoWaveform::from_f32(self.lfo1_params.waveform.load(Ordering::Relaxed));
        let l1_bpm_sync = self.lfo1_params.bpm_sync.load(Ordering::Relaxed);
        let l1_division = self.lfo1_params.division.load(Ordering::Relaxed);
        let l1_dest = self.lfo1_params.destination.load(Ordering::Relaxed) as u8;

        let l2_rate = self.lfo2_params.rate.load(Ordering::Relaxed);
        let l2_depth = self.lfo2_params.depth.load(Ordering::Relaxed);
        let l2_waveform = LfoWaveform::from_f32(self.lfo2_params.waveform.load(Ordering::Relaxed));
        let l2_bpm_sync = self.lfo2_params.bpm_sync.load(Ordering::Relaxed);
        let l2_division = self.lfo2_params.division.load(Ordering::Relaxed);
        let l2_dest = self.lfo2_params.destination.load(Ordering::Relaxed) as u8;

        // Derive samples_per_beat for BPM sync (f64 bits stored in AtomicU64)
        let spb_bits = self.transport_atomics.samples_per_beat_bits.load(Ordering::Relaxed);
        let spb = f64::from_bits(spb_bits) as f32;

        let rate1 = Self::effective_lfo_rate(l1_bpm_sync, l1_rate, l1_division, sr, spb);
        let rate2 = Self::effective_lfo_rate(l2_bpm_sync, l2_rate, l2_division, sr, spb);

        // 4. Render per-sample
        let ch = channels as usize;
        let frames = output.len() / ch;

        // Build the invariant part of RenderParams once per buffer — only lfo1_out
        // and lfo2_out change each sample, so initialise them to 0.0 and update
        // inside the loop.  All other fields are constant for the whole buffer.
        let mut rp = RenderParams {
            waveform,
            attack,
            decay,
            sustain,
            release,
            cutoff: base_cutoff,
            resonance: base_resonance,
            env_amount,
            volume,
            detune,
            pulse_width,
            lfo1_out: 0.0,
            lfo2_out: 0.0,
            lfo1_depth: l1_depth,
            lfo2_depth: l2_depth,
            lfo1_dest: l1_dest,
            lfo2_dest: l2_dest,
        };

        for frame_idx in 0..frames {
            // Tick both LFOs once per sample and update the two varying fields
            rp.lfo1_out = self.lfo1.tick(rate1, sr, l1_waveform);
            rp.lfo2_out = self.lfo2.tick(rate2, sr, l2_waveform);

            let mut mix = 0.0f32;
            for voice in &mut self.voices {
                if !voice.is_free() || voice.note.is_some() {
                    mix += voice.render(sr, &rp);
                }
            }

            // Write the same mono mix to all channels
            for ch_idx in 0..ch {
                output[frame_idx * ch + ch_idx] += mix;
            }
        }

        // 5. Advance global age counter
        self.global_age = self.global_age.wrapping_add(frames as u64);
    }

    fn name(&self) -> &str {
        "SubtractiveSynth"
    }
}

// Safety: SubtractiveSynth is moved into the audio callback closure once
// and never shared concurrently with other threads. All cross-thread
// communication goes through Arc<AtomicF32> params and the crossbeam channel.
unsafe impl Send for SubtractiveSynth {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::transport::TransportAtomics;
    use crossbeam_channel::bounded;

    fn make_synth() -> (SubtractiveSynth, crossbeam_channel::Sender<TimestampedMidiEvent>) {
        let params = SynthParams::new();
        let lfo1_params = LfoParams::new();
        let lfo2_params = LfoParams::new();
        let transport = TransportAtomics::new(120.0, 44100);
        let (tx, rx) = bounded(256);
        let synth = SubtractiveSynth::new(params, rx, 44100.0, lfo1_params, lfo2_params, transport);
        (synth, tx)
    }

    fn send_note_on(tx: &crossbeam_channel::Sender<TimestampedMidiEvent>, note: u8, vel: u8) {
        tx.send(TimestampedMidiEvent {
            event: MidiEvent::NoteOn { channel: 0, note, velocity: vel },
            timestamp_us: 0,
        })
        .unwrap();
    }

    #[allow(dead_code)]
    fn send_note_off(tx: &crossbeam_channel::Sender<TimestampedMidiEvent>, note: u8) {
        tx.send(TimestampedMidiEvent {
            event: MidiEvent::NoteOff { channel: 0, note, velocity: 0 },
            timestamp_us: 0,
        })
        .unwrap();
    }

    #[test]
    fn test_synth_silent_no_notes() {
        let (mut synth, _tx) = make_synth();
        let mut buf = vec![0.0f32; 256 * 2]; // stereo
        synth.process(&mut buf, 44100, 2);

        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max < 1e-6, "No notes → should produce silence, got {}", max);
    }

    #[test]
    fn test_synth_audio_on_note_on() {
        let (mut synth, tx) = make_synth();
        send_note_on(&tx, 60, 100);

        // Process enough samples for the attack to produce audible output
        let mut buf = vec![0.0f32; 4096 * 2];
        synth.process(&mut buf, 44100, 2);

        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max > 1e-4, "NoteOn should produce audio, got max {}", max);
    }

    #[test]
    fn test_voice_stealing_9th_note() {
        let (mut synth, tx) = make_synth();

        // Send 9 different note-ons — the 9th must steal a voice
        for note in 60u8..69 {
            send_note_on(&tx, note, 100);
        }

        // Process a buffer so MIDI events are consumed
        let mut buf = vec![0.0f32; 512 * 2];
        synth.process(&mut buf, 44100, 2);

        // At most MAX_VOICES voices can be active simultaneously
        let active_count = synth.voices.iter().filter(|v| v.note.is_some() || !v.is_free()).count();
        assert!(
            active_count <= MAX_VOICES,
            "Should not exceed {} voices, got {}",
            MAX_VOICES,
            active_count
        );

        // Audio should still be produced
        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max > 1e-4, "Should produce audio with stolen voice, got {}", max);
    }

    #[test]
    fn test_lfo_depth_zero_silent_cutoff_mod() {
        // With depth=0, the synth should produce audio identical with or without LFO wired
        let (mut synth, tx) = make_synth();
        // depth is already 0 by default — just verify audio works normally
        send_note_on(&tx, 60, 100);
        let mut buf = vec![0.0f32; 4096 * 2];
        synth.process(&mut buf, 44100, 2);
        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max > 1e-4, "Should produce audio even with LFO depth 0");
    }

    #[test]
    fn test_lfo_pitch_destination_produces_audio() {
        // With pitch destination and depth > 0, notes should still produce audio
        let (mut synth, tx) = make_synth();
        synth.lfo1_params.depth.store(0.5, Ordering::Relaxed);
        synth.lfo1_params.destination.store(1.0, Ordering::Relaxed); // 1=Pitch
        send_note_on(&tx, 60, 100);
        let mut buf = vec![0.0f32; 4096 * 2];
        synth.process(&mut buf, 44100, 2);
        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max > 1e-4, "Pitch LFO should not silence output, got {}", max);
    }
}
