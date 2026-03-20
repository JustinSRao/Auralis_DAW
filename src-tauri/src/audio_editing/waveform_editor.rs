//! Pure waveform editing functions (no I/O except `write_reversed_region`).
//!
//! All functions operate on `SampleBuffer` and return typed result structs.
//! No Tauri state, no `unwrap()`, no allocations except on the caller thread.

use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::instruments::sampler::decoder::SampleBuffer;

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

/// Snapshot of a clip's timing and offset — used for trim before/after records.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimSnapshot {
    pub start_beats: f64,
    pub duration_beats: f64,
    pub start_offset_samples: u64,
}

/// Mutable clip data sent from the frontend for edit operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEditData {
    pub id: String,
    pub name: String,
    pub start_beats: f64,
    pub duration_beats: f64,
    pub sample_id: String,
    pub start_offset_samples: u64,
    pub gain: f64,
}

/// Result of a cut operation — two replacement clips.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutResult {
    pub removed_clip_id: String,
    pub clip_a: ClipEditData,
    pub clip_b: ClipEditData,
}

/// Result of a trim operation — before/after timing snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimResult {
    pub clip_id: String,
    pub before: TrimSnapshot,
    pub after: TrimSnapshot,
}

/// Minimal sample reference data returned when a new reversed file is created.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleReferenceData {
    pub id: String,
    pub original_filename: String,
    pub archive_path: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_secs: f64,
}

/// Result of a reverse operation — the old clip is replaced by a new one
/// pointing to a freshly-written reversed WAV file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseResult {
    pub removed_clip_id: String,
    pub new_clip: ClipEditData,
    pub new_sample_reference: SampleReferenceData,
    pub reversed_file_path: String,
}

// ---------------------------------------------------------------------------
// compute_cut
// ---------------------------------------------------------------------------

/// Splits a clip at `cut_frame` (relative to the clip's own audio timeline,
/// i.e. frame 0 = `start_offset_samples` in the source file).
///
/// Returns `Err` if the cut point is at or beyond the clip's boundaries.
pub fn compute_cut(
    clip: &ClipEditData,
    cut_frame: u64,
    samples_per_beat: f64,
) -> Result<CutResult, String> {
    if samples_per_beat <= 0.0 {
        return Err("samples_per_beat must be > 0".into());
    }

    let total_frames = (clip.duration_beats * samples_per_beat).round() as u64;

    if cut_frame == 0 {
        return Err("cut_frame must be > 0".into());
    }
    if cut_frame >= total_frames {
        return Err(format!(
            "cut_frame ({cut_frame}) must be < total_frames ({total_frames})"
        ));
    }

    let cut_beats = cut_frame as f64 / samples_per_beat;
    let remaining_beats = clip.duration_beats - cut_beats;

    let clip_a = ClipEditData {
        id: Uuid::new_v4().to_string(),
        name: format!("{} A", clip.name),
        start_beats: clip.start_beats,
        duration_beats: cut_beats,
        sample_id: clip.sample_id.clone(),
        start_offset_samples: clip.start_offset_samples,
        gain: clip.gain,
    };

    let clip_b = ClipEditData {
        id: Uuid::new_v4().to_string(),
        name: format!("{} B", clip.name),
        start_beats: clip.start_beats + cut_beats,
        duration_beats: remaining_beats,
        sample_id: clip.sample_id.clone(),
        start_offset_samples: clip.start_offset_samples + cut_frame,
        gain: clip.gain,
    };

    Ok(CutResult {
        removed_clip_id: clip.id.clone(),
        clip_a,
        clip_b,
    })
}

// ---------------------------------------------------------------------------
// compute_trim_start
// ---------------------------------------------------------------------------

