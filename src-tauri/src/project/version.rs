//! Schema versioning and migration support for `.mapp` project files.
//!
//! When the project file format changes in a future sprint, add a new migration
//! entry to the `MIGRATIONS` table. Migrations are applied in order until the
//! serialized data matches `CURRENT_SCHEMA`.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Semantic version of the `.mapp` project file schema.
///
/// Stored verbatim inside `project.json` so the loader can detect and migrate
/// older files automatically.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct SchemaVersion {
    /// Breaking change — old loaders cannot read new files.
    pub major: u32,
    /// Backwards-compatible additions.
    pub minor: u32,
    /// Backwards-compatible bug fixes / clarifications.
    pub patch: u32,
}

impl SchemaVersion {
    /// Constructs a new `SchemaVersion`.
    pub fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self { major, minor, patch }
    }
}

impl std::fmt::Display for SchemaVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// The schema version that this build of the application produces.
///
/// Bump `major` when the on-disk format changes in a backwards-incompatible way.
/// Bump `minor` when new optional fields are added.
/// Bump `patch` for clarifications that require no data changes.
pub const CURRENT_SCHEMA: SchemaVersion = SchemaVersion {
    major: 1,
    minor: 3,
    patch: 0,
};

// ---------------------------------------------------------------------------
// Migration table
// ---------------------------------------------------------------------------

/// A migration function: takes the raw JSON `Value` for a project file at
/// version `from` and transforms it to the next version in-place.
type MigrationFn = fn(&mut Value) -> Result<()>;

struct Migration {
    /// The version this migration upgrades *from*.
    from: SchemaVersion,
    /// The version this migration upgrades *to*.
    to: SchemaVersion,
    apply: MigrationFn,
}

// ---------------------------------------------------------------------------
// Migration functions
// ---------------------------------------------------------------------------

/// Migrates a project file from schema v1.0.0 to v1.1.0.
///
/// Injects an empty `"patterns": []` array if the field is absent.
/// Existing `patterns` values (if any) are left untouched.
fn migrate_1_0_0_to_1_1_0(data: &mut Value) -> Result<()> {
    if let Some(obj) = data.as_object_mut() {
        obj.entry("patterns")
            .or_insert_with(|| serde_json::json!([]));
    }
    Ok(())
}

/// Migrates a project file from schema v1.1.0 to v1.2.0.
///
/// Injects a default `"tempo_map"` array into `transport` if absent.
/// The default contains a single 120 BPM Step point at tick 0, or uses the
/// existing constant `bpm` field if available.
fn migrate_1_1_0_to_1_2_0(data: &mut Value) -> Result<()> {
    if let Some(transport) = data.get_mut("transport").and_then(|t| t.as_object_mut()) {
        if !transport.contains_key("tempo_map") {
            let bpm = transport
                .get("bpm")
                .and_then(|v| v.as_f64())
                .unwrap_or(120.0);
            transport.insert(
                "tempo_map".to_string(),
                serde_json::json!([{ "tick": 0, "bpm": bpm, "interp": "Step" }]),
            );
        }
    }
    Ok(())
}

/// Migrates a project file from schema v1.2.0 to v1.3.0.
///
/// Adds `stretch_ratio: null` and `pitch_shift_semitones: null` to all clips
/// in all tracks that are missing those fields. Because both fields have
/// `#[serde(default)]` in Rust this migration is a no-op for runtime
/// deserialization, but it keeps the stored JSON tidy.
fn migrate_1_2_0_to_1_3_0(data: &mut Value) -> Result<()> {
    if let Some(tracks) = data.get_mut("tracks").and_then(|t| t.as_array_mut()) {
        for track in tracks.iter_mut() {
            if let Some(clips) = track.get_mut("clips").and_then(|c| c.as_array_mut()) {
                for clip in clips.iter_mut() {
                    if let Some(obj) = clip.as_object_mut() {
                        obj.entry("stretch_ratio").or_insert(Value::Null);
                        obj.entry("pitch_shift_semitones").or_insert(Value::Null);
                    }
                }
            }
        }
    }
    Ok(())
}

