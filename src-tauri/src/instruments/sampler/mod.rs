pub mod decoder;
pub mod voice;
pub mod zone;

use std::sync::Arc;

use crossbeam_channel::Receiver;

use crate::audio::graph::AudioNode;
use crate::midi::types::{MidiEvent, TimestampedMidiEvent};

use decoder::SampleBuffer;
use voice::SamplerVoice;
use zone::{SampleZone, SamplerParams};

/// Maximum number of simultaneous sample voices.
const MAX_VOICES: usize = 8;

/// Maximum number of zones stored in the fixed-size zone array.
pub const MAX_ZONES: usize = 32;

/// Commands sent from Tauri to the audio thread for the sampler.
pub enum SamplerCommand {
    /// Load a new zone (replaces any existing zone with the same id).
    LoadZone {
        id: u32,
        name: String,
        root_note: u8,
        min_note: u8,
        max_note: u8,
        buffer: Arc<SampleBuffer>,
        loop_start: usize,
        loop_end: usize,
        loop_enabled: bool,
    },
    /// Remove a zone by id.
    RemoveZone { id: u32 },
}

/// 8-voice polyphonic sample player.
///
/// Implements `AudioNode` so it can be inserted into the audio graph.
/// Zones are loaded asynchronously via a `crossbeam_channel`; MIDI events
/// are drained at the top of each audio buffer — no allocations, no mutexes.
///
/// Voice stealing: when all 8 voices are busy and a new note arrives, the
/// voice with the smallest `age` stamp (oldest playing voice) is stolen.
pub struct Sampler {
    /// Fixed-size voice pool — never reallocated.
    voices: [SamplerVoice; MAX_VOICES],
    /// Fixed-size zone array — up to 32 zones.
    zones: [Option<SampleZone>; MAX_ZONES],
    /// Shared ADSR + volume parameter store (lock-free atomic reads).
    params: Arc<SamplerParams>,
    /// MIDI event stream from the MIDI fan-out.
    midi_rx: Receiver<TimestampedMidiEvent>,
    /// Zone / lifecycle commands from Tauri commands.
    cmd_rx: Receiver<SamplerCommand>,
    /// Audio sample rate in Hz.
    sample_rate: f32,
    /// Monotonically increasing global age counter (increments by buffer length).
    global_age: u64,
}

impl Sampler {
    /// Creates a new sampler with the given shared parameters, MIDI receiver,
    /// and command receiver.
    pub fn new(
        params: Arc<SamplerParams>,
        midi_rx: Receiver<TimestampedMidiEvent>,
        cmd_rx: Receiver<SamplerCommand>,
        sample_rate: f32,
    ) -> Self {
        Self {
            voices: std::array::from_fn(|_| SamplerVoice::new()),
            zones: std::array::from_fn(|_| None),
            params,
            midi_rx,
            cmd_rx,
            sample_rate,
            global_age: 0,
        }
    }

    // ── Zone management ────────────────────────────────────────────────────────

    /// Finds the first zone whose `[min_note, max_note]` range contains `note`.
    fn find_zone_for_note(&self, note: u8) -> Option<&SampleZone> {
        self.zones
            .iter()
            .filter_map(|opt| opt.as_ref())
            .find(|z| z.min_note <= note && note <= z.max_note)
    }

    fn apply_command(&mut self, cmd: SamplerCommand) {
        match cmd {
            SamplerCommand::LoadZone {
                id, name, root_note, min_note, max_note,
                buffer, loop_start, loop_end, loop_enabled,
            } => {
                // Find the target slot: replace existing id, or first empty slot.
                let target = self.zones.iter().position(|opt| {
                    opt.as_ref().map(|z| z.id) == Some(id)
                }).or_else(|| {
                    self.zones.iter().position(|opt| opt.is_none())
                });

                match target {
                    Some(i) => {
                        self.zones[i] = Some(SampleZone {
                            id, name, root_note, min_note, max_note,
                            buffer, loop_start, loop_end, loop_enabled,
                        });
                    }
                    None => {
                        log::warn!("Sampler: zone array full (max {}), dropping zone {}", MAX_ZONES, id);
                    }
                }
            }
            SamplerCommand::RemoveZone { id } => {
                for slot in &mut self.zones {
                    if slot.as_ref().map(|z| z.id) == Some(id) {
                        *slot = None;
                        break;
                    }
                }
            }
        }
    }

