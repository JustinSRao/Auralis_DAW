//! Audio file writer that abstracts WAV, FLAC, and MP3 output formats.
//!
//! ## Design
//!
//! `FileWriter` is constructed with a path and `OutputFormat`, then fed
//! interleaved f32 sample blocks via `write_block`.  `finalize` flushes
//! all pending data and closes the file.
//!
//! - **WAV**: written sample-by-sample via `hound`.
//! - **FLAC**: FLAC encoding is not natively available as a pure-Rust
//!   encoder dependency that builds cleanly on Windows without C libs.
//!   FLAC output is therefore implemented by writing a temporary in-memory
//!   WAV buffer (using `hound` + `std::io::Cursor`) and re-encoding it with
//!   `symphonia`'s built-in codec support.  Since symphonia is already in the
//!   dependency tree for decoding, this avoids a new C dependency.
//!   **Current implementation**: FLAC falls back to 24-bit WAV and notes the
//!   limitation — a TODO for a future sprint that adds `flac` or `libflac-sys`.
//! - **MP3**: `mp3lame-encoder` wraps libmp3lame.  Because libmp3lame requires
//!   a C toolchain and pre-built libraries that are not trivially available on
//!   all Windows CI environments, MP3 export also falls back to WAV in this
//!   sprint with a clear TODO comment.  The `OutputFormat::Mp3` variant is
//!   fully wired so adding the real encoder is a one-file change.

use std::io::BufWriter;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};

// ─── OutputFormat ─────────────────────────────────────────────────────────────

/// Bit depth for WAV/FLAC output.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WavBitDepth {
    /// 16-bit signed integer PCM.
    Bits16,
    /// 24-bit signed integer PCM.
    Bits24,
    /// 32-bit floating-point (IEEE 754).
    Bits32Float,
}

/// Specifies the output container and codec settings.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "format")]
pub enum OutputFormat {
    /// PCM WAV file.
    Wav {
        #[serde(rename = "bitDepth")]
        bit_depth: WavBitDepth,
    },
    /// FLAC lossless file.
    ///
    /// Currently implemented as a 24-bit WAV fallback (see module docs).
    Flac {
        #[serde(rename = "bitDepth")]
        bit_depth: WavBitDepth,
    },
    /// MP3 lossy file at `kbps` kilobits per second.
    ///
    /// Currently implemented as a 16-bit WAV fallback (see module docs).
    Mp3 {
        kbps: u32,
    },
}

// ─── FileWriter ──────────────────────────────────────────────────────────────

enum WriterState {
    Wav(WavWriter<BufWriter<std::fs::File>>),
    /// FLAC: TODO — currently writes 24-bit WAV as a fallback.
    FlacFallback(WavWriter<BufWriter<std::fs::File>>),
    /// MP3: TODO — currently writes 16-bit WAV as a fallback.
    Mp3Fallback(WavWriter<BufWriter<std::fs::File>>),
}

/// Writes rendered audio samples to a file on disk.
///
/// Samples must be interleaved in the order `[L0, R0, L1, R1, …]` for stereo,
/// or `[S0, S1, …]` for mono.  Values should be in the range `[-1.0, 1.0]`.
pub struct FileWriter {
    state:           WriterState,
    #[allow(dead_code)]
    path:            PathBuf,
    #[allow(dead_code)]
    sample_rate:     u32,
    #[allow(dead_code)]
    channels:        u16,
}

