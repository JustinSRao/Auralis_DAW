use std::sync::{Arc, Mutex};

use tauri::State;

use super::devices;
use super::engine::{AudioCommand, AudioEngine};
use super::transport::TransportSnapshot;
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

// ---------------------------------------------------------------------------
// Transport commands (Sprint 25)
// ---------------------------------------------------------------------------

/// Returns the current transport state snapshot.
#[tauri::command]
pub fn get_transport_state(
    engine: State<'_, AudioEngineState>,
) -> Result<TransportSnapshot, String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.get_transport_snapshot().map_err(|e| e.to_string())
}

/// Starts transport playback.
#[tauri::command]
pub fn transport_play(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportPlay)
        .map_err(|e| e.to_string())
}

/// Stops transport playback and resets the playhead.
#[tauri::command]
pub fn transport_stop(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportStop)
        .map_err(|e| e.to_string())
}

/// Pauses transport playback, holding the current position.
#[tauri::command]
pub fn transport_pause(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportPause)
        .map_err(|e| e.to_string())
}

/// Sets the BPM. Takes effect within the next audio buffer (< 6 ms).
#[tauri::command]
pub fn set_bpm(engine: State<'_, AudioEngineState>, bpm: f64) -> Result<(), String> {
    if !(20.0..=300.0).contains(&bpm) {
        return Err(format!("BPM must be between 20 and 300, got {}", bpm));
    }
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportSetBpm(bpm))
        .map_err(|e| e.to_string())
}

/// Sets the time signature.
#[tauri::command]
pub fn set_time_signature(
    engine: State<'_, AudioEngineState>,
    numerator: u8,
    denominator: u8,
) -> Result<(), String> {
    if numerator == 0 || denominator == 0 {
        return Err("Time signature numerator and denominator must be non-zero".to_string());
    }
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportSetTimeSignature {
        numerator,
        denominator,
    })
    .map_err(|e| e.to_string())
}

/// Sets the loop region in beats. Must have start < end and both ≥ 0.
#[tauri::command]
pub fn set_loop_region(
    engine: State<'_, AudioEngineState>,
    start_beats: f64,
    end_beats: f64,
) -> Result<(), String> {
    if start_beats < 0.0 || end_beats < 0.0 {
        return Err("Loop region must be non-negative".to_string());
    }
    if start_beats >= end_beats {
        return Err("Loop start must be less than loop end".to_string());
    }
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportSetLoopRegion {
        start_beats,
        end_beats,
    })
    .map_err(|e| e.to_string())
}

/// Enables or disables loop mode.
#[tauri::command]
pub fn toggle_loop(engine: State<'_, AudioEngineState>, enabled: bool) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportToggleLoop(enabled))
        .map_err(|e| e.to_string())
}

/// Enables or disables the metronome click track.
#[tauri::command]
pub fn toggle_metronome(
    engine: State<'_, AudioEngineState>,
    enabled: bool,
) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportToggleMetronome(enabled))
        .map_err(|e| e.to_string())
}

/// Sets the metronome click volume (0.0–1.0).
#[tauri::command]
pub fn set_metronome_volume(
    engine: State<'_, AudioEngineState>,
    volume: f32,
) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportSetMetronomeVolume(volume))
        .map_err(|e| e.to_string())
}

/// Sets the metronome click pitch in Hz (200–5000 Hz).
#[tauri::command]
pub fn set_metronome_pitch(
    engine: State<'_, AudioEngineState>,
    pitch_hz: f32,
) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportSetMetronomePitch(pitch_hz))
        .map_err(|e| e.to_string())
}

/// Arms or disarms a track for recording.
#[tauri::command]
pub fn set_record_armed(
    engine: State<'_, AudioEngineState>,
    armed: bool,
) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportSetRecordArmed(armed))
        .map_err(|e| e.to_string())
}

/// Starts recording. The track must already be armed via `set_record_armed`.
#[tauri::command]
pub fn transport_record(engine: State<'_, AudioEngineState>) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportRecord)
        .map_err(|e| e.to_string())
}

/// Seeks the playhead to a specific sample position. Only valid while paused or stopped.
#[tauri::command]
pub fn transport_seek(
    engine: State<'_, AudioEngineState>,
    position_samples: u64,
) -> Result<(), String> {
    let eng = engine.lock().map_err(|e| e.to_string())?;
    eng.send_transport_command(AudioCommand::TransportSeek(position_samples))
        .map_err(|e| e.to_string())
}
