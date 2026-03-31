//! Group bus routing graph — cycle detection and topological sort (Sprint 42).
//!
//! All operations run on the **command thread** only; the audio thread reads
//! the pre-computed `sorted_bus_order` stored directly on `Mixer` (which is
//! already behind an `Arc<Mutex<>>` shared with the audio callback).
//!
//! ## OutputTarget encoding as `u8`
//!
//! | value | meaning           |
//! |-------|-------------------|
//! | 0     | `Master`          |
//! | 1–8   | `Group(id)` where `id = value - 1` |
//!
//! This lets `MixerChannel::output_target` be an `Arc<AtomicU8>` with no
//! heap allocation for the common case.

use std::collections::{HashMap, HashSet};

/// Identifies a group bus (0–7).
pub type GroupBusId = u8;

/// Maximum number of group buses the mixer supports.
pub const MAX_GROUP_BUSES: usize = 8;

/// Maximum nesting depth for group-bus chains.
///
/// A chain longer than this is rejected by `RoutingGraph::assign_bus_output`
/// to keep the UI comprehensible and bound topological sort complexity.
pub const MAX_NESTING_DEPTH: usize = 4;

/// Where a mixer channel or group bus sends its processed audio.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OutputTarget {
    /// Route directly to the master bus.
    Master,
    /// Route into a group bus identified by `GroupBusId` (0–7).
    Group(GroupBusId),
}

impl OutputTarget {
    /// Decodes the `u8` stored in an `AtomicU8`: 0 → `Master`, N → `Group(N-1)`.
    #[inline]
    pub fn from_u8(v: u8) -> Self {
        if v == 0 {
            OutputTarget::Master
        } else {
            OutputTarget::Group(v - 1)
        }
    }

    /// Encodes `self` as a `u8` suitable for an `AtomicU8`.
    #[inline]
    pub fn to_u8(self) -> u8 {
        match self {
            OutputTarget::Master => 0,
            OutputTarget::Group(id) => id + 1,
        }
    }
}

/// Routing graph for group buses (command-thread only).
///
/// Tracks where each group bus sends its output so cycle detection and
/// topological sort can be performed before mutating the live audio state.
pub struct RoutingGraph {
    /// Maps `GroupBusId → OutputTarget` for each registered group bus.
    bus_outputs: HashMap<GroupBusId, OutputTarget>,
}

impl RoutingGraph {
    /// Creates an empty routing graph.
    pub fn new() -> Self {
        Self {
            bus_outputs: HashMap::new(),
        }
    }

    /// Registers a new group bus with output defaulting to `Master`.
    pub fn add_bus(&mut self, id: GroupBusId) {
        self.bus_outputs.insert(id, OutputTarget::Master);
    }

    /// Removes a group bus from the graph.
    pub fn remove_bus(&mut self, id: GroupBusId) {
        self.bus_outputs.remove(&id);
        // Redirect any buses that pointed to the removed bus back to Master.
        for target in self.bus_outputs.values_mut() {
            if *target == OutputTarget::Group(id) {
                *target = OutputTarget::Master;
            }
        }
    }

    /// Returns the current output target for a bus, or `None` if not registered.
    pub fn get_bus_output(&self, id: GroupBusId) -> Option<OutputTarget> {
        self.bus_outputs.get(&id).copied()
    }

