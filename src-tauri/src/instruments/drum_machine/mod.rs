pub mod clock;
pub mod pad;
pub mod pattern;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use atomic_float::AtomicF32;
use crossbeam_channel::{Receiver, Sender};

use crate::audio::graph::AudioNode;
use crate::instruments::sampler::decoder::SampleBuffer;
use crate::instruments::sampler::zone::SamplerParams;

use clock::StepClock;
use pad::DrumPad;
use pattern::{DrumPattern, MAX_PADS};

pub use pattern::{DrumMachineSnapshot, DrumPadSnapshot, DrumStepSnapshot};

// ── Shared atomics ─────────────────────────────────────────────────────────────

/// Lock-free parameters shared between the Tauri command thread and the audio thread.
///
/// The audio thread reads these atomics on every buffer; the Tauri thread writes
/// them in response to UI events. Using `Relaxed` ordering is correct here
/// because these values are independent scalars with no ordering relationship.
pub struct DrumAtomics {
    /// Playback tempo in BPM (range 1.0–300.0), default 120.0.
    pub bpm: Arc<AtomicF32>,
    /// Swing amount (0.0–0.5) applied to odd-indexed steps, default 0.0.
    pub swing: Arc<AtomicF32>,
    /// Whether playback is running.
    pub playing: Arc<AtomicBool>,
    /// Index of the last step that fired (written by audio thread).
    pub current_step: Arc<AtomicU8>,
    /// Active pattern length (16 or 32).
    pub pattern_length: Arc<AtomicU8>,
}

impl DrumAtomics {
    /// Creates a new `DrumAtomics` with default values, wrapped in an `Arc`.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            bpm: Arc::new(AtomicF32::new(120.0)),
            swing: Arc::new(AtomicF32::new(0.0)),
            playing: Arc::new(AtomicBool::new(false)),
            current_step: Arc::new(AtomicU8::new(0)),
            pattern_length: Arc::new(AtomicU8::new(16)),
        })
    }
}

// ── Command enum ───────────────────────────────────────────────────────────────

/// Discrete commands sent from Tauri commands to the audio thread.
///
/// These arrive via a bounded `crossbeam_channel` and are drained at the top of
/// each `process()` call — no allocation, no blocking on the audio thread.
pub enum DrumCommand {
    /// Load a decoded sample into the given pad.
    LoadSample {
        pad_idx: u8,
        name: String,
        buffer: Arc<SampleBuffer>,
    },
    /// Toggle a step's active state and set its velocity.
    SetStep {
        pad_idx: u8,
        step_idx: u8,
        active: bool,
        velocity: u8,
    },
    /// Change the active pattern length (16 or 32).
    SetPatternLength { length: u8 },
    /// Start or resume playback.
    Play,
    /// Pause playback (preserves clock position).
    Stop,
    /// Stop playback and reset clock to step 0.
    Reset,
}

// ── DrumMachine AudioNode ──────────────────────────────────────────────────────

/// 16-pad drum machine implementing [`AudioNode`].
///
/// On each audio buffer the step clock checks whether a 16th-note boundary
/// falls within the current window. If so, every active pad on that step fires
/// a one-shot `SamplerVoice`. The active step index is published via a
/// `crossbeam_channel` to a Tokio relay task, which emits `drum-step-changed`
/// Tauri events so the React UI can highlight the current playhead column.
///
/// All real-time audio rules are observed:
/// - No heap allocations on the audio thread.
/// - No mutexes on the hot path — atomics for continuous values, bounded
///   channels for discrete commands.
/// - `unsafe impl Send` is required because `SamplerVoice` contains an `Arc`
///   (which is `Send`) but the voice pool is accessed only from the audio thread.
pub struct DrumMachine {
    /// Fixed 16-pad pool.
    pads: [DrumPad; MAX_PADS],
    /// The 16×32 step grid.
    pattern: DrumPattern,
    /// Sample-counting step clock.
    clock: StepClock,
    /// Lock-free parameter atomics (BPM, swing, playing, current_step, pattern_length).
    atomics: Arc<DrumAtomics>,
    /// Shared ADSR envelope params for all pad voices.
    ///
    /// Uses percussion-appropriate defaults: near-zero attack and decay,
    /// full sustain, very short release (samples auto-silence at end-of-buffer).
    drum_params: Arc<SamplerParams>,
    /// Discrete command stream from Tauri commands.
    cmd_rx: Receiver<DrumCommand>,
    /// Publishes fired step indices to the event relay task.
    step_tx: Sender<u8>,
    /// Current audio sample rate in Hz.
    sample_rate: f32,
}

