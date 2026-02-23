use std::sync::{Arc, Mutex};

use tauri::State;

use super::devices;
use super::engine::AudioEngine;
use super::types::*;

/// Type alias for the audio engine managed state in Tauri.
pub type AudioEngineState = Arc<Mutex<AudioEngine>>;

/// Enumerates all available ASIO and WASAPI audio devices.
#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    devices::enumerate_devices().map_err(|e| e.to_string())
}

/// Returns the current audio engine status.
#[tauri::command]
pub fn get_engine_status(engine: State<'_, AudioEngineState>) -> Result<EngineStatus, String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    Ok(eng.status())
}

/// Starts the audio engine with the current configuration.
#[tauri::command]
pub fn start_engine(engine: State<'_, AudioEngineState>) -> Result<EngineStatus, String> {
    let mut eng = engine.lock().map_err(|e| e.to_string())?;
    eng.start().map_err(|e| e.to_string())?;
    Ok(eng.status())
}

/// Stops the audio engine.
#[tauri::command]
pub fn stop_engine(engine: State<'_, AudioEngineState>) -> Result<EngineStatus, String> {
    let mut eng = engine.lock().map_err(|e| e.to_string())?;
    eng.stop().map_err(|e| e.to_string())?;
    Ok(eng.status())
}

/// Selects an audio input or output device by name. Engine must be stopped.
#[tauri::command]
pub fn set_audio_device(
    engine: State<'_, AudioEngineState>,
    device_name: String,
    is_input: bool,
) -> Result<EngineStatus, String> {
    let mut eng = engine.lock().map_err(|e| e.to_string())?;
    eng.set_device(&device_name, is_input)
        .map_err(|e| e.to_string())?;
    Ok(eng.status())
}

/// Updates engine sample rate and/or buffer size. Engine must be stopped.
#[tauri::command]
pub fn set_engine_config(
    engine: State<'_, AudioEngineState>,
    sample_rate: Option<u32>,
    buffer_size: Option<u32>,
) -> Result<EngineStatus, String> {
    let mut eng = engine.lock().map_err(|e| e.to_string())?;
    eng.set_config(sample_rate, buffer_size)
        .map_err(|e| e.to_string())?;
    Ok(eng.status())
}

/// Toggles the 440 Hz test tone on or off. Can be called while engine is running.
#[tauri::command]
pub fn set_test_tone(
    engine: State<'_, AudioEngineState>,
    enabled: bool,
) -> Result<(), String> {
    let mut eng = engine.lock().map_err(|e| e.to_string())?;
    eng.set_test_tone(enabled).map_err(|e| e.to_string())
}
