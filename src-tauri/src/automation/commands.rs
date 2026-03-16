//! Tauri IPC commands for the automation system.
//!
//! All commands are stateless with respect to the audio thread: the
//! [`AutomationLaneStore`] on the Tauri side is the source of truth for
//! lane data.  Changes are forwarded to the audio thread via the
//! `AutomationCmdTxState` sender.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crossbeam_channel::Sender;
use tauri::State;

use crate::automation::engine::AutomationCommand;
use crate::automation::lane::{
    parse_interp, AutomationLane, AutomationLaneSnapshot, ControlPointSnapshot,
};
use crate::automation::record::AutomationRecordEvent;

// ---------------------------------------------------------------------------
// Managed-state type aliases
// ---------------------------------------------------------------------------

/// Tauri-side store for all automation lanes.
///
/// Key is `(pattern_id, parameter_id)`.  Acts as the source of truth for
/// `get_automation_lane` responses and project serialisation.
pub type AutomationLaneStore =
    Arc<Mutex<HashMap<(String, String), AutomationLane>>>;

/// Sender half of the `AutomationEngine`'s command channel.
///
/// `None` until the first instrument is created (at which point a fresh
/// `AutomationEngine` is instantiated and this sender is populated).
/// Commands are silently dropped when `None` (engine not yet initialised).
pub type AutomationCmdTxState =
    Arc<Mutex<Option<Sender<AutomationCommand>>>>;

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/// Forwards `cmd` to the audio-thread `AutomationEngine` if the sender exists.
///
/// Silently no-ops when the sender is `None` (engine not yet initialised).
fn try_send_cmd(
    tx_state: &AutomationCmdTxState,
    cmd: AutomationCommand,
) -> Result<(), String> {
    let guard = tx_state
        .lock()
        .map_err(|e| format!("Failed to lock automation cmd tx: {}", e))?;
    if let Some(tx) = guard.as_ref() {
        tx.try_send(cmd)
            .map_err(|e| format!("Failed to send automation command: {}", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Adds or updates a control point in the specified automation lane.
///
/// Creates the lane if it does not yet exist.  Forwards the updated lane to
/// the audio-thread `AutomationEngine`.
#[tauri::command]
pub fn set_automation_point(
    pattern_id: String,
    parameter_id: String,
    tick: u64,
    value: f32,
    interp: String,
    lane_store: State<'_, AutomationLaneStore>,
    auto_cmd_tx: State<'_, AutomationCmdTxState>,
) -> Result<ControlPointSnapshot, String> {
    let interp_mode = parse_interp(&interp)?;

    let updated_lane = {
        let mut store = lane_store
            .lock()
            .map_err(|e| format!("Failed to lock lane store: {}", e))?;
        let lane = store
            .entry((pattern_id.clone(), parameter_id.clone()))
            .or_insert_with(|| {
                AutomationLane::new(pattern_id.clone(), parameter_id.clone())
            });
        lane.insert_point(tick, value, interp_mode);
        lane.clone()
    };

    try_send_cmd(&auto_cmd_tx, AutomationCommand::SetLane(updated_lane))?;

    Ok(ControlPointSnapshot { tick, value, interp })
}

/// Removes a control point from the specified automation lane.
#[tauri::command]
pub fn delete_automation_point(
    pattern_id: String,
    parameter_id: String,
    tick: u64,
    lane_store: State<'_, AutomationLaneStore>,
    auto_cmd_tx: State<'_, AutomationCmdTxState>,
) -> Result<(), String> {
    let maybe_lane = {
        let mut store = lane_store
            .lock()
            .map_err(|e| format!("Failed to lock lane store: {}", e))?;
        store
            .get_mut(&(pattern_id.clone(), parameter_id.clone()))
            .map(|lane| {
                lane.delete_point(tick);
                lane.clone()
            })
    };

    if let Some(lane) = maybe_lane {
        try_send_cmd(&auto_cmd_tx, AutomationCommand::SetLane(lane))?;
    }
    Ok(())
}

/// Changes the interpolation mode of a control point.
#[tauri::command]
pub fn set_automation_interp(
    pattern_id: String,
    parameter_id: String,
    tick: u64,
    interp: String,
    lane_store: State<'_, AutomationLaneStore>,
    auto_cmd_tx: State<'_, AutomationCmdTxState>,
) -> Result<(), String> {
    let interp_mode = parse_interp(&interp)?;

    let maybe_lane = {
        let mut store = lane_store
            .lock()
            .map_err(|e| format!("Failed to lock lane store: {}", e))?;
        store
            .get_mut(&(pattern_id.clone(), parameter_id.clone()))
            .map(|lane| {
                lane.set_interp(tick, interp_mode);
                lane.clone()
            })
    };

    if let Some(lane) = maybe_lane {
        try_send_cmd(&auto_cmd_tx, AutomationCommand::SetLane(lane))?;
    }
    Ok(())
}

/// Returns the full lane snapshot for a `(pattern_id, parameter_id)` pair.
///
/// Returns an empty enabled lane (zero points) when the lane does not yet exist.
#[tauri::command]
pub fn get_automation_lane(
    pattern_id: String,
    parameter_id: String,
    lane_store: State<'_, AutomationLaneStore>,
) -> Result<AutomationLaneSnapshot, String> {
    let store = lane_store
        .lock()
        .map_err(|e| format!("Failed to lock lane store: {}", e))?;
    let snapshot = match store.get(&(pattern_id.clone(), parameter_id.clone())) {
        Some(lane) => lane.to_snapshot(),
        None => AutomationLane::new(pattern_id, parameter_id).to_snapshot(),
    };
    Ok(snapshot)
}

/// Enables or disables an automation lane without deleting its breakpoints.
#[tauri::command]
pub fn enable_automation_lane(
    pattern_id: String,
    parameter_id: String,
    enabled: bool,
    lane_store: State<'_, AutomationLaneStore>,
    auto_cmd_tx: State<'_, AutomationCmdTxState>,
) -> Result<(), String> {
    let maybe_lane = {
        let mut store = lane_store
            .lock()
            .map_err(|e| format!("Failed to lock lane store: {}", e))?;
        store
            .get_mut(&(pattern_id, parameter_id))
            .map(|lane| {
                lane.enabled = enabled;
                lane.clone()
            })
    };

    if let Some(lane) = maybe_lane {
        try_send_cmd(&auto_cmd_tx, AutomationCommand::SetLane(lane))?;
    }
    Ok(())
}

/// Accepts a batch of automation record events from the frontend's 100 ms flush.
///
/// Events are forwarded to the `AutomationEngine` on the audio thread via the
/// command channel.
#[tauri::command]
pub fn record_automation_batch(
    events: Vec<AutomationRecordEvent>,
    auto_cmd_tx: State<'_, AutomationCmdTxState>,
) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }
    try_send_cmd(&auto_cmd_tx, AutomationCommand::FlushRecordEvents(events))
}
