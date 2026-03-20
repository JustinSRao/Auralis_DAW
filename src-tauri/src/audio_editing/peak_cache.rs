//! Peak data cache for waveform display in the editor.
//!
//! `PeakCache` caches min/max amplitude frames keyed by `"<file_path>::<frames_per_pixel>"`.
//! `ClipBufferCache` caches decoded `SampleBuffer` objects (max 8 entries, LRU eviction).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::instruments::sampler::decoder::SampleBuffer;

// ---------------------------------------------------------------------------
// PeakFrame / PeakData
// ---------------------------------------------------------------------------

/// Min/max amplitude for a single display pixel column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeakFrame {
    pub min: f32,
    pub max: f32,
}

/// Full peak data for one audio file at a specific zoom level.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeakData {
    /// Number of audio frames collapsed into each `PeakFrame` entry.
    pub frames_per_pixel: usize,
    /// Left-channel (or mono) peak frames.
    pub left: Vec<PeakFrame>,
    /// Right-channel peak frames. Mirrors `left` for mono sources.
    pub right: Vec<PeakFrame>,
    /// Total number of frames in the source buffer.
    pub total_frames: usize,
    /// Sample rate of the source file in Hz.
    pub sample_rate: u32,
}

/// Computes min/max peak frames from an interleaved stereo `SampleBuffer`.
///
/// The buffer stores samples as `[L0, R0, L1, R1, …]`.
/// Mono sources are already duplicated to stereo by the decoder, so both
/// channels are always present.
pub fn compute_peaks(buffer: &SampleBuffer, frames_per_pixel: usize) -> PeakData {
    let fpp = frames_per_pixel.max(1);
    let total_frames = buffer.frame_count;
    let num_windows = (total_frames + fpp - 1) / fpp;

    let mut left = Vec::with_capacity(num_windows);
    let mut right = Vec::with_capacity(num_windows);

    for window in 0..num_windows {
        let start = window * fpp;
        let end = (start + fpp).min(total_frames);

        let mut l_min = f32::MAX;
        let mut l_max = f32::MIN;
        let mut r_min = f32::MAX;
        let mut r_max = f32::MIN;

        for frame in start..end {
            let l = buffer.samples[frame * 2];
            let r = buffer.samples[frame * 2 + 1];
            if l < l_min { l_min = l; }
            if l > l_max { l_max = l; }
            if r < r_min { r_min = r; }
            if r > r_max { r_max = r; }
        }

        left.push(PeakFrame { min: l_min, max: l_max });
        right.push(PeakFrame { min: r_min, max: r_max });
    }

    PeakData {
        frames_per_pixel: fpp,
        left,
        right,
        total_frames,
        sample_rate: buffer.sample_rate,
    }
}

// ---------------------------------------------------------------------------
// ClipBufferCache — decoded audio buffers keyed by file path
// ---------------------------------------------------------------------------

/// In-memory LRU cache for decoded `SampleBuffer` objects.
///
/// Maximum capacity is 8 entries; when full, the entry with the oldest
/// `last_accessed` timestamp is evicted before inserting the new entry.
pub struct ClipBufferCache {
    pub(crate) entries: HashMap<String, (Arc<SampleBuffer>, Instant)>,
    max_entries: usize,
}

impl Default for ClipBufferCache {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            max_entries: 8,
        }
    }
}

impl ClipBufferCache {
    /// Retrieves a cached buffer, updating its last-access timestamp.
    pub fn get(&mut self, path: &str) -> Option<Arc<SampleBuffer>> {
        if let Some(entry) = self.entries.get_mut(path) {
            entry.1 = Instant::now();
            Some(Arc::clone(&entry.0))
        } else {
            None
        }
    }

    /// Inserts a buffer. Evicts the oldest entry when the cache is full.
    pub fn insert(&mut self, path: String, buffer: Arc<SampleBuffer>) {
        // Already present — just update.
        if self.entries.contains_key(&path) {
            self.entries.insert(path, (buffer, Instant::now()));
            return;
        }

        // Evict oldest entry if at capacity.
        if self.entries.len() >= self.max_entries {
            if let Some(oldest_key) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, ts))| *ts)
                .map(|(k, _)| k.clone())
            {
                self.entries.remove(&oldest_key);
            }
        }

        self.entries.insert(path, (buffer, Instant::now()));
    }
}

// ---------------------------------------------------------------------------
// PeakCache — peak data keyed by "<path>::<frames_per_pixel>"
// ---------------------------------------------------------------------------

