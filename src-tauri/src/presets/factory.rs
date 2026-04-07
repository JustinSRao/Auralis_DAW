//! Factory preset loader.
//!
//! All factory presets are embedded at compile time via `include_str!()`.
//! They are read-only and cannot be overwritten or deleted by the user.

use anyhow::{Context, Result};
use serde_json::Value;

use super::mod_types::{Preset, PresetType};

/// A raw factory preset entry: (preset_type, name, json_str).
struct FactoryEntry {
    preset_type: PresetType,
    name: &'static str,
    json: &'static str,
}

/// All embedded factory presets.
static FACTORY_PRESETS: &[FactoryEntry] = &[
    FactoryEntry {
        preset_type: PresetType::Synth,
        name: "Bass Sub",
        json: include_str!("../../resources/presets/synth/bass_sub.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::Synth,
        name: "Lead Bright",
        json: include_str!("../../resources/presets/synth/lead_bright.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::Synth,
        name: "Pad Warm",
        json: include_str!("../../resources/presets/synth/pad_warm.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::Synth,
        name: "Pluck Short",
        json: include_str!("../../resources/presets/synth/pluck_short.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::Synth,
        name: "Keys Electric",
        json: include_str!("../../resources/presets/synth/keys_electric.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::DrumMachine,
        name: "Acoustic Kit",
        json: include_str!("../../resources/presets/drum_machine/acoustic_kit.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::DrumMachine,
        name: "Electronic Kit",
        json: include_str!("../../resources/presets/drum_machine/electronic_kit.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::Eq,
        name: "Low Cut 100Hz",
        json: include_str!("../../resources/presets/eq/low_cut_100hz.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::Eq,
        name: "Presence Boost",
        json: include_str!("../../resources/presets/eq/presence_boost.mapreset"),
    },
    FactoryEntry {
        preset_type: PresetType::Eq,
        name: "Mastering Curve",
        json: include_str!("../../resources/presets/eq/mastering_curve.mapreset"),
    },
];

/// Returns all factory presets for a given type, parsed and ready for use.
pub fn load_factory_presets(preset_type: PresetType) -> Result<Vec<Preset>> {
    FACTORY_PRESETS
        .iter()
        .filter(|e| e.preset_type == preset_type)
        .map(|e| parse_factory_entry(e))
        .collect()
}

/// Returns the set of factory preset names for a given type (for protection checks).
pub fn factory_names_for_type(preset_type: PresetType) -> Vec<String> {
    FACTORY_PRESETS
        .iter()
        .filter(|e| e.preset_type == preset_type)
        .map(|e| e.name.to_string())
        .collect()
}

fn parse_factory_entry(entry: &FactoryEntry) -> Result<Preset> {
    let root: Value = serde_json::from_str(entry.json)
        .with_context(|| format!("Failed to parse factory preset '{}'", entry.name))?;
    let params = root
        .get("params")
        .cloned()
        .unwrap_or(Value::Null);
    Ok(Preset {
        name: entry.name.to_string(),
        preset_type: entry.preset_type,
        params,
        is_factory: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_factory_presets_parse() {
        // Verifies that every embedded JSON file is valid and parseable.
        // The total number of factory presets across all types is 10.
        let mut count = 0usize;
        for preset_type in [
            PresetType::Synth,
            PresetType::Sampler,
            PresetType::DrumMachine,
            PresetType::Eq,
            PresetType::Reverb,
            PresetType::Delay,
            PresetType::Compressor,
        ] {
            let presets = load_factory_presets(preset_type)
                .unwrap_or_else(|e| panic!("load_factory_presets({:?}) failed: {}", preset_type, e));
            count += presets.len();
        }
        assert_eq!(count, 10, "expected 10 total factory presets");
    }

    #[test]
    fn test_factory_names_for_synth() {
        let names = factory_names_for_type(PresetType::Synth);
        assert_eq!(names.len(), 5, "expected exactly 5 factory synth preset names");
    }

    #[test]
    fn test_is_factory_name_correct() {
        let names = factory_names_for_type(PresetType::Synth);
        // "Bass Sub" is a known factory synth preset.
        assert!(names.contains(&"Bass Sub".to_string()), "Bass Sub should be a factory name");
        // A user-invented name should not appear.
        assert!(
            !factory_names_for_type(PresetType::Synth).contains(&"Custom Name".to_string()),
            "Custom Name should not be a factory name"
        );
    }
}