    // ── Voice management ───────────────────────────────────────────────────────

    fn find_free_voice(&self) -> Option<usize> {
        self.voices.iter().position(|v| v.is_free())
    }

    fn steal_voice(&self) -> usize {
        self.voices
            .iter()
            .enumerate()
            .filter(|(_, v)| v.note.is_some())
            .min_by_key(|(_, v)| v.age)
            .map(|(i, _)| i)
            .unwrap_or(0)
    }

    // ── MIDI handling ──────────────────────────────────────────────────────────

    fn handle_midi_event(&mut self, event: &MidiEvent) {
        match event {
            MidiEvent::NoteOn { note, velocity, .. } => {
                if *velocity == 0 {
                    self.handle_note_off(*note);
                } else {
                    self.handle_note_on(*note);
                }
            }
            MidiEvent::NoteOff { note, .. } => {
                self.handle_note_off(*note);
            }
            _ => {}
        }
    }

    fn handle_note_on(&mut self, note: u8) {
        // Find a matching zone first; ignore the note if no zone covers it.
        let zone = match self.find_zone_for_note(note) {
            Some(z) => z,
            None => return,
        };

        let root_note = zone.root_note;
        let buffer = Arc::clone(&zone.buffer);
        let loop_start = zone.loop_start;
        let loop_end = zone.loop_end;
        let loop_enabled = zone.loop_enabled;

        let idx = self.find_free_voice().unwrap_or_else(|| self.steal_voice());
        self.voices[idx].age = self.global_age;
        self.voices[idx].note_on(
            note, root_note, buffer, loop_start, loop_end, loop_enabled, self.sample_rate,
        );
    }

    fn handle_note_off(&mut self, note: u8) {
        for voice in &mut self.voices {
            if voice.note == Some(note) {
                voice.note_off();
            }
        }
    }
}

impl AudioNode for Sampler {
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        self.sample_rate = sample_rate as f32;

        // 1. Drain zone/lifecycle commands — non-blocking
        while let Ok(cmd) = self.cmd_rx.try_recv() {
            self.apply_command(cmd);
        }

        // 2. Drain MIDI events — non-blocking, real-time safe
        while let Ok(msg) = self.midi_rx.try_recv() {
            self.handle_midi_event(&msg.event);
        }

        // 3. Render active voices into the output buffer
        let ch = channels as usize;
        let frames = output.len() / ch.max(1);

        for frame_idx in 0..frames {
            let mut mix_l = 0.0f32;
            let mut mix_r = 0.0f32;

            for voice in &mut self.voices {
                if !voice.is_free() {
                    let [l, r] = voice.render(self.sample_rate, &self.params);
                    mix_l += l;
                    mix_r += r;
                }
            }

            // Write stereo (or mono-duplicated) mix to output channels
            if ch >= 2 {
                output[frame_idx * ch] += mix_l;
                output[frame_idx * ch + 1] += mix_r;
            } else if ch == 1 {
                output[frame_idx] += (mix_l + mix_r) * 0.5;
            }
        }

        // 4. Advance global age counter
        self.global_age = self.global_age.wrapping_add(frames as u64);
    }

    fn name(&self) -> &str {
        "Sampler"
    }
}

// Safety: Sampler is moved into the audio callback closure once and never
// shared concurrently. All cross-thread communication goes through
// Arc<AtomicF32> params and the two crossbeam channels.
unsafe impl Send for Sampler {}

#[cfg(test)]
mod tests {
    use super::*;
    use crossbeam_channel::bounded;
    use zone::SamplerParams;

    fn make_sampler() -> (
        Sampler,
        crossbeam_channel::Sender<TimestampedMidiEvent>,
        crossbeam_channel::Sender<SamplerCommand>,
    ) {
        let params = SamplerParams::new();
        let (midi_tx, midi_rx) = bounded(256);
        let (cmd_tx, cmd_rx) = bounded(64);
        let sampler = Sampler::new(params, midi_rx, cmd_rx, 44100.0);
        (sampler, midi_tx, cmd_tx)
    }

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

