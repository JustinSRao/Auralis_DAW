//! Take lane data structures for loop recording.
//!
//! A [`TakeLane`] belongs to a DAW track and holds all [`Take`]s recorded
//! during loop recording sessions. [`CompRegion`]s allow selecting different
//! takes for different time ranges (comping).
//!
//! All mutation is done from the Tauri main thread via IPC commands or the
//! loop record watcher task. The audio thread never touches these structs.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

/// A single recorded loop pass (one take).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Take {
    /// Unique ID for this take (UUID v4).
    pub id: String,
    /// ID of the pattern holding this take's MIDI notes.
    pub pattern_id: String,
    /// 1-indexed take number within the lane.
    pub take_number: u32,
    /// Track this take belongs to.
    pub track_id: String,
    /// Loop start in beats when this take was recorded.
    pub loop_start_beats: f64,
    /// Loop end in beats when this take was recorded.
    pub loop_end_beats: f64,
    /// Whether this take is the currently selected playback source.
    pub is_active: bool,
}

/// A comp region selects a time sub-range from a specific take for playback.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompRegion {
    pub id: String,
    pub start_beats: f64,
    pub end_beats: f64,
    pub take_id: String,
}

/// All takes and comp regions for one track.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TakeLane {
    pub track_id: String,
    pub takes: Vec<Take>,
    #[serde(default)]
    pub comp_regions: Vec<CompRegion>,
    /// Whether the take lane panel is expanded in the UI.
    #[serde(default)]
    pub expanded: bool,
}

impl TakeLane {
    pub fn new(track_id: String) -> Self {
        TakeLane { track_id, takes: Vec::new(), comp_regions: Vec::new(), expanded: true }
    }

    /// Adds a take, deactivating all previous takes, and returns the new take count.
    pub fn add_take(&mut self, take: Take) -> usize {
        // Deactivate all existing takes when a new one arrives — newest is active by default
        for t in &mut self.takes {
            t.is_active = false;
        }
        self.takes.push(take);
        // Mark newly added take as active
        if let Some(last) = self.takes.last_mut() {
            last.is_active = true;
        }
        self.takes.len()
    }

    /// Sets one take as active, deactivating all others.
    pub fn set_active_take(&mut self, take_id: &str) -> bool {
        let found = self.takes.iter().any(|t| t.id == take_id);
        if found {
            for t in &mut self.takes {
                t.is_active = t.id == take_id;
            }
        }
        found
    }

    /// Removes a take by ID. Returns the take if found.
    pub fn delete_take(&mut self, take_id: &str) -> Option<Take> {
        if let Some(pos) = self.takes.iter().position(|t| t.id == take_id) {
            let removed = self.takes.remove(pos);
            // If removed was active, activate the previous (or last) take
            let none_active = !self.takes.iter().any(|t| t.is_active);
            if none_active {
                if let Some(new_active) = self.takes.last_mut() {
                    new_active.is_active = true;
                }
            }
            // Remove comp regions referencing this take
            self.comp_regions.retain(|r| r.take_id != take_id);
            Some(removed)
        } else {
            None
        }
    }

    /// Returns the currently active take, if any.
    pub fn active_take(&self) -> Option<&Take> {
        self.takes.iter().find(|t| t.is_active)
    }
}

/// All take lanes for the project, keyed by track_id.
#[derive(Debug, Default)]
pub struct TakeLaneStore {
    pub lanes: HashMap<String, TakeLane>,
}

impl TakeLaneStore {
    pub fn get_or_create(&mut self, track_id: &str) -> &mut TakeLane {
        self.lanes.entry(track_id.to_string()).or_insert_with(|| TakeLane::new(track_id.to_string()))
    }

    pub fn add_take(&mut self, track_id: &str, take: Take) {
        self.get_or_create(track_id).add_take(take);
    }
}

pub type TakeLaneStoreState = Arc<Mutex<TakeLaneStore>>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    fn make_take(id: &str, num: u32) -> Take {
        Take {
            id: id.to_string(),
            pattern_id: format!("p-{}", id),
            take_number: num,
            track_id: "track-1".to_string(),
            loop_start_beats: 0.0,
            loop_end_beats: 4.0,
            is_active: false,
        }
    }

    #[test]
    fn new_lane_is_empty() {
        let lane = TakeLane::new("t1".to_string());
        assert!(lane.takes.is_empty());
    }

    #[test]
    fn add_take_marks_newest_active() {
        let mut lane = TakeLane::new("t1".to_string());
        lane.add_take(make_take("a", 1));
        assert!(lane.takes[0].is_active);
        lane.add_take(make_take("b", 2));
        assert!(!lane.takes[0].is_active);
        assert!(lane.takes[1].is_active);
    }

    #[test]
    fn set_active_take_deactivates_others() {
        let mut lane = TakeLane::new("t1".to_string());
        lane.add_take(make_take("a", 1));
        lane.add_take(make_take("b", 2));
        lane.set_active_take("a");
        assert!(lane.takes[0].is_active);
        assert!(!lane.takes[1].is_active);
    }

    #[test]
    fn set_active_take_returns_false_for_unknown_id() {
        let mut lane = TakeLane::new("t1".to_string());
        lane.add_take(make_take("a", 1));
        assert!(!lane.set_active_take("nonexistent"));
    }

    #[test]
    fn delete_take_removes_and_activates_last() {
        let mut lane = TakeLane::new("t1".to_string());
        lane.add_take(make_take("a", 1));
        lane.add_take(make_take("b", 2));
        lane.set_active_take("b");
        lane.delete_take("b");
        assert_eq!(lane.takes.len(), 1);
        assert!(lane.takes[0].is_active);
    }

    #[test]
    fn delete_nonexistent_take_returns_none() {
        let mut lane = TakeLane::new("t1".to_string());
        assert!(lane.delete_take("ghost").is_none());
    }

    #[test]
    fn active_take_returns_correct_take() {
        let mut lane = TakeLane::new("t1".to_string());
        lane.add_take(make_take("a", 1));
        lane.add_take(make_take("b", 2));
        lane.set_active_take("a");
        assert_eq!(lane.active_take().unwrap().id, "a");
    }

    #[test]
    fn take_lane_store_get_or_create() {
        let mut store = TakeLaneStore::default();
        store.add_take("track-1", make_take("a", 1));
        assert_eq!(store.lanes["track-1"].takes.len(), 1);
    }
}
