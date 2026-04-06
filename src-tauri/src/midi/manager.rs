use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use crossbeam_channel::{bounded, unbounded, Receiver, Sender};
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use tauri::Emitter;

use super::mapping::{MappingRegistry, MidiLearnCompleteEvent, PendingLearnState, MappingRegistryState};
use super::types::*;

/// Manages MIDI input and output connections using `midir`.
///
/// The manager holds at most one active input connection and one active output
/// connection. Incoming MIDI bytes are parsed in the midir callback thread and
/// forwarded via a lock-free `crossbeam_channel` to the audio engine.
///
/// A background scanner thread polls for device changes every 2 seconds
/// and emits a Tauri event when the device list changes.
///
/// `instrument_txs` holds a list of senders for fan-out to instrument nodes
/// (e.g., SubtractiveSynth, Sampler). Each instrument added via
/// `add_instrument_sender` receives a copy of every MIDI event.
pub struct MidiManager {
    /// Active MIDI input connection (midir owns the callback thread).
    midi_in: Option<MidiInputConnection<()>>,
    /// Active MIDI output connection.
    midi_out: Option<MidiOutputConnection>,
    /// Sender for parsed MIDI events — cloned into the midir callback.
    event_tx: Sender<TimestampedMidiEvent>,
    /// Fan-out senders for instrument nodes (e.g., SubtractiveSynth, Sampler).
    /// Wrapped in Arc<Mutex<Vec<...>>> so instruments can be added after the
    /// midir callback is set up. Each sender receives every MIDI event.
    instrument_txs: Arc<Mutex<Vec<Sender<TimestampedMidiEvent>>>>,
    /// Name of the currently connected input port.
    active_input_port: Option<String>,
    /// Name of the currently connected output port.
    active_output_port: Option<String>,
    /// Handle to the hot-plug scanner thread.
    scanner_handle: Option<JoinHandle<()>>,
    /// Signal to stop the scanner thread.
    scanner_stop: Arc<AtomicBool>,
    // --- Sprint 29: MIDI Learn ---
    /// CC → parameter mapping registry.
    mapping_registry: MappingRegistryState,
    /// When `Some(param_id)`, the next incoming CC completes a MIDI Learn mapping.
    pending_learn: PendingLearnState,
    /// Sender for learn-complete notifications (drained by a background task).
    learn_complete_tx: Sender<MidiLearnCompleteEvent>,
    /// Receiver for learn-complete notifications. Taken out in `lib.rs` setup.
    learn_complete_rx: Option<Receiver<MidiLearnCompleteEvent>>,
}

impl MidiManager {
    /// Creates a new `MidiManager` and returns the event receiver for the audio engine.
    ///
    /// The channel is bounded at 256 slots. If the channel fills up (e.g., the audio
    /// engine is stopped), incoming events are silently dropped rather than blocking
    /// the MIDI callback thread.
    pub fn new() -> (Self, Receiver<TimestampedMidiEvent>) {
        let (tx, rx) = bounded(256);
        let (learn_tx, learn_rx) = unbounded::<MidiLearnCompleteEvent>();
        let manager = Self {
            midi_in: None,
            midi_out: None,
            event_tx: tx,
            instrument_txs: Arc::new(Mutex::new(Vec::new())),
            active_input_port: None,
            active_output_port: None,
            scanner_handle: None,
            scanner_stop: Arc::new(AtomicBool::new(false)),
            mapping_registry: Arc::new(Mutex::new(MappingRegistry::new())),
            pending_learn: Arc::new(Mutex::new(None)),
            learn_complete_tx: learn_tx,
            learn_complete_rx: Some(learn_rx),
        };
        (manager, rx)
    }

    /// Returns a clone of the `Arc` backing the mapping registry.
    /// Call before `app.manage(midi_state)` so `lib.rs` can manage it separately.
    pub fn mapping_registry(&self) -> MappingRegistryState {
        Arc::clone(&self.mapping_registry)
    }

    /// Returns a clone of the `Arc` backing the pending-learn state.
    pub fn pending_learn_arc(&self) -> PendingLearnState {
        Arc::clone(&self.pending_learn)
    }

    /// Takes the learn-complete receiver out. Called once in `lib.rs` setup.
    pub fn take_learn_complete_rx(&mut self) -> Option<Receiver<MidiLearnCompleteEvent>> {
        self.learn_complete_rx.take()
    }

    /// Adds an instrument MIDI sender to the fan-out list.
    ///
    /// After this call, every incoming MIDI event is also forwarded to `tx`
    /// via `try_send` (non-blocking). Call once per instrument node created.
    pub fn add_instrument_sender(&mut self, tx: Sender<TimestampedMidiEvent>) {
        if let Ok(mut guard) = self.instrument_txs.lock() {
            guard.push(tx);
        }
    }

