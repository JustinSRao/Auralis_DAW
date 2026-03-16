//! Tauri IPC commands for punch in/out recording control.
//!
//! These commands allow the frontend to configure the punch region, enable or
//! disable punch mode, and read back the current marker state.

use std::sync::atomic::Ordering;

use tauri::State;

use super::punch::{PunchControllerState, PunchMarkers};
use crate::instruments::commands::TransportAtomicsState;

/// Sets the punch-in point to the given beat position.
///
/// The sample position is derived from the current transport BPM via
/// `TransportAtomics.samples_per_beat_bits`.
#[tauri::command]
pub fn set_punch_in(
    beats: f64,
    punch: State<PunchControllerState>,
    transport_atomics: State<TransportAtomicsState>,
) -> Result<(), String> {
    let spb = f64::from_bits(
        transport_atomics
            .samples_per_beat_bits
            .load(Ordering::Relaxed),
    );
    punch
        .lock()
        .map_err(|e| e.to_string())?
        .set_punch_in(beats, spb);
    Ok(())
}

/// Sets the punch-out point to the given beat position.
///
/// The sample position is derived from the current transport BPM via
/// `TransportAtomics.samples_per_beat_bits`.
#[tauri::command]
pub fn set_punch_out(
    beats: f64,
    punch: State<PunchControllerState>,
    transport_atomics: State<TransportAtomicsState>,
) -> Result<(), String> {
    let spb = f64::from_bits(
        transport_atomics
            .samples_per_beat_bits
            .load(Ordering::Relaxed),
    );
    punch
        .lock()
        .map_err(|e| e.to_string())?
        .set_punch_out(beats, spb);
    Ok(())
}

/// Enables or disables punch recording mode.
#[tauri::command]
pub fn toggle_punch_mode(
    enabled: bool,
    punch: State<PunchControllerState>,
) -> Result<(), String> {
    punch.lock().map_err(|e| e.to_string())?.punch_enabled = enabled;
    Ok(())
}

/// Returns a clone of the current punch markers.
#[tauri::command]
pub fn get_punch_markers(punch: State<PunchControllerState>) -> Result<PunchMarkers, String> {
    Ok(punch.lock().map_err(|e| e.to_string())?.markers.clone())
}
