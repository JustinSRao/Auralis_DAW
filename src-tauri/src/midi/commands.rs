use std::sync::{Arc, Mutex};

use tauri::State;

use super::manager::MidiManager;
use super::types::*;

/// Type alias for the MIDI manager managed state in Tauri.
pub type MidiManagerState = Arc<Mutex<MidiManager>>;

/// Enumerates all available MIDI input and output devices.
#[tauri::command]
pub fn get_midi_devices() -> Result<Vec<MidiDeviceInfo>, String> {
    MidiManager::enumerate_all().map_err(|e| e.to_string())
}

/// Returns the current MIDI connection status.
#[tauri::command]
pub fn get_midi_status(midi: State<'_, MidiManagerState>) -> Result<MidiStatus, String> {
    let mgr = midi.lock().map_err(|e| e.to_string())?;
    Ok(mgr.status())
}

/// Connects to a MIDI input port by name.
#[tauri::command]
pub fn connect_midi_input(
    midi: State<'_, MidiManagerState>,
    port_name: String,
) -> Result<MidiStatus, String> {
    let mut mgr = midi.lock().map_err(|e| e.to_string())?;
    mgr.connect_input(&port_name).map_err(|e| e.to_string())?;
    Ok(mgr.status())
}

/// Disconnects the active MIDI input port.
#[tauri::command]
pub fn disconnect_midi_input(midi: State<'_, MidiManagerState>) -> Result<MidiStatus, String> {
    let mut mgr = midi.lock().map_err(|e| e.to_string())?;
    mgr.disconnect_input();
    Ok(mgr.status())
}

/// Connects to a MIDI output port by name.
#[tauri::command]
pub fn connect_midi_output(
    midi: State<'_, MidiManagerState>,
    port_name: String,
) -> Result<MidiStatus, String> {
    let mut mgr = midi.lock().map_err(|e| e.to_string())?;
    mgr.connect_output(&port_name).map_err(|e| e.to_string())?;
    Ok(mgr.status())
}

/// Disconnects the active MIDI output port.
#[tauri::command]
pub fn disconnect_midi_output(midi: State<'_, MidiManagerState>) -> Result<MidiStatus, String> {
    let mut mgr = midi.lock().map_err(|e| e.to_string())?;
    mgr.disconnect_output();
    Ok(mgr.status())
}
