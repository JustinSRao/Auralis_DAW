/// Tauri IPC commands for the VST3 plugin host.
///
/// The plugin registry is stored as `Arc<Mutex<HashMap<String, Vst3PluginEntry>>>`.
/// Each loaded plugin also has a command channel (`Sender<Vst3Cmd>`) registered in a
/// second map so that the component handler can route parameter-change events.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::params::ParamInfo;
use super::scanner::{PluginInfo, scan_vst3_directories, default_scan_paths};

// ────────────────────────────────────────────────────────────────────────────
// Command enum
// ────────────────────────────────────────────────────────────────────────────

/// Commands sent over the per-plugin crossbeam channel.
#[derive(Debug)]
pub enum Vst3Cmd {
    /// A plugin parameter was changed via the GUI or automation.
    ParamChanged { id: u32, value: f64 },
    /// A raw MIDI event to forward to the plugin's event list.
    MidiEvent { status: u8, data1: u8, data2: u8 },
}

// ────────────────────────────────────────────────────────────────────────────
// Registry entry
// ────────────────────────────────────────────────────────────────────────────

/// All persistent data for a loaded plugin instance.
pub struct Vst3PluginEntry {
    /// Plugin discovery metadata.
    pub info: PluginInfo,
    /// Unique string ID for this instance (UUID v4).
    pub instance_id: String,
    /// Keeps the plugin DLL loaded as long as this entry lives.
    pub library: Arc<libloading::Library>,
    /// `IComponent` pointer wrapped in a mutex for cross-thread state access.
    pub component: Arc<Mutex<*mut super::com::IComponent>>,
    /// Optional `IEditController` pointer (may be combined with component).
    pub controller: Option<*mut super::com::IEditController>,
    /// Enumerated parameter descriptors.
    pub params: Vec<ParamInfo>,
    /// Whether this plugin is a MIDI instrument.
    pub is_instrument: bool,
}

// Safety: raw pointers in Vst3PluginEntry are only accessed while holding
// the appropriate mutex or within the audio thread (processor). We explicitly
// declare Send+Sync so the entry can live in the Arc<Mutex<HashMap>>.
unsafe impl Send for Vst3PluginEntry {}
unsafe impl Sync for Vst3PluginEntry {}

// ────────────────────────────────────────────────────────────────────────────
// Managed state type aliases
// ────────────────────────────────────────────────────────────────────────────

/// Shared registry of loaded VST3 plugin instances, keyed by `instance_id`.
pub type Vst3RegistryState = Arc<Mutex<HashMap<String, Vst3PluginEntry>>>;

/// Per-plugin command-channel senders, keyed by `instance_id`.
pub type Vst3CmdTxState = Arc<Mutex<HashMap<String, crossbeam_channel::Sender<Vst3Cmd>>>>;

// ────────────────────────────────────────────────────────────────────────────
// Response types (serialised back to the frontend)
// ────────────────────────────────────────────────────────────────────────────

/// Slim view of a loaded plugin for the frontend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoadedPluginView {
    pub instance_id: String,
    pub name: String,
    pub vendor: String,
    pub is_instrument: bool,
    pub params: Vec<ParamInfo>,
}

// ────────────────────────────────────────────────────────────────────────────
// Tauri commands
// ────────────────────────────────────────────────────────────────────────────

/// Scans the default (and any extra) VST3 directories and returns plugin metadata.
#[tauri::command]
pub fn scan_vst3_plugins(extra_dirs: Option<Vec<String>>) -> Vec<PluginInfo> {
    let mut dirs = default_scan_paths();
    if let Some(extra) = extra_dirs {
        for d in extra {
            dirs.push(std::path::PathBuf::from(d));
        }
    }
    scan_vst3_directories(&dirs)
}

