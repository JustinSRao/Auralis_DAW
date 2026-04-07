//! `PresetManager` — handles user preset persistence.
//!
//! Factory presets are embedded at compile time (see `factory.rs`).
//! User presets live in `{app_data_dir}/presets/{preset_type_snake}/` as
//! `{name}.mapreset` JSON files.

use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use tokio::fs;

use super::factory::{factory_names_for_type, load_factory_presets};
use super::mod_types::{Preset, PresetMeta, PresetType};

/// Manages user preset I/O.
///
/// One instance is created at application startup and registered as Tauri
/// managed state behind a `Mutex<PresetManager>`.
pub struct PresetManager {
    /// Root directory for all user presets, e.g. `{app_data_dir}/presets/`.
    pub presets_root: PathBuf,
}

impl PresetManager {
    /// Creates a new `PresetManager` rooted at `{app_data_dir}/presets/`.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            presets_root: app_data_dir.join("presets"),
        }
    }

    /// Returns the directory for a given preset type, creating it if necessary.
    async fn type_dir(&self, preset_type: PresetType) -> Result<PathBuf> {
        let dir = self.presets_root.join(preset_type.snake_name());
        fs::create_dir_all(&dir)
            .await
            .with_context(|| format!("Failed to create preset dir {:?}", dir))?;
        Ok(dir)
    }

    /// Lists all presets (factory first, then user), both alphabetically sorted.
    ///
    /// Returns only metadata — no params.  Call [`load`] to get the full preset.
    pub async fn list(&self, preset_type: PresetType) -> Result<Vec<PresetMeta>> {
        // Factory presets (sorted by name)
        let mut factory = load_factory_presets(preset_type)?;
        factory.sort_by(|a, b| a.name.cmp(&b.name));
        let mut metas: Vec<PresetMeta> = factory
            .iter()
            .map(|p| PresetMeta {
                name: p.name.clone(),
                preset_type: p.preset_type,
                is_factory: true,
            })
            .collect();

        // User presets (sorted by name)
        let dir = self.type_dir(preset_type).await?;
        let mut entries = match fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(_) => return Ok(metas),
        };

        let mut user_names: Vec<String> = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("mapreset") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    // Decode the percent-encoded name stored on disk.
                    user_names.push(decode_filename(stem));
                }
            }
        }
        user_names.sort();

        let factory_name_set: std::collections::HashSet<String> =
            factory_names_for_type(preset_type).into_iter().collect();

        for name in user_names {
            // Skip any that shadow a factory name (shouldn't normally happen due to
            // save guard, but be defensive).
            if factory_name_set.contains(&name) {
                continue;
            }
            metas.push(PresetMeta {
                name,
                preset_type,
                is_factory: false,
            });
        }

        Ok(metas)
    }

    /// Loads a preset by name, checking factory first, then disk.
    pub async fn load(&self, preset_type: PresetType, name: &str) -> Result<Preset> {
        // Check factory first
        let factories = load_factory_presets(preset_type)?;
        if let Some(p) = factories.into_iter().find(|p| p.name == name) {
            return Ok(p);
        }

        // Load from disk
        let dir = self.type_dir(preset_type).await?;
        let path = dir.join(format!("{}.mapreset", encode_filename(name)));
        let contents = fs::read_to_string(&path)
            .await
            .with_context(|| format!("Failed to read preset file {:?}", path))?;
        let root: serde_json::Value = serde_json::from_str(&contents)
            .with_context(|| format!("Failed to parse preset file {:?}", path))?;
        let params = root.get("params").cloned().unwrap_or(serde_json::Value::Null);
        Ok(Preset {
            name: name.to_string(),
            preset_type,
            params,
            is_factory: false,
        })
    }

    /// Saves a user preset to disk.
    ///
    /// Rejects names that clash with factory presets.
    pub async fn save(&self, preset: &Preset) -> Result<()> {
        let factory_names = factory_names_for_type(preset.preset_type);
        if factory_names.iter().any(|n| n == &preset.name) {
            return Err(anyhow!("Cannot overwrite factory preset '{}'", preset.name));
        }

        let dir = self.type_dir(preset.preset_type).await?;
        let path = dir.join(format!("{}.mapreset", encode_filename(&preset.name)));

        let doc = serde_json::json!({
            "schema_version": 1,
            "preset_type": preset.preset_type.snake_name(),
            "name": preset.name,
            "params": preset.params,
        });
        let json = serde_json::to_string_pretty(&doc)
            .context("Failed to serialize preset")?;
        fs::write(&path, json)
            .await
            .with_context(|| format!("Failed to write preset file {:?}", path))?;
        Ok(())
    }

    /// Deletes a user preset by name.
    ///
    /// Rejects deletion of factory presets.
    pub async fn delete(&self, preset_type: PresetType, name: &str) -> Result<()> {
        let factory_names = factory_names_for_type(preset_type);
        if factory_names.iter().any(|n| n == name) {
            return Err(anyhow!("Cannot delete factory preset '{}'", name));
        }

        let dir = self.type_dir(preset_type).await?;
        let path = dir.join(format!("{}.mapreset", encode_filename(name)));
        fs::remove_file(&path)
            .await
            .with_context(|| format!("Failed to delete preset file {:?}", path))?;
        Ok(())
    }
}

