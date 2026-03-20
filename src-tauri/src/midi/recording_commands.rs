//! Tauri IPC commands for MIDI recording.
//!
//! These commands start and stop MIDI recording sessions. Recording captures
//! real-time MIDI input from the connected MIDI device, converts NoteOn/NoteOff
//! pairs into `PatternMidiNote` instances with beat positions derived from
//! `TransportAtomics`, and emits Tauri events for the frontend.

use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::bounded;
use tauri::{Emitter, State};

use super::recording::{
    current_beat_position, emit_note, snap_beat, MidiRecorderState, RecordMode, RecordQuantize,
    RecorderHandle, RecordingStartedEvent, RecordingStoppedEvent, RecordSession,
};
use crate::audio::commands::AudioEngineState;
use crate::audio::engine::AudioCommand;
use crate::audio::transport::TransportAtomics;
use crate::instruments::commands::TransportAtomicsState;
use crate::midi::commands::MidiManagerState;
use crate::midi::types::MidiEvent;

// ---------------------------------------------------------------------------
// start_midi_recording
// ---------------------------------------------------------------------------

/// Starts a MIDI recording session into the given pattern.
///
/// - Arms the transport for recording.
/// - Creates a fresh crossbeam channel for MIDI events.
/// - Registers the sender with `MidiManager`'s fan-out list.
/// - Stores a `RecorderHandle` in `MidiRecorderState`.
/// - Emits `"recording-started"` Tauri event.
/// - Spawns a background `std::thread` that drains the channel and emits
///   `"midi-recorded-note"` events when NoteOff completes a note pair.
#[tauri::command]
pub fn start_midi_recording(
    pattern_id: String,
    track_id: String,
    overdub: bool,
    quantize: RecordQuantize,
    recorder: State<MidiRecorderState>,
    midi_manager: State<MidiManagerState>,
    audio_engine: State<AudioEngineState>,
    transport_atomics: State<TransportAtomicsState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Stop any existing session first
    {
        let mut guard = recorder.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            *guard = None; // Signal old drain thread to exit
        }
    }

    // Prune dead senders from a previous recording
    {
        let mut mgr = midi_manager.lock().map_err(|e| e.to_string())?;
        mgr.cleanup_dead_senders();
    }

    // Arm transport for recording
    {
        let engine = audio_engine.lock().map_err(|e| e.to_string())?;
        if let Err(e) = engine.send_transport_command(
            AudioCommand::TransportSetRecordArmed(true),
        ) {
            log::warn!("Failed to arm transport: {}", e);
        }
    }

    let mode = if overdub { RecordMode::Overdub } else { RecordMode::Replace };
    let session_start_beats = current_beat_position(&transport_atomics);

    // Create MIDI event channel for this recording session
    let (tx, rx) = bounded::<crate::midi::types::TimestampedMidiEvent>(512);

    // Register sender with MIDI manager fan-out
    {
        let mut mgr = midi_manager.lock().map_err(|e| e.to_string())?;
        mgr.add_instrument_sender(tx);
    }

    // Store recorder handle
    let handle = RecorderHandle {
        session: RecordSession {
            pattern_id: pattern_id.clone(),
            track_id: track_id.clone(),
            quantize,
            mode,
            session_start_beats,
            pending: std::collections::HashMap::new(),
        },
    };
    {
        let mut guard = recorder.lock().map_err(|e| e.to_string())?;
        *guard = Some(handle);
    }

    // Emit recording-started event
    let mode_str = if overdub { "overdub" } else { "replace" }.to_string();
    if let Err(e) = app_handle.emit(
        "recording-started",
        &RecordingStartedEvent {
            pattern_id: pattern_id.clone(),
            track_id: track_id.clone(),
            mode: mode_str,
        },
    ) {
        log::warn!("Failed to emit recording-started: {}", e);
    }

    // Spawn drain thread
    let recorder_arc = recorder.inner().clone();
    let atomics_clone = transport_atomics.inner().clone();
    let app_handle_drain = app_handle.clone();

    std::thread::spawn(move || {
        drain_loop(rx, recorder_arc, atomics_clone, app_handle_drain);
    });

    log::info!("MIDI recording started: pattern={}, mode={}", pattern_id, if overdub { "overdub" } else { "replace" });
    Ok(())
}

