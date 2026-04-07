//! Tauri IPC commands for Track Freeze and Bounce in Place (Sprint 40).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;

use tauri::State;
use uuid::Uuid;

use crate::audio::freeze::{FreezeEngine, FreezeEngineState, FreezeRecord, RangeBeats, RenderResult, render_midi_to_wav};
use crate::instruments::commands::{SynthState, TransportAtomicsState};
use crate::instruments::synth::lfo::LfoParamsState;
use crate::project::format::ClipData;

/// Freezes a MIDI instrument track by rendering it offline to a temp WAV file.
///
/// After the render completes, the track's synth volume is set to 0 (silencing
/// the live DSP) and the caller is expected to:
/// 1. Add the returned `SampleReference` to `project.samples`.
/// 2. Add the returned audio clip to `track.clips`.
/// 3. Set `track.frozen = true` and `track.freezeWavPath = result.wavPath`.
///
/// Progress events (`freeze_progress`) are emitted via Tauri every 100 render
/// blocks so the frontend can update a progress dialog.
#[tauri::command]
pub async fn freeze_track(
    app: tauri::AppHandle,
    freeze_engine: State<'_, FreezeEngineState>,
    synth_params: State<'_, SynthState>,
    lfo_params: State<'_, LfoParamsState>,
    _transport_atomics: State<'_, TransportAtomicsState>,
    track_id: String,
    clips: Vec<ClipData>,
    bpm: f64,
    output_dir: String,
    start_beats: Option<f64>,
    end_beats: Option<f64>,
) -> Result<RenderResult, String> {
    // Compute render range.
    let range_start = start_beats.unwrap_or_else(|| {
        clips.iter().map(|c| c.start_beats).fold(f64::INFINITY, f64::min).max(0.0)
    });
    let range_end = end_beats.unwrap_or_else(|| {
        clips.iter().map(|c| c.start_beats + c.duration_beats).fold(0.0_f64, f64::max)
    });
    let range = RangeBeats { start: range_start, end: range_end };

    if range.duration() <= 0.0 {
        return Err("No clips to freeze — range is empty.".to_string());
    }

    // Build temp WAV path.
    let wav_path = build_temp_wav_path(&output_dir, &track_id)?;

    // Clone parameter Arcs for the blocking task.
    let synth_arc = Arc::clone(&*synth_params);
    let lfo1_arc  = Arc::clone(&lfo_params.lfo1);
    let lfo2_arc  = Arc::clone(&lfo_params.lfo2);

    // Register in-progress render and get cancel + progress Arcs.
    let (cancel, progress) = freeze_engine
        .lock()
        .map_err(|e| format!("Failed to lock freeze engine: {e}"))?
        .begin_render(&track_id);

    let app_clone  = app.clone();
    let wav_clone  = wav_path.clone();
    let tid_clone  = track_id.clone();
    let cancel_c   = Arc::clone(&cancel);
    let progress_c = Arc::clone(&progress);

    // Run the render on a blocking thread (never block the async runtime).
    let result = tokio::task::spawn_blocking(move || {
        render_midi_to_wav(
            &clips,
            range,
            bpm,
            synth_arc,
            lfo1_arc,
            lfo2_arc,
            &wav_clone,
            cancel_c,
            progress_c,
            &app_clone,
            &tid_clone,
        )
    })
    .await
    .map_err(|e| format!("Render task panicked: {e}"))??;

    let _ = result; // render_midi_to_wav returns ()

    // Silence the live synth by setting its volume to 0.
    let original_volume = synth_params.volume.load(Ordering::Relaxed);
    synth_params.volume.store(0.0, Ordering::Relaxed);

    // Build return value.
    let sample_id = Uuid::new_v4().to_string();
    let clip_id   = Uuid::new_v4().to_string();

    // Store FreezeRecord so Unfreeze can restore the original volume and path.
    freeze_engine
        .lock()
        .map_err(|e| format!("Failed to lock freeze engine: {e}"))?
        .store_record(FreezeRecord {
            track_id: track_id.clone(),
            original_volume,
            wav_path: wav_path.clone(),
            freeze_clip_id: clip_id.clone(),
        });

    Ok(RenderResult {
        wav_path: wav_path.to_string_lossy().into_owned(),
        sample_id,
        clip_id,
        start_beats: range_start,
        end_beats: range_end,
    })
}

/// Unfreezes a previously frozen track.
///
/// Restores the synth volume, returns the freeze clip ID so the caller can
/// remove it from the track's clip list, and deletes the temp WAV.
#[tauri::command]
pub fn unfreeze_track(
    freeze_engine: State<'_, FreezeEngineState>,
    synth_params: State<'_, SynthState>,
    track_id: String,
) -> Result<String, String> {
    let record = freeze_engine
        .lock()
        .map_err(|e| format!("Failed to lock freeze engine: {e}"))?
        .take_record(&track_id)
        .ok_or_else(|| format!("Track '{track_id}' is not frozen"))?;

    // Restore synth volume.
    synth_params.volume.store(record.original_volume, Ordering::Relaxed);

    // Delete the temp WAV.
    if record.wav_path.exists() {
        if let Err(e) = std::fs::remove_file(&record.wav_path) {
            log::warn!("Failed to delete freeze WAV {:?}: {e}", record.wav_path);
        }
    }

    // Return the clip ID so the frontend can remove it from the track.
    Ok(record.freeze_clip_id)
}

