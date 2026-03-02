pub mod envelope;
pub mod filter;
pub mod oscillator;
pub mod params;
pub mod voice;

use std::sync::Arc;

use crossbeam_channel::Receiver;

use crate::audio::graph::AudioNode;
use crate::midi::types::{MidiEvent, TimestampedMidiEvent};

use params::SynthParams;
use voice::SynthVoice;

/// Maximum number of simultaneous voices.
const MAX_VOICES: usize = 8;

/// 8-voice polyphonic subtractive synthesizer.
///
/// Implements `AudioNode` so it can be inserted into the audio graph.
/// MIDI events are drained from a dedicated crossbeam channel at the top
/// of each audio buffer — real-time safe, no allocations, no mutexes.
///
/// Voice stealing: when all 8 voices are active and a new note arrives,
/// the voice with the smallest `age` value (i.e., the one that has been
/// playing the longest) is stolen.
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
}

impl SubtractiveSynth {
    /// Creates a new synth with the given shared parameters and MIDI receiver.
    pub fn new(
        params: Arc<SynthParams>,
        midi_rx: Receiver<TimestampedMidiEvent>,
        sample_rate: f32,
    ) -> Self {
        Self {
            voices: std::array::from_fn(|_| SynthVoice::new()),
            params,
            midi_rx,
            sample_rate,
            global_age: 0,
        }
    }

    /// Finds a free voice. Returns the index, or `None` if all voices are active.
    fn find_free_voice(&self) -> Option<usize> {
        self.voices.iter().position(|v| v.is_free())
    }

    /// Steals the oldest active voice (the one with the smallest `age` value).
    ///
    /// The oldest voice is the one that has been playing the longest, because
    /// `age` is stamped on note-on and the global counter grows forward.
    /// We find the voice with the *minimum* age among those with a note.
    fn steal_voice(&self) -> usize {
        self.voices
            .iter()
            .enumerate()
            .filter(|(_, v)| v.note.is_some())
            .min_by_key(|(_, v)| v.age)
            .map(|(i, _)| i)
            .unwrap_or(0) // Fallback: steal voice 0 if somehow all are free
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
    }

    fn handle_note_off(&mut self, note: u8) {
        for voice in &mut self.voices {
            if voice.note == Some(note) {
                voice.note_off();
            }
        }
    }
}

impl AudioNode for SubtractiveSynth {
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        self.sample_rate = sample_rate as f32;

        // 1. Drain MIDI events — non-blocking, real-time safe
        while let Ok(msg) = self.midi_rx.try_recv() {
            self.handle_midi_event(&msg.event);
        }

        // 2. Render active voices into the output buffer
        let ch = channels as usize;
        let frames = output.len() / ch;

        for frame_idx in 0..frames {
            let mut mix = 0.0f32;

            for voice in &mut self.voices {
                if !voice.is_free() || voice.note.is_some() {
                    mix += voice.render(self.sample_rate, &self.params);
                }
            }

            // Write the same mono mix to all channels
            for ch_idx in 0..ch {
                output[frame_idx * ch + ch_idx] += mix;
            }
        }

        // 3. Advance global age counter
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
    use crossbeam_channel::bounded;

    fn make_synth() -> (SubtractiveSynth, crossbeam_channel::Sender<TimestampedMidiEvent>) {
        let params = SynthParams::new();
        let (tx, rx) = bounded(256);
        let synth = SubtractiveSynth::new(params, rx, 44100.0);
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
}
