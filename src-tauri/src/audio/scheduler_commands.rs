//! Tauri IPC commands for the arrangement playback scheduler (Sprint 31).
//!
//! These commands bridge the React frontend and the [`super::scheduler::ArrangementScheduler`]
//! that lives on the audio thread.
//!
//! # Flow
//!
//! 1. Frontend calls [`set_arrangement_clips`] whenever the arrangement changes or
//!    the transport tempo changes. The frontend is responsible for converting bar
//!    positions to sample positions and expanding pattern MIDI notes.
//! 2. Frontend calls [`register_scheduler_sender`] after creating a synth instrument
//!    for a track so the scheduler can route NoteOn/NoteOff events to that instrument.

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::State;

use super::scheduler::{ScheduledNote, SchedulerCommand};
use crate::instruments::commands::SynthMidiTxState;

// ---------------------------------------------------------------------------
// Managed-state type alias
// ---------------------------------------------------------------------------

/// The sender half of the scheduler command channel, held in Tauri managed state.
///
/// `None` until the audio engine starts (the receiver is moved into the audio
/// callback closure at that point).
pub type SchedulerCmdTxState = Arc<Mutex<Option<crossbeam_channel::Sender<SchedulerCommand>>>>;

// ---------------------------------------------------------------------------
// IPC payload
// ---------------------------------------------------------------------------

/// A single pre-expanded MIDI note sent from the frontend.
///
/// The frontend is responsible for:
/// 1. Converting `start_bar` + `length_bars` to sample positions using the
///    current BPM and time signature from the transport store.
/// 2. Expanding each clip's MIDI notes into absolute-sample events.
///
/// All notes sent in one [`set_arrangement_clips`] call must be sorted
/// ascending by `on_sample`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledNotePayload {
    /// Absolute sample position of the NoteOn.
    pub on_sample: u64,
    /// Absolute sample position of the NoteOff.
    pub off_sample: u64,
    /// MIDI pitch `[0, 127]`.
    pub pitch: u8,
    /// MIDI velocity `[1, 127]`.
    pub velocity: u8,
    /// MIDI channel `[0, 15]`.
    pub channel: u8,
    /// Track ID — used by the scheduler to route to the correct instrument sender.
    pub track_id: String,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Replaces the scheduler's note list with a new pre-computed set.
///
/// Called by the frontend whenever:
/// - The arrangement clip list changes (add / move / resize / delete clip).
/// - BPM or time signature changes (sample positions would be stale otherwise).
/// - A project is loaded.
///
/// The frontend must sort `notes` ascending by `on_sample` before calling.
///
/// This command is a no-op if the audio engine is not running (the channel
/// sender is `None`), so it is safe to call from the frontend even before
/// the engine starts.
#[tauri::command]
pub fn set_arrangement_clips(
    notes: Vec<ScheduledNotePayload>,
    scheduler_cmd_tx: State<'_, SchedulerCmdTxState>,
) -> Result<(), String> {
    let scheduled: Vec<ScheduledNote> = notes
        .into_iter()
        .map(|n| ScheduledNote {
            on_sample: n.on_sample,
            off_sample: n.off_sample,
            pitch: n.pitch,
            velocity: n.velocity,
            channel: n.channel,
            track_id: n.track_id,
        })
        .collect();

    let guard = scheduler_cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock scheduler cmd tx: {}", e))?;

    if let Some(tx) = guard.as_ref() {
        tx.try_send(SchedulerCommand::SetNotes(scheduled))
            .map_err(|e| format!("Scheduler command channel full: {}", e))?;
    }
    // If the engine is not running yet, silently discard.
    Ok(())
}

/// Registers the current synth's MIDI sender with the scheduler for a track.
///
/// Call this from the frontend after [`create_synth_instrument`] succeeds.
/// The scheduler uses the registered sender to forward arrangement NoteOn/NoteOff
/// events to the synth for that track.
///
/// If the synth has not been initialized yet (no instrument created), returns
/// an error. If the scheduler is not running, returns `Ok(())`.
///
/// [`create_synth_instrument`]: crate::instruments::commands::create_synth_instrument
#[tauri::command]
pub fn register_scheduler_sender(
    track_id: String,
    synth_midi_tx: State<'_, SynthMidiTxState>,
    scheduler_cmd_tx: State<'_, SchedulerCmdTxState>,
) -> Result<(), String> {
    // Clone the synth MIDI sender.
    let tx = {
        let guard = synth_midi_tx
            .lock()
            .map_err(|e| format!("Failed to lock synth MIDI tx: {}", e))?;
        guard
            .as_ref()
            .ok_or_else(|| "Synth not yet initialized — call create_synth_instrument first".to_string())?
            .clone()
    };

    let guard = scheduler_cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock scheduler cmd tx: {}", e))?;

    if let Some(sched_tx) = guard.as_ref() {
        sched_tx
            .try_send(SchedulerCommand::SetTrackSender { track_id, tx })
            .map_err(|e| format!("Scheduler command channel full: {}", e))?;
    }
    Ok(())
}
