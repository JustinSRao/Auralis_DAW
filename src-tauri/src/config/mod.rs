//! Application configuration persistence (Sprint 27).
//!
//! Loads and saves a TOML config file (`app_config.toml`) in the platform
//! app-data directory. Missing file returns [`AppConfig::default`] without
//! error; any other I/O error is propagated via [`anyhow::Error`].

pub mod commands;

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Config structs
// ---------------------------------------------------------------------------

/// Top-level application configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// Audio engine settings.
    pub audio: AudioConfig,
    /// MIDI connection settings.
    pub midi: MidiConfig,
    /// General application settings.
    pub general: GeneralConfig,
    /// UI layout settings.
    pub ui: UiConfig,
    /// Keyboard shortcut bindings.
    #[serde(default)]
    pub shortcuts: ShortcutsConfig,
    /// Sample browser favourites and recent folders.
    #[serde(default)]
    pub browser: BrowserConfig,
}

/// Audio engine device and format configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    /// Name of the selected output device, or `None` for the system default.
    pub output_device: Option<String>,
    /// Name of the selected input device, or `None` for the system default.
    pub input_device: Option<String>,
    /// Sample rate in Hz (e.g. 44100 or 48000).
    pub sample_rate: u32,
    /// Audio buffer size in frames (e.g. 128, 256, 512).
    pub buffer_size: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            output_device: None,
            input_device: None,
            sample_rate: 44100,
            buffer_size: 256,
        }
    }
}

/// MIDI connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MidiConfig {
    /// Name of the active MIDI input port, or `None`.
    pub active_input: Option<String>,
    /// Name of the active MIDI output port, or `None`.
    pub active_output: Option<String>,
}

/// General application behaviour settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    /// Auto-save interval in seconds; 0 disables auto-save.
    pub autosave_interval_secs: u64,
    /// Maximum number of recent projects to remember.
    pub recent_projects_limit: usize,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            autosave_interval_secs: 300,
            recent_projects_limit: 10,
        }
    }
}

/// Keyboard shortcut binding configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ShortcutsConfig {
    /// Map of action ID (e.g. `"transport.play_stop"`) to key combo string
    /// (e.g. `"Space"`). Empty string means the action is unbound.
    #[serde(default)]
    pub bindings: std::collections::HashMap<String, String>,
}

/// Sample & content browser settings (Sprint 28).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserConfig {
    /// Absolute folder paths pinned as favourites.
    #[serde(default)]
    pub favorites: Vec<String>,
    /// Recently visited folder paths, newest-first, capped at 10.
    #[serde(default)]
    pub recent_folders: Vec<String>,
}

/// UI layout and preference settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    /// Whether the browser panel is open on startup.
    pub browser_open: bool,
    /// Whether the mixer panel is open on startup.
    pub mixer_open: bool,
    /// Whether the timeline follows the playhead during playback.
    pub follow_playhead: bool,
    /// Active colour theme name (e.g. "dark").
    pub theme: String,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            browser_open: true,
            mixer_open: true,
            follow_playhead: false,
            theme: "dark".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Managed state type alias
// ---------------------------------------------------------------------------

/// Tauri managed state type for the application configuration.
pub type AppConfigState = Arc<Mutex<AppConfig>>;

// ---------------------------------------------------------------------------
// File name
// ---------------------------------------------------------------------------

const CONFIG_FILE: &str = "app_config.toml";

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/// Loads [`AppConfig`] from `<app_data_dir>/app_config.toml`.
///
/// Returns [`AppConfig::default`] silently when the file does not exist.
/// All other I/O errors are propagated.
pub fn load(app_data_dir: &Path) -> anyhow::Result<AppConfig> {
    let path = app_data_dir.join(CONFIG_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            let cfg: AppConfig = toml::from_str(&text)?;
            Ok(cfg)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(AppConfig::default())
        }
        Err(e) => Err(anyhow::anyhow!("failed to read config file: {e}")),
    }
}