/// Advances the clip's start by `new_start_frame` frames.
///
/// `new_start_frame` is relative to the current `start_offset_samples`
/// (i.e. 0 = current start, positive values move the start right).
pub fn compute_trim_start(
    clip: &ClipEditData,
    new_start_frame: u64,
    samples_per_beat: f64,
) -> Result<TrimResult, String> {
    if samples_per_beat <= 0.0 {
        return Err("samples_per_beat must be > 0".into());
    }

    let total_frames = (clip.duration_beats * samples_per_beat).round() as u64;

    if new_start_frame >= total_frames {
        return Err(format!(
            "new_start_frame ({new_start_frame}) would result in zero-duration clip (total: {total_frames})"
        ));
    }

    let delta_beats = new_start_frame as f64 / samples_per_beat;
    let new_duration = clip.duration_beats - delta_beats;

    if new_duration <= 0.0 {
        return Err("Trim would result in zero or negative duration".into());
    }

    let before = TrimSnapshot {
        start_beats: clip.start_beats,
        duration_beats: clip.duration_beats,
        start_offset_samples: clip.start_offset_samples,
    };

    let after = TrimSnapshot {
        start_beats: clip.start_beats + delta_beats,
        duration_beats: new_duration,
        start_offset_samples: clip.start_offset_samples + new_start_frame,
    };

    Ok(TrimResult {
        clip_id: clip.id.clone(),
        before,
        after,
    })
}

// ---------------------------------------------------------------------------
// compute_trim_end
// ---------------------------------------------------------------------------

/// Trims the clip's end so it finishes at `new_end_frame` frames from the
/// current start offset.
pub fn compute_trim_end(
    clip: &ClipEditData,
    new_end_frame: u64,
    samples_per_beat: f64,
) -> Result<TrimResult, String> {
    if samples_per_beat <= 0.0 {
        return Err("samples_per_beat must be > 0".into());
    }

    if new_end_frame == 0 {
        return Err("new_end_frame must be > 0".into());
    }

    let new_duration_beats = new_end_frame as f64 / samples_per_beat;

    if new_duration_beats <= 0.0 {
        return Err("Trim would result in zero or negative duration".into());
    }

    if new_duration_beats >= clip.duration_beats {
        return Err(format!(
            "new_end_frame ({new_end_frame}) would exceed current duration ({} beats)",
            clip.duration_beats
        ));
    }

    let before = TrimSnapshot {
        start_beats: clip.start_beats,
        duration_beats: clip.duration_beats,
        start_offset_samples: clip.start_offset_samples,
    };

    let after = TrimSnapshot {
        start_beats: clip.start_beats,
        duration_beats: new_duration_beats,
        start_offset_samples: clip.start_offset_samples,
    };

    Ok(TrimResult {
        clip_id: clip.id.clone(),
        before,
        after,
    })
}

// ---------------------------------------------------------------------------
// find_zero_crossing
// ---------------------------------------------------------------------------

/// Searches left and right from `near_frame` for a zero crossing on the left
/// channel (sign change between consecutive samples).
///
/// Returns the nearest crossing frame if one is found within `search_radius`,
/// otherwise returns `near_frame` unchanged.
pub fn find_zero_crossing(
    buffer: &SampleBuffer,
    near_frame: usize,
    search_radius: usize,
) -> usize {
    let total = buffer.frame_count;
    if total == 0 {
        return near_frame;
    }

    let near_frame = near_frame.min(total.saturating_sub(1));

    let sample_at = |frame: usize| -> f32 {
        buffer.samples[frame * 2] // left channel
    };

    // Search left first, then right, returning the closest crossing.
    let mut left_crossing: Option<usize> = None;
    let mut right_crossing: Option<usize> = None;

    // Search left
    let left_start = near_frame.saturating_sub(search_radius);
    for f in (left_start..near_frame).rev() {
        if f + 1 < total {
            let s0 = sample_at(f);
            let s1 = sample_at(f + 1);
            if (s0 < 0.0 && s1 >= 0.0) || (s0 >= 0.0 && s1 < 0.0) {
                left_crossing = Some(f);
                break;
            }
        }
    }

    // Search right
    let right_end = (near_frame + search_radius).min(total.saturating_sub(1));
    for f in near_frame..right_end {
        if f + 1 < total {
            let s0 = sample_at(f);
            let s1 = sample_at(f + 1);
            if (s0 < 0.0 && s1 >= 0.0) || (s0 >= 0.0 && s1 < 0.0) {
                right_crossing = Some(f);
                break;
            }
        }
    }

    match (left_crossing, right_crossing) {
        (Some(l), Some(r)) => {
            // Return the one closer to near_frame.
            let dl = near_frame.saturating_sub(l);
            let dr = r.saturating_sub(near_frame);
            if dl <= dr { l } else { r }
        }
        (Some(l), None) => l,
        (None, Some(r)) => r,
        (None, None) => near_frame,
    }
}

