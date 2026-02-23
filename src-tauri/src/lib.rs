pub mod audio;
pub mod auth;
pub mod effects;
pub mod instruments;
pub mod midi;
pub mod project;
pub mod vst3;

use std::sync::{Arc, Mutex};

use tauri::Manager;

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Entry point for the Tauri application.
/// Initializes logging, the SQLite database, the audio engine, and the Tauri runtime
/// with all IPC handlers.
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            log::info!("Music Application starting up");

            // Initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("music_app.db");
            auth::db::initialize_database(&db_path)
                .expect("failed to initialize database");

            log::info!("Database initialized at {:?}", db_path);

            // Initialize MIDI manager and get the event receiver
            let (midi_manager, midi_rx) = midi::manager::MidiManager::new();

            // Initialize audio engine with MIDI event receiver
            let mut audio_engine = audio::engine::AudioEngine::new();
            audio_engine.set_midi_receiver(midi_rx);

            let audio_engine: audio::commands::AudioEngineState =
                Arc::new(Mutex::new(audio_engine));
            app.manage(audio_engine);
            log::info!("Audio engine initialized");

            // Manage MIDI state and start hot-plug scanner
            let midi_state: midi::commands::MidiManagerState =
                Arc::new(Mutex::new(midi_manager));
            {
                let mut mgr = midi_state
                    .lock()
                    .map_err(|e| format!("failed to lock MIDI manager: {e}"))?;
                if let Err(e) = mgr.start_hotplug_scanner(app.handle().clone()) {
                    log::warn!("Failed to start MIDI hot-plug scanner: {}", e);
                }
            }
            app.manage(midi_state);
            log::info!("MIDI manager initialized");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            auth::commands::login,
            auth::commands::register,
            auth::commands::logout,
            auth::commands::list_users,
            audio::commands::get_audio_devices,
            audio::commands::get_engine_status,
            audio::commands::start_engine,
            audio::commands::stop_engine,
            audio::commands::set_audio_device,
            audio::commands::set_engine_config,
            audio::commands::set_test_tone,
            midi::commands::get_midi_devices,
            midi::commands::get_midi_status,
            midi::commands::connect_midi_input,
            midi::commands::disconnect_midi_input,
            midi::commands::connect_midi_output,
            midi::commands::disconnect_midi_output,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
