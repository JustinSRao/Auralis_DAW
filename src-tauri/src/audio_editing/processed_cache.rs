//! LRU cache for time-stretched / pitch-shifted `SampleBuffer` objects (Sprint 16).
//!
//! Follows the same pattern as [`ClipBufferCache`] in `peak_cache.rs`.
//! Maximum capacity is 16 entries; the entry with the oldest `last_accessed`
//! timestamp is evicted when the cache is full.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::instruments::sampler::decoder::SampleBuffer;

// ---------------------------------------------------------------------------
// ProcessedBufferCache
// ---------------------------------------------------------------------------

/// In-memory LRU cache for processed (time-stretched / pitch-shifted)
/// `SampleBuffer` objects.
///
/// Cache keys are built with [`ProcessedBufferCache::cache_key`] to encode the
/// clip identity and both processing parameters into a single string.
pub struct ProcessedBufferCache {
    entries: HashMap<String, (Arc<SampleBuffer>, Instant)>,
    max_entries: usize,
}

impl ProcessedBufferCache {
    /// Creates a new cache with a maximum of 16 entries.
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            max_entries: 16,
        }
    }

    /// Builds a deterministic cache key from the three differentiating dimensions.
    ///
    /// `stretch_ratio` is encoded via `f32::to_bits()` so that bit-identical
    /// floats produce identical strings — no floating-point comparison needed.
    pub fn cache_key(clip_id: &str, stretch_ratio: f32, pitch_semitones: i8) -> String {
        format!("{}::{}::{}", clip_id, stretch_ratio.to_bits(), pitch_semitones)
    }

    /// Returns a cached buffer, updating its last-access timestamp.
    pub fn get(&mut self, key: &str) -> Option<Arc<SampleBuffer>> {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.1 = Instant::now();
            Some(Arc::clone(&entry.0))
        } else {
            None
        }
    }

    /// Inserts a buffer. Evicts the oldest entry when the cache is at capacity.
    pub fn insert(&mut self, key: String, buffer: Arc<SampleBuffer>) {
        // Already present — update in-place.
        if self.entries.contains_key(&key) {
            self.entries.insert(key, (buffer, Instant::now()));
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

        self.entries.insert(key, (buffer, Instant::now()));
    }

    /// Removes all entries whose key starts with `"<clip_id>::"`.
    ///
    /// Call this when a clip's source audio changes (e.g. after baking).
    pub fn invalidate_clip(&mut self, clip_id: &str) {
        let prefix = format!("{clip_id}::");
        self.entries.retain(|k, _| !k.starts_with(&prefix));
    }
}

// ---------------------------------------------------------------------------
// Managed state type alias
// ---------------------------------------------------------------------------

/// Tauri managed state for the processed buffer cache.
pub type ProcessedBufferCacheState = Arc<Mutex<ProcessedBufferCache>>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_buffer(frames: usize) -> Arc<SampleBuffer> {
        let samples = vec![0.0f32; frames * 2];
        Arc::new(SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: frames,
        })
    }

    #[test]
    fn test_cache_key_determinism() {
        let k1 = ProcessedBufferCache::cache_key("clip-1", 1.5, -3);
        let k2 = ProcessedBufferCache::cache_key("clip-1", 1.5, -3);
        assert_eq!(k1, k2, "same inputs must produce the same key");

        let k3 = ProcessedBufferCache::cache_key("clip-1", 1.5, 0);
        assert_ne!(k1, k3, "different semitones must produce different keys");

        let k4 = ProcessedBufferCache::cache_key("clip-2", 1.5, -3);
        assert_ne!(k1, k4, "different clip ids must produce different keys");
    }

    #[test]
    fn test_insert_and_get() {
        let mut cache = ProcessedBufferCache::new();
        let buf = make_buffer(100);
        let key = ProcessedBufferCache::cache_key("clip-a", 1.25, 0);

        assert!(cache.get(&key).is_none(), "should be empty initially");

        cache.insert(key.clone(), Arc::clone(&buf));

        let fetched = cache.get(&key);
        assert!(fetched.is_some(), "should be retrievable after insert");
        assert_eq!(fetched.unwrap().frame_count, 100);
    }

    #[test]
    fn test_lru_eviction_at_16_entries() {
        let mut cache = ProcessedBufferCache::new();
        let buf = make_buffer(10);

        // Fill to capacity with 16 entries
        for i in 0..16 {
            let key = ProcessedBufferCache::cache_key(&format!("clip-{i}"), 1.0, 0);
            cache.insert(key, Arc::clone(&buf));
        }
        assert_eq!(cache.entries.len(), 16);

        // Touch entries 1..15 to ensure clip-0 is oldest
        for i in 1..16 {
            let key = ProcessedBufferCache::cache_key(&format!("clip-{i}"), 1.0, 0);
            cache.get(&key);
        }

        // Insert a 17th entry — should evict clip-0 (oldest)
        let new_key = ProcessedBufferCache::cache_key("clip-new", 1.0, 0);
        cache.insert(new_key.clone(), Arc::clone(&buf));

        assert_eq!(cache.entries.len(), 16, "still at capacity after eviction");
        assert!(cache.entries.contains_key(&new_key), "new entry must be present");

        let old_key = ProcessedBufferCache::cache_key("clip-0", 1.0, 0);
        assert!(
            !cache.entries.contains_key(&old_key),
            "oldest entry (clip-0) must have been evicted"
        );
    }

    #[test]
    fn test_invalidate_clip() {
        let mut cache = ProcessedBufferCache::new();
        let buf = make_buffer(10);

        cache.insert(
            ProcessedBufferCache::cache_key("clip-x", 1.0, 0),
            Arc::clone(&buf),
        );
        cache.insert(
            ProcessedBufferCache::cache_key("clip-x", 1.5, 6),
            Arc::clone(&buf),
        );
        cache.insert(
            ProcessedBufferCache::cache_key("clip-y", 1.0, 0),
            Arc::clone(&buf),
        );

        cache.invalidate_clip("clip-x");

        let k1 = ProcessedBufferCache::cache_key("clip-x", 1.0, 0);
        let k2 = ProcessedBufferCache::cache_key("clip-x", 1.5, 6);
        let k3 = ProcessedBufferCache::cache_key("clip-y", 1.0, 0);

        assert!(cache.entries.get(&k1).is_none(), "clip-x entry 1 should be gone");
        assert!(cache.entries.get(&k2).is_none(), "clip-x entry 2 should be gone");
        assert!(cache.entries.get(&k3).is_some(), "clip-y should remain");
    }
}
