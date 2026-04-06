use std::sync::{Arc, Mutex};

use tauri::State;

use super::manager::MidiManager;
use super::mapping::{MidiMapping, MappingRegistryState};
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

// ---------------------------------------------------------------------------
// Sprint 29: MIDI Learn commands
// ---------------------------------------------------------------------------

/// Enters MIDI learn mode for `param_id` with the given native range.
///
/// The next incoming CC on any channel will be bound to this parameter.
/// The range `[min_value, max_value]` is stored immediately so the callback
/// can create the mapping with correct scaling.
#[tauri::command]
pub fn start_midi_learn(
    midi: State<'_, MidiManagerState>,
    mapping_registry: State<'_, MappingRegistryState>,
    param_id: String,
    min_value: f32,
    max_value: f32,
) -> Result<(), String> {
    // Pre-register a placeholder mapping with the given range so the callback
    // can retrieve it without needing to be told the range at CC-capture time.
    {
        let mut reg = mapping_registry.lock().map_err(|e| e.to_string())?;
        reg.add_mapping(MidiMapping {
            param_id: param_id.clone(),
            cc: 0,           // will be overwritten when CC arrives
            channel: None,
            min_value,
            max_value,
        });
    }
    // Set pending learn
    let mgr = midi.lock().map_err(|e| e.to_string())?;
    let pending = mgr.pending_learn_arc();
    *pending.lock().map_err(|e| e.to_string())? = Some(param_id);
    Ok(())
}

/// Cancels any in-progress MIDI learn without creating a mapping.
#[tauri::command]
pub fn cancel_midi_learn(midi: State<'_, MidiManagerState>) -> Result<(), String> {
    let mgr = midi.lock().map_err(|e| e.to_string())?;
    let pending = mgr.pending_learn_arc();
    *pending.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Removes the CC mapping for `param_id`.
#[tauri::command]
pub fn delete_midi_mapping(
    mapping_registry: State<'_, MappingRegistryState>,
    param_id: String,
) -> Result<(), String> {
    let mut reg = mapping_registry.lock().map_err(|e| e.to_string())?;
    reg.remove_mapping(&param_id);
    Ok(())
}

/// Returns all active CC → parameter mappings.
#[tauri::command]
pub fn get_midi_mappings(
    mapping_registry: State<'_, MappingRegistryState>,
) -> Result<Vec<MidiMapping>, String> {
    let reg = mapping_registry.lock().map_err(|e| e.to_string())?;
    Ok(reg.get_mappings())
}

/// Replaces the mapping table (called on project load).
#[tauri::command]
pub fn load_midi_mappings(
    mapping_registry: State<'_, MappingRegistryState>,
    mappings: Vec<MidiMapping>,
) -> Result<(), String> {
    let mut reg = mapping_registry.lock().map_err(|e| e.to_string())?;
    reg.load_mappings(mappings);
    Ok(())
}
