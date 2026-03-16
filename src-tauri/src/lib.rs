pub mod audio;
pub mod auth;
pub mod automation;
pub mod effects;
pub mod instruments;
pub mod midi;
pub mod project;
pub mod sequencer;
pub mod vst3;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use audio::transport::TransportSnapshot;
use audio::scheduler_commands::SchedulerCmdTxState;
use automation::commands::{AutomationCmdTxState, AutomationLaneStore};
use instruments::commands::{
    DrumAtomicsState, DrumCmdTxState, DrumPatternShadowState,
    SamplerCmdTxState, SamplerMidiTxState, SamplerState, SamplerZoneListState,
    SynthMidiTxState, SynthState, TransportAtomicsState,
};
use instruments::drum_machine::{DrumAtomics, DrumPadSnapshot};
use instruments::sampler::zone::SamplerParams;
use instruments::synth::lfo::{LfoParams, LfoParamsState};
use instruments::synth::params::SynthParams;
use project::commands::{ProjectManager, ProjectManagerState};
use sequencer::commands::{
    SequencerAtomicsState, SequencerCmdTxState, SequencerStepShadowState,
};
use sequencer::step::SequencerStepSnapshot;
use sequencer::step_sequencer::SequencerAtomics;
use project::track_commands::{
    create_track, delete_track, rename_track, reorder_tracks, set_track_color,
};
use project::pattern_commands::{
    create_pattern, rename_pattern, duplicate_pattern, delete_pattern, set_pattern_length,
};
use project::arrangement_commands::{
    add_arrangement_clip, move_arrangement_clip, resize_arrangement_clip,
    delete_arrangement_clip, duplicate_arrangement_clip,
};
use midi::import_commands::{import_midi_file, create_patterns_from_import};

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

            // --- Sprint 31: Arrangement scheduler command channel ---
            // The sender lives in managed state so Tauri commands can reach the scheduler.
            // The receiver is moved into the audio callback closure when the engine starts.
            let (scheduler_cmd_tx, scheduler_cmd_rx) =
                crossbeam_channel::bounded::<audio::scheduler::SchedulerCommand>(64);
            audio_engine.set_scheduler_receiver(scheduler_cmd_rx);
            let scheduler_cmd_tx_state: SchedulerCmdTxState =
                std::sync::Arc::new(std::sync::Mutex::new(Some(scheduler_cmd_tx)));
            app.manage(scheduler_cmd_tx_state);

            // --- Sprint 33: Create TransportAtomics BEFORE starting the engine ---
            // This lets the LFO (and future audio nodes) share the same atomics
            // that the engine's TransportClock will write to.
            let transport_atomics = audio::transport::TransportAtomics::new(120.0, 44100);
            // Inject into engine so build_and_start_stream uses these atomics
            audio_engine.set_transport_atomics(transport_atomics.clone());

            // Manage as TransportAtomicsState so Tauri commands can access them
            let transport_atomics_state: TransportAtomicsState = transport_atomics;
            app.manage(transport_atomics_state);

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

            // --- Sprint 6: Synthesizer managed state ---

            // Shared synth parameter store (Arc<SynthParams> — all atomics, lock-free from audio thread)
            let synth_params: SynthState = SynthParams::new();
            app.manage(synth_params);

            // Shared reference to the synth's MIDI sender half.
            // Initially `None`; populated by `create_synth_instrument` when the user
            // instantiates the synth. The `MidiManager::set_secondary_sender` wires it
            // into the MIDI callback fan-out so real-time events reach the audio thread.
            let synth_midi_tx: SynthMidiTxState = Arc::new(Mutex::new(None));
            app.manage(synth_midi_tx);

            // --- Sprint 33: LFO managed state ---
            // Two LFO parameter stores; both live in one struct because Tauri
            // can only manage one instance of a given type.
            let lfo_params_state = LfoParamsState {
                lfo1: LfoParams::new(),
                lfo2: LfoParams::new(),
            };
            app.manage(lfo_params_state);

            // --- Sprint 7: Sampler managed state ---

            let sampler_params: SamplerState = SamplerParams::new();
            app.manage(sampler_params);

            let sampler_midi_tx: SamplerMidiTxState = Arc::new(Mutex::new(None));
            app.manage(sampler_midi_tx);

            let sampler_cmd_tx: SamplerCmdTxState = Arc::new(Mutex::new(None));
            app.manage(sampler_cmd_tx);

            let sampler_zone_list: SamplerZoneListState = Arc::new(Mutex::new(Vec::new()));
            app.manage(sampler_zone_list);

            // --- Sprint 8: Drum Machine managed state ---

            let drum_atomics: DrumAtomicsState = DrumAtomics::new();
            app.manage(drum_atomics);

            let drum_cmd_tx: DrumCmdTxState = Arc::new(Mutex::new(None));
            app.manage(drum_cmd_tx);

            // Shadow pattern: 16 pads, 32 steps each (MAX_STEPS).
            // The audio thread stores all 32 steps; pattern_length controls how many are active.
            // Initialising with 32 here ensures set_drum_step never misses a step_idx in the shadow.
            let drum_shadow: DrumPatternShadowState = Arc::new(Mutex::new(
                (0..16u8)
                    .map(|i| DrumPadSnapshot::default_for_idx(i, 32))
                    .collect(),
            ));
            app.manage(drum_shadow);

            // --- Sprint 10: Step Sequencer managed state ---
            let seq_atomics: SequencerAtomicsState = SequencerAtomics::new();
            app.manage(seq_atomics);

            let seq_cmd_tx: SequencerCmdTxState = Arc::new(Mutex::new(None));
            app.manage(seq_cmd_tx);

            let seq_step_shadow: SequencerStepShadowState = Arc::new(Mutex::new(
                (0..64).map(|_| SequencerStepSnapshot::default()).collect(),
            ));
            app.manage(seq_step_shadow);

            // --- Sprint 14: Automation managed state ---

            // Lane store: Tauri-side source of truth for all automation lanes.
            let auto_lane_store: AutomationLaneStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(auto_lane_store);

            // Automation engine command sender: None until create_synth_instrument
            // populates it with a fresh channel when an instrument is instantiated.
            let auto_cmd_tx_state: AutomationCmdTxState =
                Arc::new(Mutex::new(None));
            app.manage(auto_cmd_tx_state);

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

            // --- Sprint 9: Audio Recorder managed state ---
            let (audio_recorder, rms_rx) = audio::recorder::AudioRecorder::new(44100);
            let audio_recorder_state: audio::recorder::AudioRecorderState =
                std::sync::Arc::new(std::sync::Mutex::new(audio_recorder));
            app.manage(audio_recorder_state);

            // Spawn RMS level poller (~30 Hz) — emits "input-level-changed" Tauri event
            let app_handle_rms = app.handle().clone();
            tokio::spawn(async move {
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_millis(33));
                let mut last_rms = -1.0f32;
                loop {
                    interval.tick().await;
                    let mut latest: Option<f32> = None;
                    while let Ok(rms) = rms_rx.try_recv() {
                        latest = Some(rms);
                    }
                    if let Some(rms) = latest {
                        if (rms - last_rms).abs() > 0.001 {
                            if let Err(e) =
                                app_handle_rms.emit("input-level-changed", rms)
                            {
                                log::warn!("Failed to emit input-level-changed: {}", e);
                            }
                            last_rms = rms;
                        }
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
            instruments::commands::create_synth_instrument,
            instruments::commands::set_synth_param,
            instruments::commands::get_synth_state,
            instruments::commands::create_sampler_instrument,
            instruments::commands::load_sample_zone,
            instruments::commands::remove_sample_zone,
            instruments::commands::set_sampler_param,
            instruments::commands::get_sampler_state,
            instruments::commands::create_drum_machine,
            instruments::commands::set_drum_step,
            instruments::commands::load_drum_pad_sample,
            instruments::commands::set_drum_swing,
            instruments::commands::set_drum_bpm,
            instruments::commands::set_drum_pattern_length,
            instruments::commands::drum_play,
            instruments::commands::drum_stop,
            instruments::commands::drum_reset,
            instruments::commands::get_drum_state,
            instruments::commands::set_lfo_param,
            instruments::commands::get_lfo_state,
            audio::commands::get_input_devices,
            audio::commands::set_input_device,
            audio::commands::start_recording,
            audio::commands::stop_recording,
            audio::commands::get_recording_status,
            audio::commands::set_monitoring_enabled,
            audio::commands::set_monitoring_gain,
            sequencer::commands::create_sequencer,
            sequencer::commands::set_sequencer_step,
            sequencer::commands::set_sequencer_length,
            sequencer::commands::set_sequencer_time_div,
            sequencer::commands::set_sequencer_transpose,
            sequencer::commands::get_sequencer_state,
            sequencer::commands::sequencer_play,
            sequencer::commands::sequencer_stop,
            sequencer::commands::sequencer_reset,
            instruments::piano_roll_commands::preview_note,
            create_pattern,
            rename_pattern,
            duplicate_pattern,
            delete_pattern,
            set_pattern_length,
            add_arrangement_clip,
            move_arrangement_clip,
            resize_arrangement_clip,
            delete_arrangement_clip,
            duplicate_arrangement_clip,
            automation::commands::set_automation_point,
            automation::commands::delete_automation_point,
            automation::commands::set_automation_interp,
            automation::commands::get_automation_lane,
            automation::commands::enable_automation_lane,
            automation::commands::record_automation_batch,
            audio::scheduler_commands::set_arrangement_clips,
            audio::scheduler_commands::register_scheduler_sender,
            import_midi_file,
            create_patterns_from_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