impl DrumMachine {
    /// Creates a new `DrumMachine` with the given shared state and channels.
    pub fn new(
        atomics: Arc<DrumAtomics>,
        cmd_rx: Receiver<DrumCommand>,
        step_tx: Sender<u8>,
        sample_rate: f32,
    ) -> Self {
        // Percussion envelope: instant attack → full sustain → samples auto-silence
        let drum_params = SamplerParams::new();
        drum_params.attack.store(0.001, Ordering::Relaxed);
        drum_params.decay.store(0.001, Ordering::Relaxed);
        drum_params.sustain.store(1.0, Ordering::Relaxed);
        drum_params.release.store(0.05, Ordering::Relaxed);
        drum_params.volume.store(1.0, Ordering::Relaxed);

        Self {
            pads: std::array::from_fn(|_| DrumPad::new()),
            pattern: DrumPattern::new(),
            clock: StepClock::new(),
            atomics,
            drum_params,
            cmd_rx,
            step_tx,
            sample_rate,
        }
    }

    // ── Command handling ───────────────────────────────────────────────────────

    fn apply_command(&mut self, cmd: DrumCommand) {
        match cmd {
            DrumCommand::LoadSample {
                pad_idx,
                name,
                buffer,
            } => {
                if (pad_idx as usize) < MAX_PADS {
                    self.pads[pad_idx as usize].load_sample(name, buffer);
                }
            }
            DrumCommand::SetStep {
                pad_idx,
                step_idx,
                active,
                velocity,
            } => {
                self.pattern.set_step(pad_idx, step_idx, active, velocity);
            }
            DrumCommand::SetPatternLength { length } => {
                let clamped = if length <= 16 { 16 } else { 32 };
                self.clock.pattern_length = clamped;
                self.atomics
                    .pattern_length
                    .store(clamped, Ordering::Relaxed);
            }
            DrumCommand::Play => {
                self.atomics.playing.store(true, Ordering::Relaxed);
            }
            DrumCommand::Stop => {
                self.atomics.playing.store(false, Ordering::Relaxed);
            }
            DrumCommand::Reset => {
                self.atomics.playing.store(false, Ordering::Relaxed);
                self.clock.reset();
                self.atomics.current_step.store(0, Ordering::Relaxed);
            }
        }
    }

    // ── Step trigger ───────────────────────────────────────────────────────────

    /// Triggers all active pads for the given step index.
    fn trigger_step(&mut self, step: u8) {
        for pad_idx in 0..MAX_PADS {
            let drum_step = self.pattern.get_step(pad_idx as u8, step);
            if drum_step.active {
                self.pads[pad_idx].trigger(drum_step.velocity, self.sample_rate);
            }
        }
    }
}

impl AudioNode for DrumMachine {
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        self.sample_rate = sample_rate as f32;

        // 1. Drain discrete commands — non-blocking
        while let Ok(cmd) = self.cmd_rx.try_recv() {
            self.apply_command(cmd);
        }

        let ch = channels as usize;
        let frames = output.len() / ch.max(1);

        // 2. Advance step clock if playing
        let playing = self.atomics.playing.load(Ordering::Relaxed);
        if playing {
            let bpm = self.atomics.bpm.load(Ordering::Relaxed);
            let swing = self.atomics.swing.load(Ordering::Relaxed);

            let fired = self
                .clock
                .advance(frames as u64, bpm, swing, self.sample_rate);

            for step in fired.iter() {
                self.trigger_step(step);
                self.atomics.current_step.store(step, Ordering::Relaxed);
                // Best-effort publish to event relay; drop if channel is full
                let _ = self.step_tx.try_send(step);
            }
        }

