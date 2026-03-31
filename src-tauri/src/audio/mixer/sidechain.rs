//! `SidechainRouter` — manages cross-channel sidechain routing assignments.
//!
//! Maintains a mapping of `(dest_channel_id, slot_id)` → `Arc<SidechainTap>`
//! for the audio engine and validates routing graphs for cycles.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::effects::sidechain::SidechainTap;

/// Key uniquely identifying a sidechain connection destination:
/// the channel that owns the compressor, and the effect slot's ID.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SidechainKey {
    pub dest_channel_id: String,
    pub slot_id:         String,
}

/// One registered sidechain connection.
#[derive(Clone)]
pub struct SidechainEntry {
    /// Channel whose post-fader audio feeds the detector.
    pub source_channel_id: String,
    /// Shared tap buffer written by the source channel each callback.
    pub tap: Arc<SidechainTap>,
    /// High-pass filter cutoff frequency in Hz (20–500 Hz).
    pub hpf_cutoff_hz: f32,
    /// Whether the HPF is active.
    pub hpf_enabled: bool,
}

/// Registry of all active sidechain connections.
///
/// Lives on the control thread; the audio thread accesses entries via the
/// `Arc<SidechainTap>` it already holds as part of each `Compressor` slot.
pub struct SidechainRouter {
    /// Map from (dest_channel, slot_id) → entry.
    entries: HashMap<SidechainKey, SidechainEntry>,
    /// Map from channel_id → its tap (allocated once per channel, shared).
    channel_taps: HashMap<String, Arc<SidechainTap>>,
}

impl SidechainRouter {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            channel_taps: HashMap::new(),
        }
    }

    /// Returns the tap for `channel_id`, creating it if not present.
    pub fn get_or_create_tap(&mut self, channel_id: &str) -> Arc<SidechainTap> {
        self.channel_taps
            .entry(channel_id.to_owned())
            .or_insert_with(SidechainTap::new)
            .clone()
    }

    /// Returns the tap for `channel_id` without creating it.
    pub fn get_tap(&self, channel_id: &str) -> Option<Arc<SidechainTap>> {
        self.channel_taps.get(channel_id).cloned()
    }

    /// Removes the tap for a deleted channel and clears any routes that
    /// referenced it as a source, preventing dangling references.
    pub fn remove_channel(&mut self, channel_id: &str) {
        self.channel_taps.remove(channel_id);
        self.entries.retain(|_, e| e.source_channel_id != channel_id);
    }

    /// Adds or replaces a sidechain route from `source_channel_id` to the
    /// compressor at `(dest_channel_id, slot_id)`.
    ///
    /// Returns `Ok(Arc<SidechainTap>)` with the tap the compressor should read,
    /// or `Err(String)` if the route would create a cycle.
    pub fn set_route(
        &mut self,
        dest_channel_id: String,
        slot_id:         String,
        source_channel_id: String,
        hpf_cutoff_hz:   f32,
        hpf_enabled:     bool,
    ) -> Result<Arc<SidechainTap>, String> {
        // Detect cycle: would connecting source → dest create a loop?
        if self.creates_cycle(&dest_channel_id, &source_channel_id) {
            return Err(format!(
                "Cyclic sidechain routing: connecting '{}' → '{}' would create a cycle",
                source_channel_id, dest_channel_id
            ));
        }

        let tap = self.get_or_create_tap(&source_channel_id);

        let key = SidechainKey { dest_channel_id, slot_id };
        self.entries.insert(key, SidechainEntry {
            source_channel_id,
            tap: tap.clone(),
            hpf_cutoff_hz,
            hpf_enabled,
        });

        Ok(tap)
    }

    /// Removes a sidechain route for the given destination key.
    pub fn remove_route(&mut self, dest_channel_id: &str, slot_id: &str) {
        let key = SidechainKey {
            dest_channel_id: dest_channel_id.to_owned(),
            slot_id:         slot_id.to_owned(),
        };
        self.entries.remove(&key);
    }

    /// Updates HPF settings for an existing route.
    pub fn set_filter(
        &mut self,
        dest_channel_id: &str,
        slot_id:         &str,
        cutoff_hz:       f32,
        enabled:         bool,
    ) -> Result<(), String> {
        let key = SidechainKey {
            dest_channel_id: dest_channel_id.to_owned(),
            slot_id:         slot_id.to_owned(),
        };
        let entry = self.entries.get_mut(&key)
            .ok_or_else(|| format!(
                "No sidechain route found for channel '{}' slot '{}'",
                dest_channel_id, slot_id
            ))?;
        entry.hpf_cutoff_hz = cutoff_hz.clamp(20.0, 500.0);
        entry.hpf_enabled   = enabled;
        Ok(())
    }

    /// Returns the entry for a given destination, if it exists.
    pub fn get_entry(&self, dest_channel_id: &str, slot_id: &str) -> Option<&SidechainEntry> {
        let key = SidechainKey {
            dest_channel_id: dest_channel_id.to_owned(),
            slot_id:         slot_id.to_owned(),
        };
        self.entries.get(&key)
    }

    /// Returns a snapshot of all current routes for serialization.
    pub fn all_entries(&self) -> Vec<(SidechainKey, &SidechainEntry)> {
        self.entries.iter().map(|(k, e)| (k.clone(), e)).collect()
    }

    /// DFS cycle detection: returns true if adding source → dest would form a cycle.
    ///
    /// Follows the chain: dest → sources_that_dest_already_receives_from →
    /// their sources → ... and checks if `source_channel_id` is reachable.
    fn creates_cycle(&self, dest_channel_id: &str, source_channel_id: &str) -> bool {
        if dest_channel_id == source_channel_id {
            return true;
        }

        // Build a map: channel_id → set of channel_ids it receives sidechain from.
        let mut receives_from: HashMap<&str, Vec<&str>> = HashMap::new();
        for (key, entry) in &self.entries {
            receives_from
                .entry(key.dest_channel_id.as_str())
                .or_default()
                .push(entry.source_channel_id.as_str());
        }

        // DFS from `source_channel_id` following "receives from" edges.
        // If we reach `dest_channel_id`, adding the new edge would create a cycle.
        let mut visited: HashSet<&str> = HashSet::new();
        let mut stack: Vec<&str> = vec![source_channel_id];

        while let Some(node) = stack.pop() {
            if node == dest_channel_id {
                return true;
            }
            if !visited.insert(node) {
                continue;
            }
            if let Some(sources) = receives_from.get(node) {
                stack.extend(sources.iter().copied());
            }
        }

        false
    }
}

