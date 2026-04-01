/// VST3 plugin directory scanner.
///
/// Walks the standard VST3 bundle directories on Windows, loads each DLL,
/// calls `GetPluginFactory`, and reads `PClassInfo2` to discover plugins.
/// Each library is immediately unloaded after scanning.
use std::ffi::c_void;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::com::{
    i8_array_to_string, IPluginFactory, IPluginFactory2,
    K_AUDIO_MODULE_CLASS, K_RESULT_OK, PClassInfo2,
};
use super::com::iids::{I_PLUGIN_FACTORY2};

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/// Metadata for a discovered VST3 plugin.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PluginInfo {
    /// VST3 class GUID encoded as a hyphenated hex string.
    pub id: String,
    /// Plugin display name.
    pub name: String,
    /// Vendor / manufacturer name.
    pub vendor: String,
    /// Plugin version string.
    pub version: String,
    /// VST3 sub-category string (e.g. `"Instrument|Synth"`).
    pub category: String,
    /// Path to the `.vst3` bundle directory.
    pub bundle_path: PathBuf,
    /// Path to the actual DLL inside the bundle.
    pub dll_path: PathBuf,
    /// Whether this plugin is a MIDI instrument (rather than a pure effect).
    pub is_instrument: bool,
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/// Returns the default VST3 scan paths for Windows.
///
/// - System: `C:\Program Files\Common Files\VST3`
/// - User:   `%LOCALAPPDATA%\Programs\Common\VST3`
pub fn default_scan_paths() -> Vec<PathBuf> {
    let mut paths = vec![PathBuf::from(r"C:\Program Files\Common Files\VST3")];
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        paths.push(PathBuf::from(local_app_data).join("Programs").join("Common").join("VST3"));
    }
    paths
}

/// Scans the given directories for VST3 plugins and returns metadata for each.
///
/// Only `"Audio Module Class"` entries are included. The DLL is loaded only
/// long enough to read the factory info, then unloaded immediately.
pub fn scan_vst3_directories(dirs: &[PathBuf]) -> Vec<PluginInfo> {
    let mut results = Vec::new();
    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        scan_dir(dir, &mut results);
    }
    results
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/// Recursively walk `dir` looking for `.vst3` bundles or bare `.dll` files.
fn scan_dir(dir: &std::path::Path, results: &mut Vec<PluginInfo>) {
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if path.is_dir() && ext == "vst3" {
            // Standard Windows bundle: <Name>.vst3/Contents/x86_64-win/<Name>.vst3
            let dll_candidate = path
                .join("Contents")
                .join("x86_64-win")
                .join(path.file_name().unwrap_or_default());
            if dll_candidate.exists() {
                scan_dll(&dll_candidate, &path, results);
            } else {
                // Some bundles use a flat layout — fall through to sub-dir scan.
                scan_dir(&path, results);
            }
        } else if path.is_dir() {
            scan_dir(&path, results);
        } else if ext == "vst3" || ext == "dll" {
            // Bare DLL (legacy or non-bundled layout).
            let bundle = path.parent().unwrap_or(&path).to_path_buf();
            scan_dll(&path, &bundle, results);
        }
    }
}

/// Loads `dll_path`, queries the factory, collects plugin infos, then unloads.
fn scan_dll(dll_path: &std::path::Path, bundle_path: &std::path::Path, results: &mut Vec<PluginInfo>) {
    // Wrap the entire load in `catch_unwind` so a bad plugin can't crash the host.
    let result = std::panic::catch_unwind(|| {
        scan_dll_inner(dll_path, bundle_path)
    });
    match result {
        Ok(Some(infos)) => results.extend(infos),
        Ok(None) => {}
        Err(_) => {
            log::warn!("VST3 scanner: panic while scanning {:?}", dll_path);
        }
    }
}

fn scan_dll_inner(
    dll_path: &std::path::Path,
    bundle_path: &std::path::Path,
) -> Option<Vec<PluginInfo>> {
    // Set the DLL search directory so the plugin can load its own dependencies.
    let dll_dir = dll_path.parent()?;
    let dll_dir_wide = wide_string(dll_dir.to_str()?);

    #[cfg(target_os = "windows")]
    let _dir_guard = DllDirectoryGuard::set(&dll_dir_wide);

    let lib = unsafe { libloading::Library::new(dll_path) }.ok()?;

    type GetPluginFactory = unsafe extern "system" fn() -> *mut IPluginFactory;
    let get_factory: libloading::Symbol<GetPluginFactory> =
        unsafe { lib.get(b"GetPluginFactory\0") }.ok()?;

    let factory_ptr = unsafe { get_factory() };
    if factory_ptr.is_null() {
        return None;
    }

    // Try IPluginFactory2 first (gives us PClassInfo2 with vendor/version/subcat).
    let mut results: Vec<PluginInfo> = Vec::new();

    let factory2_ptr = query_factory2(factory_ptr);

    let class_count = unsafe { ((*(*factory_ptr).vtbl).count_classes)(factory_ptr) };
    for i in 0..class_count {
        if let Some(info) = read_class_info(factory_ptr, factory2_ptr, i, dll_path, bundle_path) {
            results.push(info);
        }
    }

    // Release factory reference.
    unsafe { ((*(*factory_ptr).vtbl).release)(factory_ptr) };
    // lib drops here, unloading the DLL.
    Some(results)
}

