//! Tauri commands for time-stretch and pitch-shift operations (Sprint 16).

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;
use uuid::Uuid;

use crate::instruments::sampler::decoder::{decode_audio_file, SampleBuffer};
use super::peak_cache::{ClipBufferCacheState, PeakCacheState};
use super::processed_cache::{ProcessedBufferCache, ProcessedBufferCacheState};
use super::time_stretch::{apply_pitch_shift, apply_time_stretch};
use super::waveform_editor::{ClipEditData, SampleReferenceData};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/// Returned by `set_clip_time_stretch` — reports the frame count of the
/// processed buffer so the frontend can update its display.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetStretchResult {
    /// The clip ID echo — lets the frontend verify which clip was processed.
    pub clip_id: String,
    /// Frame count of the processed (time-stretched) buffer.
    pub processed_frame_count: u64,
}

/// Returned by `bake_clip_stretch` — carries all metadata needed for the
/// frontend to replace the original clip with the baked version.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BakeResult {
    /// Updated clip metadata pointing to the baked WAV file.
    pub new_clip_data: ClipEditData,
    /// Sample reference record for the baked WAV file.
    pub new_sample_reference: SampleReferenceData,
    /// Absolute path to the written `.wav` file.
    pub baked_file_path: String,
}

// ---------------------------------------------------------------------------
// Internal helper: load buffer from ClipBufferCache or decode from disk
// ---------------------------------------------------------------------------

async fn load_or_decode_buffer(
    file_path: &str,
    buffer_cache: &State<'_, ClipBufferCacheState>,
) -> Result<Arc<SampleBuffer>, String> {
    // Try the buffer cache first
    {
        let mut cache = buffer_cache
            .lock()
            .map_err(|e| format!("buffer cache lock error: {e}"))?;
        if let Some(buf) = cache.get(file_path) {
            return Ok(buf);
        }
    }

    // Cache miss — decode from disk
    let path = file_path.to_owned();
    let buf = tokio::task::spawn_blocking(move || {
        decode_audio_file(&PathBuf::from(&path))
            .map_err(|e| format!("decode error: {e}"))
    })
    .await
    .map_err(|e| format!("spawn_blocking error: {e}"))??;

    // Cache the decoded buffer
    {
        let mut cache = buffer_cache
            .lock()
            .map_err(|e| format!("buffer cache lock error: {e}"))?;
        cache.insert(file_path.to_owned(), Arc::clone(&buf));
    }

    Ok(buf)
}

// ---------------------------------------------------------------------------
// set_clip_time_stretch
// ---------------------------------------------------------------------------

/// Applies time-stretch to the given clip's audio.
///
/// Checks the processed cache first; on a miss, decodes the source file and
/// runs `apply_time_stretch` in a blocking thread. Caches the result.
///
/// # Errors
/// Returns `Err` if `stretch_ratio` is outside `0.5..=2.0`, if the source file
/// cannot be decoded, or if the resampler fails.
#[tauri::command]
pub async fn set_clip_time_stretch(
    clip_id: String,
    file_path: String,
    stretch_ratio: f32,
    buffer_cache: State<'_, ClipBufferCacheState>,
    processed_cache: State<'_, ProcessedBufferCacheState>,
) -> Result<SetStretchResult, String> {
    if stretch_ratio < 0.5 || stretch_ratio > 2.0 {
        return Err(format!(
            "stretch_ratio {stretch_ratio} is out of range — must be 0.5..=2.0"
        ));
    }

    let cache_key = ProcessedBufferCache::cache_key(&clip_id, stretch_ratio, 0);

    // Check processed cache
    {
        let mut cache = processed_cache
            .lock()
            .map_err(|e| format!("processed cache lock error: {e}"))?;
        if let Some(buf) = cache.get(&cache_key) {
            return Ok(SetStretchResult {
                clip_id,
                processed_frame_count: buf.frame_count as u64,
            });
        }
    }

    // Load raw buffer
    let raw_buf = load_or_decode_buffer(&file_path, &buffer_cache).await?;

    // Apply stretch in blocking thread
    let ratio = stretch_ratio;
    let processed = tokio::task::spawn_blocking(move || apply_time_stretch(&raw_buf, ratio))
        .await
        .map_err(|e| format!("spawn_blocking error: {e}"))??;

    let frame_count = processed.frame_count as u64;
    let processed_arc = Arc::new(processed);

    // Store in processed cache
    {
        let mut cache = processed_cache
            .lock()
            .map_err(|e| format!("processed cache lock error: {e}"))?;
        cache.insert(cache_key, Arc::clone(&processed_arc));
    }

    Ok(SetStretchResult {
        clip_id,
        processed_frame_count: frame_count,
    })
}

// ---------------------------------------------------------------------------
// set_clip_pitch_shift
// ---------------------------------------------------------------------------

