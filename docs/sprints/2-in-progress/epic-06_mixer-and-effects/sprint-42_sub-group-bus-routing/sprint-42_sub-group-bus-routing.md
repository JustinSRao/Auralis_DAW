---
sprint: 42
title: "Sub-Group Bus Routing"
type: fullstack
epic: 6
status: planning
created: 2026-02-23T17:06:00Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 80
---

# Sprint 42: Sub-Group Bus Routing

## Overview

| Field | Value |
|-------|-------|
| Sprint | 42 |
| Title | Sub-Group Bus Routing |
| Type | fullstack |
| Epic | 6 - Mixer & Effects |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Add group bus channels to the mixer so users can route multiple tracks to a shared bus (e.g., "Drums Bus", "Vocals Bus") for collective processing before the master, enabling standard mixing workflows like bus compression and group EQ.

## Background

Sprint 17 deliberately deferred sub-group routing, noting it as out of scope. The Sprint 17 mixer routes every channel directly to the master bus. In a professional mixing context this is a significant limitation: a producer with 8 drum tracks needs to apply a single compressor to the entire drum group without duplicating compressor settings on every individual channel. Group buses solve this by summing a set of channels into one intermediate bus, which then feeds the master. The group bus also carries a full `MixerChannel` signal chain — fader, pan, mute, solo, and 8 effect insert slots — so engineers can apply group-level EQ or compression before the signal reaches the master.

Without group buses, two workflows are impossible:
1. Bus compression — routing all drum channels to a single compressor insert on the group bus.
2. Group fader rides — automating a single fader to duck the entire drum group without touching individual tracks.

This sprint implements the group bus layer as a first-class mixer construct, preserving the existing Sprint 17 architecture (no breaking changes to `MixerChannel` or `AuxBus`) while adding a new routing layer between individual channels and the master.

## Requirements

### Functional Requirements

- [ ] Users can create up to 8 named group buses (e.g., "Drums", "Vocals", "Guitars", "Synths")
- [ ] Users can delete a group bus; all channels previously routed to it fall back to routing to the master bus
- [ ] Each mixer channel has an `Output` selector control in its channel strip: a dropdown listing "Master" plus all active group buses
- [ ] Changing a channel's output target takes effect immediately without audio interruption
- [ ] Each group bus has a full `MixerChannel`-equivalent signal path: volume fader (0.0-2.0), pan (equal-power, -1.0 to +1.0), mute, solo, and 8 effect insert slots (populated from Sprint 21 effect chain)
- [ ] Group buses support aux send routing (consistent with Sprint 17 `AuxBus` send architecture)
- [ ] Group buses feed into the master bus; the master bus receives the summed output of all group buses plus any channels still routed directly to master
- [ ] Nested group routing: a group bus may target another group bus as its output (e.g., Group A → Group B → Master), enabling hierarchical mixing structures
- [ ] Cycle detection: assigning a group bus output is rejected if it would create a routing cycle; a clear error message is shown to the user
- [ ] Group bus peak levels (L/R) are emitted as Tauri events at 30 Hz for level meters in the UI
- [ ] Group bus configuration (name, output target, fader, pan, mute, solo, effect chain) persists in the project file
- [ ] Tauri commands: `create_group_bus`, `delete_group_bus`, `rename_group_bus`, `set_channel_output`, `set_group_bus_fader`, `set_group_bus_pan`, `set_group_bus_mute`, `set_group_bus_solo`
- [ ] Default output for all new channels is the master bus (preserves Sprint 17 behavior)

### Non-Functional Requirements

- [ ] The mixer graph is evaluated in topological order each audio callback — channels first, then group buses sorted by dependency depth, then master; no cycles are possible at evaluation time
- [ ] Group bus processing adds zero extra latency relative to a direct-to-master path; all summing happens within the same audio callback
- [ ] Changing a channel's output target is transmitted via `crossbeam_channel` and applied at the next audio callback boundary — no mutex taken on the audio thread during the switch
- [ ] Cycle detection runs in O(N + E) time (DFS on the routing graph) and executes only on the command thread when an output assignment changes, never on the audio thread
- [ ] Supports up to 8 group buses and 64 total channels without measurable CPU overhead compared to Sprint 17 baseline (target: < 5% increase in callback wall time)
- [ ] Group bus channel strips render in the React mixer view to the left of the master bus strip, visually distinct from individual channel strips (different background tint)

## Dependencies

