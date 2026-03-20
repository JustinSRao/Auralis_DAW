//! Tauri IPC commands for MIDI file export.
//!
//! Both commands are stateless: the frontend passes all data needed for export
//! (notes, tempo points, time signature) as arguments. This follows the same
//! stateless pattern used throughout the project.

use std::path::Path;

use tauri::command;

use crate::audio::tempo_map::TempoPoint;
use super::export::{ExportNote, ExportOptions, ExportTrack, MidiExporter};

/// Exports a single pattern as a Type 0 MIDI file.
///
/// The frontend supplies the note list directly from the pattern store.
///
/// # Arguments
/// - `notes` — All notes in the pattern (beat positions from pattern start).
/// - `path` — Absolute filesystem path for the output file (from Tauri save dialog).
/// - `options` — Export configuration (PPQ).
/// - `tempo_points` — Full tempo map from `tempoMapStore`. Sorted ascending by tick.
/// - `time_sig_numerator` — Time signature numerator from transport state.
/// - `time_sig_denominator` — Time signature denominator from transport state.
///
/// # Errors
/// Returns a human-readable error string on file write failure.
#[command]
pub fn export_midi_pattern(
    notes: Vec<ExportNote>,
    path: String,
    options: ExportOptions,
    tempo_points: Vec<TempoPoint>,
    time_sig_numerator: u8,
    time_sig_denominator: u8,
) -> Result<(), String> {
    MidiExporter::export_pattern(
        &notes,
        Path::new(&path),
        &options,
        &tempo_points,
        time_sig_numerator,
        time_sig_denominator,
    )
}

/// Exports the full arrangement as a Type 1 MIDI file.
///
/// The frontend is responsible for:
/// 1. Iterating all arrangement clips grouped by `trackId`.
/// 2. For each clip, offsetting pattern note positions by `clip.startBar * beatsPerBar`.
/// 3. Passing the flattened, offset notes per track in `tracks`.
///
/// # Arguments
/// - `tracks` — One entry per DAW track, containing all notes with absolute beat positions.
/// - `path` — Absolute filesystem path for the output file.
/// - `options` — Export configuration (PPQ).
/// - `tempo_points` — Full tempo map.
/// - `time_sig_numerator` — Time signature numerator.
/// - `time_sig_denominator` — Time signature denominator.
///
/// # Errors
/// Returns a human-readable error string on file write failure.
#[command]
pub fn export_midi_arrangement(
    tracks: Vec<ExportTrack>,
    path: String,
    options: ExportOptions,
    tempo_points: Vec<TempoPoint>,
    time_sig_numerator: u8,
    time_sig_denominator: u8,
) -> Result<(), String> {
    MidiExporter::export_arrangement(
        &tracks,
        Path::new(&path),
        &options,
        &tempo_points,
        time_sig_numerator,
        time_sig_denominator,
    )
}
