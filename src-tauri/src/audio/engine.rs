use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use atomic_float::AtomicF32;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Stream;
use crossbeam_channel::{bounded, Receiver, Sender};

use super::devices;
use super::graph::{AudioGraph, AudioNode, SineTestNode, TripleBuffer};
use super::metronome::MetronomeNode;
use super::scheduler::{ArrangementScheduler, SchedulerCommand};
use super::transport::{TransportAtomics, TransportClock, TransportSnapshot, TransportState};
use super::types::*;
use crate::midi::types::TimestampedMidiEvent;

/// Commands sent from the main thread to the audio callback.
///
/// Received non-blockingly via `crossbeam_channel::try_recv()` at the top
/// of each audio buffer. Adding new commands here keeps the command channel
/// as the single control path into the audio thread.
pub enum AudioCommand {
    /// Swap the audio graph with a new one via the triple buffer.
    SwapGraph(AudioGraph),
    /// Add a single node to the current active graph without replacing it.
    ///
    /// The node must have been heap-allocated before sending (no alloc on audio thread).
    /// `AudioGraph` must be created with `Vec::with_capacity` so push never reallocates.
    AddNode(Box<dyn AudioNode>),

    // --- Transport commands (Sprint 25) ---
    /// Start playback from the current position.
    TransportPlay,
    /// Stop playback and reset the playhead to 0 (or loop start).
    TransportStop,
    /// Pause playback, holding the current position.
    TransportPause,
    /// Start recording (requires record_armed = true).
    TransportRecord,
    /// Change BPM. Takes effect within the next buffer period.
    TransportSetBpm(f64),
    /// Set time signature numerator and denominator.
    TransportSetTimeSignature { numerator: u8, denominator: u8 },
    /// Set loop region in beats (authoritative unit).
    TransportSetLoopRegion { start_beats: f64, end_beats: f64 },
    /// Enable or disable loop mode.
    TransportToggleLoop(bool),
    /// Enable or disable the metronome click track.
    TransportToggleMetronome(bool),
    /// Set metronome click volume (0.0–1.0).
    TransportSetMetronomeVolume(f32),
    /// Set metronome click pitch in Hz.
    TransportSetMetronomePitch(f32),
    /// Arm or disarm a track for recording.
    TransportSetRecordArmed(bool),
    /// Seek to an absolute sample position (only when stopped or paused).
    TransportSeek(u64),

    // --- Sprint 9: Input monitoring commands ---
    /// Route recorder input to the output mix (monitoring pass-through).
    SetMonitoringConsumer(ringbuf::HeapConsumer<f32>),
    /// Enable or disable input monitoring.
    SetMonitoringEnabled(bool),

    // --- Sprint 38: Punch in/out commands ---
    /// Set the punch in/out region in beats.
    TransportSetPunchRegion { in_beats: f64, out_beats: f64 },
    /// Enable or disable punch recording mode.
    TransportTogglePunch(bool),
}

/// The core audio engine managing cpal stream lifecycle and the audio graph.
///
/// The engine is a state machine: Stopped → Starting → Running → Stopping → Stopped.
/// Configuration changes (device, sample rate, buffer size) require the engine to be stopped.
/// The test tone amplitude is controlled via a shared `Arc<AtomicF32>` — no command needed.
///
/// The transport clock lives inside the audio stream closure. Main-thread access
/// to transport state goes through [`AudioEngine::get_transport_snapshot`] and
/// [`AudioEngine::send_transport_command`].
pub struct AudioEngine {
    config: EngineConfig,
    state: Arc<AtomicU8>,
    active_host_type: Option<AudioHostType>,
    stream: Option<Stream>,
    command_tx: Option<Sender<AudioCommand>>,
    test_tone_active: bool,
    /// Shared amplitude control for the test tone node.
    test_tone_amplitude: Arc<AtomicF32>,
    /// Receiver for MIDI events from MidiManager (set before starting engine).
    midi_event_rx: Option<Receiver<TimestampedMidiEvent>>,
    /// Receiver for scheduler commands from the main thread (set before starting engine).
    scheduler_cmd_rx: Option<Receiver<SchedulerCommand>>,
    /// Shared snapshot of transport state. Updated by the audio thread via
    /// `try_lock`; read by the 60 fps poller and `get_transport_state` IPC.
    pub transport_snapshot: Arc<Mutex<TransportSnapshot>>,
    /// Optional pre-created transport atomics injected from managed state.
    ///
    /// When `Some`, `build_and_start_stream` uses this instead of creating new
    /// atomics so that external consumers (LFO, step sequencer, etc.) that were
    /// given a clone before engine start continue to share the same values.
    pub external_transport_atomics: Option<TransportAtomics>,
}