- **Sprint 2**: `AudioGraph`, `AudioNode` trait, and the topological evaluation loop that drives the mixer as a composite node
- **Sprint 17**: `Mixer`, `MixerChannel`, `AuxBus`, `MasterBus` — Sprint 42 extends the `Mixer` struct and adds `OutputTarget` to `MixerChannel`; no breaking API changes
- **Sprint 21**: `EffectChain` — group buses own an `EffectChain` instance identical to regular channels; Sprint 21 must be complete for insert slots to be populated, but group buses compile with empty insert slots before Sprint 21
- **Sprint 30**: `Track`, `TrackType`, `TrackId` — channel-to-bus assignment is stored alongside the track record and persisted in the project file; `TrackId` is used as the `MixerChannel` identifier
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio/mixer/group_bus.rs` — `GroupBus` struct (wraps `MixerChannel` signal chain, adds `output_target: OutputTarget`, accumulates input from assigned channels)
- `src-tauri/src/audio/mixer/routing.rs` — `OutputTarget` enum, `RoutingGraph` struct with `assign_output()` and `detect_cycle()` (DFS), `topological_sort()` for group bus evaluation order
- Extension to `src-tauri/src/audio/mixer/channel.rs` — add `output_target: Arc<Mutex<OutputTarget>>` field; mutation sent via crossbeam command, never mutated on audio thread
- Extension to `src-tauri/src/audio/mixer.rs` — add `group_buses: Vec<GroupBus>`, update `process()` to evaluate in topological order, add `create_group_bus` / `delete_group_bus` methods
- Tauri commands in `src-tauri/src/audio/mixer.rs` (or a dedicated `commands/mixer.rs`): `create_group_bus`, `delete_group_bus`, `rename_group_bus`, `set_channel_output`, `set_group_bus_fader`, `set_group_bus_pan`, `set_group_bus_mute`, `set_group_bus_solo`
- Tauri event: `group_bus_level_changed` `{ bus_id, peak_l, peak_r }` emitted at 30 Hz per group bus
- `src/components/mixer/GroupBusStrip.tsx` — React channel strip for a group bus (same fader/pan/mute/solo/meter components as `ChannelStrip` from Sprint 17, visually differentiated)
- `src/components/mixer/OutputSelector.tsx` — dropdown on each `ChannelStrip` listing "Master" and all active group bus names; calls `set_channel_output` IPC command on change
- `src/components/mixer/MixerView.tsx` extension — render group bus strips between channel strips and the master strip; add "Add Group Bus" button
- `src/stores/mixerStore.ts` extension — add `groupBuses: GroupBusState[]`, `createGroupBus()`, `deleteGroupBus()`, `setChannelOutput()` actions
- `src/lib/ipc.ts` extension — typed wrappers for all new Tauri commands
- Rust unit tests: cycle detection with linear chains, branching graphs, and actual cycles; topological sort with 0, 1, and N group buses; `GroupBus` signal summing correctness
- TypeScript component tests: `OutputSelector` renders all bus options; selecting a bus calls correct IPC; `GroupBusStrip` mute/solo buttons dispatch correct commands

### Out of Scope

- Sidechain routing between group buses (Sprint 39 owns sidechain)
- Automation lanes on group bus fader/pan (backlog — automation sprint)
- VCA-style group fader control (backlog — true VCA linking is a separate concept)
- More than 8 group buses (architectural limit; re-evaluate if user research demands more)
- MIDI routing at the group bus level
- Group bus color coding beyond the background tint (backlog)

## Technical Approach

### Data Model

```
OutputTarget enum:
  Master
  Group(GroupBusId)   // GroupBusId = u8 (0–7)

GroupBus struct:
  id: GroupBusId
  name: String
  channel: MixerChannel          // reuses Sprint 17 MixerChannel for signal processing
  output_target: OutputTarget    // where this bus routes to (Master or another Group)
  input_accumulator: Vec<f32>   // summed output from assigned channels, cleared each callback
```

### Signal Flow

```
[Channel A] ─┐
[Channel B] ─┼──► [Drums GroupBus] ──► [Master Bus] ──► Audio Output
[Channel C] ─┘         │ (fader, pan, inserts)
                        │
