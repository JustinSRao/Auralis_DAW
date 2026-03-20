//! Tauri commands for the waveform editor (Sprint 15).

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::instruments::sampler::decoder::decode_audio_file;
use super::peak_cache::{
    ClipBufferCacheState, PeakCacheState, PeakData, compute_peaks,
};
use super::waveform_editor::{
    ClipEditData, CutResult, ReverseResult, SampleReferenceData, TrimResult,
    compute_cut, compute_trim_end, compute_trim_start, find_zero_crossing, write_reversed_region,
};

// ---------------------------------------------------------------------------
// get_peak_data
// ---------------------------------------------------------------------------

/// Returns min/max peak data for a waveform display at the given zoom level.
///
/// First checks the peak cache, then the buffer cache. On a full miss,
/// decodes the audio file, stores both caches, and returns peak data.
#[tauri::command]
pub async fn get_peak_data(
    file_path: String,
    frames_per_pixel: usize,
    buffer_cache: State<'_, ClipBufferCacheState>,
    peak_cache: State<'_, PeakCacheState>,
) -> Result<PeakData, String> {
    // 1. Check peak cache
    {
        let cache = peak_cache
            .lock()
            .map_err(|e| format!("peak cache lock error: {e}"))?;
        if let Some(data) = cache.get(&file_path, frames_per_pixel) {
            return Ok((*data).clone());
        }
    }

    // 2. Check / populate buffer cache
    let buffer = {
        let cached = {
            let mut cache = buffer_cache
                .lock()
                .map_err(|e| format!("buffer cache lock error: {e}"))?;
            cache.get(&file_path)
        };

        match cached {
            Some(buf) => buf,
            None => {
                let path = file_path.clone();
                let buf = tokio::task::spawn_blocking(move || {
                    decode_audio_file(&PathBuf::from(&path))
                        .map_err(|e| format!("decode error: {e}"))
                })
                .await
                .map_err(|e| format!("spawn_blocking error: {e}"))??;

                {
                    let mut cache = buffer_cache
                        .lock()
                        .map_err(|e| format!("buffer cache lock error: {e}"))?;
                    cache.insert(file_path.clone(), Arc::clone(&buf));
                }
                buf
            }
        }
    };

    // 3. Compute peaks and cache
    let peaks = compute_peaks(&buffer, frames_per_pixel);
    let peaks_arc = Arc::new(peaks.clone());
    {
        let mut cache = peak_cache
            .lock()
            .map_err(|e| format!("peak cache lock error: {e}"))?;
        cache.insert(&file_path, frames_per_pixel, peaks_arc);
    }

    Ok(peaks)
}

// ---------------------------------------------------------------------------
// find_zero_crossing_cmd
// ---------------------------------------------------------------------------

/// Searches the audio buffer for the nearest zero crossing to `near_frame`.
#[tauri::command]
pub async fn find_zero_crossing_cmd(
    file_path: String,
    near_frame: usize,
    search_radius: usize,
    buffer_cache: State<'_, ClipBufferCacheState>,
) -> Result<usize, String> {
    let buffer = load_or_decode(file_path, &buffer_cache).await?;
    Ok(find_zero_crossing(&buffer, near_frame, search_radius))
}

// ---------------------------------------------------------------------------
// compute_cut_clip
// ---------------------------------------------------------------------------

/// Pure computation: returns the two sub-clips that result from cutting.
/// No I/O performed.
#[tauri::command]
pub fn compute_cut_clip(
    clip_data: ClipEditData,
    cut_frame: u64,
    samples_per_beat: f64,
) -> Result<CutResult, String> {
    compute_cut(&clip_data, cut_frame, samples_per_beat)
}

// ---------------------------------------------------------------------------
// compute_trim_start_clip
// ---------------------------------------------------------------------------

/// Pure computation: returns before/after timing for a start-trim.
#[tauri::command]
pub fn compute_trim_start_clip(
    clip_data: ClipEditData,
    new_start_frame: u64,
    samples_per_beat: f64,
) -> Result<TrimResult, String> {
    compute_trim_start(&clip_data, new_start_frame, samples_per_beat)
}

// ---------------------------------------------------------------------------
// compute_trim_end_clip
// ---------------------------------------------------------------------------

/// Pure computation: returns before/after timing for an end-trim.
#[tauri::command]
pub fn compute_trim_end_clip(
    clip_data: ClipEditData,
    new_end_frame: u64,
    samples_per_beat: f64,
) -> Result<TrimResult, String> {
    compute_trim_end(&clip_data, new_end_frame, samples_per_beat)
}

// ---------------------------------------------------------------------------
// reverse_clip_region
// ---------------------------------------------------------------------------