impl FileWriter {
    /// Creates a new `FileWriter` at `path` with the given format settings.
    pub fn new(
        path:        &Path,
        format:      OutputFormat,
        sample_rate: u32,
        channels:    u16,
    ) -> Result<Self> {
        match format {
            OutputFormat::Wav { bit_depth } => {
                let writer = Self::create_wav_writer(path, bit_depth, sample_rate, channels)?;
                Ok(Self {
                    state:       WriterState::Wav(writer),
                    path:        path.to_path_buf(),
                    sample_rate,
                    channels,
                })
            }
            OutputFormat::Flac { .. } => {
                // TODO Sprint 22+: add `flac` crate for native FLAC encoding.
                // Fallback: write 24-bit WAV.
                log::warn!(
                    "FLAC encoding not yet implemented — writing 24-bit WAV fallback to {:?}",
                    path
                );
                let writer = Self::create_wav_writer(path, WavBitDepth::Bits24, sample_rate, channels)?;
                Ok(Self {
                    state:       WriterState::FlacFallback(writer),
                    path:        path.to_path_buf(),
                    sample_rate,
                    channels,
                })
            }
            OutputFormat::Mp3 { .. } => {
                // TODO Sprint 22+: link libmp3lame via `mp3lame-encoder` crate.
                // Fallback: write 16-bit WAV.
                log::warn!(
                    "MP3 encoding not yet implemented — writing 16-bit WAV fallback to {:?}",
                    path
                );
                let writer = Self::create_wav_writer(path, WavBitDepth::Bits16, sample_rate, channels)?;
                Ok(Self {
                    state:       WriterState::Mp3Fallback(writer),
                    path:        path.to_path_buf(),
                    sample_rate,
                    channels,
                })
            }
        }
    }

    /// Writes a block of interleaved f32 samples.
    pub fn write_block(&mut self, samples: &[f32]) -> Result<()> {
        match &mut self.state {
            WriterState::Wav(w) => Self::write_wav_block(w, samples),
            WriterState::FlacFallback(w) => Self::write_wav_block(w, samples),
            WriterState::Mp3Fallback(w) => Self::write_wav_block_16bit(w, samples),
        }
    }

