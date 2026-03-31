# Sprint 42 Postmortem: Sub-Group Bus Routing

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 42 |
| Completed | 2026-03-31 |
| Files Changed | 16 (9 new, 7 modified) |
| Rust Tests Added | 20 (routing: 14, group_bus: 6) |
| TS Tests Added | 20 (groupBusStore: 8, OutputSelector: 5, GroupBusStrip: 7) |

## What Went Well

- `RoutingGraph` DFS cycle detection cleanly reused for both topological sort and max-depth enforcement.
- Pre-allocating `input_accumulator` and `output_scratch` at bus creation means zero heap allocation on the audio thread.
- `split_at_mut` pattern for group-to-group scatter solved the borrow aliasing problem without unsafe code.
- `group_scratch` copy buffer to break input/output aliasing in `GroupBus::process` kept the API clean.
- All 20 TS tests and 624 Rust tests passed on first run after implementation.

## What Could Improve

- The `output_target` field exists both on `GroupBus` (as `Arc<AtomicU8>`) and the inner `MixerChannel` (also `Arc<AtomicU8>`), but they are separate atomics. Only the `GroupBus` one is used by the audio engine routing logic — the inner one is unused for group buses. This is a minor redundancy.

## Blockers Encountered

- None. The borrow aliasing challenge with group-to-group scatter was anticipated and resolved cleanly.

## Technical Insights

- `OutputTarget` encoded as `u8` (0=Master, 1–8=Group 0–7) allows lock-free reads on the audio thread via `Arc<AtomicU8>`.
- Topological sort (DFS post-order + reverse) ensures each group bus receives all its contributions before it processes, enabling correct multi-level nesting (max depth 4).
- The `group_scratch` intermediate copy avoids a double-mutable-borrow of `self.group_buses[i].input_accumulator` and `self.group_buses[i].output_scratch` in the same loop body.

## Process Insights

- Splitting the borrow aliasing problem into two sub-problems (input-copy via `group_scratch`, scatter-copy via `split_at_mut`) kept the complexity manageable.

## Patterns Discovered

```rust
// Copy accumulator to avoid aliasing, then process
let n = frame_count * 2;
self.group_scratch[..n].copy_from_slice(&self.group_buses[i].input_accumulator[..n]);
self.group_buses[i].process(&self.group_scratch[..n], send_bufs, solo_any);

// Scatter bus output to another bus using split_at_mut
if bus_pos < dst_pos {
    let (left, right) = self.group_buses.split_at_mut(dst_pos);
    for j in 0..n { right[0].input_accumulator[j] += left[bus_pos].output_scratch[j]; }
}
```

## Action Items for Next Sprint

- [ ] Sprint 45: Audio Clip Fades — fade-in/out envelopes on audio clips in the arrangement timeline.

## Notes

- Group bus peak metering events (`GroupBusLevelEvent`) are emitted via `group_bus_level_tx` sender on the `Mixer`; the frontend hooks this up via `hydrateGroupBuses` + `applyGroupBusLevel` in the mixer store.