impl AudioEngine {
    /// Creates a new audio engine in the Stopped state with default configuration.
    pub fn new() -> Self {
        Self {
            config: EngineConfig::default(),
            state: Arc::new(AtomicU8::new(STATE_STOPPED)),
            active_host_type: None,
            stream: None,
            command_tx: None,
            test_tone_active: false,
            test_tone_amplitude: Arc::new(AtomicF32::new(0.0)),
            midi_event_rx: None,
            scheduler_cmd_rx: None,
            transport_snapshot: Arc::new(Mutex::new(TransportSnapshot::default())),
            external_transport_atomics: None,
        }
    }

    /// Returns the current engine status for IPC.
    pub fn status(&self) -> EngineStatus {
        EngineStatus {
            state: state_label(self.state.load(Ordering::Relaxed)).to_string(),
            config: self.config.clone(),
            active_host: self.active_host_type.clone(),
            test_tone_active: self.test_tone_active,
        }
    }

    /// Returns the current engine state as a u8 constant.
    pub fn current_state(&self) -> u8 {
        self.state.load(Ordering::Relaxed)
    }

    /// Provides a pre-created `TransportAtomics` instance that the engine will use
    /// when it starts.
    ///
    /// Must be called before [`start`]. The caller is responsible for managing the
    /// `Arc` copy that is placed in Tauri's managed state so that other audio nodes
    /// (LFO, future nodes) can share the same atomics.
    ///
    /// If not called, the engine will create its own atomics on `start`.
    pub fn set_transport_atomics(&mut self, atomics: TransportAtomics) {
        self.external_transport_atomics = Some(atomics);
    }

    /// Starts the audio engine with the current configuration.
    ///
    /// Resolves the output device, builds the cpal stream, creates the initial
    /// audio graph with a sine test node (disabled by default) and a metronome
    /// node, and begins playback. Falls back from ASIO to WASAPI if ASIO fails.
    pub fn start(&mut self) -> Result<()> {
        let current = self.state.load(Ordering::Relaxed);
        if current != STATE_STOPPED {
            bail!(
                "Cannot start engine: current state is '{}'",
                state_label(current)
            );
        }

        self.state.store(STATE_STARTING, Ordering::Release);
        log::info!(
            "Starting audio engine: {}Hz, {} samples buffer",
            self.config.sample_rate,
            self.config.buffer_size
        );

        match self.try_start_with_preferred_host() {
            Ok(()) => {
                self.state.store(STATE_RUNNING, Ordering::Release);
                log::info!("Audio engine running");
                Ok(())
            }
            Err(e) => {
                self.state.store(STATE_STOPPED, Ordering::Release);
                log::error!("Failed to start audio engine: {}", e);
                Err(e)
            }
        }
    }