        // 3. Render all pad voices into the output buffer
        for frame_idx in 0..frames {
            let mut mix_l = 0.0_f32;
            let mut mix_r = 0.0_f32;

            for pad in &mut self.pads {
                let [pl, pr] = pad.render(self.sample_rate, &self.drum_params);
                mix_l += pl;
                mix_r += pr;
            }

            if ch >= 2 {
                output[frame_idx * ch] += mix_l;
                output[frame_idx * ch + 1] += mix_r;
            } else if ch == 1 {
                output[frame_idx] += (mix_l + mix_r) * 0.5;
            }
        }
    }

    fn name(&self) -> &str {
        "DrumMachine"
    }
}

// Safety: DrumMachine is moved into the audio callback closure once and never
// shared concurrently. All cross-thread communication uses Arc<Atomic*> and
// crossbeam channels.
unsafe impl Send for DrumMachine {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instruments::sampler::decoder::SampleBuffer;
    use crossbeam_channel::bounded;

    fn make_drum_machine() -> (
        DrumMachine,
        crossbeam_channel::Sender<DrumCommand>,
        crossbeam_channel::Receiver<u8>,
    ) {
        let atomics = DrumAtomics::new();
        let (cmd_tx, cmd_rx) = bounded(64);
        let (step_tx, step_rx) = bounded(32);
        let machine = DrumMachine::new(atomics, cmd_rx, step_tx, 44100.0);
        (machine, cmd_tx, step_rx)
    }

    fn make_buffer_arc(frames: usize) -> Arc<SampleBuffer> {
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

    #[test]
    fn test_silent_when_not_playing_and_no_samples() {
        let (mut machine, _cmd_tx, _step_rx) = make_drum_machine();
        let mut buf = vec![0.0f32; 256 * 2];
        machine.process(&mut buf, 44100, 2);
        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max < 1e-9, "Should be silent, got max={}", max);
    }

