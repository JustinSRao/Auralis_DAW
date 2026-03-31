//! `SidechainTap` — shared read/write buffer for cross-channel sidechain routing.
//!
//! ## Aliasing invariant
//!
//! The audio callback processes mixer channels in topological order: all source
//! channels are processed before any destination channels that depend on them.
//! Therefore:
//! - The source `MixerChannel` calls [`SidechainTap::write`] exactly once per
//!   callback, before any destination compressor reads the tap.
//! - The destination `Compressor` calls [`SidechainTap::read`] only after the
//!   source channel has been fully processed.
//! - No two threads ever access the tap simultaneously — the audio callback is
//!   single-threaded.
//!
//! Given this invariant, [`UnsafeCell`] interior mutability is safe here.
//! Violation of the processing-order guarantee would cause stale reads (one
//! buffer behind), not undefined behaviour.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Maximum frames per audio buffer.  Matches `max_buf` in the audio engine.
const MAX_TAP_FRAMES: usize = 4096;

/// Shared read/write stereo buffer populated by a source mixer channel and
/// consumed by a downstream sidechain compressor in the same audio callback.
///
/// # Safety
///
/// Concurrent access is safe only when the processing-order invariant above
/// is respected.  Use only within a single-threaded audio callback.
#[derive(Debug)]
pub struct SidechainTap {
    buffer: UnsafeCell<Box<[f32]>>,
    valid_frames: AtomicUsize,
}

// SAFETY: See module-level aliasing invariant.
unsafe impl Send for SidechainTap {}
unsafe impl Sync for SidechainTap {}

impl SidechainTap {
    /// Allocates a new tap buffer (called at channel creation, not on audio thread).
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            buffer: UnsafeCell::new(vec![0.0f32; MAX_TAP_FRAMES * 2].into_boxed_slice()),
            valid_frames: AtomicUsize::new(0),
        })
    }

    /// Writes post-fader stereo samples into the tap.
    ///
    /// # Safety
    ///
    /// Must only be called from the source channel's processing code, before
    /// any destination reads in the same callback.
    pub unsafe fn write(&self, stereo_interleaved: &[f32]) {
        let frames = stereo_interleaved.len() / 2;
        let n = (frames * 2).min(MAX_TAP_FRAMES * 2);
        let buf = &mut *self.buffer.get();
        buf[..n].copy_from_slice(&stereo_interleaved[..n]);
        self.valid_frames.store(frames.min(MAX_TAP_FRAMES), Ordering::Release);
    }

    /// Returns the last-written stereo frame slice (immutable).
    ///
    /// Safe to call after the source channel has been processed in this callback.
    pub fn read(&self) -> &[f32] {
        let frames = self.valid_frames.load(Ordering::Acquire);
        // SAFETY: No write occurs concurrently; the source channel has already
        // finished writing before any destination compressor calls `read`.
        unsafe { &(&(*self.buffer.get()))[..frames * 2] }
    }

    /// Returns the number of valid stereo frames in the tap.
    pub fn frame_count(&self) -> usize {
        self.valid_frames.load(Ordering::Acquire)
    }
}

impl Default for SidechainTap {
    fn default() -> Self {
        Self {
            buffer: UnsafeCell::new(vec![0.0f32; MAX_TAP_FRAMES * 2].into_boxed_slice()),
            valid_frames: AtomicUsize::new(0),
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_and_read_stereo_samples() {
        let tap = SidechainTap::new();
        let src = vec![0.5f32, 0.6, 0.7, 0.8]; // 2 stereo frames
        unsafe { tap.write(&src) };
        let out = tap.read();
        assert_eq!(out, &[0.5, 0.6, 0.7, 0.8]);
    }

    #[test]
    fn read_before_write_returns_empty() {
        let tap = SidechainTap::new();
        let out = tap.read();
        assert_eq!(out.len(), 0);
    }

    #[test]
    fn overwrite_replaces_previous_content() {
        let tap = SidechainTap::new();
        let src1 = vec![1.0f32, 1.0];
        let src2 = vec![0.3f32, 0.4];
        unsafe { tap.write(&src1) };
        unsafe { tap.write(&src2) };
        let out = tap.read();
        assert_eq!(out, &[0.3, 0.4]);
    }

    #[test]
    fn frame_count_matches_written_frames() {
        let tap = SidechainTap::new();
        let src = vec![0.1f32; 16]; // 8 stereo frames
        unsafe { tap.write(&src) };
        assert_eq!(tap.frame_count(), 8);
    }
}
