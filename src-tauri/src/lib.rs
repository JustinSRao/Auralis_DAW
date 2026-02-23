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

            // Initialize audio engine with default config
            let audio_engine: audio::commands::AudioEngineState =
                Arc::new(Mutex::new(audio::engine::AudioEngine::new()));
            app.manage(audio_engine);
            log::info!("Audio engine initialized");

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