/// Writes a new WAV file with the selection region reversed, then returns
/// updated clip metadata and a new sample reference.
#[tauri::command]
pub async fn reverse_clip_region(
    file_path: String,
    clip_data: ClipEditData,
    start_frame: usize,
    end_frame: usize,
    output_dir: String,
    _samples_per_beat: f64,
    buffer_cache: State<'_, ClipBufferCacheState>,
    peak_cache: State<'_, PeakCacheState>,
) -> Result<ReverseResult, String> {
    let buffer = load_or_decode(file_path.clone(), &buffer_cache).await?;

    // Build output path: <stem>_rev_<uuid>.wav
    let source_path = PathBuf::from(&file_path);
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let rev_name = format!("{stem}_rev_{}.wav", Uuid::new_v4());
    let out_dir = PathBuf::from(&output_dir);
    let out_path = out_dir.join(&rev_name);

    // Ensure output directory exists
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output directory: {e}"))?;

    // Write reversed WAV (blocking I/O)
    let buffer_clone = Arc::clone(&buffer);
    let out_path_clone = out_path.clone();
    tokio::task::spawn_blocking(move || {
        write_reversed_region(&buffer_clone, start_frame, end_frame, &out_path_clone)
    })
    .await
    .map_err(|e| format!("spawn_blocking error: {e}"))??;

    let reversed_file_path = out_path
        .to_str()
        .ok_or_else(|| "Output path is not valid UTF-8".to_string())?
        .to_string();

    // Invalidate peak caches for both the old and new paths
    {
        let mut cache = peak_cache
            .lock()
            .map_err(|e| format!("peak cache lock error: {e}"))?;
        cache.invalidate(&file_path);
        cache.invalidate(&reversed_file_path);
    }

    // Build new sample reference
    let new_id = Uuid::new_v4().to_string();
    let duration_secs = buffer.frame_count as f64 / buffer.sample_rate as f64;
    let new_sample_reference = SampleReferenceData {
        id: new_id.clone(),
        original_filename: rev_name.clone(),
        archive_path: format!("samples/{rev_name}"),
        sample_rate: buffer.sample_rate,
        channels: 2,
        duration_secs,
    };

    // New clip: same beat position but references the reversed file, offset 0
    let new_clip = ClipEditData {
        id: Uuid::new_v4().to_string(),
        name: format!("{} (rev)", clip_data.name),
        start_beats: clip_data.start_beats,
        duration_beats: clip_data.duration_beats,
        sample_id: new_id,
        start_offset_samples: 0,
        gain: clip_data.gain,
    };

    Ok(ReverseResult {
        removed_clip_id: clip_data.id,
        new_clip,
        new_sample_reference,
        reversed_file_path,
    })
}

// ---------------------------------------------------------------------------
// invalidate_clip_cache
// ---------------------------------------------------------------------------

/// Evicts all cache entries associated with `file_path`.
///
/// Call after any destructive operation that modifies the underlying audio file.
#[tauri::command]
pub fn invalidate_clip_cache(
    file_path: String,
    buffer_cache: State<'_, ClipBufferCacheState>,
    peak_cache: State<'_, PeakCacheState>,
) -> Result<(), String> {
    {
        let mut cache = buffer_cache
            .lock()
            .map_err(|e| format!("buffer cache lock error: {e}"))?;
        // ClipBufferCache has no prefix-based invalidation; remove exact key.
        cache.entries.remove(&file_path);
    }
    {
        let mut cache = peak_cache
            .lock()
            .map_err(|e| format!("peak cache lock error: {e}"))?;
        cache.invalidate(&file_path);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async fn load_or_decode(
    file_path: String,
    buffer_cache: &State<'_, ClipBufferCacheState>,
) -> Result<Arc<crate::instruments::sampler::decoder::SampleBuffer>, String> {
    let cached = {
        let mut cache = buffer_cache
            .lock()
            .map_err(|e| format!("buffer cache lock error: {e}"))?;
        cache.get(&file_path)
    };

    match cached {
        Some(buf) => Ok(buf),
        None => {
            let path = file_path.clone();
            let buf = tokio::task::spawn_blocking(move || {
                decode_audio_file(&PathBuf::from(&path))
                    .map_err(|e| format!("decode error: {e}"))
            })
            .await
            .map_err(|e| format!("spawn_blocking error: {e}"))??;

            {
                let mut cache = buffer_cache
                    .lock()
                    .map_err(|e| format!("buffer cache lock error: {e}"))?;
                cache.insert(file_path, Arc::clone(&buf));
            }
            Ok(buf)
        }
    }
}

// We need Uuid in this module for the reverse command
use uuid::Uuid;