/// Bounces a MIDI track in place: renders it to a permanent audio file and
/// returns the data the frontend needs to convert the track to an Audio track.
///
/// The caller is expected to:
/// 1. Add the returned `SampleReference` to `project.samples`.
/// 2. Replace **all** clips on the track with a single `ClipContent::Audio`
///    clip spanning `[start_beats, end_beats]`.
/// 3. Set `track.track_type = "Audio"` and `track.instrument = null`.
///
/// This operation is not reversible via a command — use the undo system (Sprint 26).
#[tauri::command]
pub async fn bounce_track_in_place(
    app: tauri::AppHandle,
    synth_params: State<'_, SynthState>,
    lfo_params: State<'_, LfoParamsState>,
    _transport_atomics: State<'_, TransportAtomicsState>,
    track_id: String,
    clips: Vec<ClipData>,
    bpm: f64,
    output_dir: String,
    start_beats: Option<f64>,
    end_beats: Option<f64>,
) -> Result<RenderResult, String> {
    let range_start = start_beats.unwrap_or_else(|| {
        clips.iter().map(|c| c.start_beats).fold(f64::INFINITY, f64::min).max(0.0)
    });
    let range_end = end_beats.unwrap_or_else(|| {
        clips.iter().map(|c| c.start_beats + c.duration_beats).fold(0.0_f64, f64::max)
    });
    let range = RangeBeats { start: range_start, end: range_end };

    if range.duration() <= 0.0 {
        return Err("No clips to bounce — range is empty.".to_string());
    }

    // Bounce WAV goes into the project's samples/ directory.
    let bounce_filename = format!("{}_bounce.wav", Uuid::new_v4());
    let wav_path = if output_dir.is_empty() {
        std::env::temp_dir().join(&bounce_filename)
    } else {
        PathBuf::from(&output_dir).join("samples").join(&bounce_filename)
    };

    let synth_arc = Arc::clone(&*synth_params);
    let lfo1_arc  = Arc::clone(&lfo_params.lfo1);
    let lfo2_arc  = Arc::clone(&lfo_params.lfo2);

    let cancel   = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let progress = Arc::new(atomic_float::AtomicF32::new(0.0));

    let app_clone  = app.clone();
    let wav_clone  = wav_path.clone();
    let tid_clone  = track_id.clone();
    let cancel_c   = Arc::clone(&cancel);
    let progress_c = Arc::clone(&progress);

    tokio::task::spawn_blocking(move || {
        render_midi_to_wav(
            &clips,
            range,
            bpm,
            synth_arc,
            lfo1_arc,
            lfo2_arc,
            &wav_clone,
            cancel_c,
            progress_c,
            &app_clone,
            &tid_clone,
        )
    })
    .await
    .map_err(|e| format!("Bounce render task panicked: {e}"))??;

    let sample_id = Uuid::new_v4().to_string();
    let clip_id   = Uuid::new_v4().to_string();

    Ok(RenderResult {
        wav_path: wav_path.to_string_lossy().into_owned(),
        sample_id,
        clip_id,
        start_beats: range_start,
        end_beats: range_end,
    })
}

/// Cancels an in-progress freeze or bounce render for `track_id`.
#[tauri::command]
pub fn cancel_freeze(
    freeze_engine: State<'_, FreezeEngineState>,
    track_id: String,
) -> Result<(), String> {
    freeze_engine
        .lock()
        .map_err(|e| format!("Failed to lock freeze engine: {e}"))?
        .request_cancel(&track_id);
    Ok(())
}

/// Returns the current render progress (0.0–1.0) for `track_id`, or `null`
/// if no render is in progress.
#[tauri::command]
pub fn get_freeze_progress(
    freeze_engine: State<'_, FreezeEngineState>,
    track_id: String,
) -> Result<Option<f32>, String> {
    let engine = freeze_engine
        .lock()
        .map_err(|e| format!("Failed to lock freeze engine: {e}"))?;
    Ok(engine.get_progress(&track_id))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Builds the path for a temp freeze WAV.
///
/// Uses `{output_dir}/.mapp-temp/freeze/{track_id}_freeze.wav`, or a system
/// temp path if `output_dir` is empty.
fn build_temp_wav_path(output_dir: &str, track_id: &str) -> Result<PathBuf, String> {
    let base = if output_dir.is_empty() {
        std::env::temp_dir()
    } else {
        PathBuf::from(output_dir).join(".mapp-temp").join("freeze")
    };
    let filename = format!("{}_freeze.wav", track_id.replace('/', "_").replace('\\', "_"));
    Ok(base.join(filename))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_temp_wav_path_with_dir() {
        let p = build_temp_wav_path("/projects/my_song", "track-abc-123").unwrap();
        assert!(p.to_string_lossy().contains(".mapp-temp"));
        assert!(p.to_string_lossy().contains("track-abc-123_freeze.wav"));
    }

    #[test]
    fn build_temp_wav_path_empty_uses_system_temp() {
        let p = build_temp_wav_path("", "track-1").unwrap();
        // Must be in system temp dir.
        assert!(p.to_string_lossy().contains("track-1_freeze.wav"));
    }

    #[test]
    fn range_with_no_clips_is_empty() {
        let clips: Vec<ClipData> = vec![];
        let range_start = clips.iter().map(|c| c.start_beats).fold(f64::INFINITY, f64::min).max(0.0);
        let range_end   = clips.iter().map(|c| c.start_beats + c.duration_beats).fold(0.0_f64, f64::max);
        let range = RangeBeats { start: range_start, end: range_end };
        assert!(range.duration() <= 0.0);
    }
}
