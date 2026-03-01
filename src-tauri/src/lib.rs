pub mod audio;
pub mod auth;
pub mod effects;
pub mod instruments;
pub mod midi;
pub mod project;
pub mod vst3;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use audio::transport::TransportSnapshot;
use project::commands::{ProjectManager, ProjectManagerState};
use project::track_commands::{
    create_track, delete_track, rename_track, reorder_tracks, set_track_color,
};

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

            // Clone the transport snapshot Arc BEFORE moving engine into managed state.
            // The 60 fps poller needs it without holding the engine mutex.
            let transport_snapshot: Arc<Mutex<TransportSnapshot>> =
                audio_engine.transport_snapshot.clone();

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

            // Initialize project manager
            let pm_state: ProjectManagerState =
                Arc::new(Mutex::new(ProjectManager::new()));
            app.manage(pm_state.clone());
            log::info!("Project manager initialized");

            // Spawn ~60 fps transport state poller.
            // Reads the shared TransportSnapshot (updated by the audio thread via try_lock)
            // and emits a "transport-state" Tauri event only when the snapshot changes.
            // This keeps the audio thread and the UI decoupled.
            let app_handle_transport = app.handle().clone();
            tokio::spawn(async move {
                let mut last_emitted = TransportSnapshot::default();
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_millis(16));
                loop {
                    interval.tick().await;
                    let current = match transport_snapshot.lock() {
                        Ok(snap) => snap.clone(),
                        Err(_) => continue,
                    };
                    if current != last_emitted {
                        if let Err(e) = app_handle_transport.emit("transport-state", &current) {
                            log::warn!("Failed to emit transport-state event: {}", e);
                        }
                        last_emitted = current;
                    }
                }
            });

            // Spawn auto-save background task (fires every 300 seconds)
            let pm_clone = pm_state.clone();
            tokio::spawn(async move {
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_secs(300));
                loop {
                    interval.tick().await;

                    // Lock, check dirty, clone project + path if dirty, then unlock
                    // before the potentially slow file I/O.
                    let save_data = {
                        let mut mgr = match pm_clone.lock() {
                            Ok(m) => m,
                            Err(e) => {
                                log::warn!("Auto-save: failed to lock ProjectManager: {}", e);
                                continue;
                            }
                        };
                        mgr.take_dirty_snapshot()
                    };

                    if let Some((project, path)) = save_data {
                        let autosave_path = path.with_extension("autosave.mapp");
                        if let Err(e) =
                            project::io::save_project(&project, &autosave_path, None)
                        {
                            log::warn!("Auto-save failed: {}", e);
                        } else {
                            log::info!("Auto-saved to {:?}", autosave_path);
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            auth::commands::login,
            auth::commands::register,
            auth::commands::logout,
            auth::commands::list_users,
            auth::commands::get_current_user,
            audio::commands::get_audio_devices,
            audio::commands::get_engine_status,
            audio::commands::start_engine,
            audio::commands::stop_engine,
            audio::commands::set_audio_device,
            audio::commands::set_engine_config,
            audio::commands::set_test_tone,
            audio::commands::get_transport_state,
            audio::commands::transport_play,
            audio::commands::transport_stop,
            audio::commands::transport_pause,
            audio::commands::set_bpm,
            audio::commands::set_time_signature,
            audio::commands::set_loop_region,
            audio::commands::toggle_loop,
            audio::commands::toggle_metronome,
            audio::commands::set_metronome_volume,
            audio::commands::set_metronome_pitch,
            audio::commands::set_record_armed,
            audio::commands::transport_record,
            audio::commands::transport_seek,
            midi::commands::get_midi_devices,
            midi::commands::get_midi_status,
            midi::commands::connect_midi_input,
            midi::commands::disconnect_midi_input,
            midi::commands::connect_midi_output,
            midi::commands::disconnect_midi_output,
            project::commands::new_project,
            project::commands::save_project,
            project::commands::load_project,
            project::commands::get_recent_projects,
            project::commands::mark_project_dirty,
            create_track,
            rename_track,
            delete_track,
            reorder_tracks,
            set_track_color,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