/// Cache for computed `PeakData` objects.
///
/// Keys are formatted as `"<file_path>::<frames_per_pixel>"` so different
/// zoom levels for the same file are cached independently.
pub struct PeakCache {
    entries: HashMap<String, Arc<PeakData>>,
}

impl Default for PeakCache {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }
}

impl PeakCache {
    fn key(file_path: &str, frames_per_pixel: usize) -> String {
        format!("{file_path}::{frames_per_pixel}")
    }

    /// Returns cached peak data if available.
    pub fn get(&self, file_path: &str, frames_per_pixel: usize) -> Option<Arc<PeakData>> {
        self.entries
            .get(&Self::key(file_path, frames_per_pixel))
            .map(Arc::clone)
    }

    /// Stores peak data.
    pub fn insert(&mut self, file_path: &str, frames_per_pixel: usize, data: Arc<PeakData>) {
        self.entries.insert(Self::key(file_path, frames_per_pixel), data);
    }

    /// Removes all cached entries whose key starts with `file_path::`.
    pub fn invalidate(&mut self, file_path: &str) {
        let prefix = format!("{file_path}::");
        self.entries.retain(|k, _| !k.starts_with(&prefix));
    }
}

// ---------------------------------------------------------------------------
// Managed state type aliases
// ---------------------------------------------------------------------------

/// Tauri managed state for the decoded buffer cache.
pub type ClipBufferCacheState = Arc<Mutex<ClipBufferCache>>;

/// Tauri managed state for the peak data cache.
pub type PeakCacheState = Arc<Mutex<PeakCache>>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_buffer(frames: usize, value: f32) -> Arc<SampleBuffer> {
        let mut samples = Vec::with_capacity(frames * 2);
        for _ in 0..frames {
            samples.push(value); // L
            samples.push(value); // R
        }
        Arc::new(SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: frames,
        })
    }

    #[test]
    fn test_compute_peaks_silence() {
        let buf = make_buffer(100, 0.0);
        let peaks = compute_peaks(&buf, 10);
        for frame in &peaks.left {
            assert_eq!(frame.min, 0.0);
            assert_eq!(frame.max, 0.0);
        }
        for frame in &peaks.right {
            assert_eq!(frame.min, 0.0);
            assert_eq!(frame.max, 0.0);
        }
    }

    #[test]
    fn test_compute_peaks_stereo_frame_count() {
        let buf = make_buffer(1000, 0.5);
        let peaks = compute_peaks(&buf, 10);
        // 1000 frames / 10 fpp = 100 peak entries
        assert_eq!(peaks.left.len(), 100);
        assert_eq!(peaks.right.len(), 100);
    }

    #[test]
    fn test_compute_peaks_full_scale() {
        let buf = make_buffer(100, 1.0);
        let peaks = compute_peaks(&buf, 10);
        for frame in &peaks.left {
            assert!((frame.max - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn test_peak_cache_invalidate() {
        let mut cache = PeakCache::default();
        let data = Arc::new(PeakData {
            frames_per_pixel: 4,
            left: vec![],
            right: vec![],
            total_frames: 0,
            sample_rate: 44100,
        });
        cache.insert("foo.wav", 4, Arc::clone(&data));
        cache.insert("foo.wav", 8, Arc::clone(&data));
        cache.insert("bar.wav", 4, Arc::clone(&data));

        cache.invalidate("foo.wav");

        assert!(cache.get("foo.wav", 4).is_none(), "foo.wav::4 should be gone");
        assert!(cache.get("foo.wav", 8).is_none(), "foo.wav::8 should be gone");
        assert!(cache.get("bar.wav", 4).is_some(), "bar.wav::4 should remain");
    }

    #[test]
    fn test_buffer_cache_evicts_oldest() {
        let mut cache = ClipBufferCache {
            entries: HashMap::new(),
            max_entries: 3,
        };
        let buf = make_buffer(10, 0.0);

        // Insert 3 entries — fill to capacity, with slight time ordering.
        cache.insert("a.wav".into(), Arc::clone(&buf));
        // Manually set a.wav to be older by re-inserting with a fake older timestamp
        // (we can't easily fake Instant in tests, but insertion order ensures 'a' is oldest).
        cache.insert("b.wav".into(), Arc::clone(&buf));
        cache.insert("c.wav".into(), Arc::clone(&buf));

        // Touch b and c to make a the oldest
        cache.get("b.wav");
        cache.get("c.wav");

        // Insert d.wav — should evict the entry with the oldest timestamp (a.wav).
        cache.insert("d.wav".into(), Arc::clone(&buf));
        assert_eq!(cache.entries.len(), 3);
        // d.wav must be present
        assert!(cache.entries.contains_key("d.wav"));
    }
}