/// Replaces characters that are unsafe in filenames with percent-encoding.
fn encode_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => {
                format!("%{:02X}", c as u32)
            }
            c => c.to_string(),
        })
        .collect()
}

/// Decodes percent-encoded filename back to the original preset name.
fn decode_filename(encoded: &str) -> String {
    let mut result = String::with_capacity(encoded.len());
    let mut chars = encoded.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(h1), Some(h2)) = (h1, h2) {
                let hex = format!("{}{}", h1, h2);
                if let Ok(code) = u32::from_str_radix(&hex, 16) {
                    if let Some(decoded) = char::from_u32(code) {
                        result.push(decoded);
                        continue;
                    }
                }
                // Fallback: emit the raw bytes
                result.push('%');
                result.push(h1);
                result.push(h2);
            }
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::mod_types::PresetType;

    // ─── encode/decode helpers ────────────────────────────────────────────────

    #[test]
    fn test_encode_decode_filename_roundtrip() {
        // Each special character must survive an encode → decode roundtrip.
        let original = "My?Preset*With/Colons:Here";
        let encoded = encode_filename(original);
        let decoded = decode_filename(&encoded);
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_encode_decode_simple_name() {
        let original = "Bass Sub";
        let encoded = encode_filename(original);
        // Spaces are not special — should be preserved as-is.
        assert_eq!(encoded, "Bass Sub");
        let decoded = decode_filename(&encoded);
        assert_eq!(decoded, original);
    }

    // ─── PresetManager I/O ────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_save_and_load_roundtrip() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let manager = PresetManager::new(dir.path().to_path_buf());

        let preset = Preset {
            name: "My User Preset".to_string(),
            preset_type: PresetType::Synth,
            params: serde_json::json!({ "waveform": 0, "volume": 0.8 }),
            is_factory: false,
        };

        manager.save(&preset).await.expect("save failed");
        let loaded = manager
            .load(PresetType::Synth, "My User Preset")
            .await
            .expect("load failed");

        assert_eq!(loaded.name, preset.name);
        // schema_version is written into the JSON file but not stored in Preset struct;
        // verify the file exists and the name and type round-trip correctly.
        assert_eq!(loaded.preset_type, preset.preset_type);
        assert_eq!(loaded.is_factory, false);
    }

    #[tokio::test]
    async fn test_save_factory_name_returns_err() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let manager = PresetManager::new(dir.path().to_path_buf());

        // "Bass Sub" is a factory name for Synth.
        let preset = Preset {
            name: "Bass Sub".to_string(),
            preset_type: PresetType::Synth,
            params: serde_json::json!({}),
            is_factory: false,
        };
        let result = manager.save(&preset).await;
        assert!(result.is_err(), "saving a factory name should return Err");
    }

    #[tokio::test]
    async fn test_delete_factory_name_returns_err() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let manager = PresetManager::new(dir.path().to_path_buf());

        let result = manager.delete(PresetType::Synth, "Bass Sub").await;
        assert!(result.is_err(), "deleting a factory name should return Err");
    }

    #[tokio::test]
    async fn test_list_includes_factory_and_user() {
        let dir = tempfile::tempdir().expect("failed to create tempdir");
        let manager = PresetManager::new(dir.path().to_path_buf());

        // Save one user preset.
        let user_preset = Preset {
            name: "My Custom Synth".to_string(),
            preset_type: PresetType::Synth,
            params: serde_json::json!({}),
            is_factory: false,
        };
        manager.save(&user_preset).await.expect("save failed");

        let list = manager.list(PresetType::Synth).await.expect("list failed");

        let factory_entries: Vec<_> = list.iter().filter(|m| m.is_factory).collect();
        let user_entries: Vec<_> = list.iter().filter(|m| !m.is_factory).collect();

        // There are 5 factory synth presets embedded in the binary.
        assert_eq!(factory_entries.len(), 5, "expected 5 factory synth presets");

        // Our user preset should appear exactly once.
        assert_eq!(user_entries.len(), 1);
        assert_eq!(user_entries[0].name, "My Custom Synth");
    }
}
