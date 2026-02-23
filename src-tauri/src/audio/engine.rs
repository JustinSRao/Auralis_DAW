use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use atomic_float::AtomicF32;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Stream;
use crossbeam_channel::{bounded, Receiver, Sender};

use super::devices;
use super::graph::{AudioGraph, SineTestNode, TripleBuffer};
use super::types::*;

/// Commands sent from the main thread to the audio callback.
///
/// These are received non-blockingly via `crossbeam_channel::try_recv()`
/// at the top of each audio buffer.
pub enum AudioCommand {
    /// Swap the audio graph with a new one via the triple buffer.
    SwapGraph(AudioGraph),
}

/// The core audio engine managing cpal stream lifecycle and the audio graph.
///
/// The engine is a state machine: Stopped → Starting → Running → Stopping → Stopped.
/// Configuration changes (device, sample rate, buffer size) require the engine to be stopped.
/// The test tone amplitude is controlled via a shared `Arc<AtomicF32>` — no command needed.
pub struct AudioEngine {
    config: EngineConfig,
    state: Arc<AtomicU8>,
    active_host_type: Option<AudioHostType>,
    stream: Option<Stream>,
    command_tx: Option<Sender<AudioCommand>>,
    test_tone_active: bool,
    /// Shared amplitude control for the test tone node.
    /// Set to 0.3 to enable, 0.0 to disable. Lock-free.
    test_tone_amplitude: Arc<AtomicF32>,
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

    /// Starts the audio engine with the current configuration.
    ///
    /// Resolves the output device, builds the cpal stream, creates the initial
    /// audio graph with a sine test node (disabled by default), and begins playback.
    /// Falls back from ASIO to WASAPI if ASIO fails.
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

        // Drop the stream to stop audio
        self.stream = None;
        self.command_tx = None;
        self.active_host_type = None;
        self.test_tone_active = false;
        self.test_tone_amplitude.store(0.0, Ordering::Release);

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

    /// Toggles the 440 Hz test tone on or off.
    ///
    /// This is lock-free — it writes to a shared `AtomicF32` that the audio
    /// thread reads on every buffer. No command channel needed.
    pub fn set_test_tone(&mut self, enabled: bool) -> Result<()> {
        let amplitude = if enabled { 0.3 } else { 0.0 };
        self.test_tone_amplitude.store(amplitude, Ordering::Release);
        self.test_tone_active = enabled;
        log::info!("Test tone {}", if enabled { "enabled" } else { "disabled" });
        Ok(())
    }

    /// Internal: attempts to start the engine with the preferred host.
    fn try_start_with_preferred_host(&mut self) -> Result<()> {
        let (host, host_type) = devices::get_preferred_host()?;

        // Resolve output device
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
        let channels: u16 = 2; // Stereo output

        let stream_config = cpal::StreamConfig {
            channels,
            sample_rate,
            buffer_size,
        };

        // Create the command channel
        let (command_tx, command_rx) = bounded::<AudioCommand>(64);

        // Build the initial audio graph
        let max_buf = 1024; // Max buffer size we support
        let max_ch = 2;
        let mut initial_graph = AudioGraph::new(max_buf, max_ch);

        // Add a test tone node with shared amplitude control
        // Starts at 0.0 (silent) — toggled via set_test_tone()
        self.test_tone_amplitude.store(0.0, Ordering::Release);
        let test_node = SineTestNode::with_shared_amplitude(self.test_tone_amplitude.clone());
        initial_graph.add_node(Box::new(test_node));

        // Create the triple buffer
        let mut triple_buf = TripleBuffer::new(initial_graph);

        let sr = self.config.sample_rate;
        let ch = channels;
        let state = self.state.clone();

        let stream = device
            .build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    audio_callback(data, &mut triple_buf, &command_rx, sr, ch, &state);
                },
                move |err| {
                    log::error!("Audio stream error: {}", err);
                },
                None, // No timeout
            )
            .context("Failed to build output stream")?;

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
// The `!Send` marker in cpal is a blanket safety measure across all platforms.
// AudioEngine is only accessed through a Mutex, ensuring exclusive access.
unsafe impl Send for AudioEngine {}
// Safety: AudioEngine is always accessed through Arc<Mutex<>>,
// which provides synchronization. The Mutex ensures only one thread
// accesses the engine at a time.
unsafe impl Sync for AudioEngine {}

/// The real-time audio callback. Runs on cpal's audio thread.
///
/// This function must NEVER allocate, block, or use mutexes.
/// It drains the command channel, swaps the graph if needed,
/// and processes the current graph.
fn audio_callback(
    data: &mut [f32],
    triple_buf: &mut TripleBuffer,
    command_rx: &Receiver<AudioCommand>,
    sample_rate: u32,
    channels: u16,
    _state: &AtomicU8,
) {
    // Drain commands (non-blocking)
    while let Ok(cmd) = command_rx.try_recv() {
        match cmd {
            AudioCommand::SwapGraph(new_graph) => {
                triple_buf.publish(new_graph);
            }
        }
    }

    // Process the current graph
    if let Some(graph) = triple_buf.read() {
        graph.process(data, sample_rate, channels);
    } else {
        // No graph available — output silence
        for s in data.iter_mut() {
            *s = 0.0;
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
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Invalid sample rate")
        );
    }

    #[test]
    fn test_set_config_invalid_buffer_size() {
        let mut engine = AudioEngine::new();
        let result = engine.set_config(None, Some(64));
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Invalid buffer size")
        );
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
        // Only update sample rate
        engine.set_config(Some(48000), None).unwrap();
        assert_eq!(engine.config.sample_rate, 48000);
        assert_eq!(engine.config.buffer_size, 256); // unchanged

        // Only update buffer size
        engine.set_config(None, Some(1024)).unwrap();
        assert_eq!(engine.config.sample_rate, 48000); // unchanged
        assert_eq!(engine.config.buffer_size, 1024);
    }

    #[test]
    #[ignore] // Requires audio hardware; ASIO cleanup can segfault in test harness
    fn test_start_and_stop_engine() {
        // Integration test — requires audio hardware
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
            // If no audio device available (CI environment), that's ok
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