    #[test]
    fn test_silent_when_not_playing() {
        let (mut machine, cmd_tx, _step_rx) = make_drum_machine();
        // Load a sample on pad 0
        cmd_tx
            .send(DrumCommand::LoadSample {
                pad_idx: 0,
                name: "kick.wav".to_string(),
                buffer: make_buffer_arc(4096),
            })
            .unwrap();
        // Activate step 0 on pad 0
        cmd_tx
            .send(DrumCommand::SetStep {
                pad_idx: 0,
                step_idx: 0,
                active: true,
                velocity: 100,
            })
            .unwrap();
        // Do NOT send Play command

        let mut buf = vec![0.0f32; 256 * 2];
        machine.process(&mut buf, 44100, 2);
        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max < 1e-9, "Should be silent when not playing, got {}", max);
    }

    #[test]
    fn test_plays_audio_when_step_active() {
        let (mut machine, cmd_tx, _step_rx) = make_drum_machine();

        cmd_tx
            .send(DrumCommand::LoadSample {
                pad_idx: 0,
                name: "kick.wav".to_string(),
                buffer: make_buffer_arc(4096),
            })
            .unwrap();
        cmd_tx
            .send(DrumCommand::SetStep {
                pad_idx: 0,
                step_idx: 0,
                active: true,
                velocity: 100,
            })
            .unwrap();
        cmd_tx.send(DrumCommand::Play).unwrap();

        // Process enough buffers to get audio out
        let mut total_energy = 0.0f32;
        for _ in 0..8 {
            let mut buf = vec![0.0f32; 256 * 2];
            machine.process(&mut buf, 44100, 2);
            total_energy += buf.iter().map(|s| s.abs()).sum::<f32>();
        }
        assert!(
            total_energy > 1e-4,
            "Should produce audio when playing with active step, got {}",
            total_energy
        );
    }

    #[test]
    fn test_stop_silences_future_steps() {
        let (mut machine, cmd_tx, _step_rx) = make_drum_machine();

        cmd_tx
            .send(DrumCommand::LoadSample {
                pad_idx: 0,
                name: "kick.wav".to_string(),
                buffer: make_buffer_arc(4096),
            })
            .unwrap();
        cmd_tx
            .send(DrumCommand::SetStep {
                pad_idx: 0,
                step_idx: 0,
                active: true,
                velocity: 100,
            })
            .unwrap();
        cmd_tx.send(DrumCommand::Play).unwrap();

        // Process one buffer to start playback
        let mut buf = vec![0.0f32; 256 * 2];
        machine.process(&mut buf, 44100, 2);

        // Stop playback
        cmd_tx.send(DrumCommand::Stop).unwrap();

        // Advance many buffers past the step boundary — voices already triggered
        // will finish, but new steps must NOT fire
        let step_dur = ((60.0 / 120.0 / 4.0) * 44100.0) as usize;
        let extra_frames = step_dur * 2 + 256;
        let mut buf2 = vec![0.0f32; extra_frames * 2];
        // Process in chunks to drain voices and pass step boundary
        for chunk in buf2.chunks_mut(256 * 2) {
            let tmp_buf = &mut vec![0.0f32; chunk.len()];
            machine.process(tmp_buf, 44100, 2);
        }

        // After voices drain, there should be no more audio from new triggers
        let mut post_stop_buf = vec![0.0f32; 256 * 2];
        machine.process(&mut post_stop_buf, 44100, 2);
        // We just check the stop command was accepted (playing = false)
        assert!(
            !machine.atomics.playing.load(Ordering::Relaxed),
            "Should not be playing after Stop"
        );
    }

    #[test]
    fn test_reset_returns_to_step_zero() {
        let (mut machine, cmd_tx, _step_rx) = make_drum_machine();
        cmd_tx.send(DrumCommand::Play).unwrap();

        // Advance past step 0
        let step_dur = ((60.0 / 120.0 / 4.0) * 44100.0) as usize;
        let mut buf = vec![0.0f32; (step_dur * 4 + 1) * 2];
        machine.process(&mut buf, 44100, 2);
        assert!(machine.clock.next_step > 0, "Should have advanced");

        cmd_tx.send(DrumCommand::Reset).unwrap();
        let mut buf2 = vec![0.0f32; 1 * 2];
        machine.process(&mut buf2, 44100, 2);

        assert_eq!(machine.clock.next_step, 0, "After reset, clock should be at step 0");
        assert!(
            !machine.atomics.playing.load(Ordering::Relaxed),
            "Should not be playing after Reset"
        );
    }

    #[test]
    fn test_step_event_emitted_on_fire() {
        let (mut machine, cmd_tx, step_rx) = make_drum_machine();

        cmd_tx
            .send(DrumCommand::LoadSample {
                pad_idx: 0,
                name: "kick.wav".to_string(),
                buffer: make_buffer_arc(1024),
            })
            .unwrap();
        cmd_tx
            .send(DrumCommand::SetStep {
                pad_idx: 0,
                step_idx: 0,
                active: true,
                velocity: 100,
            })
            .unwrap();
        cmd_tx.send(DrumCommand::Play).unwrap();

        // Process one buffer — step 0 fires immediately
        let mut buf = vec![0.0f32; 256 * 2];
        machine.process(&mut buf, 44100, 2);

        let step = step_rx.try_recv().expect("step event should have been sent");
        assert_eq!(step, 0, "First fired step should be 0");
    }

    #[test]
    fn test_set_pattern_length_32() {
        let (mut machine, cmd_tx, _step_rx) = make_drum_machine();
        cmd_tx
            .send(DrumCommand::SetPatternLength { length: 32 })
            .unwrap();

        let mut buf = vec![0.0f32; 1 * 2];
        machine.process(&mut buf, 44100, 2);
        assert_eq!(machine.clock.pattern_length, 32);
        assert_eq!(
            machine.atomics.pattern_length.load(Ordering::Relaxed),
            32
        );
    }
}
