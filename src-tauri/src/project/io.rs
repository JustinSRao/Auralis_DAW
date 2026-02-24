//! Serialization and deserialization of `.mapp` project archives.
//!
//! A `.mapp` file is a ZIP archive containing:
//! - `project.json` — the full project graph serialized as JSON.
//! - `samples/<filename>` — audio sample files referenced by clips.
//!
//! Saves go through a `.tmp` intermediate file with an atomic rename so that a
//! crash during the write never corrupts the existing file.

use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::project::format::ProjectFile;
use crate::project::version::apply_migrations;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_JSON_ENTRY: &str = "project.json";
const SAMPLES_PREFIX: &str = "samples/";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Serializes `project` to a `.mapp` ZIP archive at `path`.
///
/// The write is atomic: the data is first written to `<path>.tmp`, then the
/// temporary file is renamed over `path`.  This protects the existing file
/// from corruption if the process is interrupted mid-write.
///
/// # Sample bundling
///
/// When `sample_source_dir` is `Some(dir)`, each [`SampleReference`] in the
/// project is read from `dir/<archive_path>` and stored verbatim inside the
/// ZIP under `samples/<archive_path>`.  If a sample file is missing the
/// operation continues — a warning is logged but no error is returned — so
/// projects with partially-collected samples can still be saved.
///
/// Pass `None` for `sample_source_dir` to skip sample bundling (useful for
/// auto-saves where sample collection has already been done).
pub fn save_project(
    project: &ProjectFile,
    path: &Path,
    sample_source_dir: Option<&Path>,
) -> Result<()> {
    let tmp_path = tmp_path_for(path);

    {
        let file = File::create(&tmp_path)
            .with_context(|| format!("Failed to create temp file {:?}", tmp_path))?;
        let buf_writer = BufWriter::new(file);
        let mut zip = ZipWriter::new(buf_writer);

        // --- project.json ---
        let json_bytes = serde_json::to_vec_pretty(project)
            .context("Failed to serialize ProjectFile to JSON")?;

        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        zip.start_file(PROJECT_JSON_ENTRY, opts)
            .context("Failed to start project.json ZIP entry")?;
        zip.write_all(&json_bytes)
            .context("Failed to write project.json into ZIP")?;

        // --- sample files ---
        if let Some(src_dir) = sample_source_dir {
            for sample in &project.samples {
                let source_path = src_dir.join(&sample.archive_path);
                match fs::read(&source_path) {
                    Ok(data) => {
                        let entry_name = format!("{}{}", SAMPLES_PREFIX, sample.archive_path);
                        let sample_opts = SimpleFileOptions::default()
                            .compression_method(CompressionMethod::Stored)
                            .unix_permissions(0o644);
                        if let Err(e) = zip.start_file(&entry_name, sample_opts) {
                            log::warn!("Skipping sample {:?}: {}", source_path, e);
                            continue;
                        }
                        if let Err(e) = zip.write_all(&data) {
                            log::warn!("Failed to write sample {:?}: {}", source_path, e);
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Sample file {:?} not found — skipping ({})",
                            source_path,
                            e
                        );
                    }
                }
            }
        }

        zip.finish().context("Failed to finalize ZIP archive")?;
    }

    // Atomic rename: replace target only after the write completes cleanly.
    fs::rename(&tmp_path, path).with_context(|| {
        format!(
            "Failed to rename {:?} → {:?} (atomic save)",
            tmp_path, path
        )
    })?;

    Ok(())
}

/// Loads a `.mapp` project archive from `path`.
///
/// The function:
/// 1. Opens the ZIP archive.
/// 2. Reads `project.json`.
/// 3. Deserializes it into a `serde_json::Value`.
/// 4. Applies any pending schema migrations.
/// 5. Deserializes the (potentially migrated) value into a [`ProjectFile`].
pub fn load_project(path: &Path) -> Result<ProjectFile> {
    let file = File::open(path)
        .with_context(|| format!("Failed to open project file {:?}", path))?;

    let mut archive =
        ZipArchive::new(file).with_context(|| format!("Not a valid ZIP archive: {:?}", path))?;

    let json_bytes = {
        let mut entry = archive.by_name(PROJECT_JSON_ENTRY).with_context(|| {
            format!(
                "Archive {:?} does not contain a `{}` entry",
                path, PROJECT_JSON_ENTRY
            )
        })?;

        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .context("Failed to read project.json from archive")?;
        buf
    };

    let mut value: serde_json::Value =
        serde_json::from_slice(&json_bytes).context("project.json contains invalid JSON")?;

    apply_migrations(&mut value).context("Schema migration failed")?;

    let project: ProjectFile =
        serde_json::from_value(value).context("Failed to deserialize ProjectFile from JSON")?;

    Ok(project)
}

