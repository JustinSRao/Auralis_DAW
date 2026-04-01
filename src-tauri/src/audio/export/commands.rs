//! Tauri IPC commands for audio export (Sprint 22).
//!
//! ## State types
//!
//! `ExportJobState` holds a cancel flag and progress atomic that are shared
//! between the spawned blocking task and the Tauri command thread.
//! `ExportJobStateArc` is the managed-state type: `Arc<Mutex<Option<ExportJobState>>>`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use atomic_float::AtomicF32;
use tauri::{Emitter, Manager, State};

use crate::audio::clip_player::{ClipStore, ClipStoreInner};
use crate::audio::export::file_writer::OutputFormat;
use crate::audio::export::render_session::{ExportClipInfo, RenderConfig, RenderSession};
use crate::audio::export::stem_splitter::{run_stem_export, StemConfig};
use crate::audio::export::FileWriter;
use crate::audio::transport::TransportSnapshot;

// ─── Job state ────────────────────────────────────────────────────────────────

/// Live state for a running export job.
pub struct ExportJobState {
    /// Set to `true` to request cancellation.
    pub cancel:   Arc<AtomicBool>,
    /// Current progress in `[0.0, 1.0]`.
    pub progress: Arc<AtomicF32>,
}

/// Tauri managed state: one optional running job at a time.
pub type ExportJobStateArc = Arc<Mutex<Option<ExportJobState>>>;

// ─── ExportParams (Tauri IPC payload) ────────────────────────────────────────

/// Parameters received from the TypeScript frontend via `start_export`.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportParams {
    /// Absolute path for the output file (stereo mix) or stem directory.
    pub output_path:    String,
    /// Audio format and codec settings.
    pub format:         OutputFormat,
    /// Target sample rate (44100 or 48000 Hz).
    pub sample_rate:    u32,
    /// If `true`, also render per-track stems.
    pub stems:          bool,
    /// Directory for stem files (required when `stems` is true).
    pub stem_output_dir: Option<String>,
    /// First bar to export (1-based, `None` = start of arrangement).
    pub start_bar:      Option<f64>,
    /// Last bar to export (1-based, `None` = end of arrangement).
    pub end_bar:        Option<f64>,
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Starts an audio export job.
///
/// Collects clip data from `ClipStore`, builds a `RenderConfig`, and spawns
/// a blocking task that renders + writes the output file.  Progress is emitted
/// as `export_progress_changed` events (plain `f32` payload in `[0.0, 1.0]`).
#[tauri::command]
pub async fn start_export(
    params:           ExportParams,
    clip_store:       State<'_, ClipStore>,
    job_state:        State<'_, ExportJobStateArc>,
    app:              tauri::AppHandle,
) -> Result<(), String> {
    // Read transport snapshot for BPM.  Fall back to 120 BPM if unavailable.
    // We source BPM from the clip store metadata (start_bar / duration_bars)
    // combined with the managed TransportSnapshot.
    let bpm = app
        .try_state::<Arc<Mutex<TransportSnapshot>>>()
        .and_then(|snap| {
            snap.lock().ok().map(|s| s.bpm)
        })
        .unwrap_or(120.0);

    let beats_per_bar = app
        .try_state::<Arc<Mutex<TransportSnapshot>>>()
        .and_then(|snap| {
            snap.lock().ok().map(|s| s.time_sig_numerator as f64)
        })
        .unwrap_or(4.0);

    // samples_per_bar at project sample rate (44100).
    let project_sr: u32 = 44100;
    let spb = (60.0 / bpm) * project_sr as f64; // samples per beat
    let samples_per_bar = spb * beats_per_bar;

    // Collect clips from the store.
    let clips: Vec<ExportClipInfo> = {
        let store = clip_store
            .lock()
            .map_err(|e| format!("Failed to lock clip store: {e}"))?;

        build_export_clips(&store, samples_per_bar, project_sr)
            .map_err(|e| e.to_string())?
    };

    if clips.is_empty() {
        return Err("No loaded audio clips to export.".to_string());
    }

    // Determine render range in samples.
    let start_sample = params
        .start_bar
        .map(|b| ((b - 1.0).max(0.0) * samples_per_bar) as u64)
        .unwrap_or(0);

    let end_sample = params
        .end_bar
        .map(|b| (b * samples_per_bar) as u64)
        .unwrap_or_else(|| {
            clips
                .iter()
                .map(|c| {
                    c.start_sample + c.buffer.frame_count as u64
                })
                .max()
                .unwrap_or(0)
        });

    if end_sample <= start_sample {
        return Err("Export range is empty.".to_string());
    }

    // Build the render config.
    let render_config = RenderConfig {
        sample_rate:  project_sr,
        channels:     2,
        block_size:   1024,
        start_sample,
        end_sample,
        clips,
        master_gain:  1.0,
    };

    // Create job state.
    let cancel   = Arc::new(AtomicBool::new(false));
    let progress = Arc::new(AtomicF32::new(0.0));
    {
        let mut guard = job_state
            .lock()
            .map_err(|e| format!("Failed to lock job state: {e}"))?;
        *guard = Some(ExportJobState {
            cancel:   Arc::clone(&cancel),
            progress: Arc::clone(&progress),
        });
    }

    // Resolve paths.
    let output_path = PathBuf::from(&params.output_path);
    let stem_dir = params
        .stem_output_dir
        .as_deref()
        .map(PathBuf::from);
    let stems = params.stems;
    let format = params.format;
    let target_sr = params.sample_rate;
    let app_for_task = app.clone();

    // Spawn blocking task.
    tokio::task::spawn_blocking(move || {
        let result = run_export_blocking(
            render_config,
            &output_path,
            format,
            stems,
            stem_dir.as_deref(),
            target_sr,
            project_sr,
            Arc::clone(&cancel),
            Arc::clone(&progress),
            &app_for_task,
        );

        // Final progress event.
        match &result {
            Ok(_) => {
                progress.store(1.0, Ordering::Relaxed);
                let _ = app_for_task.emit("export_progress_changed", 1.0f32);
            }
            Err(e) => {
                log::error!("Export failed: {e}");
                let _ = app_for_task.emit("export_progress_changed", -1.0f32);
                // Clean up partial file on error.
                if output_path.exists() {
                    let _ = std::fs::remove_file(&output_path);
                }
            }
        }
    });

    Ok(())
}

