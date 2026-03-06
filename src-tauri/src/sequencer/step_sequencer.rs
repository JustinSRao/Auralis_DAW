use std::sync::atomic::{AtomicBool, AtomicI8, AtomicU8, Ordering};
use std::sync::Arc;

use crossbeam_channel::{Receiver, Sender};

use crate::audio::graph::AudioNode;
use crate::audio::transport::TransportAtomics;
use crate::midi::types::{MidiEvent, TimestampedMidiEvent};

use super::clock::SequencerClock;
use super::step::{SequencerStep, MAX_SEQ_STEPS};

/// Lock-free parameters shared between the Tauri command thread and the audio thread.
///
/// Written by Tauri command handlers and read by the audio thread on every buffer.
pub struct SequencerAtomics {
    /// Whether the sequencer clock is currently advancing.
    pub is_playing: Arc<AtomicBool>,
    /// Index of the step that fired most recently (0-based).
    pub current_step: Arc<AtomicU8>,
    /// Number of active steps in the pattern (16, 32, or 64).
    pub pattern_length: Arc<AtomicU8>,
    /// Step time division as a note-value denominator (4=quarter, 8=eighth, 16=sixteenth, 32=thirty-second).
    pub time_div: Arc<AtomicU8>,
    /// Global semitone transpose offset applied to all step notes (−24..+24).
    pub transpose: Arc<AtomicI8>,
}

impl SequencerAtomics {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            is_playing: Arc::new(AtomicBool::new(false)),
            current_step: Arc::new(AtomicU8::new(0)),
            pattern_length: Arc::new(AtomicU8::new(16)),
            time_div: Arc::new(AtomicU8::new(16)),
            transpose: Arc::new(AtomicI8::new(0)),
        })
    }
}

/// Discrete commands sent from Tauri command handlers to the audio thread.
pub enum SequencerCommand {
    /// Replace the data for a single step at the given index.
    SetStep { idx: u8, step: SequencerStep },
    /// Change the active pattern length (1–64 steps).
    SetLength { length: u8 },
    /// Change the step time division (4, 8, 16, or 32).
    SetTimeDiv { div: u8 },
    /// Set the global semitone transpose offset (−24..+24).
    SetTranspose { semitones: i8 },
    /// Wire the sequencer output to an instrument's MIDI event sender.
    SetInstrumentTx { tx: Sender<TimestampedMidiEvent> },
    /// Start the step clock.
    Play,
    /// Pause the step clock (preserves clock position).
    Stop,
    /// Stop playback and reset the clock to step 0.
    Reset,
}

/// MIDI step sequencer implementing AudioNode.
///
/// On each audio buffer the step clock checks whether one or more step
/// boundaries fall within the current window.
///
/// Real-time safety: no heap alloc, no mutex, no blocking on audio thread.
pub struct StepSequencer {
    steps: [SequencerStep; MAX_SEQ_STEPS],
    clock: SequencerClock,
    atomics: Arc<SequencerAtomics>,
    cmd_rx: Receiver<SequencerCommand>,
    step_event_tx: Sender<u8>,
    instrument_tx: Option<Sender<TimestampedMidiEvent>>,
    pending_note_off: Option<(u8, u64)>,
    lcg_state: u32,
    transport_atomics: TransportAtomics,
    sample_rate: f32,
    is_playing: bool,
}

impl StepSequencer {
    /// Creates a new StepSequencer.
    pub fn new(
        atomics: Arc<SequencerAtomics>,
        cmd_rx: Receiver<SequencerCommand>,
        step_event_tx: Sender<u8>,
        transport_atomics: TransportAtomics,
        sample_rate: f32,
    ) -> Self {
        let pattern_length = atomics.pattern_length.load(Ordering::Relaxed);
        let mut clock = SequencerClock::new();
        clock.pattern_length = pattern_length;
        Self {
            steps: std::array::from_fn(|_| SequencerStep::default()),
            clock,
            atomics,
            cmd_rx,
            step_event_tx,
            instrument_tx: None,
            pending_note_off: None,
            lcg_state: 0xDEAD_BEEF,
            transport_atomics,
            sample_rate,
            is_playing: false,
        }
    }