/// Extracts all `samples/` entries from the project archive at `archive_path`
/// into `target_dir`.
///
/// Existing files in `target_dir` are overwritten.  The `samples/` prefix is
/// stripped so that, for example, `samples/kick.wav` is extracted to
/// `target_dir/kick.wav`.
pub fn extract_samples(archive_path: &Path, target_dir: &Path) -> Result<()> {
    let file = File::open(archive_path)
        .with_context(|| format!("Failed to open archive {:?}", archive_path))?;

    let mut archive = ZipArchive::new(file)
        .with_context(|| format!("Not a valid ZIP archive: {:?}", archive_path))?;

    fs::create_dir_all(target_dir).with_context(|| {
        format!("Failed to create sample extraction directory {:?}", target_dir)
    })?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).with_context(|| {
            format!("Failed to read ZIP entry index {} in {:?}", i, archive_path)
        })?;

        let entry_name = entry.name().to_string();

        if !entry_name.starts_with(SAMPLES_PREFIX) || entry_name == SAMPLES_PREFIX {
            continue;
        }

        // Strip the "samples/" prefix to get the relative filename.
        let relative = &entry_name[SAMPLES_PREFIX.len()..];
        if relative.is_empty() {
            continue;
        }

        let dest = target_dir.join(relative);

        // Ensure parent directories exist (in case of nested paths).
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut out =
            File::create(&dest).with_context(|| format!("Failed to create {:?}", dest))?;

        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .with_context(|| format!("Failed to read sample entry `{}`", entry_name))?;
        out.write_all(&buf)
            .with_context(|| format!("Failed to write sample to {:?}", dest))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn tmp_path_for(path: &Path) -> PathBuf {
    let mut tmp = path.to_path_buf();
    let mut name = path
        .file_name()
        .unwrap_or_default()
        .to_os_string();
    name.push(".tmp");
    tmp.set_file_name(name);
    tmp
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::format::{
        ClipContent, ClipData, MidiNoteData, TrackData, TrackType,
    };
    use tempfile::TempDir;
    use uuid::Uuid;

    fn make_project(name: &str) -> ProjectFile {
        let mut p = ProjectFile::default();
        p.name = name.to_string();
        p
    }

    fn make_project_with_track() -> ProjectFile {
        let mut project = make_project("Track Project");
        project.tracks.push(TrackData {
            id: Uuid::new_v4().to_string(),
            name: "Test Track".to_string(),
            track_type: TrackType::Midi,
            color: "#00FF00".to_string(),
            volume: 1.0,
            pan: 0.0,
            muted: false,
            soloed: false,
            armed: false,
            output_bus: None,
            instrument: None,
            effects: vec![],
            clips: vec![ClipData {
                id: Uuid::new_v4().to_string(),
                name: "Clip 1".to_string(),
                start_beats: 0.0,
                duration_beats: 4.0,
                content: ClipContent::Midi {
                    notes: vec![MidiNoteData {
                        note: 60,
                        velocity: 127,
                        start_beats: 0.0,
                        duration_beats: 1.0,
                        channel: 0,
                    }],
                    cc_events: vec![],
                },
            }],
            automation: vec![],
        });
        project
    }

    // -----------------------------------------------------------------------
    // Round-trip tests
    // -----------------------------------------------------------------------

    #[test]
    fn empty_project_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("empty.mapp");

        let original = make_project("Empty");
        save_project(&original, &path, None).expect("save failed");
        let loaded = load_project(&path).expect("load failed");

        // Compare fields that are deterministic (timestamps may differ by µs).
        assert_eq!(original.id, loaded.id);
        assert_eq!(original.name, loaded.name);
        assert_eq!(original.transport, loaded.transport);
        assert_eq!(original.tracks, loaded.tracks);
        assert_eq!(original.master, loaded.master);
        assert_eq!(original.samples, loaded.samples);
    }

    #[test]
    fn project_with_tracks_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("with_tracks.mapp");

        let original = make_project_with_track();
        save_project(&original, &path, None).expect("save failed");
        let loaded = load_project(&path).expect("load failed");

        assert_eq!(original.tracks.len(), loaded.tracks.len());
        assert_eq!(original.tracks[0].name, loaded.tracks[0].name);
        assert_eq!(original.tracks[0].clips.len(), loaded.tracks[0].clips.len());
    }

    // -----------------------------------------------------------------------
    // ZIP structure
    // -----------------------------------------------------------------------

    #[test]
    fn saved_archive_contains_project_json() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("structure.mapp");

        save_project(&make_project("Structure Test"), &path, None).expect("save failed");

        let file = File::open(&path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let entry = archive.by_name(PROJECT_JSON_ENTRY);
        assert!(entry.is_ok(), "project.json should exist in archive");
    }

    #[test]
    fn saved_archive_project_json_is_valid_json() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("valid_json.mapp");

        save_project(&make_project("JSON Test"), &path, None).expect("save failed");

        let file = File::open(&path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut entry = archive.by_name(PROJECT_JSON_ENTRY).unwrap();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).unwrap();

        let value: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        assert!(value.get("id").is_some());
        assert!(value.get("schema_version").is_some());
    }

    // -----------------------------------------------------------------------
    // Sample extraction
    // -----------------------------------------------------------------------

    #[test]
    fn extract_samples_works() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("samples.mapp");
        let extract_dir = tmp.path().join("extracted");

        // Write a fake sample file.
        let sample_src_dir = tmp.path().join("src_samples");
        fs::create_dir_all(&sample_src_dir).unwrap();
        let sample_data = b"RIFF....WAVEfmt ";
        fs::write(sample_src_dir.join("kick.wav"), sample_data).unwrap();

        let mut project = make_project("Sample Project");
        project.samples.push(crate::project::format::SampleReference {
            id: Uuid::new_v4().to_string(),
            original_filename: "kick.wav".to_string(),
            archive_path: "kick.wav".to_string(),
            sample_rate: 44100,
            channels: 2,
            duration_secs: 0.5,
        });

        save_project(&project, &path, Some(&sample_src_dir)).expect("save failed");
        extract_samples(&path, &extract_dir).expect("extract failed");

        let extracted_file = extract_dir.join("kick.wav");
        assert!(extracted_file.exists(), "kick.wav should be extracted");
        let extracted_data = fs::read(&extracted_file).unwrap();
        assert_eq!(extracted_data, sample_data);
    }

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------

    #[test]
    fn load_nonexistent_file_returns_error() {
        let result = load_project(Path::new("/nonexistent/path/to/project.mapp"));
        assert!(result.is_err());
    }

    #[test]
    fn load_corrupt_file_returns_error() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("corrupt.mapp");
        fs::write(&path, b"this is not a ZIP file at all").unwrap();
        let result = load_project(&path);
        assert!(result.is_err());
    }

    #[test]
    fn load_valid_zip_without_project_json_returns_error() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("no_project_json.mapp");

        // Create a ZIP with a different entry name.
        {
            let file = File::create(&path).unwrap();
            let mut zip = ZipWriter::new(BufWriter::new(file));
            let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            zip.start_file("not_project.json", opts).unwrap();
            zip.write_all(b"{}").unwrap();
            zip.finish().unwrap();
        }

        let result = load_project(&path);
        assert!(result.is_err());
    }

    #[test]
    fn save_creates_tmp_file_then_renames() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("rename_test.mapp");
        let tmp_path = tmp.path().join("rename_test.mapp.tmp");

        save_project(&make_project("Rename Test"), &path, None).expect("save failed");

        // After a successful save the .tmp file must be gone.
        assert!(path.exists(), "final .mapp file must exist");
        assert!(!tmp_path.exists(), ".tmp file must not remain after save");
    }
}