/// Signals the running export job to cancel.
#[tauri::command]
pub fn cancel_export(job_state: State<'_, ExportJobStateArc>) -> Result<(), String> {
    let guard = job_state
        .lock()
        .map_err(|e| format!("Failed to lock job state: {e}"))?;
    if let Some(state) = &*guard {
        state.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Returns the current export progress in `[0.0, 1.0]`, or `0.0` if idle.
#[tauri::command]
pub fn get_export_progress(job_state: State<'_, ExportJobStateArc>) -> f32 {
    let guard = match job_state.lock() {
        Ok(g)  => g,
        Err(_) => return 0.0,
    };
    guard
        .as_ref()
        .map(|s| s.progress.load(Ordering::Relaxed))
        .unwrap_or(0.0)
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/// Converts `ClipStoreInner` entries into `ExportClipInfo` values.
///
/// Clips without a decoded buffer are skipped with a warning.
fn build_export_clips(
    store:           &ClipStoreInner,
    samples_per_bar: f64,
    _sample_rate:    u32,
) -> Result<Vec<ExportClipInfo>> {
    let mut clips = Vec::with_capacity(store.len());

    for (clip_id, entry) in store {
        let buffer = match &entry.buffer {
            Some(b) => Arc::clone(b),
            None => {
                log::warn!("Clip '{}' has no decoded buffer — skipping in export", clip_id);
                continue;
            }
        };

        let start_sample = (entry.start_bar * samples_per_bar) as u64;

        clips.push(ExportClipInfo {
            clip_id:             clip_id.clone(),
            track_id:            String::new(), // ClipEntry has no track_id; use empty for now
            start_sample,
            buffer,
            gain:                entry.gain,
            start_offset_frames: entry.start_offset_frames,
            fade_in_frames:      entry.fade_in_frames,
            fade_out_frames:     entry.fade_out_frames,
            fade_in_curve:       entry.fade_in_curve,
            fade_out_curve:      entry.fade_out_curve,
        });
    }

    Ok(clips)
}

/// The actual blocking render loop, called from `spawn_blocking`.
fn run_export_blocking(
    config:        RenderConfig,
    output_path:   &Path,
    format:        OutputFormat,
    stems:         bool,
    stem_dir:      Option<&Path>,
    _target_sr:    u32,
    project_sr:    u32,
    cancel:        Arc<AtomicBool>,
    progress:      Arc<AtomicF32>,
    app:           &tauri::AppHandle,
) -> Result<()> {
    let total_frames = config.end_sample.saturating_sub(config.start_sample);
    if total_frames == 0 {
        bail!("Zero-length export range");
    }

    // ── Stereo mix render ──────────────────────────────────────────────────
    let channels    = config.channels;
    let block_size  = config.block_size;
    let start_sample = config.start_sample;
    let end_sample   = config.end_sample;

    // Clone clips for the optional stem pass before consuming `config`.
    let stem_clips: Option<Vec<ExportClipInfo>> = if stems {
        Some(config.clips.clone())
    } else {
        None
    };

    let mix_fraction: f64 = if stems { 0.7 } else { 1.0 };

    let mut session = RenderSession::new(config);
    let mut writer  = FileWriter::new(output_path, format.clone(), project_sr, channels)?;

    let mut block_buf       = vec![0.0f32; block_size * channels as usize];
    let mut blocks_rendered: u64 = 0;

    loop {
        if cancel.load(Ordering::Relaxed) {
            log::info!("Export cancelled by user during mix render");
            return Ok(());
        }

        let more = session.render_block(&mut block_buf);

        // For the last (partial) block, only write the valid samples.
        let frames_this_block = if !more {
            let rendered = session.frames_rendered();
            let leftover = rendered as usize % block_size;
            if leftover == 0 { block_size } else { leftover }
        } else {
            block_size
        };
        let samples_count = frames_this_block * channels as usize;
        writer.write_block(&block_buf[..samples_count])?;

        blocks_rendered += 1;

        // Emit progress every 100 blocks.
        if blocks_rendered % 100 == 0 {
            let mix_progress = session.frames_rendered() as f64 / total_frames as f64;
            let overall = (mix_progress * mix_fraction) as f32;
            progress.store(overall, Ordering::Relaxed);
            let _ = app.emit("export_progress_changed", overall);
        }

        if !more {
            break;
        }
    }

    writer.finalize()?;

    // ── Optional stems render ─────────────────────────────────────────────
    if stems {
        if let (Some(clips), Some(dir)) = (stem_clips, stem_dir) {
            let stem_cfg = StemConfig {
                base_config: RenderConfig {
                    sample_rate:  project_sr,
                    channels,
                    block_size,
                    start_sample,
                    end_sample,
                    clips,
                    master_gain:  1.0,
                },
                output_dir:      dir.to_path_buf(),
                format:          format.clone(),
                stem_name_prefix: "stem".to_string(),
            };

            let (progress_tx, _progress_rx) =
                tokio::sync::mpsc::unbounded_channel::<f32>();

            // We are already on a Tokio blocking thread — use `block_on` to
            // drive the async stem export function synchronously.
            let rt = tokio::runtime::Handle::current();
            let stem_result = rt.block_on(run_stem_export(
                stem_cfg,
                Arc::clone(&cancel),
                progress_tx,
            ));

            match stem_result {
                Ok(paths) => {
                    log::info!("Stem export complete: {} files written", paths.len());
                }
                Err(e) => {
                    log::error!("Stem export failed: {e}");
                    return Err(e);
                }
            }
        }
    }

    Ok(())
}