    /// Stops the audio engine and releases the audio stream.
    ///
    /// The transport clock is dropped with the stream. The snapshot is updated
    /// to reflect the stopped state so IPC callers see accurate state.
    pub fn stop(&mut self) -> Result<()> {
        let current = self.state.load(Ordering::Relaxed);
        if current != STATE_RUNNING {
            bail!(
                "Cannot stop engine: current state is '{}'",
                state_label(current)
            );
        }

        self.state.store(STATE_STOPPING, Ordering::Release);
        log::info!("Stopping audio engine");

        // Drop the stream — this drops the TransportClock inside the closure too
        self.stream = None;
        self.command_tx = None;
        self.active_host_type = None;
        self.test_tone_active = false;
        self.test_tone_amplitude.store(0.0, Ordering::Release);

        // Reset the transport snapshot to reflect stopped state
        if let Ok(mut snap) = self.transport_snapshot.lock() {
            snap.state = "stopped".to_string();
            snap.position_samples = 0;
            snap.bbt = crate::audio::transport::BbtPosition::origin();
        }

        self.state.store(STATE_STOPPED, Ordering::Release);
        log::info!("Audio engine stopped");
        Ok(())
    }

    /// Sets the output or input device by name. Engine must be stopped.
    pub fn set_device(&mut self, device_name: &str, is_input: bool) -> Result<()> {
        let current = self.state.load(Ordering::Relaxed);
        if current != STATE_STOPPED {
            bail!(
                "Cannot change device while engine is '{}' — stop first",
                state_label(current)
            );
        }

        if is_input {
            self.config.input_device = Some(device_name.to_string());
        } else {
            self.config.output_device = Some(device_name.to_string());
        }

        log::info!(
            "Set {} device to '{}'",
            if is_input { "input" } else { "output" },
            device_name
        );
        Ok(())
    }

    /// Updates the sample rate and/or buffer size. Engine must be stopped.
    pub fn set_config(
        &mut self,
        sample_rate: Option<u32>,
        buffer_size: Option<u32>,
    ) -> Result<()> {
        let current = self.state.load(Ordering::Relaxed);
        if current != STATE_STOPPED {
            bail!(
                "Cannot change config while engine is '{}' — stop first",
                state_label(current)
            );
        }

        if let Some(sr) = sample_rate {
            if !ALLOWED_SAMPLE_RATES.contains(&sr) {
                bail!(
                    "Invalid sample rate: {}. Allowed: {:?}",
                    sr,
                    ALLOWED_SAMPLE_RATES
                );
            }
            self.config.sample_rate = sr;
        }

        if let Some(bs) = buffer_size {
            if !ALLOWED_BUFFER_SIZES.contains(&bs) {
                bail!(
                    "Invalid buffer size: {}. Allowed: {:?}",
                    bs,
                    ALLOWED_BUFFER_SIZES
                );
            }
            self.config.buffer_size = bs;
        }

        log::info!(
            "Engine config updated: {}Hz, {} samples",
            self.config.sample_rate,
            self.config.buffer_size
        );
        Ok(())
    }

    /// Sets the MIDI event receiver. Must be called before starting the engine.
    ///
    /// The receiver is moved into the audio callback closure when the engine starts,
    /// so MIDI events are drained each audio buffer alongside `AudioCommand`s.
    pub fn set_midi_receiver(&mut self, rx: Receiver<TimestampedMidiEvent>) {
        self.midi_event_rx = Some(rx);
    }

    /// Sets the arrangement scheduler command receiver. Must be called before starting.
    ///
    /// The receiver is moved into the audio callback closure. The corresponding
    /// sender is held in [`crate::audio::scheduler_commands::SchedulerCmdTxState`].
    pub fn set_scheduler_receiver(&mut self, rx: Receiver<SchedulerCommand>) {
        self.scheduler_cmd_rx = Some(rx);
    }

    /// Toggles the 440 Hz test tone on or off.
    ///
    /// Lock-free — writes to a shared `AtomicF32` read by the audio thread.
    pub fn set_test_tone(&mut self, enabled: bool) -> Result<()> {
        let amplitude = if enabled { 0.3 } else { 0.0 };
        self.test_tone_amplitude.store(amplitude, Ordering::Release);
        self.test_tone_active = enabled;
        log::info!("Test tone {}", if enabled { "enabled" } else { "disabled" });
        Ok(())
    }