/// Attempts a `QueryInterface` for `IPluginFactory2`. Returns null on failure.
fn query_factory2(factory: *mut IPluginFactory) -> *mut IPluginFactory2 {
    let mut factory2: *mut c_void = std::ptr::null_mut();
    let res = unsafe {
        ((*(*factory).vtbl).query_interface)(
            factory,
            &I_PLUGIN_FACTORY2,
            &mut factory2,
        )
    };
    if res == K_RESULT_OK && !factory2.is_null() {
        factory2 as *mut IPluginFactory2
    } else {
        std::ptr::null_mut()
    }
}

fn read_class_info(
    factory: *mut IPluginFactory,
    factory2: *mut IPluginFactory2,
    index: i32,
    dll_path: &std::path::Path,
    bundle_path: &std::path::Path,
) -> Option<PluginInfo> {
    // Prefer PClassInfo2 if IPluginFactory2 is available.
    if !factory2.is_null() {
        let mut info2 = unsafe { std::mem::zeroed::<PClassInfo2>() };
        let res = unsafe {
            ((*(*factory2).vtbl).get_class_info2)(factory2, index, &mut info2)
        };
        if res == K_RESULT_OK {
            return class_info2_to_plugin_info(&info2, dll_path, bundle_path);
        }
    }

    // Fall back to PClassInfo (no vendor/version/sub-categories).
    let mut info = unsafe { std::mem::zeroed::<super::com::PClassInfo>() };
    let res = unsafe { ((*(*factory).vtbl).get_class_info)(factory, index, &mut info) };
    if res != K_RESULT_OK {
        return None;
    }
    let category = i8_array_to_string(&info.category);
    if !category.starts_with(std::str::from_utf8(K_AUDIO_MODULE_CLASS).unwrap_or("")) {
        return None;
    }
    let name = i8_array_to_string(&info.name);
    Some(PluginInfo {
        id: super::com::guid_to_string(&info.cid),
        name,
        vendor: String::new(),
        version: String::new(),
        category,
        bundle_path: bundle_path.to_path_buf(),
        dll_path: dll_path.to_path_buf(),
        is_instrument: false,
    })
}

fn class_info2_to_plugin_info(
    info: &PClassInfo2,
    dll_path: &std::path::Path,
    bundle_path: &std::path::Path,
) -> Option<PluginInfo> {
    let category = i8_array_to_string(&info.category);
    if !category.starts_with(std::str::from_utf8(K_AUDIO_MODULE_CLASS).unwrap_or("")) {
        return None;
    }
    let sub_categories = i8_array_to_string(&info.sub_categories);
    let is_instrument = sub_categories.to_ascii_lowercase().contains("instrument")
        || sub_categories.to_ascii_lowercase().contains("synth");
    Some(PluginInfo {
        id: super::com::guid_to_string(&info.cid),
        name: i8_array_to_string(&info.name),
        vendor: i8_array_to_string(&info.vendor),
        version: i8_array_to_string(&info.version),
        category: sub_categories,
        bundle_path: bundle_path.to_path_buf(),
        dll_path: dll_path.to_path_buf(),
        is_instrument,
    })
}

/// Encodes a UTF-8 string as a null-terminated wide (UTF-16) string.
fn wide_string(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ────────────────────────────────────────────────────────────────────────────
// Windows DLL directory guard
// ────────────────────────────────────────────────────────────────────────────

/// RAII guard that calls `SetDllDirectoryW` on construction and restores the
/// previous value (empty string → system default) on drop.
#[cfg(target_os = "windows")]
struct DllDirectoryGuard;

#[cfg(target_os = "windows")]
impl DllDirectoryGuard {
    fn set(wide_path: &[u16]) -> Self {
        unsafe {
            windows_sys::Win32::System::LibraryLoader::SetDllDirectoryW(wide_path.as_ptr());
        }
        DllDirectoryGuard
    }
}

#[cfg(target_os = "windows")]
impl Drop for DllDirectoryGuard {
    fn drop(&mut self) {
        // Restore to system default by passing an empty string.
        let empty: Vec<u16> = vec![0u16];
        unsafe {
            windows_sys::Win32::System::LibraryLoader::SetDllDirectoryW(empty.as_ptr());
        }
    }
}