/// All registered migrations, in ascending `from` order.
///
/// Add entries here whenever the schema version is bumped.
static MIGRATIONS: &[Migration] = &[
    // v1.0.0 → v1.1.0: add `patterns` array (Sprint 12 Pattern System).
    Migration {
        from: SchemaVersion { major: 1, minor: 0, patch: 0 },
        to: SchemaVersion { major: 1, minor: 1, patch: 0 },
        apply: migrate_1_0_0_to_1_1_0,
    },
    // v1.1.0 → v1.2.0: add `transport.tempo_map` array (Sprint 41 Tempo Automation).
    Migration {
        from: SchemaVersion { major: 1, minor: 1, patch: 0 },
        to: SchemaVersion { major: 1, minor: 2, patch: 0 },
        apply: migrate_1_1_0_to_1_2_0,
    },
    // v1.2.0 → v1.3.0: add `stretch_ratio` and `pitch_shift_semitones` to clips (Sprint 16).
    Migration {
        from: SchemaVersion { major: 1, minor: 2, patch: 0 },
        to: SchemaVersion { major: 1, minor: 3, patch: 0 },
        apply: migrate_1_2_0_to_1_3_0,
    },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Applies all necessary migrations to bring `data` up to `CURRENT_SCHEMA`.
///
/// The function reads the `schema_version` field from `data`, then walks the
/// `MIGRATIONS` table applying each applicable step in sequence.
///
/// Returns an error if:
/// - `schema_version` is missing or malformed.
/// - The file's `major` version is greater than `CURRENT_SCHEMA.major`
///   (we cannot downgrade).
/// - A migration function itself returns an error.
pub fn apply_migrations(data: &mut Value) -> Result<()> {
    let version = read_schema_version(data)?;

    // Cannot load files from a future major version.
    if version.major > CURRENT_SCHEMA.major {
        return Err(anyhow!(
            "Project file schema version {} is newer than this application supports ({}). \
             Please upgrade the application.",
            version,
            CURRENT_SCHEMA
        ));
    }

    if version == CURRENT_SCHEMA {
        return Ok(());
    }

    let mut current = version;
    for migration in MIGRATIONS {
        if current >= CURRENT_SCHEMA {
            break;
        }
        if migration.from == current {
            (migration.apply)(data)
                .with_context(|| format!("Migration {} → {} failed", migration.from, migration.to))?;
            current = migration.to.clone();
            write_schema_version(data, &current);
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_schema_version(data: &Value) -> Result<SchemaVersion> {
    let sv = data
        .get("schema_version")
        .ok_or_else(|| anyhow!("Missing `schema_version` field in project file"))?;
    serde_json::from_value::<SchemaVersion>(sv.clone())
        .context("Failed to parse `schema_version` field")
}

fn write_schema_version(data: &mut Value, version: &SchemaVersion) {
    if let Some(obj) = data.as_object_mut() {
        obj.insert(
            "schema_version".to_string(),
            serde_json::to_value(version).unwrap_or(Value::Null),
        );
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn current_schema_is_v1_3() {
        assert_eq!(CURRENT_SCHEMA, SchemaVersion::new(1, 3, 0));
    }

    #[test]
    fn version_ordering() {
        let v1 = SchemaVersion::new(1, 0, 0);
        let v1_1 = SchemaVersion::new(1, 1, 0);
        let v2 = SchemaVersion::new(2, 0, 0);
        assert!(v1 < v1_1);
        assert!(v1_1 < v2);
        assert!(v1 < v2);
    }

    #[test]
    fn no_migration_needed_for_current_version() {
        let mut data = json!({
            "schema_version": { "major": 1, "minor": 3, "patch": 0 },
            "patterns": []
        });
        assert!(apply_migrations(&mut data).is_ok());
        // Schema version unchanged.
        let sv: SchemaVersion =
            serde_json::from_value(data["schema_version"].clone()).unwrap();
        assert_eq!(sv, CURRENT_SCHEMA);
    }

    #[test]
    fn migration_1_0_0_injects_patterns_and_tempo_map() {
        let mut data = json!({
            "schema_version": { "major": 1, "minor": 0, "patch": 0 },
            "name": "Old Project",
            "transport": { "bpm": 140.0 },
            "tracks": []
        });
        assert!(apply_migrations(&mut data).is_ok());
        // Should have been bumped to current (v1.3.0).
        let sv: SchemaVersion =
            serde_json::from_value(data["schema_version"].clone()).unwrap();
        assert_eq!(sv, CURRENT_SCHEMA);
        // patterns field must be present and empty.
        assert_eq!(data["patterns"], json!([]));
        // tempo_map must be injected using the existing bpm
        let tm = &data["transport"]["tempo_map"];
        assert_eq!(tm[0]["bpm"], json!(140.0));
        assert_eq!(tm[0]["tick"], json!(0));
        assert_eq!(tm[0]["interp"], json!("Step"));
    }

    #[test]
    fn migration_1_0_0_to_1_1_0_preserves_existing_patterns() {
        let existing = json!([{"id": "pat-1", "name": "Verse", "trackId": "t1",
                               "lengthBars": 4, "content": {"type": "Midi", "notes": []}}]);
        let mut data = json!({
            "schema_version": { "major": 1, "minor": 0, "patch": 0 },
            "patterns": existing.clone(),
            "transport": { "bpm": 120.0 }
        });
        assert!(apply_migrations(&mut data).is_ok());
        assert_eq!(data["patterns"], existing);
    }

    #[test]
    fn migration_1_1_0_to_1_2_0_injects_tempo_map() {
        let mut data = json!({
            "schema_version": { "major": 1, "minor": 1, "patch": 0 },
            "transport": { "bpm": 90.0 },
            "tracks": []
        });
        assert!(apply_migrations(&mut data).is_ok());
        let sv: SchemaVersion =
            serde_json::from_value(data["schema_version"].clone()).unwrap();
        assert_eq!(sv, CURRENT_SCHEMA);
        let tm = &data["transport"]["tempo_map"];
        assert_eq!(tm[0]["bpm"], json!(90.0));
    }

    #[test]
    fn migration_1_2_0_to_1_3_0_injects_stretch_fields() {
        let mut data = json!({
            "schema_version": { "major": 1, "minor": 2, "patch": 0 },
            "tracks": [
                {
                    "clips": [
                        { "id": "c1", "name": "kick", "start_beats": 0.0 }
                    ]
                }
            ]
        });
        assert!(apply_migrations(&mut data).is_ok());
        let sv: SchemaVersion =
            serde_json::from_value(data["schema_version"].clone()).unwrap();
        assert_eq!(sv, CURRENT_SCHEMA);
        // stretch fields must be injected as null
        assert_eq!(data["tracks"][0]["clips"][0]["stretch_ratio"], json!(null));
        assert_eq!(data["tracks"][0]["clips"][0]["pitch_shift_semitones"], json!(null));
    }

    #[test]
    fn future_major_version_returns_error() {
        let mut data = json!({
            "schema_version": { "major": 99, "minor": 0, "patch": 0 }
        });
        assert!(apply_migrations(&mut data).is_err());
    }

    #[test]
    fn missing_schema_version_returns_error() {
        let mut data = json!({ "name": "test" });
        assert!(apply_migrations(&mut data).is_err());
    }

    #[test]
    fn schema_version_display() {
        let v = SchemaVersion::new(2, 3, 4);
        assert_eq!(v.to_string(), "2.3.4");
    }
}
