//! Tauri IPC commands for take lane operations.

use tauri::{command, State};
use serde::{Deserialize, Serialize};

use super::loop_recorder::LoopRecordControllerState;
use super::take_lane::{TakeLane, TakeLaneStoreState};

/// Payload for the `take-created` Tauri event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeCreatedEvent {
    pub take: super::take_lane::Take,
    pub track_id: String,
}

/// Payload for `take-recording-started` Tauri event (new take pattern created).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeRecordingStartedEvent {
    pub track_id: String,
    pub pattern_id: String,
    pub take_number: u32,
}

/// Returns the take lane for a given track. Returns an empty lane if none exists.
#[command]
pub fn get_take_lanes(
    track_id: String,
    store: State<TakeLaneStoreState>,
) -> Result<TakeLane, String> {
    let guard = store.lock().map_err(|e| e.to_string())?;
    Ok(guard.lanes.get(&track_id).cloned().unwrap_or_else(|| TakeLane::new(track_id)))
}

/// Sets a specific take as the active playback source for a track.
#[command]
pub fn set_active_take(
    track_id: String,
    take_id: String,
    store: State<TakeLaneStoreState>,
) -> Result<(), String> {
    let mut guard = store.lock().map_err(|e| e.to_string())?;
    if let Some(lane) = guard.lanes.get_mut(&track_id) {
        if !lane.set_active_take(&take_id) {
            return Err(format!("Take {} not found on track {}", take_id, track_id));
        }
    }
    Ok(())
}

/// Deletes a take from a track's take lane.
#[command]
pub fn delete_take(
    track_id: String,
    take_id: String,
    store: State<TakeLaneStoreState>,
) -> Result<(), String> {
    let mut guard = store.lock().map_err(|e| e.to_string())?;
    if let Some(lane) = guard.lanes.get_mut(&track_id) {
        lane.delete_take(&take_id);
    }
    Ok(())
}

/// Arms a specific track for loop recording. Call before starting transport recording.
#[command]
pub fn arm_loop_recording(
    track_id: Option<String>,
    ctrl: State<LoopRecordControllerState>,
) -> Result<(), String> {
    let mut guard = ctrl.lock().map_err(|e| e.to_string())?;
    match track_id {
        Some(id) => guard.start(id),
        None => guard.stop(),
    }
    Ok(())
}

/// Toggles the expanded/collapsed state of a track's take lane panel.
#[command]
pub fn toggle_take_lane_expanded(
    track_id: String,
    store: State<TakeLaneStoreState>,
) -> Result<bool, String> {
    let mut guard = store.lock().map_err(|e| e.to_string())?;
    let lane = guard.get_or_create(&track_id);
    lane.expanded = !lane.expanded;
    Ok(lane.expanded)
}
