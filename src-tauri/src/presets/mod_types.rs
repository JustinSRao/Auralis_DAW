//! Shared types for the preset system.

use serde::{Deserialize, Serialize};

/// All supported preset categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresetType {
    /// Subtractive synthesizer preset.
    Synth,
    /// Sampler ADSR preset.
    Sampler,
    /// Drum machine pattern + sound preset.
    DrumMachine,
    /// Parametric EQ preset.
    Eq,
    /// Algorithmic reverb preset.
    Reverb,
    /// Stereo delay preset.
    Delay,
    /// Compressor preset.
    Compressor,
}

impl PresetType {
    /// Returns the snake_case directory name used for file storage.
    pub fn snake_name(self) -> &'static str {
        match self {
            PresetType::Synth => "synth",
            PresetType::Sampler => "sampler",
            PresetType::DrumMachine => "drum_machine",
            PresetType::Eq => "eq",
            PresetType::Reverb => "reverb",
            PresetType::Delay => "delay",
            PresetType::Compressor => "compressor",
        }
    }
}

/// A fully loaded preset including its parameter data.
///
/// `is_factory` is a runtime-only flag — never written to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    /// Human-readable preset name.
    pub name: String,
    /// Category of this preset.
    pub preset_type: PresetType,
    /// Parameter payload (shape depends on `preset_type`).
    pub params: serde_json::Value,
    /// `true` if this is a built-in factory preset (runtime flag, not persisted).
    pub is_factory: bool,
}

/// Lightweight metadata returned by `list_presets`.
///
/// Does not include parameter data — call `load_preset` for that.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetMeta {
    /// Human-readable preset name.
    pub name: String,
    /// Category of this preset.
    pub preset_type: PresetType,
    /// Whether this is a factory (read-only) preset.
    pub is_factory: bool,
}