    /// Finalizes the file: flushes and closes the writer.
    pub fn finalize(self) -> Result<()> {
        match self.state {
            WriterState::Wav(w)
            | WriterState::FlacFallback(w)
            | WriterState::Mp3Fallback(w) => {
                w.finalize().context("Failed to finalize WAV file")?;
            }
        }
        Ok(())
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    fn create_wav_writer(
        path:        &Path,
        bit_depth:   WavBitDepth,
        sample_rate: u32,
        channels:    u16,
    ) -> Result<WavWriter<BufWriter<std::fs::File>>> {
        let (bits_per_sample, sample_format) = match bit_depth {
            WavBitDepth::Bits16     => (16u16, SampleFormat::Int),
            WavBitDepth::Bits24     => (24u16, SampleFormat::Int),
            WavBitDepth::Bits32Float => (32u16, SampleFormat::Float),
        };

        let spec = WavSpec {
            channels,
            sample_rate,
            bits_per_sample,
            sample_format,
        };

        WavWriter::create(path, spec)
            .with_context(|| format!("Failed to create WAV file at {:?}", path))
    }

    /// Write a block using the bit depth encoded in the `WavWriter`'s spec.
    fn write_wav_block(
        writer:  &mut WavWriter<BufWriter<std::fs::File>>,
        samples: &[f32],
    ) -> Result<()> {
        let spec = writer.spec();
        match (spec.bits_per_sample, spec.sample_format) {
            (32, SampleFormat::Float) => {
                for &s in samples {
                    writer
                        .write_sample(s)
                        .context("WAV write_sample (f32) failed")?;
                }
            }
            (24, SampleFormat::Int) => {
                for &s in samples {
                    let clamped = s.clamp(-1.0, 1.0);
                    let v = (clamped * 8_388_607.0) as i32;
                    writer
                        .write_sample(v)
                        .context("WAV write_sample (24-bit) failed")?;
                }
            }
            _ => {
                // Default: 16-bit int
                for &s in samples {
                    let clamped = s.clamp(-1.0, 1.0);
                    let v = (clamped * 32_767.0) as i16;
                    writer
                        .write_sample(v)
                        .context("WAV write_sample (16-bit) failed")?;
                }
            }
        }
        Ok(())
    }

    /// Always writes 16-bit integer samples (for MP3 fallback path).
    fn write_wav_block_16bit(
        writer:  &mut WavWriter<BufWriter<std::fs::File>>,
        samples: &[f32],
    ) -> Result<()> {
        for &s in samples {
            let clamped = s.clamp(-1.0, 1.0);
            let v = (clamped * 32_767.0) as i16;
            writer
                .write_sample(v)
                .context("WAV write_sample (16-bit fallback) failed")?;
        }
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use hound::WavReader;
    use tempfile::NamedTempFile;

    use super::*;

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn write_and_finalize(samples: &[f32], bit_depth: WavBitDepth) -> NamedTempFile {
        let tmp = NamedTempFile::new().expect("tempfile");
        let path = tmp.path().to_path_buf();
        let mut fw = FileWriter::new(
            &path,
            OutputFormat::Wav { bit_depth },
            44100,
            2,
        )
        .expect("FileWriter::new");
        fw.write_block(samples).expect("write_block");
        fw.finalize().expect("finalize");
        tmp
    }

    // ── WAV 16-bit: valid header ──────────────────────────────────────────────

    #[test]
    fn wav_writer_produces_valid_header() {
        // 1 second of silence at 44100 Hz stereo = 88200 samples.
        let samples = vec![0.0f32; 88200];
        let tmp = write_and_finalize(&samples, WavBitDepth::Bits16);

        let reader = WavReader::open(tmp.path()).expect("WavReader::open");
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 44100);
        assert_eq!(spec.channels, 2);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(spec.sample_format, SampleFormat::Int);
        // hound duration() returns frame count (samples ÷ channels).
        assert_eq!(reader.duration(), 44100);
    }

    // ── WAV 16-bit: clamping ──────────────────────────────────────────────────

    #[test]
    fn wav_16bit_clamped() {
        // Values beyond [-1, 1] must be clamped, not wrap around.
        let samples = vec![2.0f32, -2.0f32, 1.0f32, -1.0f32];
        let tmp = write_and_finalize(&samples, WavBitDepth::Bits16);

        let mut reader = WavReader::open(tmp.path()).expect("WavReader::open");
        let read: Vec<i16> = reader
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .expect("read samples");

        // 2.0 → clamped to 1.0 → 32767
        assert_eq!(read[0], 32767, "positive overflow should clamp to 32767");
        // -2.0 → clamped to -1.0 → -32767
        assert_eq!(read[1], -32767, "negative overflow should clamp to -32767");
        // 1.0 → 32767
        assert_eq!(read[2], 32767);
        // -1.0 → -32767
        assert_eq!(read[3], -32767);
    }

    // ── WAV 32-bit float: round-trip ─────────────────────────────────────────

    #[test]
    fn wav_32bit_float_roundtrip() {
        // Must be an even count for stereo (2 channels × 2 frames).
        let samples = vec![0.123_f32, -0.456_f32, 0.789_f32, -0.321_f32];
        let tmp = write_and_finalize(&samples, WavBitDepth::Bits32Float);

        let mut reader = WavReader::open(tmp.path()).expect("WavReader::open");
        let spec = reader.spec();
        assert_eq!(spec.sample_format, SampleFormat::Float);
        assert_eq!(spec.bits_per_sample, 32);

        let read: Vec<f32> = reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .expect("read f32 samples");
        for (orig, got) in samples.iter().zip(read.iter()) {
            assert!(
                (orig - got).abs() < 1e-6,
                "32-bit float round-trip mismatch: {orig} vs {got}"
            );
        }
    }

    // ── WAV 24-bit: basic write ──────────────────────────────────────────────

    #[test]
    fn wav_24bit_basic_write() {
        let samples = vec![0.5_f32, -0.5_f32];
        let tmp = write_and_finalize(&samples, WavBitDepth::Bits24);

        let reader = WavReader::open(tmp.path()).expect("WavReader::open");
        let spec = reader.spec();
        assert_eq!(spec.bits_per_sample, 24);
        assert_eq!(spec.sample_format, SampleFormat::Int);
    }

    // ── FLAC fallback produces a readable WAV ────────────────────────────────

    #[test]
    fn flac_fallback_produces_valid_wav() {
        let samples = vec![0.1_f32; 100];
        let tmp = NamedTempFile::new().expect("tempfile");
        let path = tmp.path().to_path_buf();
        let mut fw = FileWriter::new(
            &path,
            OutputFormat::Flac { bit_depth: WavBitDepth::Bits24 },
            44100,
            2,
        )
        .expect("FileWriter::new (FLAC fallback)");
        fw.write_block(&samples).expect("write_block");
        fw.finalize().expect("finalize");

        let reader = WavReader::open(path).expect("WavReader::open (FLAC fallback)");
        assert_eq!(reader.spec().bits_per_sample, 24);
    }
}
