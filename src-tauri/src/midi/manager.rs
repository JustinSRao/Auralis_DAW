use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use crossbeam_channel::{bounded, Receiver, Sender};
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use tauri::Emitter;

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
}

impl MidiManager {
    /// Creates a new `MidiManager` and returns the event receiver for the audio engine.
    ///
    /// The channel is bounded at 256 slots. If the channel fills up (e.g., the audio
    /// engine is stopped), incoming events are silently dropped rather than blocking
    /// the MIDI callback thread.
    pub fn new() -> (Self, Receiver<TimestampedMidiEvent>) {
        let (tx, rx) = bounded(256);
        let manager = Self {
            midi_in: None,
            midi_out: None,
            event_tx: tx,
            instrument_txs: Arc::new(Mutex::new(Vec::new())),
            active_input_port: None,
            active_output_port: None,
            scanner_handle: None,
            scanner_stop: Arc::new(AtomicBool::new(false)),
        };
        (manager, rx)
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
        let connection = midi_in
            .connect(
                &port,
                "music-app-input",
                move |timestamp_us, data, _| {
                    if let Some(event) = MidiEvent::from_bytes(data) {
                        let stamped = TimestampedMidiEvent {
                            event,
                            timestamp_us,
                        };
                        // Primary channel: audio engine (discard on full)
                        let _ = tx.try_send(stamped.clone());

                        // Fan-out: all registered instrument nodes receive a copy
                        if let Ok(guard) = instrument_txs_arc.lock() {
                            for itx in guard.iter() {
                                let _ = itx.try_send(stamped.clone());
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
