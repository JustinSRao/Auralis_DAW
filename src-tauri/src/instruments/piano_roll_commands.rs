//! Tauri commands for Piano Roll preview functionality.
//!
//! The `preview_note` command fires a brief NoteOn → (delay) → NoteOff pair
//! through the synth's MIDI channel so the user hears a note when clicking
//! keys on the on-screen piano keyboard. The command is a no-op when no
//! instrument has been loaded yet.

use tauri::State;

use crate::midi::types::{MidiEvent, TimestampedMidiEvent};

use super::commands::SynthMidiTxState;

/// Trigger a brief preview note through the active synth instrument.
///
/// Sends a NoteOn immediately and schedules a NoteOff after `duration_ms`
/// milliseconds on a Tokio background task. If no synth is initialised the
/// call is silently ignored (returns `Ok(())`).
///
/// # Arguments
/// * `note`        — MIDI note number 0–127.
/// * `velocity`    — MIDI velocity 1–127.
/// * `duration_ms` — How long the note sounds, in milliseconds.
#[tauri::command]
pub async fn preview_note(
    synth_midi_tx: State<'_, SynthMidiTxState>,
    note: u8,
    velocity: u8,
    duration_ms: u64,
) -> Result<(), String> {
    // Clone the sender out of managed state so we can move it into the
    // background task without holding the mutex across the await point.
    let tx = {
        let guard = synth_midi_tx
            .lock()
            .map_err(|e| format!("Failed to lock synth MIDI tx: {e}"))?;
        guard.clone()
    };

    // Silent no-op when no instrument has been created yet.
    let Some(tx) = tx else {
        return Ok(());
    };

    let note_on = TimestampedMidiEvent {
        event: MidiEvent::NoteOn {
            channel: 0,
            note,
            velocity: velocity.clamp(1, 127),
        },
        timestamp_us: 0,
    };

    // try_send: never blocks — if the channel is full the preview is silently
    // dropped rather than stalling the Tauri async runtime.
    tx.try_send(note_on).ok();

    // Schedule NoteOff on a background task.
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(duration_ms)).await;

        let note_off = TimestampedMidiEvent {
            event: MidiEvent::NoteOff {
                channel: 0,
                note,
                velocity: 0,
            },
            timestamp_us: 0,
        };

        tx.try_send(note_off).ok();
    });

    Ok(())
}