/// Loads a VST3 plugin by DLL path and returns the instance id.
#[tauri::command]
pub fn load_vst3_plugin(
    info: PluginInfo,
    registry: tauri::State<Vst3RegistryState>,
    cmd_tx_map: tauri::State<Vst3CmdTxState>,
) -> Result<LoadedPluginView, String> {
    let (tx, _rx) = crossbeam_channel::bounded::<Vst3Cmd>(256);

    // Build host application.
    let mut host_app = super::host::VstHostApplication::new();
    let host_ptr = host_app.as_host_ptr();

    let loaded = super::loader::load_plugin(&info, 44100, 256, host_ptr)
        .map_err(|e| format!("Failed to load VST3 plugin: {e}"))?;

    // Keep host alive by boxing it (it must outlive the plugin; managed in the entry).
    // For this sprint we leak it — future sprint adds proper lifecycle management.
    std::mem::forget(host_app);

    let instance_id = loaded.instance_id.clone();
    let view = LoadedPluginView {
        instance_id: instance_id.clone(),
        name: loaded.info.name.clone(),
        vendor: loaded.info.vendor.clone(),
        is_instrument: loaded.is_instrument,
        params: loaded.params.clone(),
    };

    let entry = Vst3PluginEntry {
        info: loaded.info,
        instance_id: instance_id.clone(),
        library: loaded.library,
        component: loaded.component,
        controller: loaded.controller,
        params: loaded.params,
        is_instrument: loaded.is_instrument,
    };

    registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?
        .insert(instance_id.clone(), entry);

    cmd_tx_map
        .lock()
        .map_err(|e| format!("cmd_tx_map lock poisoned: {e}"))?
        .insert(instance_id, tx);

    Ok(view)
}

/// Unloads a previously loaded VST3 plugin instance.
#[tauri::command]
pub fn unload_vst3_plugin(
    instance_id: String,
    registry: tauri::State<Vst3RegistryState>,
    cmd_tx_map: tauri::State<Vst3CmdTxState>,
) -> Result<(), String> {
    registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?
        .remove(&instance_id);

    cmd_tx_map
        .lock()
        .map_err(|e| format!("cmd_tx_map lock poisoned: {e}"))?
        .remove(&instance_id);

    Ok(())
}

/// Sets a normalised parameter value on a loaded plugin.
#[tauri::command]
pub fn set_vst3_param(
    instance_id: String,
    param_id: u32,
    value: f64,
    registry: tauri::State<Vst3RegistryState>,
) -> Result<(), String> {
    let mut reg = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;

    let entry = reg
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Plugin instance '{}' not found", instance_id))?;

    if let Some(ctrl) = entry.controller {
        let res = unsafe {
            ((*(*ctrl).vtbl).set_param_normalized)(ctrl, param_id, value)
        };
        if res != super::com::K_RESULT_OK {
            return Err(format!("set_param_normalized returned {res}"));
        }
    }
    // Update shadow copy.
    if let Some(p) = entry.params.iter_mut().find(|p| p.id == param_id) {
        p.current_normalized = value;
    }
    Ok(())
}

/// Returns the current parameter list for a loaded plugin.
#[tauri::command]
pub fn get_vst3_params(
    instance_id: String,
    registry: tauri::State<Vst3RegistryState>,
) -> Result<Vec<ParamInfo>, String> {
    let reg = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;

    let entry = reg
        .get(&instance_id)
        .ok_or_else(|| format!("Plugin instance '{}' not found", instance_id))?;

    Ok(entry.params.clone())
}

/// Serialises the plugin component state to a base64 string.
#[tauri::command]
pub fn save_vst3_state(
    instance_id: String,
    registry: tauri::State<Vst3RegistryState>,
) -> Result<String, String> {
    let reg = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;

    let entry = reg
        .get(&instance_id)
        .ok_or_else(|| format!("Plugin instance '{}' not found", instance_id))?;

    let component_ptr = *entry
        .component
        .lock()
        .map_err(|e| format!("component lock poisoned: {e}"))?;

    let mut stream = super::state::VecIBStream::new_empty();
    let stream_ptr = stream.as_ibstream_ptr();
    let res = unsafe {
        ((*(*component_ptr).vtbl).get_state)(component_ptr, stream_ptr)
    };
    if res != super::com::K_RESULT_OK {
        return Err(format!("IComponent::get_state returned {res}"));
    }
    Ok(stream.to_base64())
}

/// Restores plugin component state from a base64 string.
#[tauri::command]
pub fn load_vst3_state(
    instance_id: String,
    state_b64: String,
    registry: tauri::State<Vst3RegistryState>,
) -> Result<(), String> {
    let reg = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;

    let entry = reg
        .get(&instance_id)
        .ok_or_else(|| format!("Plugin instance '{}' not found", instance_id))?;

    let mut stream = super::state::VecIBStream::from_base64(&state_b64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    let stream_ptr = stream.as_ibstream_ptr();

    let component_ptr = *entry
        .component
        .lock()
        .map_err(|e| format!("component lock poisoned: {e}"))?;

    let res = unsafe {
        ((*(*component_ptr).vtbl).set_state)(component_ptr, stream_ptr)
    };
    if res != super::com::K_RESULT_OK {
        return Err(format!("IComponent::set_state returned {res}"));
    }
    Ok(())
}
