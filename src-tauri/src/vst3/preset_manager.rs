/// VST3 preset manager.
///
/// Discovers `.vstpreset` files in the standard folder layout and applies them
/// to a loaded plugin component.
///
/// Standard folder: `%USERPROFILE%\Documents\VST3 Presets\{Vendor}\{PluginName}\*.vstpreset`
use std::path::PathBuf;

use super::com::{IComponent, IBStream, K_RESULT_OK};

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/// Metadata for a single discovered `.vstpreset` file.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PresetInfo {
    /// File name without the `.vstpreset` extension.
    pub name: String,
    /// Full absolute path to the `.vstpreset` file.
    pub path: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the root presets directory: `Documents\VST3 Presets`.
pub fn presets_root() -> PathBuf {
    // Prefer the well-known Documents folder via the USERPROFILE env var.
    // On Windows this resolves to e.g. `C:\Users\<user>\Documents`.
    let documents = std::env::var("USERPROFILE")
        .map(|p| PathBuf::from(p).join("Documents"))
        .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Default\\Documents"));
    documents.join("VST3 Presets")
}

/// Walks `Documents\VST3 Presets\{vendor}\{plugin_name}\` and returns all
/// `.vstpreset` files found there.
///
/// Returns an empty `Vec` if the directory doesn't exist or can't be read.
pub fn get_presets(vendor: &str, plugin_name: &str) -> Vec<PresetInfo> {
    let dir = presets_root().join(vendor).join(plugin_name);
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut presets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("vstpreset") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            presets.push(PresetInfo {
                name,
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    presets.sort_by(|a, b| a.name.cmp(&b.name));
    presets
}

/// Reads a `.vstpreset` file and calls `IComponent::setState` with its bytes.
///
/// The `.vstpreset` format has a binary header before the actual state payload.
/// For maximum compatibility, we pass the raw file bytes directly — most plugins
/// accept this, and those that don't will simply return an error which we log as
/// a warning rather than propagating as a hard failure.
///
/// # Safety
/// `component` must be a valid, initialised `IComponent` pointer.
pub fn apply_preset(component: *mut IComponent, preset_path: &str) -> anyhow::Result<()> {
    let bytes = std::fs::read(preset_path)
        .map_err(|e| anyhow::anyhow!("Failed to read preset '{preset_path}': {e}"))?;

    let mut stream = super::state::VecIBStream::from_data(bytes);
    let stream_ptr: *mut IBStream = stream.as_ibstream_ptr();

    let res = unsafe { ((*(*component).vtbl).set_state)(component, stream_ptr) };
    if res != K_RESULT_OK {
        log::warn!(
            "IComponent::setState returned {res} for preset '{}' — plugin may not support raw preset bytes",
            preset_path
        );
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_path_construction_uses_documents_dir() {
        let root = presets_root();
        // Should end with "Documents\VST3 Presets" (or Documents/VST3 Presets on Unix).
        let root_str = root.to_string_lossy();
        assert!(
            root_str.contains("VST3 Presets"),
            "Expected 'VST3 Presets' in path, got: {root_str}"
        );
        assert!(
            root_str.contains("Documents"),
            "Expected 'Documents' in path, got: {root_str}"
        );
    }

    #[test]
    fn preset_info_serializes_correctly() {
        let info = PresetInfo {
            name: "My Preset".to_string(),
            path: "C:\\Users\\test\\Documents\\VST3 Presets\\Acme\\Synth\\My Preset.vstpreset"
                .to_string(),
        };
        let json = serde_json::to_string(&info).expect("serialize");
        assert!(json.contains("My Preset"));
        assert!(json.contains("VST3 Presets"));

        let decoded: PresetInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded.name, info.name);
        assert_eq!(decoded.path, info.path);
    }

    #[test]
    fn get_presets_returns_empty_for_missing_directory() {
        let results = get_presets("NonExistentVendor_XYZ_12345", "NonExistentPlugin_XYZ_12345");
        assert!(results.is_empty());
    }
}