    fn apply_commands(&mut self) {
        while let Ok(cmd) = self.cmd_rx.try_recv() {
            match cmd {
                SequencerCommand::SetStep { idx, step } => {
                    if (idx as usize) < MAX_SEQ_STEPS {
                        self.steps[idx as usize] = step;
                    }
                }
                SequencerCommand::SetLength { length } => {
                    let clamped = length.clamp(1, MAX_SEQ_STEPS as u8);
                    self.clock.pattern_length = clamped;
                    self.atomics.pattern_length.store(clamped, Ordering::Relaxed);
                }
                SequencerCommand::SetTimeDiv { div } => {
                    let valid = match div { 4 | 8 | 16 | 32 => div, _ => 16 };
                    self.atomics.time_div.store(valid, Ordering::Relaxed);
                }
                SequencerCommand::SetTranspose { semitones } => {
                    self.atomics.transpose.store(semitones, Ordering::Relaxed);
                }
                SequencerCommand::SetInstrumentTx { tx } => {
                    self.instrument_tx = Some(tx);
                }
                SequencerCommand::Play => {
                    self.is_playing = true;
                    self.atomics.is_playing.store(true, Ordering::Relaxed);
                }
                SequencerCommand::Stop => {
                    self.is_playing = false;
                    self.atomics.is_playing.store(false, Ordering::Relaxed);
                }
                SequencerCommand::Reset => {
                    self.is_playing = false;
                    self.atomics.is_playing.store(false, Ordering::Relaxed);
                    self.clock.reset();
                    self.atomics.current_step.store(0, Ordering::Relaxed);
                    self.pending_note_off = None;
                }
            }
        }
    }

    /// Advances the LCG and returns true if the step should fire.
    fn prob_fires(&mut self, probability: u8) -> bool {
        if probability == 0 { return false; }
        if probability >= 100 { return true; }
        self.lcg_state = self.lcg_state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((self.lcg_state as u64 * 100 / u32::MAX as u64) as u8) < probability
    }

    fn send_note_off(&self, note: u8) {
        if let Some(ref tx) = self.instrument_tx {
            let _ = tx.try_send(TimestampedMidiEvent {
                event: MidiEvent::NoteOff { channel: 0, note, velocity: 0 },
                timestamp_us: 0,
            });
        }
    }

    fn send_note_on(&self, note: u8, velocity: u8) {
        if let Some(ref tx) = self.instrument_tx {
            let _ = tx.try_send(TimestampedMidiEvent {
                event: MidiEvent::NoteOn { channel: 0, note, velocity },
                timestamp_us: 0,
            });
        }
    }
}

impl AudioNode for StepSequencer {
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        self.sample_rate = sample_rate as f32;
        let ch = channels as usize;
        let frames = if ch > 0 { output.len() / ch } else { output.len() };

        self.apply_commands();

        if let Some((note, countdown)) = self.pending_note_off {
            if countdown <= frames as u64 {
                self.send_note_off(note);
                self.pending_note_off = None;
            } else {
                self.pending_note_off = Some((note, countdown - frames as u64));
            }
        }

        if self.is_playing {
            let spb_bits = self.transport_atomics.samples_per_beat_bits.load(Ordering::Relaxed);
            let spb = f64::from_bits(spb_bits);
            let bpm = (self.sample_rate as f64 * 60.0) / spb.max(1.0);
            let raw_div = self.atomics.time_div.load(Ordering::Relaxed);
            let time_div_factor = raw_div as f32 / 4.0;
            let transpose = self.atomics.transpose.load(Ordering::Relaxed);

            let fired = self.clock.advance(frames as u64, bpm, time_div_factor, self.sample_rate);

            for step_idx in fired.iter() {
                let step = self.steps[step_idx as usize];
                if !step.enabled { continue; }
                if !self.prob_fires(step.probability) { continue; }

                let raw_note = step.note as i16 + transpose as i16;
                let note = raw_note.clamp(0, 127) as u8;

                // Flush any existing pending note-off before issuing a new note-on.
                // This prevents stuck notes when two steps fire within the same buffer
                // (which can happen at high BPM with large buffer sizes).
                if let Some((prev_note, _)) = self.pending_note_off.take() {
                    self.send_note_off(prev_note);
                }

                self.send_note_on(note, step.velocity);

                let step_dur = SequencerClock::step_duration(bpm, time_div_factor, self.sample_rate);
                let gate_samples = ((step.gate.clamp(0.0, 1.0) as f64) * step_dur as f64).max(1.0) as u64;
                self.pending_note_off = Some((note, gate_samples));

                let _ = self.step_event_tx.try_send(step_idx);
            }

            self.atomics.current_step.store(self.clock.current_step, Ordering::Relaxed);
        }
    }

    fn name(&self) -> &str {
        "StepSequencer"
    }
}

unsafe impl Send for StepSequencer {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::transport::TransportAtomics;
    use crossbeam_channel::bounded;