impl Default for SidechainRouter {
    fn default() -> Self {
        Self::new()
    }
}

/// Tauri managed type.
pub type SidechainRouterStore = std::sync::Arc<std::sync::Mutex<SidechainRouter>>;

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_route_returns_tap() {
        let mut router = SidechainRouter::new();
        let result = router.set_route(
            "bass".to_owned(), "slot-1".to_owned(),
            "kick".to_owned(), 100.0, true,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn direct_cycle_is_rejected() {
        let mut router = SidechainRouter::new();
        // A → B
        router.set_route("B".to_owned(), "s1".to_owned(), "A".to_owned(), 100.0, true).unwrap();
        // B → A: would create A → B → A
        let result = router.set_route("A".to_owned(), "s2".to_owned(), "B".to_owned(), 100.0, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cycle"));
    }

    #[test]
    fn self_sidechain_is_rejected() {
        let mut router = SidechainRouter::new();
        // A → A
        let result = router.set_route("A".to_owned(), "s1".to_owned(), "A".to_owned(), 100.0, true);
        assert!(result.is_err());
    }

    #[test]
    fn transitive_cycle_is_rejected() {
        let mut router = SidechainRouter::new();
        // A → B → C → A would be a cycle; set A→B and B→C first
        router.set_route("B".to_owned(), "s1".to_owned(), "A".to_owned(), 100.0, true).unwrap();
        router.set_route("C".to_owned(), "s2".to_owned(), "B".to_owned(), 100.0, true).unwrap();
        // Now try C → A (closes the loop A→B→C→A)
        let result = router.set_route("A".to_owned(), "s3".to_owned(), "C".to_owned(), 100.0, true);
        assert!(result.is_err());
    }

    #[test]
    fn remove_route_clears_entry() {
        let mut router = SidechainRouter::new();
        router.set_route("bass".to_owned(), "s1".to_owned(), "kick".to_owned(), 100.0, true).unwrap();
        router.remove_route("bass", "s1");
        assert!(router.get_entry("bass", "s1").is_none());
    }

    #[test]
    fn remove_channel_clears_related_routes() {
        let mut router = SidechainRouter::new();
        router.set_route("bass".to_owned(), "s1".to_owned(), "kick".to_owned(), 100.0, true).unwrap();
        router.remove_channel("kick");
        assert!(router.get_entry("bass", "s1").is_none());
    }

    #[test]
    fn set_filter_updates_entry() {
        let mut router = SidechainRouter::new();
        router.set_route("bass".to_owned(), "s1".to_owned(), "kick".to_owned(), 100.0, true).unwrap();
        router.set_filter("bass", "s1", 200.0, false).unwrap();
        let e = router.get_entry("bass", "s1").unwrap();
        assert!((e.hpf_cutoff_hz - 200.0).abs() < 0.001);
        assert!(!e.hpf_enabled);
    }

    #[test]
    fn tap_is_shared_between_entries() {
        let mut router = SidechainRouter::new();
        let tap1 = router.set_route("bass".to_owned(), "s1".to_owned(), "kick".to_owned(), 100.0, true).unwrap();
        let tap2 = router.set_route("pad".to_owned(), "s2".to_owned(), "kick".to_owned(), 100.0, true).unwrap();
        // Both should share the same Arc (same underlying kick tap)
        assert!(Arc::ptr_eq(&tap1, &tap2));
    }
}