    /// Sends a transport command to the audio thread. Non-blocking.
    ///
    /// Returns an error if the engine is not running or the command channel is full.
    pub fn send_transport_command(&self, cmd: AudioCommand) -> Result<()> {
        let tx = self
            .command_tx
            .as_ref()
            .context("Audio engine is not running — start the engine first")?;
        tx.try_send(cmd)
            .map_err(|e| anyhow::anyhow!("Transport command channel full: {}", e))?;
        Ok(())
    }

    /// Returns a clone of the current transport snapshot.
    ///
    /// Safe to call whether the engine is running or stopped.
    pub fn get_transport_snapshot(&self) -> Result<TransportSnapshot> {
        self.transport_snapshot
            .lock()
            .map(|s| s.clone())
            .map_err(|e| anyhow::anyhow!("Transport snapshot mutex poisoned: {}", e))
    }

    /// Internal: attempts to start the engine with the preferred host.
    fn try_start_with_preferred_host(&mut self) -> Result<()> {
        let (host, host_type) = devices::get_preferred_host()?;

        let device = if let Some(ref name) = self.config.output_device {
            devices::find_output_device(&host, name)?
        } else {
            host.default_output_device()
                .context("No default output device available")?
        };

        let device_name = device.name().unwrap_or_else(|_| "unknown".to_string());
        log::info!("Using output device: '{}' ({:?})", device_name, host_type);

        self.build_and_start_stream(device, host_type)
    }

    /// Builds the cpal output stream and starts playback.
    fn build_and_start_stream(
        &mut self,
        device: cpal::Device,
        host_type: AudioHostType,
    ) -> Result<()> {
        let sample_rate = cpal::SampleRate(self.config.sample_rate);
        let buffer_size = cpal::BufferSize::Fixed(self.config.buffer_size);
        let channels: u16 = 2;

        let stream_config = cpal::StreamConfig {
            channels,
            sample_rate,
            buffer_size,
        };

        // Create the command channel
        let (command_tx, command_rx) = bounded::<AudioCommand>(64);

        // Build the initial audio graph
        let max_buf = 1024;
        let max_ch = 2;
        let mut initial_graph = AudioGraph::new(max_buf, max_ch);

        // Test tone node (starts silent — toggled via set_test_tone())
        self.test_tone_amplitude.store(0.0, Ordering::Release);
        let test_node = SineTestNode::with_shared_amplitude(self.test_tone_amplitude.clone());
        initial_graph.add_node(Box::new(test_node));

        // Use pre-created transport atomics if provided (Sprint 33: LFO BPM sync).
        // When the caller manages a clone in Tauri state, all consumers that received
        // a clone before engine start continue to observe the same atomic values.
        let sr = self.config.sample_rate;
        let atomics = self
            .external_transport_atomics
            .take()
            .unwrap_or_else(|| TransportAtomics::new(120.0, sr));
        let snapshot_arc = self.transport_snapshot.clone();
        let mut clock = TransportClock::new(sr, atomics.clone(), snapshot_arc);

        // Add MetronomeNode to the graph — shares the transport atomics
        let metronome = MetronomeNode::new(atomics, sr);
        initial_graph.add_node(Box::new(metronome));

        // Create the triple buffer
        let mut triple_buf = TripleBuffer::new(initial_graph);

        let ch = channels;
        let state = self.state.clone();
        let midi_rx = self.midi_event_rx.take();

        // Build the arrangement scheduler. Falls back to a no-op scheduler with a
        // disconnected channel if set_scheduler_receiver was not called.
        let scheduler_rx = self.scheduler_cmd_rx.take().unwrap_or_else(|| {
            let (_, rx) = crossbeam_channel::bounded(1);
            rx
        });
        let mut scheduler = ArrangementScheduler::new(scheduler_rx);

        // Monitoring state: owned by the audio thread inside the closure
        let mut monitoring_cons: Option<ringbuf::HeapConsumer<f32>> = None;
        let mut monitoring_enabled_flag = false;

        let stream = device
            .build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    audio_callback(
                        data,
                        &mut triple_buf,
                        &mut clock,
                        &command_rx,
                        midi_rx.as_ref(),
                        sr,
                        ch,
                        &state,
                        &mut monitoring_cons,
                        &mut monitoring_enabled_flag,
                        &mut scheduler,
                    );
                },
                move |err| {
                    log::error!("Audio stream error: {}", err);
                },
                None,
            )
            .context("Failed to build output stream")?;

        // `clock` is moved into the closure; make the borrow work by using an inner scope
        // The closure already owns clock. The variable binding above is moved.

        // `clock`, `triple_buf`, `command_rx`, `midi_rx` are all moved into the closure.

        stream.play().context("Failed to start audio stream")?;

        self.stream = Some(stream);
        self.command_tx = Some(command_tx);
        self.active_host_type = Some(host_type);
        self.test_tone_active = false;

        Ok(())
    }
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new()
    }
}

