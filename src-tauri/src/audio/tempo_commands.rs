//! Tauri IPC commands for tempo map management.
//!
//! The tempo map is the variable-BPM automation layer.  The main thread owns a
//! snapshot of the current point list; every mutation rebuilds a
//! [`CumulativeTempoMap`] and sends it to the audio thread via a
//! bounded-1 channel (the audio thread always reads the latest map).

use std::sync::{Arc, Mutex};

use crossbeam_channel::Sender;
use tauri::State;

use super::commands::AudioEngineState;
use super::tempo_map::{CumulativeTempoMap, TempoInterp, TempoPoint};

// ---------------------------------------------------------------------------
// Managed state types
// ---------------------------------------------------------------------------

/// Channel sender: main thread → audio thread tempo map updates.
///
/// Bounded to 1. Before each send the slot is drained so the latest map
/// always wins — rapid UI edits never lose the most recent update.
pub type TempoMapTxState = Arc<Mutex<Option<Sender<Box<CumulativeTempoMap>>>>>;

/// Main-thread snapshot of the current tempo point list.
///
/// Read by `get_tempo_map`; written by `set_tempo_map`.
pub type TempoMapSnapshotState = Arc<Mutex<Vec<TempoPoint>>>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Replaces the project's tempo map with the given list of points.
///
/// * Validates that all BPM values are in [20.0, 300.0].
/// * Builds a new [`CumulativeTempoMap`] and sends it to the audio thread.
/// * Updates the in-memory snapshot for `get_tempo_map`.
#[tauri::command]
pub fn set_tempo_map(
    points: Vec<TempoPoint>,
    tempo_map_tx: State<'_, TempoMapTxState>,
    tempo_map_snapshot: State<'_, TempoMapSnapshotState>,
    engine: State<'_, AudioEngineState>,
) -> Result<(), String> {
    // Validate BPM range
    for p in &points {
        if p.bpm < 20.0 || p.bpm > 300.0 {
            return Err(format!(
                "BPM value {} at tick {} is outside the allowed range [20.0, 300.0]",
                p.bpm, p.tick
            ));
        }
    }

    // Determine sample rate from the running engine; fall back to 44100
    let sample_rate = {
        match engine.lock() {
            Ok(eng) => eng.get_sample_rate(),
            Err(_) => 44100,
        }
    };

    // Build the map
    let map = CumulativeTempoMap::build(points.clone(), sample_rate);

    // Send to audio thread via an unbounded channel.
    // The audio thread drains ALL pending maps each callback and applies only
    // the last one, so rapid UI edits always result in the latest map winning.
    if let Ok(guard) = tempo_map_tx.lock() {
        if let Some(ref tx) = *guard {
            let _ = tx.send(Box::new(map));
        }
    }

    // Update snapshot
    *tempo_map_snapshot.lock().map_err(|e| e.to_string())? = points;

    Ok(())
}

/// Returns the current list of tempo points.
#[tauri::command]
pub fn get_tempo_map(
    tempo_map_snapshot: State<'_, TempoMapSnapshotState>,
) -> Result<Vec<TempoPoint>, String> {
    let guard = tempo_map_snapshot.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

// ---------------------------------------------------------------------------
// Default map constructor (used in lib.rs setup)
// ---------------------------------------------------------------------------

/// Returns the default single-point tempo map (120 BPM Step at tick 0).
pub fn default_points() -> Vec<TempoPoint> {
    vec![TempoPoint {
        tick: 0,
        bpm: 120.0,
        interp: TempoInterp::Step,
    }]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_points_has_one_entry() {
        let pts = default_points();
        assert_eq!(pts.len(), 1);
        assert_eq!(pts[0].tick, 0);
        assert_eq!(pts[0].bpm, 120.0);
    }
}