[Channel D] ──────────► [Master Bus] (direct)
```

Nested example:

```
[Channel A] ──► [Synths GroupBus] ──► [Production GroupBus] ──► [Master Bus]
[Channel B] ──► [Drums GroupBus]  ──► [Production GroupBus]
```

### Audio Thread Evaluation Order

Each audio callback the `Mixer::process()` method:

1. Clears all group bus `input_accumulator` buffers (single `fill(0.0)` pass).
2. Iterates all `MixerChannel` instances. For each channel, applies fader/pan/mute/solo, runs the `EffectChain`, then writes the result into the accumulator of the channel's `OutputTarget` (either the master bus input buffer or a group bus `input_accumulator`).
3. Iterates group buses in **topological order** (computed once on the command thread whenever routing changes, stored as a sorted `Vec<GroupBusId>` behind an `Arc<RwLock>` swapped atomically). For each group bus, it reads its `input_accumulator`, applies its own fader/pan/mute/solo/inserts, and writes into the accumulator of its own `OutputTarget`.
4. Writes the final group bus outputs plus any direct-to-master channels into the master bus input, then applies the master fader.

The topological sort is computed on the command thread and the resulting `Vec<GroupBusId>` is published via an `Arc<AtomicPtr>` double-buffer so the audio thread always reads a consistent, fully-sorted order without taking a lock.

### Cycle Detection

`RoutingGraph::detect_cycle()` performs a standard DFS over the group bus directed graph. It is called on the command thread inside `set_channel_output` and `assign_group_bus_output` before any state mutation. If a cycle is detected, the command returns `Err("Routing cycle detected: ...")` and the Tauri command propagates the error to the frontend as a user-visible notification. The audio thread routing state is never modified when cycle detection fails.

```
detect_cycle(graph: &HashMap<GroupBusId, OutputTarget>) -> bool:
  for each node in graph:
    DFS with visited set and recursion stack
    if a node is visited twice in the same DFS path → cycle detected
