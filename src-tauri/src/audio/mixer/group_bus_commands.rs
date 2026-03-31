//! Tauri commands for group bus management (Sprint 42).

use std::sync::atomic::Ordering;
use tauri::State;

use super::commands::MixerState;
use super::routing::OutputTarget;

// ── Serialisable snapshot ──────────────────────────────────────────────────────

/// Snapshot of a single group bus for the frontend.
#[derive(serde::Serialize, Clone)]
pub struct GroupBusSnapshot {
    pub id: u8,
    pub name: String,
    pub output_target: OutputTargetDto,
    pub fader: f32,
    pub pan: f32,
    pub mute: bool,
    pub solo: bool,
    pub peak_l: f32,
    pub peak_r: f32,
}

/// Serialisable `OutputTarget`.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct OutputTargetDto {
    /// `"master"` or `"group"`.
    pub kind: String,
    /// Present only when `kind == "group"`.
    pub group_id: Option<u8>,
}

impl OutputTargetDto {
    pub fn from_target(t: OutputTarget) -> Self {
        match t {
            OutputTarget::Master => Self { kind: "master".into(), group_id: None },
            OutputTarget::Group(id) => Self { kind: "group".into(), group_id: Some(id) },
        }
    }

    pub fn to_target(&self) -> Result<OutputTarget, String> {
        match self.kind.as_str() {
            "master" => Ok(OutputTarget::Master),
            "group" => {
                let id = self.group_id.ok_or("group_id required when kind=group")?;
                Ok(OutputTarget::Group(id))
            }
            other => Err(format!("unknown output target kind: {}", other)),
        }
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Creates a new named group bus.  Returns the assigned bus ID (0–7).
#[tauri::command]
pub fn create_group_bus(
    name: String,
    mixer_state: State<'_, MixerState>,
) -> Result<u8, String> {
    let mut mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    mixer.create_group_bus(name)
}

/// Deletes a group bus.  Channels that were routing to it fall back to Master.
#[tauri::command]
pub fn delete_group_bus(
    bus_id: u8,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let mut mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    mixer.delete_group_bus(bus_id)
}

/// Renames a group bus.
#[tauri::command]
pub fn rename_group_bus(
    bus_id: u8,
    name: String,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let mut mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    mixer.rename_group_bus(bus_id, name)
}

/// Sets the output routing target for a mixer channel.
#[tauri::command]
pub fn set_channel_output(
    channel_id: String,
    target: OutputTargetDto,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let output_target = target.to_target()?;
    let mut mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    mixer.set_channel_output(&channel_id, output_target)
}

/// Sets the output routing target for a group bus (supports nested routing).
///
/// Returns an error if the assignment would create a cycle or exceed the
/// maximum nesting depth.
#[tauri::command]
pub fn set_group_bus_output(
    bus_id: u8,
    target: OutputTargetDto,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let output_target = target.to_target()?;
    let mut mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    mixer.set_group_bus_output(bus_id, output_target)
}

/// Sets the fader level for a group bus (0.0–2.0; unity = 1.0).
#[tauri::command]
pub fn set_group_bus_fader(
    bus_id: u8,
    value: f32,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    let gb = mixer.group_bus(bus_id)
        .ok_or_else(|| format!("Group bus {} not found", bus_id))?;
    gb.channel.fader.store(value.clamp(0.0, 2.0), Ordering::Relaxed);
    Ok(())
}

/// Sets the pan for a group bus (-1.0 full-left to +1.0 full-right).
#[tauri::command]
pub fn set_group_bus_pan(
    bus_id: u8,
    value: f32,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    let gb = mixer.group_bus(bus_id)
        .ok_or_else(|| format!("Group bus {} not found", bus_id))?;
    gb.channel.pan.store(value.clamp(-1.0, 1.0), Ordering::Relaxed);
    Ok(())
}

/// Mutes or unmutes a group bus.
#[tauri::command]
pub fn set_group_bus_mute(
    bus_id: u8,
    muted: bool,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    let gb = mixer.group_bus(bus_id)
        .ok_or_else(|| format!("Group bus {} not found", bus_id))?;
    gb.channel.mute.store(muted, Ordering::Relaxed);
    Ok(())
}

/// Solos or unsolos a group bus.
#[tauri::command]
pub fn set_group_bus_solo(
    bus_id: u8,
    soloed: bool,
    mixer_state: State<'_, MixerState>,
) -> Result<(), String> {
    let mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    let gb = mixer.group_bus(bus_id)
        .ok_or_else(|| format!("Group bus {} not found", bus_id))?;
    gb.channel.solo.store(soloed, Ordering::Relaxed);
    Ok(())
}

/// Returns a snapshot of all group buses.
#[tauri::command]
pub fn get_group_bus_state(
    mixer_state: State<'_, MixerState>,
) -> Result<Vec<GroupBusSnapshot>, String> {
    let mixer = mixer_state.lock().map_err(|e| e.to_string())?;
    Ok(mixer.group_buses.iter().map(|gb| GroupBusSnapshot {
        id: gb.id,
        name: gb.name.clone(),
        output_target: OutputTargetDto::from_target(gb.output_target()),
        fader: gb.channel.fader.load(Ordering::Relaxed),
        pan: gb.channel.pan.load(Ordering::Relaxed),
        mute: gb.channel.mute.load(Ordering::Relaxed),
        solo: gb.channel.solo.load(Ordering::Relaxed),
        peak_l: gb.channel.peak_l.load(Ordering::Relaxed),
        peak_r: gb.channel.peak_r.load(Ordering::Relaxed),
    }).collect())
}