/// Background drain loop: runs on a dedicated `std::thread`.
///
/// Receives MIDI events with a 20ms timeout. Processes NoteOn/NoteOff pairs
/// into completed notes, emitting `"midi-recorded-note"` for each. Exits when
/// the recorder state becomes `None` (set by `stop_midi_recording`).
pub fn drain_loop(
    rx: crossbeam_channel::Receiver<crate::midi::types::TimestampedMidiEvent>,
    recorder_arc: Arc<std::sync::Mutex<Option<RecorderHandle>>>,
    atomics: TransportAtomics,
    app_handle: tauri::AppHandle,
) {
    loop {
        // Check if session is still active
        let is_active = {
            match recorder_arc.lock() {
                Ok(guard) => guard.is_some(),
                Err(_) => false,
            }
        };
        if !is_active {
            break;
        }

        // Drain with timeout
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(stamped) => {
                let beat = current_beat_position(&atomics);
                let mut guard = match recorder_arc.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                let handle = match guard.as_mut() {
                    Some(h) => h,
                    None => break, // Session stopped
                };
                let session = &mut handle.session;

                match stamped.event {
                    MidiEvent::NoteOn { channel, note, velocity } => {
                        let snapped = snap_beat(beat, session.quantize);
                        session.pending.insert(
                            (channel, note),
                            super::recording::PendingNote {
                                pitch: note,
                                channel,
                                velocity,
                                start_beats: snapped,
                            },
                        );
                    }
                    MidiEvent::NoteOff { channel, note, .. } => {
                        if let Some(pending) = session.pending.remove(&(channel, note)) {
                            let pattern_id = session.pattern_id.clone();
                            emit_note(&app_handle, &pattern_id, &pending, beat);
                        }
                    }
                    _ => {} // Ignore CC, PitchBend, etc.
                }
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                // Normal — just loop and re-check active status
            }
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                break; // Channel closed
            }
        }
    }
    log::debug!("MIDI recording drain thread exiting");
}

// ---------------------------------------------------------------------------
// stop_midi_recording
// ---------------------------------------------------------------------------

/// Stops the active MIDI recording session.
///
/// - Takes the `RecorderHandle` from managed state (signals drain thread to exit).
/// - Flushes all pending (un-closed) NoteOn events as notes with duration =
///   `current_beat - start_beat`.
/// - Emits `"recording-stopped"` Tauri event.
/// - Disarms the transport record arm.
#[tauri::command]
pub fn stop_midi_recording(
    recorder: State<MidiRecorderState>,
    audio_engine: State<AudioEngineState>,
    transport_atomics: State<TransportAtomicsState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let stop_beat = current_beat_position(&transport_atomics);

    let taken = {
        let mut guard = recorder.lock().map_err(|e| e.to_string())?;
        guard.take() // Signals drain thread to exit
    };

    if let Some(handle) = taken {
        let session = handle.session;

        // Flush in-flight notes
        for (_, pending) in &session.pending {
            emit_note(&app_handle, &session.pattern_id, pending, stop_beat);
        }

        // Emit recording-stopped
        if let Err(e) = app_handle.emit(
            "recording-stopped",
            &RecordingStoppedEvent {
                pattern_id: session.pattern_id.clone(),
            },
        ) {
            log::warn!("Failed to emit recording-stopped: {}", e);
        }

        log::info!("MIDI recording stopped: pattern={}", session.pattern_id);
    }

    // Disarm transport
    {
        let engine = audio_engine.lock().map_err(|e| e.to_string())?;
        if let Err(e) = engine.send_transport_command(
            AudioCommand::TransportSetRecordArmed(false),
        ) {
            log::warn!("Failed to disarm transport: {}", e);
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// set_record_quantize
// ---------------------------------------------------------------------------

/// Updates the quantize grid for the active recording session.
///
/// If no session is active, this is a no-op (returns `Ok`).
#[tauri::command]
pub fn set_record_quantize(
    quantize: RecordQuantize,
    recorder: State<MidiRecorderState>,
) -> Result<(), String> {
    let mut guard = recorder.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.as_mut() {
        handle.session.quantize = quantize;
    }
    Ok(())
}
