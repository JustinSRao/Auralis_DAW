/// Tauri IPC commands for the VST3 plugin host.
///
/// The plugin registry is stored as `Arc<Mutex<HashMap<String, Vst3PluginEntry>>>`.
/// Each loaded plugin also has a command channel (`Sender<Vst3Cmd>`) registered in a
/// second map so that the component handler can route parameter-change events.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::gui_bridge::{Vst3GuiBridge, Vst3GuiState};
use super::params::ParamInfo;
use super::preset_manager::PresetInfo;
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

// ────────────────────────────────────────────────────────────────────────────
// Sprint 24: GUI bridge commands
// ────────────────────────────────────────────────────────────────────────────

/// Opens the native VST3 plugin GUI as a Win32 child window embedded in the
/// main Tauri window.
///
/// On non-Windows targets this is a no-op that returns an error.
#[tauri::command]
pub async fn open_plugin_gui(
    instance_id: String,
    app_handle: tauri::AppHandle,
    registry: State<'_, Vst3RegistryState>,
    gui_state: State<'_, Vst3GuiState>,
) -> Result<(), String> {
    // Get the controller pointer while holding the registry lock, then release
    // the lock before the (potentially slow) main-thread dispatch.
    // Cast to isize so the pointer is Send-safe across threads.
    let controller_isize: isize = {
        let reg = registry
            .lock()
            .map_err(|e| format!("registry lock poisoned: {e}"))?;
        let entry = reg
            .get(&instance_id)
            .ok_or_else(|| format!("Plugin instance '{}' not found", instance_id))?;
        let ctrl = entry
            .controller
            .ok_or_else(|| format!("Plugin '{}' has no IEditController", instance_id))?;
        ctrl as isize
    };

    // Obtain the Win32 HWND from the main Tauri window, encoded as isize for Send safety.
    #[cfg(target_os = "windows")]
    let parent_hwnd_isize: isize = {
        use raw_window_handle::HasWindowHandle;
        use tauri::Manager;
        let window = app_handle
            .get_webview_window("main")
            .ok_or_else(|| "no main window".to_string())?;
        let handle = window
            .window_handle()
            .map_err(|e| format!("window handle error: {e}"))?;
        match handle.as_raw() {
            raw_window_handle::RawWindowHandle::Win32(h) => h.hwnd.get() as isize,
            _ => return Err("not a Win32 window".to_string()),
        }
    };

    #[cfg(not(target_os = "windows"))]
    return Err("open_plugin_gui is only supported on Windows".to_string());

    #[cfg(target_os = "windows")]
    {
        let id_clone = instance_id.clone();
        let (tx, rx) = std::sync::mpsc::channel::<anyhow::Result<Vst3GuiBridge>>();
        app_handle
            .run_on_main_thread(move || {
                // Safety: controller_isize was obtained from a valid IEditController pointer
                // stored in the plugin registry. The plugin DLL remains loaded while the
                // entry exists. We dereference it only on the main thread as required by VST3.
                let ctrl_ptr =
                    controller_isize as *mut super::com::IEditController;
                let result = Vst3GuiBridge::open(id_clone, ctrl_ptr, parent_hwnd_isize);
                let _ = tx.send(result);
            })
            .map_err(|e| format!("run_on_main_thread failed: {e}"))?;

        let bridge = rx
            .recv()
            .map_err(|e| format!("channel recv failed: {e}"))?
            .map_err(|e| format!("GUI open failed: {e}"))?;

        gui_state
            .lock()
            .map_err(|e| format!("gui_state lock poisoned: {e}"))?
            .insert(instance_id, bridge);

        Ok(())
    }
}

/// Closes an open VST3 plugin GUI and destroys the child window.
#[tauri::command]
pub async fn close_plugin_gui(
    instance_id: String,
    app_handle: tauri::AppHandle,
    gui_state: State<'_, Vst3GuiState>,
) -> Result<(), String> {
    let bridge = gui_state
        .lock()
        .map_err(|e| format!("gui_state lock poisoned: {e}"))?
        .remove(&instance_id)
        .ok_or_else(|| format!("No open GUI for instance '{instance_id}'"))?;

    #[cfg(target_os = "windows")]
    {
        let (tx, rx) = std::sync::mpsc::channel::<anyhow::Result<()>>();
        app_handle
            .run_on_main_thread(move || {
                let result = bridge.close();
                let _ = tx.send(result);
            })
            .map_err(|e| format!("run_on_main_thread failed: {e}"))?;
        rx.recv()
            .map_err(|e| format!("channel recv failed: {e}"))?
            .map_err(|e| format!("GUI close failed: {e}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app_handle;
        drop(bridge);
    }

    Ok(())
}

/// Resizes the child window that hosts the VST3 plugin GUI.
#[tauri::command]
pub async fn resize_plugin_gui(
    instance_id: String,
    width: i32,
    height: i32,
    app_handle: tauri::AppHandle,
    gui_state: State<'_, Vst3GuiState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd_isize = {
            let gs = gui_state
                .lock()
                .map_err(|e| format!("gui_state lock poisoned: {e}"))?;
            let bridge = gs
                .get(&instance_id)
                .ok_or_else(|| format!("No open GUI for instance '{instance_id}'"))?;
            bridge.hwnd_isize()
        };

        let (tx, rx) = std::sync::mpsc::channel::<()>();
        app_handle
            .run_on_main_thread(move || {
                use windows_sys::Win32::Foundation::HWND;
                use windows_sys::Win32::UI::WindowsAndMessaging::MoveWindow;
                let hwnd: HWND = hwnd_isize as HWND;
                unsafe { MoveWindow(hwnd, 0, 0, width, height, 1) };
                let _ = tx.send(());
            })
            .map_err(|e| format!("run_on_main_thread failed: {e}"))?;
        let _ = rx.recv();
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app_handle, gui_state, width, height);
        Err("resize_plugin_gui is only supported on Windows".to_string())
    }
}

/// Returns the list of preset files for the given plugin instance.
#[tauri::command]
pub fn get_plugin_presets(
    instance_id: String,
    registry: State<'_, Vst3RegistryState>,
) -> Result<Vec<PresetInfo>, String> {
    let reg = registry
        .lock()
        .map_err(|e| format!("registry lock poisoned: {e}"))?;
    let entry = reg
        .get(&instance_id)
        .ok_or_else(|| format!("Plugin instance '{}' not found", instance_id))?;
    let presets = super::preset_manager::get_presets(&entry.info.vendor, &entry.info.name);
    Ok(presets)
}

/// Applies a `.vstpreset` file to the component state of the given plugin instance.
#[tauri::command]
pub fn apply_plugin_preset(
    instance_id: String,
    preset_path: String,
    registry: State<'_, Vst3RegistryState>,
) -> Result<(), String> {
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
    super::preset_manager::apply_preset(component_ptr, &preset_path)
        .map_err(|e| format!("apply_preset failed: {e}"))
}
