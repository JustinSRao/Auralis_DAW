//! Stem export: renders each track independently into its own output file.
//!
//! `run_stem_export` iterates over unique `track_id`s found in the base
//! `RenderConfig`, clones the config with only that track's clips, and drives
//! a `RenderSession` + `FileWriter` for each stem.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::mpsc::UnboundedSender;

use super::file_writer::{FileWriter, OutputFormat};
use super::render_session::{ExportClipInfo, RenderConfig, RenderSession};

// ─── StemConfig ──────────────────────────────────────────────────────────────

/// Parameters for a stems-only export run.
pub struct StemConfig {
    /// Base render parameters (sample rate, channels, range, master gain).
    /// `clips` must contain all clips across all tracks.
    pub base_config:       RenderConfig,
    /// Directory where stem files will be written.
    pub output_dir:        PathBuf,
    /// Output format for every stem file.
    pub format:            OutputFormat,
    /// Filename prefix — stem files are named `{prefix}_{track_id}.{ext}`.
    pub stem_name_prefix:  String,
}

// ─── run_stem_export ─────────────────────────────────────────────────────────

/// Renders one WAV/FLAC/MP3 file per track into `config.output_dir`.
///
/// Progress is reported as a value in `[0.0, 1.0]` via `progress_tx`.
/// Returns the list of paths that were written.
///
/// Set `cancel` to `true` from another thread to abort; any partial output
/// files are **not** removed (the caller may choose to clean up on cancel).
pub async fn run_stem_export(
    config:      StemConfig,
    cancel:      Arc<AtomicBool>,
    progress_tx: UnboundedSender<f32>,
) -> Result<Vec<PathBuf>> {
    // Collect unique track IDs in a deterministic order.
    let mut seen = HashSet::new();
    let mut track_ids: Vec<String> = Vec::new();
    for clip in &config.base_config.clips {
        if seen.insert(clip.track_id.clone()) {
            track_ids.push(clip.track_id.clone());
        }
    }

    if track_ids.is_empty() {
        return Ok(vec![]);
    }

    let ext = format_extension(&config.format);
    let n_tracks = track_ids.len() as f64;
    let mut output_paths = Vec::with_capacity(track_ids.len());

    for (track_idx, track_id) in track_ids.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            log::info!("Stem export cancelled after {} tracks", track_idx);
            break;
        }

        // Filter clips to this track only.
        let track_clips: Vec<ExportClipInfo> = config
            .base_config
            .clips
            .iter()
            .filter(|c| &c.track_id == track_id)
            .cloned()
            .collect();

        let stem_config = RenderConfig {
            sample_rate:  config.base_config.sample_rate,
            channels:     config.base_config.channels,
            block_size:   config.base_config.block_size,
            start_sample: config.base_config.start_sample,
            end_sample:   config.base_config.end_sample,
            clips:        track_clips,
            master_gain:  config.base_config.master_gain,
        };

        let total_frames = stem_config.end_sample.saturating_sub(stem_config.start_sample);
        let mut session = RenderSession::new(stem_config);

        // Sanitize the track ID for use as a filename component.
        let safe_id = sanitize_filename(track_id);
        let filename = format!("{}_{}.{}", config.stem_name_prefix, safe_id, ext);
        let out_path = config.output_dir.join(&filename);
        output_paths.push(out_path.clone());

        let mut writer = FileWriter::new(
            &out_path,
            config.format.clone(),
            config.base_config.sample_rate,
            config.base_config.channels,
        )?;

        let ch = config.base_config.channels as usize;
        let block_size = config.base_config.block_size;
        let mut block_buf = vec![0.0f32; block_size * ch];
        let mut blocks_rendered: u64 = 0;

        loop {
            if cancel.load(Ordering::Relaxed) {
                log::info!("Stem export cancelled mid-track '{}'", track_id);
                break;
            }

            let more = session.render_block(&mut block_buf);

            // Determine how many samples were actually written (handle partial last block).
            let frames_this_block = if !more {
                // May be a partial block — compute exact count.
                let rendered = session.frames_rendered();
                let leftover = rendered as usize % block_size;
                if leftover == 0 { block_size } else { leftover }
            } else {
                block_size
            };
            let samples_this_block = frames_this_block * ch;
            writer.write_block(&block_buf[..samples_this_block])?;

            blocks_rendered += 1;

            // Update progress every 50 blocks.
            if blocks_rendered % 50 == 0 && total_frames > 0 {
                let track_progress = session.frames_rendered() as f64 / total_frames as f64;
                let overall = (track_idx as f64 + track_progress) / n_tracks;
                let _ = progress_tx.send(overall as f32);
            }

            if !more {
                break;
            }
        }

        writer.finalize()?;

        // Report completion of this track.
        let overall = (track_idx + 1) as f64 / n_tracks;
        let _ = progress_tx.send(overall as f32);
    }

    Ok(output_paths)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn format_extension(fmt: &OutputFormat) -> &'static str {
    match fmt {
        OutputFormat::Wav { .. }  => "wav",
        OutputFormat::Flac { .. } => "wav", // fallback produces WAV
        OutputFormat::Mp3 { .. }  => "wav", // fallback produces WAV
    }
}

/// Replaces characters that are invalid in filenames with underscores.
fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect()
}
