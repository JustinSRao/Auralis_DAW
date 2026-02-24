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
    minor: 0,
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

/// All registered migrations, in ascending `from` order.
///
/// Add entries here whenever the schema version is bumped.
static MIGRATIONS: &[Migration] = &[
    // v1.0.0 is the baseline — no migration needed to reach it.
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
    fn current_schema_is_v1() {
        assert_eq!(CURRENT_SCHEMA, SchemaVersion::new(1, 0, 0));
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
            "schema_version": { "major": 1, "minor": 0, "patch": 0 }
        });
        assert!(apply_migrations(&mut data).is_ok());
        // Schema version unchanged.
        let sv: SchemaVersion =
            serde_json::from_value(data["schema_version"].clone()).unwrap();
        assert_eq!(sv, CURRENT_SCHEMA);
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