/// Serialises `config` to TOML and writes it to `<app_data_dir>/app_config.toml`.
pub fn save(config: &AppConfig, app_data_dir: &Path) -> anyhow::Result<()> {
    let text = toml::to_string_pretty(config)?;
    let path = app_data_dir.join(CONFIG_FILE);
    std::fs::write(&path, text)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn roundtrip_default_config() {
        let cfg = AppConfig::default();
        let text = toml::to_string_pretty(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&text).expect("deserialize");
        // Spot-check key fields
        assert_eq!(back.audio.sample_rate, cfg.audio.sample_rate);
        assert_eq!(back.audio.buffer_size, cfg.audio.buffer_size);
        assert_eq!(back.general.autosave_interval_secs, cfg.general.autosave_interval_secs);
        assert_eq!(back.general.recent_projects_limit, cfg.general.recent_projects_limit);
        assert_eq!(back.ui.browser_open, cfg.ui.browser_open);
        assert_eq!(back.ui.theme, cfg.ui.theme);
        // shortcuts field defaults to empty map
        assert!(back.shortcuts.bindings.is_empty());
    }

    #[test]
    fn shortcuts_roundtrip() {
        let mut cfg = AppConfig::default();
        cfg.shortcuts.bindings.insert("transport.play_stop".to_string(), "Space".to_string());
        cfg.shortcuts.bindings.insert("project.save".to_string(), "Ctrl+S".to_string());
        let text = toml::to_string_pretty(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&text).expect("deserialize");
        assert_eq!(back.shortcuts.bindings.get("transport.play_stop").map(String::as_str), Some("Space"));
        assert_eq!(back.shortcuts.bindings.get("project.save").map(String::as_str), Some("Ctrl+S"));
    }

    #[test]
    fn old_toml_without_shortcuts_deserializes_ok() {
        // Simulate a TOML file from before this field existed (no [shortcuts] section).
        let old_toml = r#"
[audio]
output_device = "ASIO4ALL"
input_device = "Microphone"
sample_rate = 44100
buffer_size = 256

[midi]
active_input = "USB Keyboard"
active_output = "USB Keyboard"

[general]
autosave_interval_secs = 300
recent_projects_limit = 10

[ui]
browser_open = true
mixer_open = true
follow_playhead = false
theme = "dark"
"#;
        let cfg: AppConfig = toml::from_str(old_toml).expect("deserialize old toml");
        assert!(cfg.shortcuts.bindings.is_empty(), "shortcuts should default to empty map");
        assert_eq!(cfg.audio.sample_rate, 44100);
    }

    #[test]
    fn browser_config_roundtrip() {
        let mut cfg = AppConfig::default();
        cfg.browser.favorites.push("/music/samples".to_string());
        cfg.browser.recent_folders.push("/music/drums".to_string());
        let text = toml::to_string_pretty(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&text).expect("deserialize");
        assert_eq!(back.browser.favorites, vec!["/music/samples"]);
        assert_eq!(back.browser.recent_folders, vec!["/music/drums"]);
    }

    #[test]
    fn old_toml_without_browser_section_deserializes_ok() {
        let old_toml = r#"
[audio]
output_device = "ASIO4ALL"
input_device = "Microphone"
sample_rate = 44100
buffer_size = 256

[midi]
active_input = "USB Keyboard"
active_output = "USB Keyboard"

[general]
autosave_interval_secs = 300
recent_projects_limit = 10

[ui]
browser_open = true
mixer_open = true
follow_playhead = false
theme = "dark"

[shortcuts]
"#;
        let cfg: AppConfig = toml::from_str(old_toml).expect("deserialize old toml");
        assert!(cfg.browser.favorites.is_empty(), "browser favorites should default to empty");
        assert!(cfg.browser.recent_folders.is_empty(), "browser recent_folders should default to empty");
        assert_eq!(cfg.audio.sample_rate, 44100);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let tmp = TempDir::new().expect("tempdir");
        // Point at a non-existent subdirectory
        let nonexistent = tmp.path().join("does_not_exist");
        // The file does not exist, so load should return the default without error.
        // Note: the directory also doesn't exist — that's fine; only the file path
        // matters for the NotFound check.
        let cfg = load(&nonexistent).expect("should return default");
        assert_eq!(cfg.audio.sample_rate, 44100);
        assert_eq!(cfg.audio.buffer_size, 256);
    }

    #[test]
    fn save_then_load_roundtrip() {
        let tmp = TempDir::new().expect("tempdir");
        let mut cfg = AppConfig::default();
        cfg.audio.sample_rate = 48000;
        cfg.audio.buffer_size = 512;
        cfg.audio.output_device = Some("ASIO4ALL v2".to_string());
        cfg.midi.active_input = Some("USB MIDI Keyboard".to_string());
        cfg.general.autosave_interval_secs = 60;
        cfg.ui.browser_open = false;
        cfg.ui.theme = "dark".to_string();

        save(&cfg, tmp.path()).expect("save");
        let back = load(tmp.path()).expect("load");

        assert_eq!(back.audio.sample_rate, 48000);
        assert_eq!(back.audio.buffer_size, 512);
        assert_eq!(back.audio.output_device, Some("ASIO4ALL v2".to_string()));
        assert_eq!(back.midi.active_input, Some("USB MIDI Keyboard".to_string()));
        assert_eq!(back.general.autosave_interval_secs, 60);
        assert!(!back.ui.browser_open);
    }
}