// Safety: On Windows, cpal::Stream is safe to move between threads.
// AudioEngine is only ever accessed through a Mutex.
unsafe impl Send for AudioEngine {}
unsafe impl Sync for AudioEngine {}

/// The real-time audio callback. Runs on cpal's audio thread.
///
/// This function must NEVER allocate, block, or use mutexes except via
/// `try_lock` (which is non-blocking).
fn audio_callback(
    data: &mut [f32],
    triple_buf: &mut TripleBuffer,
    clock: &mut TransportClock,
    command_rx: &Receiver<AudioCommand>,
    midi_rx: Option<&Receiver<TimestampedMidiEvent>>,
    sample_rate: u32,
    channels: u16,
    _state: &AtomicU8,
    monitoring_cons: &mut Option<ringbuf::HeapConsumer<f32>>,
    monitoring_enabled: &mut bool,
    scheduler: &mut ArrangementScheduler,
) {
    // Drain commands (non-blocking)
    while let Ok(cmd) = command_rx.try_recv() {
        match cmd {
            AudioCommand::SwapGraph(new_graph) => {
                triple_buf.publish(new_graph);
            }
            AudioCommand::AddNode(node) => {
                // Add node to the current active graph in place.
                // Vec::push will not allocate because AudioGraph::new pre-reserves capacity.
                if let Some(graph) = triple_buf.read() {
                    graph.add_node(node);
                }
            }
            // --- Transport commands ---
            AudioCommand::TransportPlay => clock.apply_play(),
            AudioCommand::TransportStop => {
                clock.apply_stop();
                scheduler.handle_stop();
            }
            AudioCommand::TransportPause => clock.apply_pause(),
            AudioCommand::TransportRecord => clock.apply_record(),
            AudioCommand::TransportSetBpm(bpm) => clock.apply_set_bpm(bpm),
            AudioCommand::TransportSetTimeSignature {
                numerator,
                denominator,
            } => clock.apply_set_time_signature(numerator, denominator),
            AudioCommand::TransportSetLoopRegion {
                start_beats,
                end_beats,
            } => clock.apply_set_loop_region(start_beats, end_beats),
            AudioCommand::TransportToggleLoop(enabled) => clock.apply_toggle_loop(enabled),
            AudioCommand::TransportToggleMetronome(enabled) => {
                clock.apply_toggle_metronome(enabled)
            }
            AudioCommand::TransportSetMetronomeVolume(vol) => {
                clock.apply_set_metronome_volume(vol)
            }
            AudioCommand::TransportSetMetronomePitch(pitch) => {
                clock.apply_set_metronome_pitch(pitch)
            }
            AudioCommand::TransportSetRecordArmed(armed) => {
                clock.apply_set_record_armed(armed)
            }
            AudioCommand::TransportSeek(pos) => {
                clock.apply_seek(pos);
                scheduler.handle_seek(pos);
            }
            // --- Sprint 9: Input monitoring commands ---
            AudioCommand::SetMonitoringConsumer(cons) => {
                *monitoring_cons = Some(cons);
            }
            AudioCommand::SetMonitoringEnabled(enabled) => {
                *monitoring_enabled = enabled;
            }
            // --- Sprint 38: Punch in/out commands ---
            AudioCommand::TransportSetPunchRegion { in_beats, out_beats } => {
                clock.apply_set_punch_region(in_beats, out_beats);
            }
            AudioCommand::TransportTogglePunch(enabled) => {
                clock.apply_toggle_punch(enabled);
            }
        }
    }

    // Drain MIDI events (non-blocking)
    if let Some(rx) = midi_rx {
        while let Ok(_midi_event) = rx.try_recv() {
            // Events consumed — instrument routing added in future sprints
        }
    }

    // Advance the transport clock by this buffer's frame count
    let buffer_frames = data.len() / channels as usize;

    // Tick the arrangement scheduler BEFORE advancing the clock so that
    // `clock.position_samples` represents the *start* of the current buffer window.
    let is_playing = matches!(
        clock.state,
        TransportState::Playing | TransportState::Recording
    );
    scheduler.tick(clock.position_samples, buffer_frames, is_playing);

    clock.advance(buffer_frames);

    // Process the current graph
    if let Some(graph) = triple_buf.read() {
        graph.process(data, sample_rate, channels);
    } else {
        for s in data.iter_mut() {
            *s = 0.0;
        }
    }

    // Input monitoring pass-through — mix recorder input into output
    if *monitoring_enabled {
        if let Some(ref mut cons) = monitoring_cons {
            let available = cons.len().min(data.len());
            let mut mon_scratch = [0.0f32; 1024]; // stack-allocated, no heap
            let mut written = 0;
            while written < available {
                let chunk = (available - written).min(1024);
                let n = cons.pop_slice(&mut mon_scratch[..chunk]);
                for (out_s, &mon_s) in data[written..written + n]
                    .iter_mut()
                    .zip(mon_scratch[..n].iter())
                {
                    *out_s += mon_s;
                }
                written += n;
                if n == 0 {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_new_defaults() {
        let engine = AudioEngine::new();
        assert_eq!(engine.current_state(), STATE_STOPPED);
        assert!(engine.active_host_type.is_none());
        assert!(!engine.test_tone_active);
    }

    #[test]
    fn test_engine_default_trait() {
        let engine = AudioEngine::default();
        assert_eq!(engine.current_state(), STATE_STOPPED);
    }

    #[test]
    fn test_engine_status() {
        let engine = AudioEngine::new();
        let status = engine.status();
        assert_eq!(status.state, "stopped");
        assert_eq!(status.config.sample_rate, 44100);
        assert_eq!(status.config.buffer_size, 256);
        assert!(status.active_host.is_none());
        assert!(!status.test_tone_active);
    }

    #[test]
    fn test_set_config_valid() {
        let mut engine = AudioEngine::new();
        let result = engine.set_config(Some(48000), Some(512));
        assert!(result.is_ok());
        assert_eq!(engine.config.sample_rate, 48000);
        assert_eq!(engine.config.buffer_size, 512);
    }

    #[test]
    fn test_set_config_invalid_sample_rate() {
        let mut engine = AudioEngine::new();
        let result = engine.set_config(Some(96000), None);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid sample rate"));
    }

    #[test]
    fn test_set_config_invalid_buffer_size() {
        let mut engine = AudioEngine::new();
        let result = engine.set_config(None, Some(64));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid buffer size"));
    }

    #[test]
    fn test_set_device_while_stopped() {
        let mut engine = AudioEngine::new();
        let result = engine.set_device("Test Device", false);
        assert!(result.is_ok());
        assert_eq!(engine.config.output_device, Some("Test Device".to_string()));
    }

    #[test]
    fn test_set_input_device() {
        let mut engine = AudioEngine::new();
        let result = engine.set_device("Mic Input", true);
        assert!(result.is_ok());
        assert_eq!(engine.config.input_device, Some("Mic Input".to_string()));
    }

    #[test]
    fn test_cannot_stop_when_already_stopped() {
        let mut engine = AudioEngine::new();
        let result = engine.stop();
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Cannot stop"));
    }

    #[test]
    fn test_set_test_tone() {
        let mut engine = AudioEngine::new();
        let result = engine.set_test_tone(true);
        assert!(result.is_ok());
        assert!(engine.test_tone_active);
        assert!(engine.test_tone_amplitude.load(Ordering::Relaxed) > 0.0);

        let result = engine.set_test_tone(false);
        assert!(result.is_ok());
        assert!(!engine.test_tone_active);
        assert_eq!(engine.test_tone_amplitude.load(Ordering::Relaxed), 0.0);
    }

    #[test]
    fn test_set_config_partial_update() {
        let mut engine = AudioEngine::new();
        engine.set_config(Some(48000), None).unwrap();
        assert_eq!(engine.config.sample_rate, 48000);
        assert_eq!(engine.config.buffer_size, 256);

        engine.set_config(None, Some(1024)).unwrap();
        assert_eq!(engine.config.sample_rate, 48000);
        assert_eq!(engine.config.buffer_size, 1024);
    }

    #[test]
    fn test_send_transport_command_when_stopped_errors() {
        let engine = AudioEngine::new();
        let result = engine.send_transport_command(AudioCommand::TransportPlay);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("not running"));
    }

    #[test]
    fn test_get_transport_snapshot_when_stopped() {
        let engine = AudioEngine::new();
        let snap = engine.get_transport_snapshot().unwrap();
        assert_eq!(snap.state, "stopped");
        assert_eq!(snap.bpm, 120.0);
    }

    #[test]
    fn test_transport_snapshot_initialized() {
        let engine = AudioEngine::new();
        let snap = engine.get_transport_snapshot().unwrap();
        assert_eq!(snap.state, "stopped");
        assert_eq!(snap.position_samples, 0);
        assert_eq!(snap.time_sig_numerator, 4);
        assert_eq!(snap.time_sig_denominator, 4);
        assert!(!snap.loop_enabled);
        assert!(!snap.metronome_enabled);
    }

    #[test]
    #[ignore] // Requires audio hardware; ASIO cleanup can segfault in test harness
    fn test_start_and_stop_engine() {
        let mut engine = AudioEngine::new();
        let start_result = engine.start();

        if start_result.is_ok() {
            assert_eq!(engine.current_state(), STATE_RUNNING);
            assert!(engine.active_host_type.is_some());

            let status = engine.status();
            assert_eq!(status.state, "running");

            let stop_result = engine.stop();
            assert!(stop_result.is_ok());
            assert_eq!(engine.current_state(), STATE_STOPPED);
        } else {
            log::warn!(
                "Could not start engine (no audio device?): {}",
                start_result.unwrap_err()
            );
        }
    }

    #[test]
    #[ignore] // Requires audio hardware; ASIO cleanup can segfault in test harness
    fn test_cannot_start_when_already_running() {
        let mut engine = AudioEngine::new();
        if engine.start().is_ok() {
            let result = engine.start();
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("Cannot start"));
            let _ = engine.stop();
        }
    }

    #[test]
    #[ignore] // Requires audio hardware; ASIO cleanup can segfault in test harness
    fn test_cannot_set_config_while_running() {
        let mut engine = AudioEngine::new();
        if engine.start().is_ok() {
            let result = engine.set_config(Some(48000), None);
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("stop first"));
            let _ = engine.stop();
        }
    }

    #[test]
    #[ignore] // Requires audio hardware; ASIO cleanup can segfault in test harness
    fn test_cannot_set_device_while_running() {
        let mut engine = AudioEngine::new();
        if engine.start().is_ok() {
            let result = engine.set_device("Another Device", false);
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("stop first"));
            let _ = engine.stop();
        }
    }
}
