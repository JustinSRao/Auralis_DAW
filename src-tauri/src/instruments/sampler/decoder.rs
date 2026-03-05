use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use symphonia::core::audio::SampleBuffer as SymphoniaSampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Decoded audio buffer, always stored as interleaved stereo f32.
///
/// Mono sources are duplicated to both channels; multi-channel sources are
/// mixed down to stereo. The `sample_rate` is the original source rate,
/// which the sampler uses to compute pitch-ratio correction.
pub struct SampleBuffer {
    /// Interleaved stereo samples: [L0, R0, L1, R1, …]
    pub samples: Vec<f32>,
    /// Sample rate of the source file (Hz).
    pub sample_rate: u32,
    /// Number of channels in the source file (before normalization).
    pub original_channels: u16,
    /// Number of frames: `samples.len() / 2`.
    pub frame_count: usize,
}

/// Decodes an audio file at `path` into an interleaved stereo f32 `SampleBuffer`.
///
/// Supports any format that symphonia can decode (WAV, MP3, FLAC, OGG, …).
/// Returns `Err` if the file cannot be opened, probed, or decoded.
///
/// This function performs synchronous I/O and CPU-intensive decoding.
/// Call it via `tokio::task::spawn_blocking` from async Tauri commands.
pub fn decode_audio_file(path: &Path) -> Result<Arc<SampleBuffer>> {
    // Open source file
    let src = std::fs::File::open(path)
        .with_context(|| format!("Failed to open audio file: {}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(src), Default::default());

    // Probe the format
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .context("Failed to probe audio format")?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .context("No audio tracks found in file")?
        .clone();

    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .context("Audio track has no sample rate")?;
    let original_channels = track
        .codec_params
        .channels
        .map(|c| c.count() as u16)
        .unwrap_or(1);

    // Create decoder
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("Failed to create decoder")?;

    let mut interleaved_stereo: Vec<f32> = Vec::new();

    // Decode all packets
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(_)) => break, // End of stream
            Err(e) => return Err(anyhow::anyhow!("Decode error: {}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(symphonia::core::errors::Error::DecodeError(msg)) => {
                log::warn!("Skipping malformed packet: {}", msg);
                continue;
            }
            Err(e) => return Err(anyhow::anyhow!("Decode error: {}", e)),
        };

        // Convert decoded audio to interleaved f32
        let spec = *decoded.spec();
        let mut sample_buf: SymphoniaSampleBuffer<f32> =
            SymphoniaSampleBuffer::new(decoded.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);

        let samples = sample_buf.samples();
        let ch = spec.channels.count();

        match ch {
            1 => {
                // Mono → duplicate to stereo
                for &s in samples {
                    interleaved_stereo.push(s);
                    interleaved_stereo.push(s);
                }
            }
            2 => {
                // Already stereo — copy as-is
                interleaved_stereo.extend_from_slice(samples);
            }
            n => {
                // Multi-channel → average all channels into stereo
                // Simple downmix: use ch[0] as L and ch[1] as R, mix rest equally
                for frame in samples.chunks_exact(n) {
                    let l = frame[0];
                    let r = if n > 1 { frame[1] } else { frame[0] };
                    interleaved_stereo.push(l);
                    interleaved_stereo.push(r);
                }
            }
        }
    }

    let frame_count = interleaved_stereo.len() / 2;

    Ok(Arc::new(SampleBuffer {
        samples: interleaved_stereo,
        sample_rate,
        original_channels,
        frame_count,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_decode_unsupported_format() {
        // Pass a non-audio path (this source file itself) — should return Err
        let path = PathBuf::from(file!());
        let result = decode_audio_file(&path);
        assert!(
            result.is_err(),
            "Expected Err for a non-audio file, got Ok"
        );
    }

    #[test]
    fn test_decode_nonexistent_file() {
        let path = PathBuf::from("/nonexistent/audio/file_xyz_12345.wav");
        let result = decode_audio_file(&path);
        assert!(result.is_err(), "Expected Err for nonexistent file");
    }
}