    fn load_zone(cmd_tx: &crossbeam_channel::Sender<SamplerCommand>, id: u32, min: u8, max: u8, root: u8) {
        cmd_tx.send(SamplerCommand::LoadZone {
            id,
            name: format!("zone_{}", id),
            root_note: root,
            min_note: min,
            max_note: max,
            buffer: make_buffer(4096),
            loop_start: 0,
            loop_end: 0,
            loop_enabled: false,
        }).unwrap();
    }

    fn send_note_on(midi_tx: &crossbeam_channel::Sender<TimestampedMidiEvent>, note: u8, vel: u8) {
        use crate::midi::types::MidiEvent;
        midi_tx.send(TimestampedMidiEvent {
            event: MidiEvent::NoteOn { channel: 0, note, velocity: vel },
            timestamp_us: 0,
        }).unwrap();
    }

    fn send_note_off(midi_tx: &crossbeam_channel::Sender<TimestampedMidiEvent>, note: u8) {
        use crate::midi::types::MidiEvent;
        midi_tx.send(TimestampedMidiEvent {
            event: MidiEvent::NoteOff { channel: 0, note, velocity: 0 },
            timestamp_us: 0,
        }).unwrap();
    }

    #[test]
    fn test_sampler_silent_no_zones() {
        let (mut sampler, _midi_tx, _cmd_tx) = make_sampler();
        let mut buf = vec![0.0f32; 256 * 2];
        sampler.process(&mut buf, 44100, 2);

        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max < 1e-9, "No zones → silence, got {}", max);
    }

    #[test]
    fn test_sampler_silent_note_with_no_matching_zone() {
        let (mut sampler, midi_tx, _cmd_tx) = make_sampler();
        // No zones loaded; note should produce silence
        send_note_on(&midi_tx, 60, 100);
        let mut buf = vec![0.0f32; 512 * 2];
        sampler.process(&mut buf, 44100, 2);

        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max < 1e-9, "No zones → silence even with note-on, got {}", max);
    }

    #[test]
    fn test_sampler_audio_on_note_on_with_zone() {
        let (mut sampler, midi_tx, cmd_tx) = make_sampler();
        load_zone(&cmd_tx, 0, 0, 127, 60); // full-range zone, root C4
        send_note_on(&midi_tx, 60, 100);

        let mut buf = vec![0.0f32; 4096 * 2];
        sampler.process(&mut buf, 44100, 2);

        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max > 1e-4, "Zone + NoteOn → audio, got {}", max);
    }

    #[test]
    fn test_sampler_voice_stealing() {
        let (mut sampler, midi_tx, cmd_tx) = make_sampler();
        load_zone(&cmd_tx, 0, 0, 127, 60);

        // Fire 9 simultaneous notes — the 9th must steal a voice
        for note in 60u8..69 {
            send_note_on(&midi_tx, note, 100);
        }

        let mut buf = vec![0.0f32; 512 * 2];
        sampler.process(&mut buf, 44100, 2);

        let active = sampler.voices.iter().filter(|v| v.note.is_some() || !v.is_free()).count();
        assert!(active <= MAX_VOICES, "Voice count must not exceed {}, got {}", MAX_VOICES, active);
    }

    #[test]
    fn test_sampler_remove_zone() {
        let (mut sampler, _midi_tx, cmd_tx) = make_sampler();
        load_zone(&cmd_tx, 42, 0, 127, 60);

        // Process one buffer to apply the load command
        let mut buf = vec![0.0f32; 64 * 2];
        sampler.process(&mut buf, 44100, 2);

        // Verify zone is present
        assert!(sampler.zones.iter().any(|s| s.as_ref().map(|z| z.id) == Some(42)));

        // Remove it
        cmd_tx.send(SamplerCommand::RemoveZone { id: 42 }).unwrap();
        sampler.process(&mut buf, 44100, 2);

        assert!(sampler.zones.iter().all(|s| s.as_ref().map(|z| z.id) != Some(42)));
    }
}