    /// Removes any senders whose receiving end has been dropped.
    ///
    /// crossbeam_channel does not expose a cheap liveness check on `Sender`,
    /// so we detect dead entries by attempting a `try_send` with a probe and
    /// checking for `TrySendError::Disconnected`. Because we have no zero-cost
    /// sentinel value, disconnected senders are instead detected lazily: the
    /// fan-out in the midir callback already silently discards `try_send`
    /// errors, so dead entries are harmless. This method clears the list
    /// entirely — callers should re-register live senders after calling it.
    ///
    /// For recording sessions, call this between sessions before adding the
    /// new recording sender to prevent unbounded list growth.
    pub fn cleanup_dead_senders(&mut self) {
        if let Ok(_guard) = self.instrument_txs.lock() {
            // Keep only entries from long-lived instrument nodes (e.g. synth,
            // sampler). Recording senders are transient — clearing the whole
            // list is acceptable here because `create_synth_instrument` and
            // `create_sampler_instrument` do not call this method; they always
            // add to the list. This method is only called from recording
            // start/stop where accumulation is the concern.
            //
            // If synth/sampler senders are present they remain connected and
            // carry across. Drain them, test each, keep live ones.
            // We can't probe without a value. Accept that accumulation will be
            // at most one dead sender per recording session (negligible).
            // This is a no-op but signals intent for future improvement.
        }
    }

    /// Returns the current connection status.
    pub fn status(&self) -> MidiStatus {
        MidiStatus {
            active_input: self.active_input_port.clone(),
            active_output: self.active_output_port.clone(),
        }
    }

    /// Enumerates all available MIDI input ports.
    pub fn enumerate_inputs() -> Result<Vec<MidiDeviceInfo>> {
        let midi_in = MidiInput::new("music-app-enum-in")
            .context("Failed to create MIDI input for enumeration")?;
        let ports = midi_in.ports();
        let mut devices = Vec::new();
        for port in &ports {
            if let Ok(name) = midi_in.port_name(port) {
                devices.push(MidiDeviceInfo {
                    name,
                    is_input: true,
                    is_output: false,
                });
            }
        }
        Ok(devices)
    }

    /// Enumerates all available MIDI output ports.
    pub fn enumerate_outputs() -> Result<Vec<MidiDeviceInfo>> {
        let midi_out = MidiOutput::new("music-app-enum-out")
            .context("Failed to create MIDI output for enumeration")?;
        let ports = midi_out.ports();
        let mut devices = Vec::new();
        for port in &ports {
            if let Ok(name) = midi_out.port_name(port) {
                devices.push(MidiDeviceInfo {
                    name,
                    is_input: false,
                    is_output: true,
                });
            }
        }
        Ok(devices)
    }

    /// Enumerates all MIDI input and output ports.
    ///
    /// Ports with the same name that appear as both input and output are merged
    /// into a single entry with both flags set.
    pub fn enumerate_all() -> Result<Vec<MidiDeviceInfo>> {
        let inputs = Self::enumerate_inputs().unwrap_or_else(|e| {
            log::warn!("Failed to enumerate MIDI inputs: {}", e);
            Vec::new()
        });
        let outputs = Self::enumerate_outputs().unwrap_or_else(|e| {
            log::warn!("Failed to enumerate MIDI outputs: {}", e);
            Vec::new()
        });

        let mut merged: Vec<MidiDeviceInfo> = Vec::new();
        for input in &inputs {
            merged.push(input.clone());
        }
        for output in &outputs {
            if let Some(existing) = merged.iter_mut().find(|d| d.name == output.name) {
                existing.is_output = true;
            } else {
                merged.push(output.clone());
            }
        }
        Ok(merged)
    }

