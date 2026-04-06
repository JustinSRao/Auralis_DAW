pub mod audio;
pub mod audio_editing;
pub mod auth;
pub mod automation;
pub mod browser;
pub mod config;
pub mod effects;
pub mod instruments;
pub mod midi;
pub mod project;
pub mod sequencer;
pub mod vst3;

use midi::mapping::MappingRegistryState;

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
use midi::recording::MidiRecorderState;
use midi::recording_commands::{start_midi_recording, stop_midi_recording, set_record_quantize};
use midi::export_commands::{export_midi_pattern, export_midi_arrangement};
use audio::punch::PunchControllerState;
use audio::punch_commands::{set_punch_in, set_punch_out, toggle_punch_mode, get_punch_markers};
use audio::loop_recorder::{LoopRecordController, LoopRecordControllerState};
use audio::take_lane::{TakeLaneStore, TakeLaneStoreState};
use audio::take_commands::{TakeCreatedEvent, TakeRecordingStartedEvent};
use audio_editing::peak_cache::{ClipBufferCache, ClipBufferCacheState, PeakCache, PeakCacheState};
use audio_editing::processed_cache::{ProcessedBufferCache, ProcessedBufferCacheState};
use audio::mixer::{Mixer, commands::MixerState};
use audio::mixer::master::MasterLevelEvent;
use audio::mixer::mixer::ChannelLevelEvent;
use audio::export::ExportJobStateArc;
use vst3::{Vst3CmdTxState, Vst3GuiState, Vst3RegistryState};

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

            // --- Sprint 27: Load application config from TOML ---
            let app_config = config::load(&app_data_dir)
                .unwrap_or_else(|e| {
                    log::warn!("Failed to load app config, using defaults: {}", e);
                    config::AppConfig::default()
                });
            log::info!("App config loaded (sample_rate={}, buffer_size={})",
                app_config.audio.sample_rate, app_config.audio.buffer_size);
            let app_config_state: config::AppConfigState =
                std::sync::Arc::new(std::sync::Mutex::new(app_config.clone()));
            app.manage(app_config_state);

            // Initialize MIDI manager and get the event receiver
            let (mut midi_manager, midi_rx) = midi::manager::MidiManager::new();
            // Extract Sprint 29 arcs BEFORE managing the midi_manager.
            let mapping_registry: MappingRegistryState = midi_manager.mapping_registry();
            let learn_complete_rx = midi_manager
                .take_learn_complete_rx()
                .expect("learn_complete_rx always present at startup");

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

            // Manage as TransportAtomicsState so Tauri commands can access them.
            // Clone it before moving into managed state so the punch watcher task
            // (spawned later) can read transport position atomics.
            let transport_atomics_state: TransportAtomicsState = transport_atomics;
            let punch_watcher_atomics = transport_atomics_state.clone();
            // Also clone for the loop record watcher task (Sprint 44).
            let loop_watcher_atomics = transport_atomics_state.clone();
            app.manage(transport_atomics_state);

            // Clone the transport snapshot Arc BEFORE moving engine into managed state.
            // The 60 fps poller needs it without holding the engine mutex.
            // Also clone for the loop record watcher task (Sprint 44).
            let transport_snapshot: Arc<Mutex<TransportSnapshot>> =
                audio_engine.transport_snapshot.clone();
            let loop_watcher_snapshot = transport_snapshot.clone();

            // --- Sprint 41: Tempo map channel ---
            // Create the bounded-1 channel for main→audio tempo map updates.
            // The receiver is moved into the audio callback closure; the sender
            // lives in managed state so `set_tempo_map` can reach it.
            // Unbounded so rapid UI edits are never dropped; audio thread drains
            // all pending maps each callback and applies only the latest.
            let (tempo_map_tx, tempo_map_rx) =
                crossbeam_channel::unbounded::<Box<audio::tempo_map::CumulativeTempoMap>>();
            audio_engine.set_tempo_map_receiver(tempo_map_rx);

            // --- Sprint 37: Clip command channel (must be wired before engine is wrapped) ---
            let (clip_tx, clip_rx) = crossbeam_channel::bounded::<audio::clip_player::ClipCmd>(128);
            audio_engine.set_clip_cmd_receiver(clip_rx);

            let tempo_map_tx_state: audio::tempo_commands::TempoMapTxState =
                Arc::new(Mutex::new(Some(tempo_map_tx)));
            let tempo_map_snapshot_state: audio::tempo_commands::TempoMapSnapshotState =
                Arc::new(Mutex::new(audio::tempo_commands::default_points()));

            app.manage(tempo_map_tx_state);
            app.manage(tempo_map_snapshot_state);

            let audio_engine: audio::commands::AudioEngineState =
                Arc::new(Mutex::new(audio_engine));
            // Clone the Arc so the startup config apply block (Sprint 27) can
            // access the engine after it is moved into managed state.
            let audio_engine_for_config = audio_engine.clone();
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
            // Clone before managing so the loop record watcher task can access it.
            let loop_watcher_midi_manager = midi_state.clone();
            app.manage(midi_state.clone());
            // Sprint 29: Manage CC mapping registry and spawn learn-complete emitter
            app.manage(mapping_registry.clone());
            {
                let app_handle_learn = app.handle().clone();
                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_millis(16)).await;
                        while let Ok(evt) = learn_complete_rx.try_recv() {
                            let _ = app_handle_learn.emit("midi-learn-captured", &evt);
                        }
                    }
                });
            }
            log::info!("MIDI manager initialized");

            // --- Sprint 28: Browser preview player managed state ---
            let preview_player: browser::preview::PreviewPlayerState =
                Arc::new(Mutex::new(None));
            app.manage(preview_player);

            // --- Sprint 27: Apply saved config to audio engine and MIDI manager ---
            {
                let mut eng = audio_engine_for_config.lock()
                    .expect("failed to lock audio engine for config apply");
                if let Some(ref name) = app_config.audio.output_device {
                    if let Err(e) = eng.set_device(name, false) {
                        log::warn!("Startup config: failed to set output device '{}': {}", name, e);
                    }
                }
                if let Some(ref name) = app_config.audio.input_device {
                    if let Err(e) = eng.set_device(name, true) {
                        log::warn!("Startup config: failed to set input device '{}': {}", name, e);
                    }
                }
                if let Err(e) = eng.set_config(
                    Some(app_config.audio.sample_rate),
                    Some(app_config.audio.buffer_size),
                ) {
                    log::warn!("Startup config: failed to apply engine config: {}", e);
                }
            }
            {
                let mut mgr = midi_state.lock()
                    .expect("failed to lock MIDI manager for config apply");
                if let Some(ref port) = app_config.midi.active_input {
                    if let Err(e) = mgr.connect_input(port) {
                        log::warn!("Startup config: failed to connect MIDI input '{}': {}", port, e);
                    }
                }
                if let Some(ref port) = app_config.midi.active_output {
                    if let Err(e) = mgr.connect_output(port) {
                        log::warn!("Startup config: failed to connect MIDI output '{}': {}", port, e);
                    }
                }
            }

            // --- Sprint 36: MIDI Recorder managed state ---
            let midi_recorder: MidiRecorderState = Arc::new(Mutex::new(None));
            // Clone before managing so the loop record watcher task can access it.
            let loop_watcher_recorder = Arc::clone(&midi_recorder);
            app.manage(midi_recorder);

            // --- Sprint 9: Audio Recorder managed state ---
            // Created here (before Sprint 38 punch controller) so the punch watcher
            // task can capture a clone of the Arc before it's moved into managed state.
            let (audio_recorder, rms_rx) = audio::recorder::AudioRecorder::new(44100);
            let audio_recorder_state: audio::recorder::AudioRecorderState =
                std::sync::Arc::new(std::sync::Mutex::new(audio_recorder));
            // Clone before managing so the punch watcher task can access it.
            let punch_watcher_recorder = audio_recorder_state.clone();
            app.manage(audio_recorder_state);

            // --- Sprint 38: Punch controller managed state ---
            let punch_controller: PunchControllerState =
                Arc::new(Mutex::new(audio::punch::PunchController::new()));
            app.manage(punch_controller.clone());

            // Spawn punch watcher task (~50 Hz)
            let punch_watcher_punch = punch_controller.clone();
            let app_handle_punch = app.handle().clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(20));
                // Track last-known SPB to detect BPM changes and recalculate punch samples.
                let mut last_spb_bits: u64 = 0;
                loop {
                    interval.tick().await;
                    let playhead = punch_watcher_atomics.playhead_samples.load(std::sync::atomic::Ordering::Relaxed);
                    let is_playing = punch_watcher_atomics.is_playing.load(std::sync::atomic::Ordering::Relaxed);
                    let current_spb_bits = punch_watcher_atomics.samples_per_beat_bits.load(std::sync::atomic::Ordering::Relaxed);
                    let recorder_is_active = {
                        if let Ok(rec) = punch_watcher_recorder.lock() {
                            rec.atomics.state.load(std::sync::atomic::Ordering::Relaxed) == audio::recorder::REC_RECORDING
                        } else {
                            false
                        }
                    };
                    let action = {
                        if let Ok(mut punch) = punch_watcher_punch.lock() {
                            // If BPM changed, recalculate punch sample positions before tick.
                            if current_spb_bits != last_spb_bits {
                                let new_spb = f64::from_bits(current_spb_bits);
                                punch.recalculate_samples(new_spb);
                                last_spb_bits = current_spb_bits;
                            }
                            punch.tick(playhead, is_playing, recorder_is_active)
                        } else {
                            audio::punch::PunchAction::Nothing
                        }
                    };
                    match action {
                        audio::punch::PunchAction::StartAudioRecording => {
                            let mut rec = match punch_watcher_recorder.lock() { Ok(r) => r, Err(_) => continue };
                            if let Err(e) = rec.start_recording(app_handle_punch.clone()) {
                                log::warn!("Punch watcher: failed to start recording: {}", e);
                            }
                        }
                        audio::punch::PunchAction::StopAudioRecording => {
                            let mut rec = match punch_watcher_recorder.lock() { Ok(r) => r, Err(_) => continue };
                            if let Err(e) = rec.stop_recording() {
                                log::warn!("Punch watcher: failed to stop recording: {}", e);
                            }
                        }
                        audio::punch::PunchAction::StartMidiRecording => {
                            log::info!("Punch watcher: MIDI punch-in deferred to future sprint");
                        }
                        audio::punch::PunchAction::StopMidiRecording => {
                            log::info!("Punch watcher: MIDI punch-out deferred to future sprint");
                        }
                        audio::punch::PunchAction::Nothing => {}
                    }
                }
            });

            // --- Sprint 44: Take lane managed state ---
            let take_lane_store: TakeLaneStoreState = Arc::new(Mutex::new(TakeLaneStore::default()));
            app.manage(take_lane_store.clone());

            let loop_record_ctrl: LoopRecordControllerState =
                Arc::new(Mutex::new(LoopRecordController::new()));
            app.manage(loop_record_ctrl.clone());

            // Spawn loop record watcher task (~50 Hz)
            let loop_watcher_ctrl = loop_record_ctrl.clone();
            let loop_watcher_take_store = take_lane_store.clone();
            let loop_app_handle = app.handle().clone();
            tokio::spawn(async move {
                use std::sync::atomic::Ordering;
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(20));
                let mut last_spb_bits: u64 = 0;
                let mut take_counter: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
                loop {
                    interval.tick().await;

                    let playhead = loop_watcher_atomics.playhead_samples.load(Ordering::Relaxed);
                    let is_playing = loop_watcher_atomics.is_playing.load(Ordering::Relaxed);
                    let spb_bits = loop_watcher_atomics.samples_per_beat_bits.load(Ordering::Relaxed);

                    // Read loop region from transport snapshot
                    let (loop_start_samples, loop_end_samples, loop_start_beats, loop_end_beats, loop_enabled) = {
                        if let Ok(snap) = loop_watcher_snapshot.try_lock() {
                            let spb = f64::from_bits(spb_bits);
                            let start_beats = if spb > 0.0 { snap.loop_start_samples as f64 / spb } else { 0.0 };
                            let end_beats = if spb > 0.0 { snap.loop_end_samples as f64 / spb } else { 0.0 };
                            (snap.loop_start_samples, snap.loop_end_samples, start_beats, end_beats, snap.loop_enabled)
                        } else {
                            continue;
                        }
                    };

                    let action = {
                        if let Ok(mut ctrl) = loop_watcher_ctrl.lock() {
                            if spb_bits != last_spb_bits {
                                let new_spb = f64::from_bits(spb_bits);
                                ctrl.recalculate_samples(new_spb);
                                last_spb_bits = spb_bits;
                            }
                            ctrl.update_loop_region(
                                loop_start_samples, loop_end_samples,
                                loop_start_beats, loop_end_beats, loop_enabled,
                            );
                            ctrl.tick(playhead, is_playing)
                        } else {
                            audio::loop_recorder::LoopRecordAction::Nothing
                        }
                    };

                    if let audio::loop_recorder::LoopRecordAction::LoopWrapped = action {
                        let track_id = {
                            if let Ok(ctrl) = loop_watcher_ctrl.lock() {
                                ctrl.track_id.clone()
                            } else {
                                None
                            }
                        };
                        let Some(track_id) = track_id else { continue };

                        // --- Finalize current take ---
                        let spb = f64::from_bits(spb_bits);
                        let stop_beat = if spb > 0.0 {
                            loop_end_samples as f64 / spb
                        } else {
                            loop_end_beats
                        };
                        let completed_pattern_id = {
                            let mut guard = match loop_watcher_recorder.lock() {
                                Ok(g) => g,
                                Err(_) => continue,
                            };
                            if let Some(handle) = guard.take() {
                                // Flush pending notes
                                for (_, pending) in &handle.session.pending {
                                    midi::recording::emit_note(
                                        &loop_app_handle,
                                        &handle.session.pattern_id,
                                        pending,
                                        stop_beat,
                                    );
                                }
                                // Emit recording-stopped for old pattern
                                let _ = loop_app_handle.emit(
                                    "recording-stopped",
                                    &midi::recording::RecordingStoppedEvent {
                                        pattern_id: handle.session.pattern_id.clone(),
                                    },
                                );
                                Some(handle.session.pattern_id)
                            } else {
                                None
                            }
                        };

                        let Some(old_pattern_id) = completed_pattern_id else { continue };

                        // --- Create Take record ---
                        let take_num = {
                            let counter = take_counter.entry(track_id.clone()).or_insert(0);
                            *counter += 1;
                            *counter
                        };
                        let take = audio::take_lane::Take {
                            id: uuid::Uuid::new_v4().to_string(),
                            pattern_id: old_pattern_id,
                            take_number: take_num,
                            track_id: track_id.clone(),
                            loop_start_beats,
                            loop_end_beats,
                            is_active: true,
                        };
                        {
                            if let Ok(mut store) = loop_watcher_take_store.lock() {
                                store.add_take(&track_id, take.clone());
                            }
                        }
                        let _ = loop_app_handle.emit("take-created", &TakeCreatedEvent {
                            take,
                            track_id: track_id.clone(),
                        });

                        // --- Start new take ---
                        let new_pattern_id = uuid::Uuid::new_v4().to_string();
                        let next_take_num = take_counter.get(&track_id).copied().unwrap_or(0) + 1;
                        let _ = loop_app_handle.emit("take-recording-started", &TakeRecordingStartedEvent {
                            track_id: track_id.clone(),
                            pattern_id: new_pattern_id.clone(),
                            take_number: next_take_num,
                        });

                        // Create fresh MIDI drain channel and start new recording session
                        let (tx, rx) = crossbeam_channel::bounded::<midi::types::TimestampedMidiEvent>(512);
                        {
                            let mut mgr = match loop_watcher_midi_manager.lock() {
                                Ok(g) => g,
                                Err(_) => continue,
                            };
                            mgr.cleanup_dead_senders();
                            mgr.add_instrument_sender(tx);
                        }
                        let new_handle = midi::recording::RecorderHandle {
                            session: midi::recording::RecordSession {
                                pattern_id: new_pattern_id,
                                track_id: track_id.clone(),
                                quantize: midi::recording::RecordQuantize::Off,
                                mode: midi::recording::RecordMode::Overdub,
                                session_start_beats: loop_start_beats,
                                pending: std::collections::HashMap::new(),
                            },
                        };
                        {
                            let mut guard = match loop_watcher_recorder.lock() {
                                Ok(g) => g,
                                Err(_) => continue,
                            };
                            *guard = Some(new_handle);
                        }
                        let recorder_arc2 = Arc::clone(&loop_watcher_recorder);
                        let atomics_clone2 = loop_watcher_atomics.clone();
                        let app_drain = loop_app_handle.clone();
                        std::thread::spawn(move || {
                            midi::recording_commands::drain_loop(rx, recorder_arc2, atomics_clone2, app_drain);
                        });
                    }
                }
            });

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

            // --- Sprint 15: Waveform editor caches ---
            let clip_buffer_cache: ClipBufferCacheState =
                Arc::new(Mutex::new(ClipBufferCache::default()));
            app.manage(clip_buffer_cache);

            let peak_cache: PeakCacheState =
                Arc::new(Mutex::new(PeakCache::default()));
            app.manage(peak_cache);

            // --- Sprint 16: Processed buffer cache (time-stretch / pitch-shift) ---
            let processed_cache: ProcessedBufferCacheState =
                Arc::new(Mutex::new(ProcessedBufferCache::new()));
            app.manage(processed_cache);

            // --- Sprint 17: Mixer ---
            let (master_level_tx, master_level_rx) =
                crossbeam_channel::bounded::<MasterLevelEvent>(64);
            let (channel_level_tx, channel_level_rx) =
                crossbeam_channel::bounded::<ChannelLevelEvent>(64);
            let mixer = Mixer::new(256, master_level_tx, channel_level_tx);
            let mixer_state: MixerState = Arc::new(Mutex::new(mixer));
            app.manage(mixer_state);
            log::info!("Mixer initialized");

            // --- Sprint 18: EQ store ---
            let eq_store: effects::eq::EqStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(eq_store);
            log::info!("EQ store initialized");

            // --- Sprint 20: Dynamics stores ---
            let compressor_store: effects::dynamics::CompressorStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(compressor_store);
            let limiter_store: effects::dynamics::LimiterStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(limiter_store);
            let gate_store: effects::dynamics::GateStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(gate_store);
            log::info!("Dynamics stores initialized");

            // --- Sprint 19: Reverb store ---
            let reverb_store: effects::reverb::ReverbStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(reverb_store);
            log::info!("Reverb store initialized");

            // --- Sprint 19: Delay store ---
            let delay_store: effects::delay::DelayStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(delay_store);
            log::info!("Delay store initialized");

            // --- Sprint 37: Audio clip player stores ---
            let clip_cmd_tx_state: audio::clip_player::ClipCmdSenderState = Arc::new(clip_tx);
            app.manage(clip_cmd_tx_state);
            let clip_store: audio::clip_player::ClipStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(clip_store);
            log::info!("Clip player stores initialized");

            // --- Sprint 21: Effect chain store ---
            let chain_store: audio::effect_chain::ChainStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(chain_store);
            let preset_store: audio::effect_chain::PresetStore =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(preset_store);
            log::info!("Effect chain stores initialized");

            // --- Sprint 39: Sidechain router ---
            let sidechain_router: audio::mixer::sidechain::SidechainRouterStore =
                Arc::new(Mutex::new(audio::mixer::sidechain::SidechainRouter::new()));
            app.manage(sidechain_router);
            log::info!("Sidechain router initialized");

            // --- Sprint 22: Audio export job state ---
            let export_job_state: ExportJobStateArc =
                Arc::new(Mutex::new(None));
            app.manage(export_job_state);
            log::info!("Export job state initialized");

            // --- Sprint 23: VST3 plugin registry and command-channel map ---
            let vst3_registry: Vst3RegistryState =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(vst3_registry);
            let vst3_cmd_tx_map: Vst3CmdTxState =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(vst3_cmd_tx_map);
            log::info!("VST3 plugin host initialized");

            // --- Sprint 24: VST3 GUI bridge state ---
            let vst3_gui_state: Vst3GuiState =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            app.manage(vst3_gui_state);
            log::info!("VST3 GUI bridge state initialized");

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

            // Spawn mixer master level poller (~30 Hz) — emits "master_level_changed" Tauri event
            let app_handle_master_level = app.handle().clone();
            tokio::spawn(async move {
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_millis(33));
                loop {
                    interval.tick().await;
                    let mut latest: Option<MasterLevelEvent> = None;
                    while let Ok(evt) = master_level_rx.try_recv() {
                        latest = Some(evt);
                    }
                    if let Some(evt) = latest {
                        if let Err(e) = app_handle_master_level.emit("master_level_changed", serde_json::json!({
                            "peak_l": evt.peak_l,
                            "peak_r": evt.peak_r,
                        })) {
                            log::warn!("Failed to emit master_level_changed: {}", e);
                        }
                    }
                }
            });

            // Spawn mixer channel level poller (~30 Hz) — emits "channel_level_changed" Tauri event
            let app_handle_channel_level = app.handle().clone();
            tokio::spawn(async move {
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_millis(33));
                loop {
                    interval.tick().await;
                    // Drain all pending channel level events, keeping latest per channel
                    let mut latest: std::collections::HashMap<String, ChannelLevelEvent> =
                        std::collections::HashMap::new();
                    while let Ok(evt) = channel_level_rx.try_recv() {
                        latest.insert(evt.channel_id.clone(), evt);
                    }
                    for evt in latest.values() {
                        if let Err(e) = app_handle_channel_level.emit("channel_level_changed", serde_json::json!({
                            "channel_id": evt.channel_id,
                            "peak_l": evt.peak_l,
                            "peak_r": evt.peak_r,
                        })) {
                            log::warn!("Failed to emit channel_level_changed: {}", e);
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
        .on_window_event(|window, event| {
            // On window destruction, drop all open VST3 GUI bridges so their
            // Win32 child windows are destroyed and IPlugView::removed is called.
            if let tauri::WindowEvent::Destroyed = event {
                let app_handle = window.app_handle().clone();
                // Clone the Arc out of managed state; use a tight block so the
                // MutexGuard is dropped before gui_arc goes out of scope.
                let gui_arc: Vst3GuiState =
                    Arc::clone(&*app_handle.state::<Vst3GuiState>());
                {
                    if let Ok(mut gs) = gui_arc.lock() {
                        gs.clear();
                    };
                }
            }
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
            midi::commands::start_midi_learn,
            midi::commands::cancel_midi_learn,
            midi::commands::delete_midi_mapping,
            midi::commands::get_midi_mappings,
            midi::commands::load_midi_mappings,
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
            start_midi_recording,
            stop_midi_recording,
            set_record_quantize,
            set_punch_in,
            set_punch_out,
            toggle_punch_mode,
            get_punch_markers,
            audio::tempo_commands::set_tempo_map,
            audio::tempo_commands::get_tempo_map,
            export_midi_pattern,
            export_midi_arrangement,
            audio::take_commands::get_take_lanes,
            audio::take_commands::set_active_take,
            audio::take_commands::delete_take,
            audio::take_commands::arm_loop_recording,
            audio::take_commands::toggle_take_lane_expanded,
            audio_editing::commands::get_peak_data,
            audio_editing::commands::find_zero_crossing_cmd,
            audio_editing::commands::compute_cut_clip,
            audio_editing::commands::compute_trim_start_clip,
            audio_editing::commands::compute_trim_end_clip,
            audio_editing::commands::reverse_clip_region,
            audio_editing::commands::invalidate_clip_cache,
            audio_editing::stretch_commands::set_clip_time_stretch,
            audio_editing::stretch_commands::set_clip_pitch_shift,
            audio_editing::stretch_commands::bake_clip_stretch,
            audio_editing::stretch_commands::compute_bpm_stretch_ratio,
            audio::mixer::commands::get_mixer_state,
            audio::mixer::commands::set_channel_fader,
            audio::mixer::commands::set_channel_pan,
            audio::mixer::commands::set_channel_mute,
            audio::mixer::commands::set_channel_solo,
            audio::mixer::commands::set_channel_send,
            audio::mixer::commands::set_master_fader,
            audio::mixer::commands::add_mixer_channel,
            audio::mixer::commands::remove_mixer_channel,
            effects::eq::set_eq_band,
            effects::eq::enable_eq_band,
            effects::eq::get_eq_state,
            effects::eq::get_eq_frequency_response,
            effects::dynamics::set_compressor_param,
            effects::dynamics::get_compressor_state,
            effects::dynamics::set_limiter_param,
            effects::dynamics::get_limiter_state,
            effects::dynamics::set_gate_param,
            effects::dynamics::get_gate_state,
            effects::reverb::set_reverb_param,
            effects::reverb::get_reverb_state,
            effects::delay::set_delay_param,
            effects::delay::set_delay_sync,
            effects::delay::get_delay_state,
            audio::clip_player::load_audio_clip,
            audio::clip_player::set_clip_gain,
            audio::clip_player::set_clip_offset,
            audio::clip_player::trigger_audio_clip,
            audio::clip_player::stop_audio_clip,
            audio::clip_player::get_clip_state,
            audio::clip_player::get_waveform_peaks,
            audio::effect_chain::add_effect_to_chain,
            audio::effect_chain::remove_effect_from_chain,
            audio::effect_chain::move_effect_in_chain,
            audio::effect_chain::bypass_effect,
            audio::effect_chain::set_effect_wet_dry,
            audio::effect_chain::get_chain_state,
            audio::effect_chain::save_chain_preset,
            audio::effect_chain::load_chain_preset,
            audio::effect_chain::list_chain_presets,
            audio::mixer::sidechain_commands::set_sidechain_source,
            audio::mixer::sidechain_commands::remove_sidechain,
            audio::mixer::sidechain_commands::set_sidechain_filter,
            audio::mixer::group_bus_commands::create_group_bus,
            audio::mixer::group_bus_commands::delete_group_bus,
            audio::mixer::group_bus_commands::rename_group_bus,
            audio::mixer::group_bus_commands::set_channel_output,
            audio::mixer::group_bus_commands::set_group_bus_output,
            audio::mixer::group_bus_commands::set_group_bus_fader,
            audio::mixer::group_bus_commands::set_group_bus_pan,
            audio::mixer::group_bus_commands::set_group_bus_mute,
            audio::mixer::group_bus_commands::set_group_bus_solo,
            audio::mixer::group_bus_commands::get_group_bus_state,
            audio::fade_commands::set_clip_fade_in,
            audio::fade_commands::set_clip_fade_out,
            audio::fade_commands::set_fade_curve_type,
            audio::fade_commands::set_crossfade,
            audio::fade_commands::get_clip_fade_state,
            audio::export::commands::start_export,
            audio::export::commands::cancel_export,
            audio::export::commands::get_export_progress,
            vst3::commands::scan_vst3_plugins,
            vst3::commands::load_vst3_plugin,
            vst3::commands::unload_vst3_plugin,
            vst3::commands::set_vst3_param,
            vst3::commands::get_vst3_params,
            vst3::commands::save_vst3_state,
            vst3::commands::load_vst3_state,
            vst3::commands::open_plugin_gui,
            vst3::commands::close_plugin_gui,
            vst3::commands::resize_plugin_gui,
            vst3::commands::get_plugin_presets,
            vst3::commands::apply_plugin_preset,
            config::commands::get_config,
            config::commands::save_config,
            browser::list_directory,
            browser::get_drives,
            browser::preview::start_preview,
            browser::preview::stop_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