    /// Attempts to assign `new_target` as the output for `bus_id`.
    ///
    /// Rejects with an error string if:
    /// - The assignment would create a routing cycle.
    /// - The resulting chain depth would exceed `MAX_NESTING_DEPTH`.
    pub fn assign_bus_output(
        &mut self,
        bus_id: GroupBusId,
        new_target: OutputTarget,
    ) -> Result<(), String> {
        // Temporarily assign to check for cycle / depth.
        let old = self.bus_outputs.insert(bus_id, new_target);

        if self.detect_cycle() {
            // Roll back.
            match old {
                Some(t) => { self.bus_outputs.insert(bus_id, t); }
                None => { self.bus_outputs.remove(&bus_id); }
            }
            return Err(format!(
                "Routing cycle detected: assigning bus {} to {:?} would create a cycle",
                bus_id, new_target
            ));
        }

        if self.chain_depth(bus_id) > MAX_NESTING_DEPTH {
            match old {
                Some(t) => { self.bus_outputs.insert(bus_id, t); }
                None => { self.bus_outputs.remove(&bus_id); }
            }
            return Err(format!(
                "Maximum nesting depth ({}) exceeded", MAX_NESTING_DEPTH
            ));
        }

        Ok(())
    }

    /// Returns `true` if the current graph contains a cycle.
    ///
    /// Uses iterative DFS with a recursion stack to detect back edges.
    pub fn detect_cycle(&self) -> bool {
        let mut visited: HashSet<GroupBusId> = HashSet::new();
        let mut rec_stack: HashSet<GroupBusId> = HashSet::new();
        for &id in self.bus_outputs.keys() {
            if self.dfs_cycle(id, &mut visited, &mut rec_stack) {
                return true;
            }
        }
        false
    }

    fn dfs_cycle(
        &self,
        id: GroupBusId,
        visited: &mut HashSet<GroupBusId>,
        rec_stack: &mut HashSet<GroupBusId>,
    ) -> bool {
        if rec_stack.contains(&id) {
            return true;
        }
        if visited.contains(&id) {
            return false;
        }
        visited.insert(id);
        rec_stack.insert(id);
        if let Some(&OutputTarget::Group(next)) = self.bus_outputs.get(&id) {
            if self.dfs_cycle(next, visited, rec_stack) {
                return true;
            }
        }
        rec_stack.remove(&id);
        false
    }

    /// Returns the chain depth starting from `bus_id` (1 = routes to Master).
    fn chain_depth(&self, start: GroupBusId) -> usize {
        let mut depth = 0;
        let mut current = start;
        loop {
            depth += 1;
            if depth > MAX_NESTING_DEPTH + 1 {
                break; // guard against cycles (should not happen post-check)
            }
            match self.bus_outputs.get(&current).copied() {
                Some(OutputTarget::Group(next)) => current = next,
                _ => break,
            }
        }
        depth
    }

    /// Returns bus IDs sorted in topological order (sources before destinations).
    ///
    /// Buses that ultimately reach Master appear in dependency order so the
    /// mixer can evaluate them sequentially without any bus reading stale output
    /// from a downstream bus that hasn't run yet.
    pub fn topological_sort(&self, all_bus_ids: &[GroupBusId]) -> Vec<GroupBusId> {
        let mut visited: HashSet<GroupBusId> = HashSet::new();
        let mut result: Vec<GroupBusId> = Vec::new();
        for &id in all_bus_ids {
            self.dfs_topo(id, &mut visited, &mut result);
        }
        result.reverse();
        result
    }

    fn dfs_topo(
        &self,
        id: GroupBusId,
        visited: &mut HashSet<GroupBusId>,
        result: &mut Vec<GroupBusId>,
    ) {
        if visited.contains(&id) {
            return;
        }
        visited.insert(id);
        if let Some(&OutputTarget::Group(next)) = self.bus_outputs.get(&id) {
            // Only recurse if the next bus is also in our graph.
            if self.bus_outputs.contains_key(&next) {
                self.dfs_topo(next, visited, result);
            }
        }
        result.push(id);
    }
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_graph(pairs: &[(GroupBusId, OutputTarget)]) -> RoutingGraph {
        let mut g = RoutingGraph::new();
        for &(id, _) in pairs {
            g.add_bus(id);
        }
        for &(id, target) in pairs {
            g.bus_outputs.insert(id, target);
        }
        g
    }

    // ── detect_cycle ──────────────────────────────────────────────────────────