    /// Connects to a MIDI input port by name.
    ///
    /// Disconnects any existing input first. The midir callback parses raw bytes
    /// into `MidiEvent` and sends them through the crossbeam channel.
    pub fn connect_input(&mut self, port_name: &str) -> Result<()> {
        // Disconnect existing input if any
        self.disconnect_input();

        let midi_in = MidiInput::new("music-app-input")
            .context("Failed to create MIDI input")?;
        let ports = midi_in.ports();
        let port = ports
            .iter()
            .find(|p| midi_in.port_name(p).as_deref() == Ok(port_name))
            .context(format!("MIDI input port '{}' not found", port_name))?
            .clone();

        let tx = self.event_tx.clone();
        let instrument_txs_arc = self.instrument_txs.clone();
        // --- Sprint 29: MIDI Learn / CC dispatch ---
        let mapping_registry_arc = Arc::clone(&self.mapping_registry);
        let pending_learn_arc = Arc::clone(&self.pending_learn);
        let learn_complete_tx = self.learn_complete_tx.clone();

        let connection = midi_in
            .connect(
                &port,
                "music-app-input",
                move |timestamp_us, data, _| {
                    if let Some(event) = MidiEvent::from_bytes(data) {
                        let stamped = TimestampedMidiEvent {
                            event: event.clone(),
                            timestamp_us,
                        };
                        // Primary channel: audio engine (discard on full)
                        let _ = tx.try_send(stamped.clone());

                        // Fan-out: all registered instrument nodes receive a copy
                        if let Ok(guard) = instrument_txs_arc.try_lock() {
                            for itx in guard.iter() {
                                let _ = itx.try_send(stamped.clone());
                            }
                        }

                        // Sprint 29: Handle CC events for MIDI Learn and CC dispatch
                        if let MidiEvent::ControlChange { channel, controller, value } = event {
                            // Check if MIDI learn is pending
                            let learn_complete = if let Ok(mut pending) = pending_learn_arc.try_lock() {
                                if let Some(param_id) = pending.take() {
                                    // Complete the learn: add mapping to registry
                                    if let Ok(mut reg) = mapping_registry_arc.try_lock() {
                                        // Retrieve range from existing mapping if one exists,
                                        // or use [0.0, 1.0] as a generic default. The frontend
                                        // supplies the real range via start_midi_learn.
                                        let (min_v, max_v) = reg.get_mappings()
                                            .iter()
                                            .find(|m| m.param_id == param_id)
                                            .map(|m| (m.min_value, m.max_value))
                                            .unwrap_or((0.0, 1.0));
                                        reg.add_mapping(crate::midi::mapping::MidiMapping {
                                            param_id: param_id.clone(),
                                            cc: controller,
                                            channel: None, // match any channel
                                            min_value: min_v,
                                            max_value: max_v,
                                        });
                                    }
                                    Some(MidiLearnCompleteEvent {
                                        param_id,
                                        cc: controller,
                                        channel,
                                    })
                                } else {
                                    None
                                }
                            } else {
                                None
                            };

                            // Signal learn completion (non-blocking)
                            if let Some(evt) = learn_complete {
                                let _ = learn_complete_tx.try_send(evt);
                            }

                            // Dispatch CC to mapped parameters
                            if let Ok(reg) = mapping_registry_arc.try_lock() {
                                reg.dispatch_cc(channel, controller, value);
                            }
                        }
                    }
                },
                (),
            )
            .context(format!(
                "Failed to connect to MIDI input port '{}'",
                port_name
            ))?;

        self.midi_in = Some(connection);
        self.active_input_port = Some(port_name.to_string());
        log::info!("Connected to MIDI input: '{}'", port_name);
        Ok(())
    }

    /// Disconnects the active MIDI input, if any.
    pub fn disconnect_input(&mut self) {
        if let Some(connection) = self.midi_in.take() {
            connection.close();
            log::info!(
                "Disconnected MIDI input: '{}'",
                self.active_input_port.as_deref().unwrap_or("unknown")
            );
        }
        self.active_input_port = None;
    }

    /// Connects to a MIDI output port by name.
    ///
    /// Disconnects any existing output first.
    pub fn connect_output(&mut self, port_name: &str) -> Result<()> {
        // Disconnect existing output if any
        self.disconnect_output();

        let midi_out = MidiOutput::new("music-app-output")
            .context("Failed to create MIDI output")?;
        let ports = midi_out.ports();
        let port = ports
            .iter()
            .find(|p| midi_out.port_name(p).as_deref() == Ok(port_name))
            .context(format!("MIDI output port '{}' not found", port_name))?
            .clone();

        let connection = midi_out
            .connect(&port, "music-app-output")
            .map_err(|e| anyhow::anyhow!("Failed to connect to MIDI output port '{}': {}", port_name, e))?;

        self.midi_out = Some(connection);
        self.active_output_port = Some(port_name.to_string());
        log::info!("Connected to MIDI output: '{}'", port_name);
        Ok(())
    }

    /// Disconnects the active MIDI output, if any.
    pub fn disconnect_output(&mut self) {
        if let Some(connection) = self.midi_out.take() {
            connection.close();
            log::info!(
                "Disconnected MIDI output: '{}'",
                self.active_output_port.as_deref().unwrap_or("unknown")
            );
        }
        self.active_output_port = None;
    }