// ---------------------------------------------------------------------------
// write_reversed_region
// ---------------------------------------------------------------------------

/// Writes a new WAV file where `start_frame..end_frame` has been reversed in-place.
///
/// The output file contains:
/// - frames `0..start_frame` unchanged
/// - frames `start_frame..end_frame` in reverse order
/// - frames `end_frame..` unchanged
///
/// Uses the `hound` crate (already in Cargo.toml) to write a standard
/// IEEE float 32-bit PCM WAV file.
pub fn write_reversed_region(
    source_buffer: &SampleBuffer,
    start_frame: usize,
    end_frame: usize,
    output_path: &Path,
) -> Result<(), String> {
    if start_frame >= end_frame {
        return Err(format!(
            "start_frame ({start_frame}) must be < end_frame ({end_frame})"
        ));
    }
    if end_frame > source_buffer.frame_count {
        return Err(format!(
            "end_frame ({end_frame}) exceeds buffer frame_count ({})",
            source_buffer.frame_count
        ));
    }

    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: source_buffer.sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer = hound::WavWriter::create(output_path, spec)
        .map_err(|e| format!("Failed to create WAV writer: {e}"))?;

    // Frames before the reversal region — copy unchanged
    for frame in 0..start_frame {
        let l = source_buffer.samples[frame * 2];
        let r = source_buffer.samples[frame * 2 + 1];
        writer.write_sample(l).map_err(|e| format!("WAV write error: {e}"))?;
        writer.write_sample(r).map_err(|e| format!("WAV write error: {e}"))?;
    }

    // Reversed region
    for frame in (start_frame..end_frame).rev() {
        let l = source_buffer.samples[frame * 2];
        let r = source_buffer.samples[frame * 2 + 1];
        writer.write_sample(l).map_err(|e| format!("WAV write error: {e}"))?;
        writer.write_sample(r).map_err(|e| format!("WAV write error: {e}"))?;
    }

    // Frames after the reversal region — copy unchanged
    for frame in end_frame..source_buffer.frame_count {
        let l = source_buffer.samples[frame * 2];
        let r = source_buffer.samples[frame * 2 + 1];
        writer.write_sample(l).map_err(|e| format!("WAV write error: {e}"))?;
        writer.write_sample(r).map_err(|e| format!("WAV write error: {e}"))?;
    }

    writer.finalize().map_err(|e| format!("WAV finalize error: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    // Helper: create a simple stereo SampleBuffer
    fn make_clip(id: &str, start_beats: f64, duration_beats: f64, start_offset: u64) -> ClipEditData {
        ClipEditData {
            id: id.to_string(),
            name: "test".to_string(),
            start_beats,
            duration_beats,
            sample_id: "sample-1".to_string(),
            start_offset_samples: start_offset,
            gain: 1.0,
        }
    }

    fn make_stereo_buffer(frames: usize) -> Arc<SampleBuffer> {
        // Alternating +0.5 / -0.5 for zero-crossing tests
        let mut samples = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let v = if i % 2 == 0 { 0.5f32 } else { -0.5f32 };
            samples.push(v); // L
            samples.push(v); // R
        }
        Arc::new(SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: frames,
        })
    }

    // --- compute_cut ---

    #[test]
    fn test_compute_cut_midpoint() {
        let clip = make_clip("c1", 0.0, 4.0, 0);
        let samples_per_beat = 44100.0;
        // Cut at the midpoint: 2 beats * 44100 = 88200 frames
        let cut_frame = 88200u64;
        let result = compute_cut(&clip, cut_frame, samples_per_beat).unwrap();
        assert_eq!(result.removed_clip_id, "c1");
        // clip_a: 0..2 beats
        assert!((result.clip_a.duration_beats - 2.0).abs() < 1e-9);
        assert_eq!(result.clip_a.start_offset_samples, 0);
        // clip_b: 2..4 beats
        assert!((result.clip_b.start_beats - 2.0).abs() < 1e-9);
        assert!((result.clip_b.duration_beats - 2.0).abs() < 1e-9);
        assert_eq!(result.clip_b.start_offset_samples, cut_frame);
    }

    #[test]
    fn test_compute_cut_at_zero_errors() {
        let clip = make_clip("c1", 0.0, 4.0, 0);
        let result = compute_cut(&clip, 0, 44100.0);
        assert!(result.is_err(), "cut at frame 0 should error");
    }

    #[test]
    fn test_compute_cut_at_end_errors() {
        let clip = make_clip("c1", 0.0, 4.0, 0);
        let total_frames = (4.0 * 44100.0f64).round() as u64;
        let result = compute_cut(&clip, total_frames, 44100.0);
        assert!(result.is_err(), "cut at last frame should error");
    }

    // --- compute_trim_start ---

    #[test]
    fn test_compute_trim_start_advances_offset() {
        let clip = make_clip("c1", 0.0, 4.0, 1000);
        let advance = 4410u64; // 0.1 beats @ 44100 spb
        let result = compute_trim_start(&clip, advance, 44100.0).unwrap();
        assert_eq!(result.after.start_offset_samples, 1000 + advance);
        assert!((result.after.start_beats - (advance as f64 / 44100.0)).abs() < 1e-9);
        assert!((result.after.duration_beats - (4.0 - advance as f64 / 44100.0)).abs() < 1e-9);
    }

    // --- compute_trim_end ---

    #[test]
    fn test_compute_trim_end_reduces_duration() {
        let clip = make_clip("c1", 0.0, 4.0, 0);
        let new_end = (3.0 * 44100.0f64) as u64; // shorten to 3 beats
        let result = compute_trim_end(&clip, new_end, 44100.0).unwrap();
        assert!((result.after.duration_beats - 3.0).abs() < 1e-9);
        assert_eq!(result.after.start_offset_samples, 0);
        assert_eq!(result.before.duration_beats, 4.0);
    }

    #[test]
    fn test_trim_to_zero_duration_errors() {
        let clip = make_clip("c1", 0.0, 4.0, 0);
        // Trimming start to the very end leaves no frames
        let total = (4.0 * 44100.0f64).round() as u64;
        let result = compute_trim_start(&clip, total, 44100.0);
        assert!(result.is_err(), "trim to zero duration should error");
    }

    // --- find_zero_crossing ---

    #[test]
    fn test_find_zero_crossing_sign_change() {
        // Buffer: frame 0 = +0.5, frame 1 = -0.5, frame 2 = +0.5 ...
        let buf = make_stereo_buffer(20);
        // Frame 0 L=+0.5, frame 1 L=-0.5 → crossing between frame 0 and 1
        let result = find_zero_crossing(&buf, 5, 10);
        // Should find a zero crossing within radius
        assert!(result < 20);
    }

    #[test]
    fn test_find_zero_crossing_no_crossing_returns_near_frame() {
        // All positive samples — no zero crossing
        let samples: Vec<f32> = vec![0.5f32; 40]; // 20 stereo frames
        let buf = Arc::new(SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: 20,
        });
        let result = find_zero_crossing(&buf, 10, 5);
        assert_eq!(result, 10, "no crossing → should return near_frame");
    }

    // --- write_reversed_region ---

    #[test]
    fn test_write_reversed_region_frame_count() {
        use tempfile::NamedTempFile;
        let frames = 100usize;
        let samples: Vec<f32> = (0..frames * 2).map(|i| i as f32 / 100.0).collect();
        let buf = SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: frames,
        };
        let tmpfile = NamedTempFile::new().expect("tmpfile");
        write_reversed_region(&buf, 25, 75, tmpfile.path()).expect("write failed");

        let mut reader = hound::WavReader::open(tmpfile.path()).expect("read failed");
        let written_samples: Vec<f32> = reader.samples::<f32>().map(|s| s.unwrap()).collect();
        // Output frame count must equal input frame count
        assert_eq!(written_samples.len(), frames * 2);
    }
}
