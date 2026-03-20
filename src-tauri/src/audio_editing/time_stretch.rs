//! Time-stretch and pitch-shift using rubato FFT resampling (Sprint 16).
//!
//! `apply_time_stretch` stretches audio by `ratio` (ratio > 1.0 = longer/slower,
//! < 1.0 = shorter/faster). Valid range: 0.5–2.0 inclusive.
//!
//! `apply_pitch_shift` shifts pitch by `semitones` while preserving duration via
//! a double-pass approach: pass 1 time-stretches by `1/freq_ratio`, pass 2
//! resamples back to the original frame count.

use rubato::{FftFixedIn, Resampler};

use crate::instruments::sampler::decoder::SampleBuffer;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_stretch_ratio(ratio: f32) -> Result<(), String> {
    if ratio < 0.5 || ratio > 2.0 {
        Err(format!(
            "stretch_ratio {ratio} is out of range — must be 0.5..=2.0"
        ))
    } else {
        Ok(())
    }
}

fn validate_semitones(semitones: i8) -> Result<(), String> {
    if semitones < -24 || semitones > 24 {
        Err(format!(
            "pitch_shift_semitones {semitones} is out of range — must be -24..=+24"
        ))
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Interleaved <-> planar conversion helpers
// ---------------------------------------------------------------------------

/// Splits an interleaved stereo buffer into two planar channel vecs.
fn deinterleave(samples: &[f32], frame_count: usize) -> (Vec<f32>, Vec<f32>) {
    let mut left = Vec::with_capacity(frame_count);
    let mut right = Vec::with_capacity(frame_count);
    for i in 0..frame_count {
        left.push(samples[i * 2]);
        right.push(samples[i * 2 + 1]);
    }
    (left, right)
}

/// Interleaves two planar channel vecs into a single stereo buffer.
fn interleave(left: &[f32], right: &[f32]) -> Vec<f32> {
    let frame_count = left.len().min(right.len());
    let mut out = Vec::with_capacity(frame_count * 2);
    for i in 0..frame_count {
        out.push(left[i]);
        out.push(right[i]);
    }
    out
}

// ---------------------------------------------------------------------------
// apply_time_stretch
// ---------------------------------------------------------------------------

/// Time-stretch a buffer by `ratio`.
///
/// - `ratio > 1.0` → longer (slower)
/// - `ratio < 1.0` → shorter (faster)
///
/// Valid range: 0.5–2.0 inclusive.
///
/// Internally, this creates a virtual "source rate" of
/// `buffer.sample_rate * ratio` and resamples it down to the original
/// `buffer.sample_rate`. FFT-based resampling via rubato `FftFixedIn`.
pub fn apply_time_stretch(buffer: &SampleBuffer, ratio: f32) -> Result<SampleBuffer, String> {
    validate_stretch_ratio(ratio)?;

    let channels = 2usize; // always stereo after decode

    // FftFixedIn::new(input_rate, output_rate, chunk_size, sub_chunks, channels)
    // produces `output_rate / input_rate` output frames per input frame.
    //
    // To time-stretch by `ratio`:
    //   - Input plays at buffer.sample_rate (input_rate = buffer.sample_rate)
    //   - We want `ratio * buffer.frame_count` output frames, so
    //     output_rate = buffer.sample_rate * ratio
    //
    // Example: ratio=2.0, buffer at 44100 Hz:
    //   FftFixedIn::new(44100, 88200, ...) → 2x as many output frames → 2x longer

    let input_rate = buffer.sample_rate as usize;
    let output_rate = (buffer.sample_rate as f64 * ratio as f64).round() as usize;

    // Identity fast-path
    if input_rate == output_rate {
        let out_samples = buffer.samples.clone();
        return Ok(SampleBuffer {
            frame_count: buffer.frame_count,
            samples: out_samples,
            sample_rate: buffer.sample_rate,
            original_channels: buffer.original_channels,
        });
    }

    let chunk_size = 4096usize;

    let mut resampler = FftFixedIn::<f32>::new(input_rate, output_rate, chunk_size, 2, channels)
        .map_err(|e| format!("FftFixedIn::new error: {e}"))?;

    let (left_in, right_in) = deinterleave(&buffer.samples, buffer.frame_count);

    let mut left_out: Vec<f32> = Vec::new();
    let mut right_out: Vec<f32> = Vec::new();

    let mut pos = 0usize;

    // Process in full chunks
    while pos + chunk_size <= buffer.frame_count {
        let chunk_l = left_in[pos..pos + chunk_size].to_vec();
        let chunk_r = right_in[pos..pos + chunk_size].to_vec();
        let input: Vec<Vec<f32>> = vec![chunk_l, chunk_r];

        let result = resampler
            .process(&input, None)
            .map_err(|e| format!("resampler.process error: {e}"))?;

        left_out.extend_from_slice(&result[0]);
        right_out.extend_from_slice(&result[1]);

        pos += chunk_size;
    }

    // Flush remaining frames (partial chunk + internal delay frames).
    // When there are no remaining input frames, pass None so rubato zero-pads
    // internally and flushes any delayed samples without buffer-size errors.
    let remaining_len = buffer.frame_count - pos;
    if remaining_len > 0 {
        let remaining_l: Vec<f32> = left_in[pos..].to_vec();
        let remaining_r: Vec<f32> = right_in[pos..].to_vec();
        let partial_input: Vec<Vec<f32>> = vec![remaining_l, remaining_r];
        let partial_result = resampler
            .process_partial(Some(&partial_input), None)
            .map_err(|e| format!("resampler.process_partial error: {e}"))?;
        left_out.extend_from_slice(&partial_result[0]);
        right_out.extend_from_slice(&partial_result[1]);
    } else {
        // No leftover input — just flush internal delay samples.
        let flush_result = resampler
            .process_partial(None::<&[Vec<f32>]>, None)
            .map_err(|e| format!("resampler flush error: {e}"))?;
        left_out.extend_from_slice(&flush_result[0]);
        right_out.extend_from_slice(&flush_result[1]);
    }

    let frame_count = left_out.len().min(right_out.len());
    let samples = interleave(&left_out, &right_out);

    Ok(SampleBuffer {
        samples,
        sample_rate: buffer.sample_rate,
        original_channels: buffer.original_channels,
        frame_count,
    })
}

// ---------------------------------------------------------------------------
// apply_pitch_shift
// ---------------------------------------------------------------------------

/// Pitch-shift by `semitones` while preserving the original duration.
///
/// Uses a double-pass rubato approach:
/// - Pass 1: `apply_time_stretch(buffer, 1.0 / freq_ratio)` — stretches the
///   audio so that after pitch-shifting the length is restored.
/// - Pass 2: Resample the stretched buffer from a virtual source rate back to
///   the original length, which raises/lowers pitch by `semitones`.
///
/// Valid range: -24..=+24 semitones.
/// The output `frame_count` is truncated or zero-padded to exactly
/// `buffer.frame_count` to guarantee duration is preserved.
pub fn apply_pitch_shift(buffer: &SampleBuffer, semitones: i8) -> Result<SampleBuffer, String> {
    validate_semitones(semitones)?;

    // Identity fast-path
    if semitones == 0 {
        let out_samples = buffer.samples.clone();
        return Ok(SampleBuffer {
            frame_count: buffer.frame_count,
            samples: out_samples,
            sample_rate: buffer.sample_rate,
            original_channels: buffer.original_channels,
        });
    }

    let freq_ratio = 2.0_f32.powf(semitones as f32 / 12.0);

    // Pass 1: time-stretch by 1/freq_ratio so the pitch shift
    // in pass 2 restores the original duration.
    let stretched = apply_time_stretch(buffer, 1.0 / freq_ratio)?;

    // Pass 2: resample the shortened/lengthened stretched buffer back to the
    // original frame_count, which shifts pitch by freq_ratio.
    //
    // The stretched buffer has `buffer.frame_count / freq_ratio` frames.
    // We treat those frames as input (at buffer.sample_rate) and produce
    // output at `buffer.sample_rate * freq_ratio` Hz.
    //
    //   FftFixedIn(input=44100, output=44100*freq_ratio, ...)
    //   produces `freq_ratio` output frames per input frame.
    //
    // Example (freq_ratio=2.0, +1 octave):
    //   stretched has ~frame_count/2 frames
    //   resampler produces 2x → ~frame_count frames ✓
    let pass2_input_rate = stretched.sample_rate as usize;
    let pass2_output_rate = (stretched.sample_rate as f64 * freq_ratio as f64).round() as usize;

    let channels = 2usize;
    let chunk_size = 4096usize;

    let mut resampler =
        FftFixedIn::<f32>::new(pass2_input_rate, pass2_output_rate, chunk_size, 2, channels)
            .map_err(|e| format!("FftFixedIn::new (pass 2) error: {e}"))?;

    let (left_in, right_in) = deinterleave(&stretched.samples, stretched.frame_count);

    let mut left_out: Vec<f32> = Vec::new();
    let mut right_out: Vec<f32> = Vec::new();

    let mut pos = 0usize;

    while pos + chunk_size <= stretched.frame_count {
        let chunk_l = left_in[pos..pos + chunk_size].to_vec();
        let chunk_r = right_in[pos..pos + chunk_size].to_vec();
        let input: Vec<Vec<f32>> = vec![chunk_l, chunk_r];

        let result = resampler
            .process(&input, None)
            .map_err(|e| format!("resampler.process (pass 2) error: {e}"))?;

        left_out.extend_from_slice(&result[0]);
        right_out.extend_from_slice(&result[1]);

        pos += chunk_size;
    }

    let remaining_len = stretched.frame_count - pos;
    if remaining_len > 0 {
        let remaining_l: Vec<f32> = left_in[pos..].to_vec();
        let remaining_r: Vec<f32> = right_in[pos..].to_vec();
        let partial_input: Vec<Vec<f32>> = vec![remaining_l, remaining_r];
        let partial_result = resampler
            .process_partial(Some(&partial_input), None)
            .map_err(|e| format!("resampler.process_partial (pass 2) error: {e}"))?;
        left_out.extend_from_slice(&partial_result[0]);
        right_out.extend_from_slice(&partial_result[1]);
    } else {
        let flush_result = resampler
            .process_partial(None::<&[Vec<f32>]>, None)
            .map_err(|e| format!("resampler flush (pass 2) error: {e}"))?;
        left_out.extend_from_slice(&flush_result[0]);
        right_out.extend_from_slice(&flush_result[1]);
    }

    // Truncate or zero-pad to exactly buffer.frame_count to preserve duration
    let target_frames = buffer.frame_count;
    left_out.resize(target_frames, 0.0);
    right_out.resize(target_frames, 0.0);

    let samples = interleave(&left_out, &right_out);

    Ok(SampleBuffer {
        samples,
        sample_rate: buffer.sample_rate,
        original_channels: buffer.original_channels,
        frame_count: target_frames,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Buffer size used by stretch tests — must be several times the chunk size
    /// (4096) so that the FFT flush overhead is a small fraction of total output.
    const TEST_FRAMES: usize = 44100; // ~1 second at 44100 Hz

    fn make_buffer(frames: usize) -> Arc<SampleBuffer> {
        // Simple sine-like content: non-zero so rubato has something to process
        let mut samples = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let t = i as f32 / 44100.0;
            let v = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
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

    #[test]
    fn test_stretch_ratio_1_0_identity() {
        let buf = make_buffer(TEST_FRAMES);
        let result = apply_time_stretch(&buf, 1.0).expect("should succeed");
        let diff = (result.frame_count as i64 - buf.frame_count as i64).abs();
        assert!(diff <= 2, "ratio 1.0: frame_count diff {diff} should be ≤2");
    }

    #[test]
    fn test_stretch_ratio_2_0_doubles_length() {
        let buf = make_buffer(TEST_FRAMES);
        let result = apply_time_stretch(&buf, 2.0).expect("should succeed");
        let expected = buf.frame_count * 2;
        let diff = (result.frame_count as i64 - expected as i64).abs();
        // Allow ±5% tolerance due to FFT block boundaries and flush latency
        let tolerance = (expected as f64 * 0.05) as i64;
        assert!(
            diff <= tolerance,
            "ratio 2.0: expected ~{expected} frames, got {} (diff {diff})",
            result.frame_count
        );
    }

    #[test]
    fn test_stretch_ratio_0_5_halves_length() {
        let buf = make_buffer(TEST_FRAMES);
        let result = apply_time_stretch(&buf, 0.5).expect("should succeed");
        let expected = buf.frame_count / 2;
        let diff = (result.frame_count as i64 - expected as i64).abs();
        let tolerance = (expected as f64 * 0.05) as i64;
        assert!(
            diff <= tolerance,
            "ratio 0.5: expected ~{expected} frames, got {} (diff {diff})",
            result.frame_count
        );
    }

    #[test]
    fn test_stretch_invalid_ratio_errors() {
        let buf = make_buffer(1024);
        assert!(
            apply_time_stretch(&buf, 0.4).is_err(),
            "ratio 0.4 should be out of range"
        );
        assert!(
            apply_time_stretch(&buf, 2.1).is_err(),
            "ratio 2.1 should be out of range"
        );
    }

    #[test]
    fn test_pitch_shift_zero_semitones_identity() {
        let buf = make_buffer(TEST_FRAMES);
        let result = apply_pitch_shift(&buf, 0).expect("should succeed");
        let diff = (result.frame_count as i64 - buf.frame_count as i64).abs();
        assert!(diff <= 5, "0 semitones: frame_count diff {diff} should be ≤5");
    }

    #[test]
    fn test_pitch_shift_plus_12_preserves_frame_count() {
        let buf = make_buffer(TEST_FRAMES);
        let result = apply_pitch_shift(&buf, 12).expect("+12 semitones should succeed");
        let diff = (result.frame_count as i64 - buf.frame_count as i64).abs();
        let tolerance = (buf.frame_count as f64 * 0.05) as i64;
        assert!(
            diff <= tolerance,
            "+12 semitones: frame_count diff {diff} should be within 5%"
        );
    }

    #[test]
    fn test_pitch_shift_minus_12_preserves_frame_count() {
        let buf = make_buffer(TEST_FRAMES);
        let result = apply_pitch_shift(&buf, -12).expect("-12 semitones should succeed");
        let diff = (result.frame_count as i64 - buf.frame_count as i64).abs();
        let tolerance = (buf.frame_count as f64 * 0.05) as i64;
        assert!(
            diff <= tolerance,
            "-12 semitones: frame_count diff {diff} should be within 5%"
        );
    }
}