/// Applies pitch-shift to the given clip's audio.
///
/// Same cache pattern as `set_clip_time_stretch`.
///
/// # Errors
/// Returns `Err` if `pitch_shift_semitones` is outside `-24..=+24`, or if
/// decoding / resampling fails.
#[tauri::command]
pub async fn set_clip_pitch_shift(
    clip_id: String,
    file_path: String,
    pitch_shift_semitones: i8,
    buffer_cache: State<'_, ClipBufferCacheState>,
    processed_cache: State<'_, ProcessedBufferCacheState>,
) -> Result<(), String> {
    if pitch_shift_semitones < -24 || pitch_shift_semitones > 24 {
        return Err(format!(
            "pitch_shift_semitones {pitch_shift_semitones} is out of range — must be -24..=+24"
        ));
    }

    let cache_key = ProcessedBufferCache::cache_key(&clip_id, 1.0, pitch_shift_semitones);

    // Check processed cache
    {
        let mut cache = processed_cache
            .lock()
            .map_err(|e| format!("processed cache lock error: {e}"))?;
        if cache.get(&cache_key).is_some() {
            return Ok(());
        }
    }

    // Load raw buffer
    let raw_buf = load_or_decode_buffer(&file_path, &buffer_cache).await?;

    // Apply pitch shift in blocking thread
    let semitones = pitch_shift_semitones;
    let processed = tokio::task::spawn_blocking(move || apply_pitch_shift(&raw_buf, semitones))
        .await
        .map_err(|e| format!("spawn_blocking error: {e}"))??;

    let processed_arc = Arc::new(processed);

    // Store in processed cache
    {
        let mut cache = processed_cache
            .lock()
            .map_err(|e| format!("processed cache lock error: {e}"))?;
        cache.insert(cache_key, Arc::clone(&processed_arc));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// bake_clip_stretch
// ---------------------------------------------------------------------------

/// Applies the current stretch and pitch-shift settings to a clip and writes
/// the result as a permanent WAV file.
///
/// Order of operations:
/// 1. Load (or decode) the raw buffer.
/// 2. Apply `stretch_ratio` if not identity.
/// 3. Apply `pitch_shift_semitones` if not identity.
/// 4. Write to `<output_dir>/<stem>_baked_<uuid>.wav`.
/// 5. Invalidate the processed cache for the old `clip_id`.
/// 6. Invalidate the peak cache for the old `file_path`.
///
/// Returns `BakeResult` with updated clip metadata and a new sample reference.
#[tauri::command]
pub async fn bake_clip_stretch(
    clip_id: String,
    clip_data: ClipEditData,
    file_path: String,
    stretch_ratio: f32,
    pitch_shift_semitones: i8,
    output_dir: String,
    buffer_cache: State<'_, ClipBufferCacheState>,
    peak_cache: State<'_, PeakCacheState>,
    processed_cache: State<'_, ProcessedBufferCacheState>,
) -> Result<BakeResult, String> {
    if stretch_ratio < 0.5 || stretch_ratio > 2.0 {
        return Err(format!(
            "stretch_ratio {stretch_ratio} is out of range — must be 0.5..=2.0"
        ));
    }
    if pitch_shift_semitones < -24 || pitch_shift_semitones > 24 {
        return Err(format!(
            "pitch_shift_semitones {pitch_shift_semitones} is out of range — must be -24..=+24"
        ));
    }

    // Load raw buffer
    let raw_buf = load_or_decode_buffer(&file_path, &buffer_cache).await?;

    let ratio = stretch_ratio;
    let semitones = pitch_shift_semitones;

    // Apply stretch + pitch in blocking thread
    let processed = tokio::task::spawn_blocking(move || {
        let after_stretch = if (ratio - 1.0).abs() > 1e-6 {
            apply_time_stretch(&raw_buf, ratio)?
        } else {
            SampleBuffer {
                samples: raw_buf.samples.clone(),
                sample_rate: raw_buf.sample_rate,
                original_channels: raw_buf.original_channels,
                frame_count: raw_buf.frame_count,
            }
        };

        if semitones != 0 {
            apply_pitch_shift(&after_stretch, semitones)
        } else {
            Ok(after_stretch)
        }
    })
    .await
    .map_err(|e| format!("spawn_blocking error: {e}"))??;

    // Build output path: <stem>_baked_<uuid>.wav
    let source_path = PathBuf::from(&file_path);
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let baked_name = format!("{stem}_baked_{}.wav", Uuid::new_v4());
    let out_dir = PathBuf::from(&output_dir);
    let out_path = out_dir.join(&baked_name);

    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output directory: {e}"))?;

    // Write WAV
    let processed_arc = Arc::new(processed);
    let out_path_clone = out_path.clone();
    let buf_clone = Arc::clone(&processed_arc);
    tokio::task::spawn_blocking(move || write_sample_buffer_wav(&buf_clone, &out_path_clone))
        .await
        .map_err(|e| format!("spawn_blocking error: {e}"))??;

    let baked_file_path = out_path
        .to_str()
        .ok_or_else(|| "Output path is not valid UTF-8".to_string())?
        .to_string();

    // Invalidate caches for the original clip / file
    {
        let mut cache = processed_cache
            .lock()
            .map_err(|e| format!("processed cache lock error: {e}"))?;
        cache.invalidate_clip(&clip_id);
    }
    {
        let mut cache = peak_cache
            .lock()
            .map_err(|e| format!("peak cache lock error: {e}"))?;
        cache.invalidate(&file_path);
        cache.invalidate(&baked_file_path);
    }

    // Build new sample reference
    let new_id = Uuid::new_v4().to_string();
    let duration_secs = processed_arc.frame_count as f64 / processed_arc.sample_rate as f64;
    let new_sample_reference = SampleReferenceData {
        id: new_id.clone(),
        original_filename: baked_name.clone(),
        archive_path: format!("samples/{baked_name}"),
        sample_rate: processed_arc.sample_rate,
        channels: 2,
        duration_secs,
    };

    // Build updated clip pointing to the baked file
    let new_clip_data = ClipEditData {
        id: Uuid::new_v4().to_string(),
        name: format!("{} (baked)", clip_data.name),
        start_beats: clip_data.start_beats,
        duration_beats: clip_data.duration_beats,
        sample_id: new_id,
        start_offset_samples: 0,
        gain: clip_data.gain,
    };

    Ok(BakeResult {
        new_clip_data,
        new_sample_reference,
        baked_file_path,
    })
}

// ---------------------------------------------------------------------------
// compute_bpm_stretch_ratio
// ---------------------------------------------------------------------------

/// Computes the time-stretch ratio needed to match an audio clip's internal
/// tempo to the project BPM.
///
/// `stretch_ratio = original_bpm / project_bpm`
///
/// A ratio > 1.0 slows the clip down; < 1.0 speeds it up.
///
/// # Errors
/// Returns `Err` if either BPM is ≤ 0.0, or if the resulting ratio falls
/// outside the supported `[0.5, 2.0]` range.
#[tauri::command]
pub fn compute_bpm_stretch_ratio(
    original_bpm: f32,
    project_bpm: f32,
) -> Result<f32, String> {
    if original_bpm <= 0.0 {
        return Err(format!("original_bpm must be > 0 (got {original_bpm})"));
    }
    if project_bpm <= 0.0 {
        return Err(format!("project_bpm must be > 0 (got {project_bpm})"));
    }

    let ratio = original_bpm / project_bpm;

    if ratio < 0.5 || ratio > 2.0 {
        return Err(format!(
            "Computed stretch ratio {ratio:.4} (original {original_bpm} BPM / project {project_bpm} BPM) \
             is outside the supported range [0.5, 2.0]. \
             The BPM difference is too large to time-stretch in a single pass."
        ));
    }

    Ok(ratio)
}

// ---------------------------------------------------------------------------
// Internal WAV writer
// ---------------------------------------------------------------------------

/// Writes a `SampleBuffer` (interleaved stereo f32) to a WAV file at `path`.
fn write_sample_buffer_wav(buffer: &SampleBuffer, path: &std::path::Path) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: buffer.sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| format!("Failed to create WAV writer: {e}"))?;

    for &sample in &buffer.samples {
        writer
            .write_sample(sample)
            .map_err(|e| format!("WAV write error: {e}"))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("WAV finalize error: {e}"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_bpm_stretch_ratio_correct() {
        let ratio = compute_bpm_stretch_ratio(120.0, 90.0).unwrap();
        let expected = 120.0_f32 / 90.0_f32;
        assert!(
            (ratio - expected).abs() < 1e-5,
            "120/90 should give ~{expected}, got {ratio}"
        );
    }

    #[test]
    fn test_compute_bpm_stretch_ratio_identity() {
        let ratio = compute_bpm_stretch_ratio(140.0, 140.0).unwrap();
        assert!((ratio - 1.0).abs() < 1e-5, "same BPM should give ratio 1.0");
    }

    #[test]
    fn test_compute_bpm_stretch_ratio_zero_bpm_errors() {
        assert!(
            compute_bpm_stretch_ratio(0.0, 120.0).is_err(),
            "original_bpm = 0 should error"
        );
        assert!(
            compute_bpm_stretch_ratio(120.0, 0.0).is_err(),
            "project_bpm = 0 should error"
        );
        assert!(
            compute_bpm_stretch_ratio(-10.0, 120.0).is_err(),
            "negative original_bpm should error"
        );
    }

    #[test]
    fn test_compute_bpm_stretch_ratio_out_of_range_errors() {
        // 200 BPM / 50 BPM = 4.0 → out of range [0.5, 2.0]
        assert!(
            compute_bpm_stretch_ratio(200.0, 50.0).is_err(),
            "ratio 4.0 (200/50) should be out of range"
        );
        // 50 BPM / 200 BPM = 0.25 → out of range
        assert!(
            compute_bpm_stretch_ratio(50.0, 200.0).is_err(),
            "ratio 0.25 (50/200) should be out of range"
        );
    }

    #[test]
    fn test_compute_bpm_stretch_ratio_boundary_values() {
        // 60/120 = 0.5 — at lower boundary, should be Ok
        assert!(compute_bpm_stretch_ratio(60.0, 120.0).is_ok());
        // 240/120 = 2.0 — at upper boundary, should be Ok
        assert!(compute_bpm_stretch_ratio(240.0, 120.0).is_ok());
    }
}