    fn make_sequencer() -> (
        StepSequencer,
        Sender<SequencerCommand>,
        crossbeam_channel::Receiver<u8>,
        crossbeam_channel::Receiver<TimestampedMidiEvent>,
    ) {
        let atomics = SequencerAtomics::new();
        let (cmd_tx, cmd_rx) = bounded::<SequencerCommand>(64);
        let (step_tx, step_rx) = bounded::<u8>(32);
        let (midi_tx, midi_rx) = bounded::<TimestampedMidiEvent>(256);
        let transport = TransportAtomics::new(120.0, 44100);
        let mut seq = StepSequencer::new(atomics, cmd_rx, step_tx, transport, 44100.0);
        seq.instrument_tx = Some(midi_tx);
        (seq, cmd_tx, step_rx, midi_rx)
    }

    fn process_frames(seq: &mut StepSequencer, frames: usize) {
        let mut buf = vec![0.0f32; frames * 2];
        seq.process(&mut buf, 44100, 2);
    }

    #[test]
    fn test_no_fire_when_stopped() {
        let (mut seq, _cmd_tx, _step_rx, midi_rx) = make_sequencer();
        seq.steps[0] = SequencerStep { enabled: true, note: 60, velocity: 100, gate: 0.8, probability: 100 };
        process_frames(&mut seq, 8192);
        assert!(midi_rx.try_recv().is_err());
    }

    #[test]
    fn test_fires_note_on_enabled_step() {
        let (mut seq, cmd_tx, _step_rx, midi_rx) = make_sequencer();
        seq.steps[0] = SequencerStep { enabled: true, note: 60, velocity: 100, gate: 0.8, probability: 100 };
        cmd_tx.send(SequencerCommand::Play).unwrap();
        process_frames(&mut seq, 1);
        let ev = midi_rx.try_recv().unwrap();
        match ev.event {
            MidiEvent::NoteOn { note, velocity, .. } => { assert_eq!(note, 60); assert_eq!(velocity, 100); }
            other => panic!("expected NoteOn got {:?}", other),
        }
    }

    #[test]
    fn test_disabled_step_silent() {
        let (mut seq, cmd_tx, _step_rx, midi_rx) = make_sequencer();
        cmd_tx.send(SequencerCommand::Play).unwrap();
        process_frames(&mut seq, 1);
        assert!(midi_rx.try_recv().is_err());
    }

    #[test]
    fn test_probability_zero_never_fires() {
        let (mut seq, cmd_tx, _step_rx, midi_rx) = make_sequencer();
        seq.steps[0] = SequencerStep { enabled: true, note: 60, velocity: 100, gate: 0.8, probability: 0 };
        cmd_tx.send(SequencerCommand::Play).unwrap();
        for _ in 0..100 { process_frames(&mut seq, 1); }
        let mut note_on_count = 0;
        while let Ok(ev) = midi_rx.try_recv() {
            if let MidiEvent::NoteOn { .. } = ev.event { note_on_count += 1; }
        }
        assert_eq!(note_on_count, 0);
    }

    #[test]
    fn test_probability_100_always_fires() {
        let (mut seq, cmd_tx, _step_rx, midi_rx) = make_sequencer();
        seq.steps[0] = SequencerStep { enabled: true, note: 60, velocity: 100, gate: 0.01, probability: 100 };
        cmd_tx.send(SequencerCommand::Play).unwrap();
        process_frames(&mut seq, 1);
        let ev = midi_rx.try_recv().unwrap();
        assert!(matches!(ev.event, MidiEvent::NoteOn { .. }));
    }

    #[test]
    fn test_transpose_shifts_pitch() {
        let (mut seq, cmd_tx, _step_rx, midi_rx) = make_sequencer();
        seq.steps[0] = SequencerStep { enabled: true, note: 60, velocity: 100, gate: 0.8, probability: 100 };
        seq.atomics.transpose.store(12, Ordering::Relaxed);
        cmd_tx.send(SequencerCommand::Play).unwrap();
        process_frames(&mut seq, 1);
        let ev = midi_rx.try_recv().unwrap();
        match ev.event {
            MidiEvent::NoteOn { note, .. } => assert_eq!(note, 72),
            other => panic!("expected NoteOn got {:?}", other),
        }
    }

    #[test]
    fn test_gate_note_off_arrives() {
        let (mut seq, cmd_tx, _step_rx, midi_rx) = make_sequencer();
        seq.steps[0] = SequencerStep { enabled: true, note: 60, velocity: 100, gate: 0.5, probability: 100 };
        cmd_tx.send(SequencerCommand::Play).unwrap();
        process_frames(&mut seq, 1);
        let ev = midi_rx.try_recv().unwrap();
        assert!(matches!(ev.event, MidiEvent::NoteOn { .. }));
        process_frames(&mut seq, 2756);
        let ev2 = midi_rx.try_recv().unwrap();
        assert!(matches!(ev2.event, MidiEvent::NoteOff { .. }));
    }
}
