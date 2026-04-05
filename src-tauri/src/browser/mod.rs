//! Sample & Content Browser backend (Sprint 28).
//!
//! Provides async Tauri commands for listing file system directories and
//! drives. Audio file detection is based on file extension. Preview
//! playback lives in [`preview`].

pub mod preview;

use serde::Serialize;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Metadata for a single file system entry.
#[derive(Debug, Serialize)]
pub struct FileEntry {
    /// File or directory name.
    pub name: String,
    /// Absolute path.
    pub path: String,
    /// File size in bytes. Always 0 for directories.
    pub size: u64,
    /// True when this entry is a directory.
    pub is_dir: bool,
    /// True when the file has an audio extension (WAV, MP3, FLAC, OGG, AIFF).
    /// Always false for directories.
    pub is_audio: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn is_audio_extension(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        std::path::Path::new(&lower)
            .extension()
            .and_then(|e| e.to_str()),
        Some("wav" | "mp3" | "flac" | "ogg" | "aiff" | "aif")
    )
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Lists the contents of `path`, returning directories and files.
///
/// Directories are sorted before files; within each group entries are sorted
/// alphabetically. Non-readable entries are silently skipped.
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let mut read_dir = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| format!("cannot read directory: {e}"))?;

    let mut dirs: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };

        if meta.is_dir() {
            dirs.push(FileEntry {
                name,
                path: full_path,
                size: 0,
                is_dir: true,
                is_audio: false,
            });
        } else {
            let size = meta.len();
            let is_audio = is_audio_extension(&name);
            files.push(FileEntry {
                name,
                path: full_path,
                size,
                is_dir: false,
                is_audio,
            });
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    Ok(dirs)
}

/// Returns available drives on Windows (A:–Z:) or a single root on other
/// platforms.
#[tauri::command]
pub async fn get_drives() -> Result<Vec<FileEntry>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if std::fs::metadata(&path).is_ok() {
                let name = path.clone();
                drives.push(FileEntry {
                    name,
                    path,
                    size: 0,
                    is_dir: true,
                    is_audio: false,
                });
            }
        }
        Ok(drives)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![FileEntry {
            name: "/".to_string(),
            path: "/".to_string(),
            size: 0,
            is_dir: true,
            is_audio: false,
        }])
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_audio_extension_recognizes_audio() {
        for name in &["kick.wav", "loop.WAV", "pad.mp3", "bass.flac", "drone.ogg", "chord.aiff", "hit.aif"] {
            assert!(is_audio_extension(name), "{name} should be audio");
        }
    }

    #[test]
    fn is_audio_extension_ignores_non_audio() {
        for name in &["readme.txt", "song.rs", "image.png", "doc.pdf", ""] {
            assert!(!is_audio_extension(name), "{name} should not be audio");
        }
    }

    #[test]
    fn list_directory_entries() {
        use std::io::Write;
        let dir = tempfile::tempdir().expect("tempdir");
        // Create a subdirectory
        std::fs::create_dir(dir.path().join("drums")).expect("mkdir");
        // Create an audio file and a non-audio file
        std::fs::File::create(dir.path().join("kick.wav"))
            .expect("wav")
            .write_all(b"RIFF")
            .expect("write");
        std::fs::File::create(dir.path().join("notes.txt"))
            .expect("txt")
            .write_all(b"hi")
            .expect("write");

        let rt = tokio::runtime::Runtime::new().unwrap();
        let entries = rt
            .block_on(list_directory(dir.path().to_string_lossy().to_string()))
            .expect("list_directory");

        // Directory comes first
        assert_eq!(entries[0].name, "drums");
        assert!(entries[0].is_dir);
        assert!(!entries[0].is_audio);

        let wav_entry = entries.iter().find(|e| e.name == "kick.wav").expect("kick.wav");
        assert!(!wav_entry.is_dir);
        assert!(wav_entry.is_audio);

        let txt_entry = entries.iter().find(|e| e.name == "notes.txt").expect("notes.txt");
        assert!(!txt_entry.is_dir);
        assert!(!txt_entry.is_audio);
    }
}