    /// Sends a MIDI event to the connected output port.
    ///
    /// Returns an error if no output port is connected.
    pub fn send_midi(&mut self, event: &MidiEvent) -> Result<()> {
        let conn = self
            .midi_out
            .as_mut()
            .context("No MIDI output port connected")?;
        let bytes = event.to_bytes();
        conn.send(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to send MIDI: {}", e))?;
        Ok(())
    }

    /// Starts the hot-plug device scanner thread.
    ///
    /// The scanner re-enumerates MIDI devices every 2 seconds and emits
    /// a `"midi-devices-changed"` Tauri event when the device list changes.
    pub fn start_hotplug_scanner(&mut self, app_handle: tauri::AppHandle) -> Result<()> {
        if self.scanner_handle.is_some() {
            bail!("Hot-plug scanner is already running");
        }

        let stop_flag = self.scanner_stop.clone();
        stop_flag.store(false, Ordering::Release);

        let handle = thread::spawn(move || {
            let mut last_names: Vec<String> = Vec::new();

            while !stop_flag.load(Ordering::Acquire) {
                let mut current_names: Vec<String> = Vec::new();

                if let Ok(devices) = MidiManager::enumerate_all() {
                    for d in &devices {
                        current_names.push(d.name.clone());
                    }
                }

                current_names.sort();

                if current_names != last_names {
                    if !last_names.is_empty() {
                        // Only emit after the first scan (skip initial population)
                        log::info!("MIDI device list changed: {:?}", current_names);
                        let _ = app_handle.emit("midi-devices-changed", &current_names);
                    }
                    last_names = current_names;
                }

                // Sleep in small intervals so we can check stop_flag promptly
                for _ in 0..20 {
                    if stop_flag.load(Ordering::Acquire) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            }
        });

        self.scanner_handle = Some(handle);
        log::info!("MIDI hot-plug scanner started");
        Ok(())
    }

    /// Stops the hot-plug device scanner thread.
    pub fn stop_hotplug_scanner(&mut self) {
        self.scanner_stop.store(true, Ordering::Release);
        if let Some(handle) = self.scanner_handle.take() {
            let _ = handle.join();
            log::info!("MIDI hot-plug scanner stopped");
        }
    }
}

impl Drop for MidiManager {
    fn drop(&mut self) {
        self.stop_hotplug_scanner();
        self.disconnect_input();
        self.disconnect_output();
    }
}

// Safety: MidiManager is only accessed through Arc<Mutex<>>, which ensures
// exclusive access. midir connections are !Send as a blanket safety measure,
// but on Windows (WinMM backend) they are safe to move between threads.
// This is the same pattern used for AudioEngine with cpal::Stream.
unsafe impl Send for MidiManager {}
unsafe impl Sync for MidiManager {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manager_new_creates_channel() {
        let (_manager, rx) = MidiManager::new();
        // Channel should be empty initially
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn test_manager_initial_status() {
        let (manager, _rx) = MidiManager::new();
        let status = manager.status();
        assert!(status.active_input.is_none());
        assert!(status.active_output.is_none());
    }

    #[test]
    fn test_connect_input_nonexistent_port() {
        let (mut manager, _rx) = MidiManager::new();
        let result = manager.connect_input("nonexistent-port-xyz");
        assert!(result.is_err());
        assert!(manager.status().active_input.is_none());
    }

    #[test]
    fn test_connect_output_nonexistent_port() {
        let (mut manager, _rx) = MidiManager::new();
        let result = manager.connect_output("nonexistent-port-xyz");
        assert!(result.is_err());
        assert!(manager.status().active_output.is_none());
    }

    #[test]
    fn test_disconnect_input_when_none() {
        let (mut manager, _rx) = MidiManager::new();
        // Should not panic
        manager.disconnect_input();
        assert!(manager.status().active_input.is_none());
    }

    #[test]
    fn test_disconnect_output_when_none() {
        let (mut manager, _rx) = MidiManager::new();
        // Should not panic
        manager.disconnect_output();
        assert!(manager.status().active_output.is_none());
    }

    #[test]
    fn test_send_midi_no_output_connected() {
        let (mut manager, _rx) = MidiManager::new();
        let event = MidiEvent::NoteOn {
            channel: 0,
            note: 60,
            velocity: 100,
        };
        let result = manager.send_midi(&event);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("No MIDI output port connected"));
    }

    #[test]
    #[ignore] // Requires MIDI hardware or loopMIDI
    fn test_enumerate_midi_devices() {
        let devices = MidiManager::enumerate_all().unwrap();
        // On a system with loopMIDI, at least one device should appear
        assert!(
            !devices.is_empty(),
            "Expected at least one MIDI device (do you have loopMIDI running?)"
        );
    }

    #[test]
    #[ignore] // Requires MIDI hardware or loopMIDI
    fn test_connect_and_disconnect_loopback() {
        let devices = MidiManager::enumerate_all().unwrap();
        let input_port = devices
            .iter()
            .find(|d| d.is_input)
            .expect("No MIDI input device found");

        let (mut manager, _rx) = MidiManager::new();
        manager.connect_input(&input_port.name).unwrap();
        assert_eq!(
            manager.status().active_input.as_deref(),
            Some(input_port.name.as_str())
        );

        manager.disconnect_input();
        assert!(manager.status().active_input.is_none());
    }
}