    #[test]
    fn no_cycle_single_bus_to_master() {
        let g = make_graph(&[(0, OutputTarget::Master)]);
        assert!(!g.detect_cycle());
    }

    #[test]
    fn no_cycle_linear_chain() {
        // 0 → 1 → 2 → Master
        let g = make_graph(&[
            (0, OutputTarget::Group(1)),
            (1, OutputTarget::Group(2)),
            (2, OutputTarget::Master),
        ]);
        assert!(!g.detect_cycle());
    }

    #[test]
    fn no_cycle_diamond() {
        // 0 → 2, 1 → 2, 2 → Master
        let g = make_graph(&[
            (0, OutputTarget::Group(2)),
            (1, OutputTarget::Group(2)),
            (2, OutputTarget::Master),
        ]);
        assert!(!g.detect_cycle());
    }

    #[test]
    fn cycle_self_loop() {
        let g = make_graph(&[(0, OutputTarget::Group(0))]);
        assert!(g.detect_cycle());
    }

    #[test]
    fn cycle_two_node_mutual() {
        let g = make_graph(&[
            (0, OutputTarget::Group(1)),
            (1, OutputTarget::Group(0)),
        ]);
        assert!(g.detect_cycle());
    }

    #[test]
    fn cycle_three_node() {
        let g = make_graph(&[
            (0, OutputTarget::Group(1)),
            (1, OutputTarget::Group(2)),
            (2, OutputTarget::Group(0)),
        ]);
        assert!(g.detect_cycle());
    }

    // ── assign_bus_output ─────────────────────────────────────────────────────

    #[test]
    fn assign_rejects_cycle() {
        let mut g = RoutingGraph::new();
        g.add_bus(0);
        g.add_bus(1);
        g.assign_bus_output(0, OutputTarget::Group(1)).unwrap();
        let result = g.assign_bus_output(1, OutputTarget::Group(0));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cycle"));
    }

    #[test]
    fn assign_accepts_valid() {
        let mut g = RoutingGraph::new();
        g.add_bus(0);
        g.add_bus(1);
        g.assign_bus_output(0, OutputTarget::Master).unwrap();
        g.assign_bus_output(1, OutputTarget::Group(0)).unwrap();
        assert!(!g.detect_cycle());
    }

    // ── topological_sort ──────────────────────────────────────────────────────

    #[test]
    fn topo_single_bus() {
        let g = make_graph(&[(0, OutputTarget::Master)]);
        let order = g.topological_sort(&[0]);
        assert_eq!(order, vec![0]);
    }

    #[test]
    fn topo_two_buses_with_dependency() {
        // Bus 0 routes to Bus 1 (so 0 must be processed before 1)
        let g = make_graph(&[
            (0, OutputTarget::Group(1)),
            (1, OutputTarget::Master),
        ]);
        let order = g.topological_sort(&[0, 1]);
        let pos0 = order.iter().position(|&x| x == 0).unwrap();
        let pos1 = order.iter().position(|&x| x == 1).unwrap();
        assert!(pos0 < pos1, "bus 0 must come before bus 1");
    }

    #[test]
    fn topo_independent_buses() {
        let g = make_graph(&[
            (0, OutputTarget::Master),
            (1, OutputTarget::Master),
            (2, OutputTarget::Master),
        ]);
        let order = g.topological_sort(&[0, 1, 2]);
        assert_eq!(order.len(), 3);
    }

    #[test]
    fn topo_max_nesting_depth() {
        // 0 → 1 → 2 → 3 → Master (depth 4)
        let g = make_graph(&[
            (0, OutputTarget::Group(1)),
            (1, OutputTarget::Group(2)),
            (2, OutputTarget::Group(3)),
            (3, OutputTarget::Master),
        ]);
        let order = g.topological_sort(&[0, 1, 2, 3]);
        assert_eq!(order.len(), 4);
        assert_eq!(order[0], 0);
        assert_eq!(order[3], 3);
    }
}
