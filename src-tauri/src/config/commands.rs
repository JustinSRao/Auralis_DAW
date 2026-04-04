//! Tauri IPC commands for application config (Sprint 27).
//!
//! `get_config`  — returns the current in-memory [`AppConfig`].
//! `save_config` — persists the new config to TOML and re-applies audio/MIDI settings.

use tauri::{AppHandle, Manager, State};

use super::{AppConfig, AppConfigState};
use crate::audio::commands::AudioEngineState;
use crate::midi::commands::MidiManagerState;

/// Returns the current in-memory application configuration.
#[tauri::command]
pub fn get_config(state: State<'_, AppConfigState>) -> Result<AppConfig, String> {
    let cfg = state.lock().map_err(|e| e.to_string())?;
    Ok(cfg.clone())
}

/// Persists `new_config` to TOML, updates managed state, and re-applies
/// audio device / engine settings and MIDI connections.
///
/// Audio device and engine-config changes are applied inline using the same
/// logic as the individual audio commands. MIDI connections are re-established
/// by disconnecting first, then reconnecting to the saved port names.
#[tauri::command]
pub async fn save_config(
    new_config: AppConfig,
    state: State<'_, AppConfigState>,
    app_handle: AppHandle,
    audio_engine: State<'_, AudioEngineState>,
    midi_manager: State<'_, MidiManagerState>,
) -> Result<(), String> {
    // 1. Obtain app data dir for the TOML file path.
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {e}"))?;

    // 2. Persist to disk first so the config is durable before we mutate state.
    super::save(&new_config, &app_data_dir).map_err(|e| e.to_string())?;

    // 3. Re-apply audio settings — device selection and engine config.
    //    These calls mirror the logic in audio::commands::set_audio_device /
    //    set_engine_config. We do NOT start the engine here; the UI handles that.
    {
        let mut eng = audio_engine.lock().map_err(|e| e.to_string())?;

        // Apply output device if specified.
        if let Some(ref name) = new_config.audio.output_device {
            if let Err(e) = eng.set_device(name, false) {
                log::warn!("save_config: failed to set output device '{}': {}", name, e);
            }
        }

        // Apply input device if specified.
        if let Some(ref name) = new_config.audio.input_device {
            if let Err(e) = eng.set_device(name, true) {
                log::warn!("save_config: failed to set input device '{}': {}", name, e);
            }
        }

        // Apply sample rate and buffer size.
        if let Err(e) = eng.set_config(
            Some(new_config.audio.sample_rate),
            Some(new_config.audio.buffer_size),
        ) {
            log::warn!("save_config: failed to apply engine config: {}", e);
        }
    }

    // 4. Re-apply MIDI connections.
    {
        let mut mgr = midi_manager.lock().map_err(|e| e.to_string())?;

        // Always disconnect first, then reconnect if a port name is set.
        mgr.disconnect_input();
        if let Some(ref port) = new_config.midi.active_input {
            if let Err(e) = mgr.connect_input(port) {
                log::warn!("save_config: failed to connect MIDI input '{}': {}", port, e);
            }
        }

        mgr.disconnect_output();
        if let Some(ref port) = new_config.midi.active_output {
            if let Err(e) = mgr.connect_output(port) {
                log::warn!("save_config: failed to connect MIDI output '{}': {}", port, e);
            }
        }
    }

    // 5. Update in-memory state last (so callers who read state see the new value).
    {
        let mut cfg = state.lock().map_err(|e| e.to_string())?;
        *cfg = new_config;
    }

    Ok(())
}