```

### Frontend State

`mixerStore` adds:
```typescript
interface GroupBusState {
  id: number;          // GroupBusId (0-7)
  name: string;
  outputTarget: 'master' | number;  // number = GroupBusId
  fader: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  peakL: number;
  peakR: number;
}
```

`OutputSelector` is a Radix UI `Select` populated from `mixerStore.groupBuses`. It is rendered at the bottom of each `ChannelStrip` and each `GroupBusStrip`. On change, it calls `ipc.setChannelOutput(channelId, target)` or `ipc.setGroupBusOutput(busId, target)` and shows a toast notification if the backend returns a cycle error.

### No Breaking Changes to Sprint 17

`MixerChannel` gains one new field: `output_target: Arc<Mutex<OutputTarget>>` initialized to `OutputTarget::Master`. Existing Tauri commands for `set_channel_fader`, `set_channel_pan`, etc. are untouched. The `Mixer::process()` method gains the group bus evaluation step but the channel iteration loop is unchanged in behavior for channels routed to master.

## Tasks

### Phase 1: Planning

- [ ] Draw the full signal flow diagram covering: multi-channel → group bus → nested group bus → master, and annotate where each `MixerChannel` signal chain (fader, pan, inserts) is applied
- [ ] Confirm the topological sort strategy: represent the group bus routing graph as `HashMap<GroupBusId, OutputTarget>` and run Kahn's algorithm (BFS) for sort; use DFS only for cycle detection
- [ ] Decide the double-buffer mechanism for publishing the sorted evaluation order to the audio thread: `Arc<AtomicPtr<Vec<GroupBusId>>>` with `Box::into_raw` / `Box::from_raw` — document this decision and the `unsafe` invariants
- [ ] Review Sprint 17 `MixerChannel` and confirm `output_target` can be added as a new field without modifying existing Tauri command signatures
- [ ] Define the maximum number of nested group levels (propose: 4 levels deep maximum to bound topological sort time and prevent accidental complexity)

### Phase 2: Backend Implementation

- [ ] Define `OutputTarget` enum and `GroupBusId` type alias in `src-tauri/src/audio/mixer/routing.rs`
- [ ] Implement `RoutingGraph` struct with `assign_channel_output()`, `assign_group_output()`, `detect_cycle()` (DFS), and `topological_sort()` (Kahn's algorithm) in `routing.rs`
- [ ] Write unit tests for `detect_cycle()`: linear chain (no cycle), diamond graph (no cycle), single self-loop (cycle), two-node mutual cycle, three-node cycle
- [ ] Write unit tests for `topological_sort()`: single bus, three independent buses, two buses with dependency, maximum nesting depth of 4
- [ ] Implement `GroupBus` struct in `src-tauri/src/audio/mixer/group_bus.rs`: wraps a `MixerChannel` instance, owns `input_accumulator: Vec<f32>`, exposes `accumulate(buffer: &[f32])` and `process(out: &mut [f32])`
- [ ] Write unit tests for `GroupBus::process()`: zero channels routed → silence; two channels routed → summed output; fader at 0.0 → silence; mute active → silence
- [ ] Add `output_target: Arc<Mutex<OutputTarget>>` field to `MixerChannel` (default `OutputTarget::Master`); add `set_output_target()` method that takes a crossbeam command
- [ ] Extend `Mixer` struct to hold `group_buses: Vec<GroupBus>`, `routing_graph: RoutingGraph`, `sorted_bus_order: Arc<AtomicPtr<Vec<GroupBusId>>>`
- [ ] Implement `Mixer::create_group_bus(name: String) -> Result<GroupBusId>` — rejects if 8 buses already exist
- [ ] Implement `Mixer::delete_group_bus(id: GroupBusId)` — reassigns all channels pointing to the deleted bus back to `OutputTarget::Master`, recomputes topology
- [ ] Rewrite `Mixer::process()` to: (1) clear group bus accumulators, (2) route channel outputs to bus or master accumulators, (3) process group buses in topological order, (4) write to master
- [ ] Implement 30 Hz `group_bus_level_changed` event emission inside `Mixer::process()` using the same frame counter pattern as Sprint 17's `channel_level_changed`
- [ ] Implement all Tauri commands: `create_group_bus`, `delete_group_bus`, `rename_group_bus`, `set_channel_output`, `set_group_bus_output`, `set_group_bus_fader`, `set_group_bus_pan`, `set_group_bus_mute`, `set_group_bus_solo`
- [ ] Extend project file serialization to include `group_buses` array and per-channel `output_target` field

### Phase 3: Frontend Implementation

- [ ] Extend `src/lib/ipc.ts` with typed wrappers: `createGroupBus(name: string)`, `deleteGroupBus(id: number)`, `renameGroupBus(id: number, name: string)`, `setChannelOutput(channelId: string, target: 'master' | number)`, `setGroupBusOutput(busId: number, target: 'master' | number)`, `setGroupBusFader(busId: number, value: number)`, `setGroupBusPan(busId: number, value: number)`, `setGroupBusMute(busId: number, muted: boolean)`, `setGroupBusSolo(busId: number, soloed: boolean)`
- [ ] Extend `mixerStore.ts` with `groupBuses: GroupBusState[]`, `createGroupBus()`, `deleteGroupBus()`, `setChannelOutput()`, `setGroupBusOutput()` actions; subscribe to `group_bus_level_changed` Tauri events to update `peakL`/`peakR`
- [ ] Build `OutputSelector.tsx`: Radix UI `Select` listing "Master" and each group bus name; disabled if no group buses exist; shows a Radix UI `Toast` with the backend error message if `set_channel_output` rejects (cycle detected)
- [ ] Build `GroupBusStrip.tsx`: reuses `LevelMeter`, fader, pan knob, mute, solo, and `OutputSelector` components from Sprint 17; styled with a distinct background tint (CSS variable `--color-group-bus-bg`) to visually distinguish from channel strips; renders the bus name as an editable label (double-click to rename, Enter to confirm)
- [ ] Extend `MixerView.tsx`: render `GroupBusStrip` instances between the last channel strip and the master strip; add "Add Group Bus" button (opens a small name-entry popover using Radix UI `Popover`); disable the button when 8 buses already exist
- [ ] Add `OutputSelector` to existing `ChannelStrip.tsx` from Sprint 17 (below the send knob row)
- [ ] Write component test for `OutputSelector`: renders "Master" option when no buses exist; renders bus names when buses are present; selecting a bus calls `ipc.setChannelOutput` with correct arguments; shows error toast when backend returns a cycle error
- [ ] Write component test for `GroupBusStrip`: mute button dispatches `setGroupBusMute`; solo button dispatches `setGroupBusSolo`; fader drag calls `setGroupBusFader`; level meter updates from mock `group_bus_level_changed` event

### Phase 4: Validation

- [ ] Create 3 group buses: "Drums", "Vocals", "Guitars". Route 4 channels to "Drums", 2 to "Vocals", 2 to "Guitars". Adjust each group bus fader independently — confirm only the grouped channels are affected.
- [ ] Apply a compressor insert on the "Drums" group bus — confirm all 4 drum channels pass through the compressor together
- [ ] Mute the "Drums" group bus — all 4 drum channels go silent; other groups are unaffected
- [ ] Solo the "Vocals" group bus — only vocal channels are heard
- [ ] Create a nested route: "Drums" output → "Production" group bus → Master. Adjust the "Production" fader — confirm drums are affected via the nested path
- [ ] Attempt to create a cycle: set "Production" output → "Drums" (which already routes to "Production"). Confirm the backend rejects it and the UI shows an error toast; no crash or audio glitch occurs
- [ ] Delete the "Drums" group bus — the 4 drum channels automatically route to Master; audio is uninterrupted
- [ ] Save the project, close, reload — all group bus assignments, names, faders, pans, and mute/solo states are restored
- [ ] Profile audio callback with 8 group buses and 64 channels active — confirm callback wall time increase is under 5% compared to Sprint 17 baseline with the same channel count routed directly to master

### Phase 5: Documentation

- [ ] Rustdoc on `GroupBus`, `OutputTarget`, `RoutingGraph`, `Mixer::create_group_bus`, `Mixer::delete_group_bus`, `Mixer::process` — document topological evaluation order and the `unsafe` invariants on the atomic pointer double-buffer
- [ ] Document the cycle detection algorithm in a rustdoc comment on `RoutingGraph::detect_cycle()` with an example graph
- [ ] TSDoc on `GroupBusStrip`, `OutputSelector`, and the `GroupBusState` interface
- [ ] Add an inline comment in `Mixer::process()` labeling each of the four evaluation phases (clear, channel route, group process, master sum)
- [ ] Update project file format documentation (in Sprint 4's or Sprint 17's notes) to document the new `group_buses` and per-channel `output_target` fields

## Acceptance Criteria

- [ ] Up to 8 named group buses can be created and deleted from the mixer view
- [ ] Any channel's output can be changed to any group bus or back to Master via the `OutputSelector` dropdown on its channel strip
- [ ] Each group bus channel strip has an independently working fader, pan, mute, solo, and peak level meter
- [ ] Effect inserts on a group bus process the summed signal of all assigned channels before it reaches the master
- [ ] Nested group routing (group A output → group B → master) produces correct audio: adjusting group B's fader affects group A's output as expected
- [ ] Assigning an output that would create a routing cycle is rejected with a clear error message; the routing state is unchanged and audio continues without interruption
- [ ] Deleting a group bus automatically reroutes all of its assigned channels to Master
- [ ] Group bus configuration (name, output target, fader, pan, mute, solo, effect chain) survives a project save/load cycle
- [ ] The audio callback processes the mixer graph in correct topological order with no observable latency increase
- [ ] All Rust unit tests pass (cycle detection, topological sort, signal summing)
- [ ] All TypeScript component tests pass (`OutputSelector`, `GroupBusStrip`)
- [ ] No `unwrap()` calls in non-test Rust code; all public types have rustdoc comments
- [ ] No `any` types in TypeScript; all Tauri IPC calls go through `src/lib/ipc.ts`

## Notes

Created: 2026-02-23

**Key design decision — reuse `MixerChannel` inside `GroupBus`:** Rather than implementing a separate signal path for group buses, `GroupBus` composes a full `MixerChannel` instance. This gives group buses fader, pan, mute, solo, and effect inserts for free, and means that all atomic parameter update patterns from Sprint 17 apply unchanged. The only addition is the `input_accumulator` buffer and the `output_target` routing field.

**Key design decision — topological sort on command thread:** The sorted evaluation order is recomputed on the command thread every time any routing assignment changes (a rare operation), and the result is published to the audio thread via an atomic pointer swap. The audio thread never runs the sort and never takes a lock to read the order. This keeps the audio callback allocation-free and mutex-free at the cost of a small allocation on the command thread for each routing change — an acceptable tradeoff.

**Key design decision — maximum nesting depth of 4:** This bounds the worst-case topological sort complexity, keeps the UI comprehensible, and is consistent with professional DAW conventions (Logic Pro, Ableton Live, and Pro Tools all impose similar implicit limits through VCA/group bus UI constraints). If a routing assignment would create a chain deeper than 4 levels, the backend returns a descriptive error.

**Dependency note on Sprint 21:** Group buses compile and function correctly before Sprint 21 completes — the `EffectChain` insert slots on each `GroupBus` will simply be empty. Sprint 21 populates them using the same `add_effect_to_chain` command that targets regular channels; the `target_id` parameter will accept either a `ChannelId` or a `GroupBusId` via a new `EffectTarget` enum added in that sprint.
