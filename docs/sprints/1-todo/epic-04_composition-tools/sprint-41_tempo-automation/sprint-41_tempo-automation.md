---
sprint: 41
title: "Tempo Automation"
type: fullstack
epic: 4
status: planning
created: 2026-02-23T17:05:57Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 70
# Justification: TempoMap evaluation and tick/sample conversion are pure functions — fully unit testable.
# Audio thread integration tested via smoke tests. TransportClock hot path exempt from unit coverage.
---

# Sprint 41: Tempo Automation

## Overview

| Field | Value |
|-------|-------|
| Sprint | 41 |
| Title | Tempo Automation |
| Type | fullstack |
| Epic | 4 - Composition Tools |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Enable tempo changes over the course of a song via a dedicated tempo track with BPM automation points, supporting gradual accelerando/ritardando and sudden tempo jumps, while keeping all time-dependent systems (transport clock, arrangement scheduler, metronome, step sequencer, tempo-synced delay) correctly locked to the evolving tempo curve.

## Background

Sprint 25 (Transport & Tempo Engine) implemented a single static BPM stored as an `AtomicF32` — a necessary simplification to get the clock running. That sprint explicitly deferred tempo automation to Epic 4. The limitation is real: any song with a tempo ramp, a ritardando into a bridge, or different BPMs per section cannot be represented. Without a `TempoMap`, the `TransportClock` computes BBT position using a fixed ratio (`samples_per_tick = sample_rate / (bpm / 60.0 * ticks_per_beat)`), and the `ArrangementScheduler` (Sprint 31) converts bar positions to sample positions using that same fixed ratio. Introducing tempo changes invalidates both of those calculations.

This sprint replaces the single static BPM with a `TempoMap` — a sorted sequence of `TempoPoint` structs, each specifying a tick position, a BPM value, and an interpolation mode (linear ramp or step jump). All time-dependent systems are updated to query the tempo map rather than reading a single atomic value. The frontend gains a tempo track lane in the timeline where users can draw, drag, and delete tempo automation points, and see the resulting curve rendered as a continuous BPM graph.

## Requirements

### Functional Requirements

- [ ] A dedicated tempo track exists as a non-deletable, non-reorderable special track at the top of the timeline
- [ ] The tempo track displays a horizontal automation lane showing the BPM curve over bars/ticks
- [ ] Users can add tempo points by clicking on the tempo lane; drag points to adjust position and BPM value; right-click to delete
- [ ] Each tempo segment has a selectable interpolation mode: **linear** (gradual accelerando or ritardando) or **step** (instant tempo jump at the point)
- [ ] BPM range: 20.0 to 300.0 BPM with 0.1 BPM resolution
- [ ] A minimum of one tempo point must always exist (the initial default BPM, typically 120.0)
- [ ] The initial project tempo point at tick 0 is non-deletable (it may be edited but not removed)
- [ ] Tempo changes update `TransportClock`'s tick-to-sample and sample-to-tick conversion in real time without audio glitches
- [ ] The BBT (bars:beats:ticks) position displayed in the transport bar remains accurate through all tempo changes
- [ ] `ArrangementScheduler` uses `TempoMap::tick_to_sample()` for all bar-to-sample conversions, replacing any fixed-BPM calculation
- [ ] `MetronomeNode` (Sprint 25) fires click events at the correct sample positions derived from the tempo map
- [ ] `StepSequencer` (Sprint 10) step clock advances by sample count per step computed from the tempo map at the current tick position
- [ ] Tempo-synced delay (Sprint 19) reads the current BPM from the tempo map at the playhead position rather than a global static BPM
- [ ] Tauri commands: `set_tempo_point`, `delete_tempo_point`, `set_tempo_interp`, `get_tempo_map`
- [ ] Tempo map data is persisted in the project file and restored correctly on load
- [ ] Tempo points can be imported from SMF (Standard MIDI File) tempo change events when MIDI import (Sprint 32) is used

### Non-Functional Requirements

- [ ] `TempoMap::bpm_at_tick()` evaluation is O(log n) via binary search over the sorted `Vec<TempoPoint>` — no linear scan
- [ ] `TempoMap::tick_to_sample()` and `sample_to_tick()` integrate the piecewise tempo curve using pre-computed cumulative sample offsets stored per point — O(log n) per call
- [ ] No heap allocations on the audio thread during tempo map evaluation — the map is a pre-allocated, atomically swapped snapshot
- [ ] Tempo map updates from the UI are applied to the audio thread within one buffer period via `crossbeam-channel` swap
- [ ] A tempo ramp from 60 BPM to 180 BPM over 4 bars must produce smooth acceleration with no audible step artifacts when using linear interpolation
- [ ] The `TempoMap` supports at least 1000 tempo points without measurable performance impact on the audio thread callback
- [ ] `tick_to_sample()` and `sample_to_tick()` must be inverse functions within rounding error (round-trip error < 1 sample)

## Dependencies

- **Sprints**:
  - Sprint 2 (Core Audio Engine) — audio callback architecture, `AudioGraph` integration point
  - Sprint 14 (Automation Editor) — `ControlPoint` / interpolation model that `TempoPoint` mirrors in structure
  - Sprint 25 (Transport & Tempo Engine) — `TransportClock`, `BBTPosition`, `bpm AtomicF32` being replaced; `MetronomeNode` integration
  - Sprint 31 (Arrangement Playback Engine) — `ArrangementScheduler` bar-to-sample conversion must migrate to `TempoMap`
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio/tempo_map.rs` — `TempoMap`, `TempoPoint`, `TempoInterp` enum, `CumulativeTempoMap` with pre-computed offsets
- Modification of `src-tauri/src/audio/transport.rs` — replace `bpm: AtomicF32` with `Arc<ArcSwap<CumulativeTempoMap>>` (or equivalent lock-free swap); update `TransportClock::advance()` to evaluate `samples_per_tick` from the map at the current position
- Modification of `src-tauri/src/audio/metronome.rs` — derive beat boundary sample positions from tempo map rather than fixed BPM
- Modification of `src-tauri/src/audio/scheduler.rs` (Sprint 31) — replace fixed-ratio bar-to-sample with `TempoMap::tick_to_sample()`
- Modification of `src-tauri/src/sequencer/step_sequencer.rs` (Sprint 10) — derive step duration samples from `TempoMap::bpm_at_tick()` at current tick position
- Modification of `src-tauri/src/effects/delay.rs` (Sprint 19) — read current BPM from transport state (which sources from tempo map) for tempo-sync delay time computation
- New Tauri commands: `set_tempo_point`, `delete_tempo_point`, `set_tempo_interp_mode`, `get_tempo_map`
- `src/components/daw/TempoTrack.tsx` — React component rendering the tempo lane in the timeline: BPM curve canvas, draggable points, interpolation mode right-click menu
- `src/stores/tempoMapStore.ts` — Zustand store for tempo map state with `immer` middleware; subscribes to Tauri `tempo_map_changed` event
- Tempo map serialization/deserialization in the project file (Sprint 4 `.mapp` format extension)

### Out of Scope

- Time signature automation (each bar can have a different time signature) — separate backlog item
- Tap tempo UI — backlog
- Ableton Link or MIDI clock tempo sync — backlog
- Swing / groove quantize (separate from tempo) — backlog
- Tempo detection from audio (beat detection) — backlog
- Per-clip independent tempo (clips always follow the master tempo map)

## Technical Approach

### Data Model

```rust
/// One point on the tempo map. Interpolation applies from this point to the next.
pub struct TempoPoint {
    /// Absolute position in ticks (960 PPQ, matching the rest of the DAW).
    pub tick: u64,
    /// BPM at this point (20.0 – 300.0).
    pub bpm: f64,
    /// How to interpolate BPM between this point and the next.
    pub interp: TempoInterp,
}

pub enum TempoInterp {
    /// Hold BPM constant until the next point (sudden jump at next point).
    Step,
    /// Linearly interpolate BPM from this point to the next.
    Linear,
}
```

### CumulativeTempoMap

The naive approach — integrating from tick 0 to any tick T on every call — would be O(n). Instead, `CumulativeTempoMap` pre-computes and stores the cumulative sample offset at every `TempoPoint` when the map is built (i.e., when the user edits a point). This makes `tick_to_sample()` O(log n): binary-search to the correct segment, then compute the remaining fractional samples within that segment analytically.

```
cumulative_samples[i] = sum of samples in all segments before point i
```

For a linear segment from point i (bpm_a at tick_a) to point i+1 (bpm_b at tick_b), the number of samples is computed by integrating the instantaneous `samples_per_tick` over the tick range. Since BPM changes linearly with tick, `samples_per_tick` changes linearly too, so the integral is the trapezoid area:

```
delta_ticks = tick_b - tick_a
spt_a = sample_rate * 60.0 / (bpm_a * ticks_per_beat)
spt_b = sample_rate * 60.0 / (bpm_b * ticks_per_beat)
segment_samples = delta_ticks * (spt_a + spt_b) / 2.0
```

For a step segment, `spt` is constant at `spt_a` for the full `delta_ticks`.

`sample_to_tick()` is the inverse: binary-search `cumulative_samples` to find the segment, then solve analytically for the fractional tick within that segment.

### Audio Thread Integration

The audio thread never builds or rebuilds the `CumulativeTempoMap`. It only reads a pre-built snapshot. The update flow is:

1. User edits a tempo point in the React UI.
2. Tauri command `set_tempo_point` is called on the main thread.
3. The main thread rebuilds `CumulativeTempoMap` from the new `Vec<TempoPoint>`.
4. The new map is sent to the audio thread via a `crossbeam_channel` (single-producer, single-consumer, capacity 1 — the audio thread drains it at buffer start).
5. The audio thread swaps the new map in and drops the old one (no dealloc on audio thread — use `Arc` so the old map's memory is freed on the main thread's drop after the channel receive confirms the swap).

### TransportClock Changes

`TransportClock::advance(buffer_size)` currently computes:

```rust
let samples_per_tick = sample_rate * 60.0 / (bpm * ticks_per_beat as f64);
self.current_sample += buffer_size as u64;
self.current_tick = (self.current_sample as f64 / samples_per_tick) as u64;
```

After this sprint, it becomes:

```rust
// At buffer start, optionally drain the channel to get a new TempoMap snapshot.
// Then compute how many ticks correspond to the new sample position using the map.
self.current_sample += buffer_size as u64;
self.current_tick = self.tempo_map.sample_to_tick(self.current_sample);
// For per-buffer BPM (e.g., feeding MetronomeNode, StepSequencer):
let current_bpm = self.tempo_map.bpm_at_tick(self.current_tick);
```

BBT conversion is updated similarly: `bar` and `beat` are derived from `current_tick` divided by ticks-per-beat and ticks-per-bar — this logic does not change since ticks are the stable intermediate unit.

### Frontend Tempo Track

`TempoTrack.tsx` renders as a special lane above all other tracks. The canvas maps the x-axis to the timeline's bar position (matching other tracks) and the y-axis to BPM (20 at bottom, 300 at top, with labeled gridlines at round values). Each `TempoPoint` is rendered as a draggable circle. Segments between points are drawn as straight lines (linear interp) or horizontal lines followed by a vertical jump (step interp). Users interact with the lane the same way as `AutomationLane` from Sprint 14: click to add, drag to move, right-click for interpolation mode and delete.

## Tasks

### Phase 1: Planning

- [ ] Review Sprint 25 `TransportClock` implementation and identify all sites that read the static `bpm` AtomicF32
- [ ] Review Sprint 31 `ArrangementScheduler` bar-to-sample conversion code and identify the replacement call sites
- [ ] Review Sprint 10 `StepSequencer` step clock and Sprint 19 `StereoDelay` tempo sync code
- [ ] Design the `TempoPoint`, `TempoInterp`, `CumulativeTempoMap` structs with full field documentation
- [ ] Specify the `CumulativeTempoMap::build()` algorithm with worked numerical examples at 120 BPM and at a ramp 60→180
- [ ] Design the audio-thread swap mechanism (channel capacity, Arc drop behavior, memory ordering)
- [ ] Specify `tick_to_sample()` and `sample_to_tick()` inverse pair, define acceptable rounding error (< 1 sample)
- [ ] Design `TempoTrack.tsx` canvas layout: y-axis scale, grid lines, point rendering, segment rendering for step vs. linear
- [ ] Define Tauri command surface and event emission strategy (`tempo_map_changed` event to frontend)

### Phase 2: Backend Implementation

- [ ] Implement `src-tauri/src/audio/tempo_map.rs`:
  - [ ] `TempoInterp` enum (Step, Linear) with serde derive
  - [ ] `TempoPoint` struct (tick: u64, bpm: f64, interp: TempoInterp) with rustdoc
  - [ ] `TempoMap` — user-facing mutable model: sorted `Vec<TempoPoint>`, insert/delete/update operations that keep the vec sorted
  - [ ] `CumulativeTempoMap::build(points, sample_rate, ticks_per_beat)` — computes and stores cumulative sample offsets
  - [ ] `CumulativeTempoMap::bpm_at_tick(tick) -> f64` — binary search, linear interpolate within segment
  - [ ] `CumulativeTempoMap::tick_to_sample(tick) -> u64` — binary search cumulative offsets, compute fractional offset analytically
  - [ ] `CumulativeTempoMap::sample_to_tick(sample) -> u64` — binary search, invert analytically
  - [ ] `CumulativeTempoMap::samples_per_tick_at(tick) -> f64` — used by TransportClock for per-buffer `samples_per_tick`
- [ ] Modify `src-tauri/src/audio/transport.rs`:
  - [ ] Replace `bpm: AtomicF32` field with `tempo_map: Arc<CumulativeTempoMap>` (immutable snapshot held by audio thread) and `tempo_map_rx: crossbeam_channel::Receiver<Arc<CumulativeTempoMap>>`
  - [ ] Update `TransportClock::advance()` to drain `tempo_map_rx` at buffer start (non-blocking `try_recv`)
  - [ ] Update `TransportClock::advance()` to call `tempo_map.sample_to_tick()` for current tick derivation
  - [ ] Update `TransportClock::bbt_position()` to remain tick-based (no change to BBT math itself)
  - [ ] Retain `set_bpm` as a convenience command that creates or updates the tick-0 point if the map has only one point, for backward compatibility with simple projects
  - [ ] Expose `current_bpm() -> f64` on `TransportClock` using `tempo_map.bpm_at_tick(current_tick)` for consumers (MetronomeNode, StepSequencer, delay)
- [ ] Modify `src-tauri/src/audio/metronome.rs`:
  - [ ] Replace static BPM read with `TransportClock::current_bpm()` per callback
  - [ ] Compute beat boundary sample position from `tempo_map.tick_to_sample(beat_tick)` rather than fixed BPM formula
- [ ] Modify `src-tauri/src/audio/scheduler.rs` (Sprint 31 scope):
  - [ ] Replace `bar_to_sample(bar, bpm) -> u64` utility with `tempo_map.tick_to_sample(bar_in_ticks)`
  - [ ] On seek, recompute all `ScheduledClip::start_sample` and `end_sample` using the tempo map
- [ ] Modify `src-tauri/src/sequencer/step_sequencer.rs` (Sprint 10 scope):
  - [ ] Derive `step_duration_samples` per callback using `tempo_map.samples_per_tick_at(current_tick) * ticks_per_step` instead of fixed BPM
- [ ] Modify `src-tauri/src/effects/delay.rs` (Sprint 19 scope):
  - [ ] Replace static global BPM read with per-callback BPM from `TransportClock::current_bpm()`
- [ ] Add Tauri commands in `src-tauri/src/audio/transport.rs` or a new `src-tauri/src/audio/tempo_commands.rs`:
  - [ ] `set_tempo_point(tick: u64, bpm: f64, interp: String) -> Result<(), String>` — insert or update a point at the given tick, rebuild `CumulativeTempoMap`, send to audio thread
  - [ ] `delete_tempo_point(tick: u64) -> Result<(), String>` — refuse if tick == 0, otherwise remove and rebuild
  - [ ] `set_tempo_interp_mode(tick: u64, interp: String) -> Result<(), String>` — update interp mode for the point at tick
  - [ ] `get_tempo_map() -> Vec<TempoPointDto>` — return current map for frontend hydration
- [ ] Emit `tempo_map_changed` Tauri event after every successful mutation, carrying the full updated `Vec<TempoPointDto>`
- [ ] Extend project file serialization/deserialization (`src-tauri/src/project/`) to include `tempo_map: Vec<TempoPointDto>` in the `.mapp` format; on load, hydrate `TempoMap`, build `CumulativeTempoMap`, send to audio thread

### Phase 3: Frontend Implementation

- [ ] Add `src/stores/tempoMapStore.ts`:
  - [ ] Zustand store with `immer` middleware: `{ points: TempoPointDto[], setPoints, addPoint, deletePoint, setInterpMode }`
  - [ ] Subscribe to `tempo_map_changed` Tauri event and update store on receipt
  - [ ] On store mutation, call the appropriate Tauri command
- [ ] Add typed IPC wrappers in `src/lib/ipc.ts`: `setTempoPoint`, `deleteTempoPoint`, `setTempoInterpMode`, `getTempoMap`
- [ ] Build `src/components/daw/TempoTrack.tsx`:
  - [ ] Canvas element mapping timeline x-axis to bar positions (reads `timelineStore` for zoom/scroll)
  - [ ] Y-axis: BPM range 20–300, with horizontal gridlines at 60, 80, 100, 120, 140, 160, 180, 200, 240, 300; labeled every 20 BPM
  - [ ] Render each `TempoPoint` as a filled circle (same interaction model as `AutomationLane` from Sprint 14)
  - [ ] Render segments: for `Linear` segments, draw a straight line between adjacent points; for `Step` segments, draw a horizontal line then a vertical drop/rise at the next point's tick
  - [ ] Click on empty lane area: add new tempo point at clicked tick and BPM (snapped to 0.1 BPM)
  - [ ] Drag a point: update tick (x) and BPM (y) live; the tick-0 point may only move vertically (BPM only — its tick is locked to 0)
  - [ ] Right-click a point: context menu with "Delete" (disabled for tick-0 point) and "Set to Linear" / "Set to Step"
  - [ ] Display current BPM numerically in a label that follows the playhead x-position
  - [ ] Highlight the currently active segment (the one containing the playhead) with a slightly different stroke color
- [ ] Integrate `TempoTrack.tsx` into the main timeline layout (`src/components/daw/Timeline.tsx` or equivalent from Sprint 30): render it as the topmost lane above all other tracks, with a fixed label "Tempo" in the track header column; no mute/solo/delete controls (it is a system track)
- [ ] On project load, call `getTempoMap()` and hydrate `tempoMapStore`
- [ ] Transport bar BPM display: change from a static editable input to a read-only display that shows the current BPM from `transportStore.currentBpm` (which is emitted by the `transport_state` Tauri event that now sources BPM from the tempo map at the playhead)

### Phase 4: Validation

- [ ] Unit test — `bpm_at_tick` step interpolation: point A = tick 0 / 120 BPM, point B = tick 1920 / 140 BPM (step); query tick 960 → returns 120.0; query tick 1920 → returns 140.0
- [ ] Unit test — `bpm_at_tick` linear interpolation: point A = tick 0 / 60 BPM, point B = tick 3840 / 180 BPM (linear); query tick 1920 (midpoint) → returns 120.0 ± 0.01
- [ ] Unit test — `tick_to_sample` constant tempo: at 120 BPM, 960 PPQ, 44100 Hz, tick 960 (one beat) = 22050 samples
- [ ] Unit test — `tick_to_sample` linear ramp: 60→120 BPM over one beat; verify sample count equals the trapezoid integral result to within 1 sample
- [ ] Unit test — `sample_to_tick` is the inverse of `tick_to_sample`: for 50 random tick values across a 4-point map, `sample_to_tick(tick_to_sample(t)) == t` within 1 tick
- [ ] Unit test — `CumulativeTempoMap::build()` with 1000 points: completes in < 1 ms
- [ ] Unit test — `bpm_at_tick` with 1000 points: single lookup completes in < 1 μs
- [ ] Unit test — Tick-0 point cannot be deleted: `delete_tempo_point(0)` returns an error
- [ ] Unit test — `set_tempo_point` with a duplicate tick updates the existing point in place and keeps the vec sorted
- [ ] Unit test — Project file round-trip: serialize a 5-point tempo map, deserialize, rebuilt `CumulativeTempoMap` produces identical `tick_to_sample()` results
- [ ] Integration smoke test: start audio engine, set a linear 120→180 BPM ramp over bars 1–4, play for 8 seconds; transport BBT position advances beyond bar 4; no audio callback errors in the log
- [ ] Manual test — Accelerando: set tempo ramp 60→180 BPM over 4 bars; play back with metronome; clicks speed up smoothly with no audible steps
- [ ] Manual test — Sudden jump: add a step point at bar 5 changing from 120 to 80 BPM; at bar 5 the metronome immediately slows without any intermediate fast/slow artifacts
- [ ] Manual test — Arrangement scheduler: place a clip at bar 5 with a ramp before it; clip starts at the correct wall-clock time accounting for the ramp
- [ ] Manual test — Tempo-synced delay: with a 120→180 ramp, the delay set to 1/4 note sync audibly shortens its echo time as tempo increases

### Phase 5: Documentation

- [ ] Rustdoc on `TempoMap`, `CumulativeTempoMap`, `TempoPoint`, `TempoInterp`, and all public methods — include the integration formula in the `tick_to_sample` doc comment
- [ ] Rustdoc on the `TransportClock::advance()` changes — document the map-swap protocol and why Arc is dropped on the main thread
- [ ] Inline comment in `CumulativeTempoMap::build()` explaining the trapezoid integration for linear segments vs. constant integration for step segments
- [ ] Update `docs/sprints/2-in-progress/.../sprint-25_transport-and-tempo-engine.md` with a note that the static `bpm` field was replaced by `TempoMap` in Sprint 41

## Acceptance Criteria

- [ ] A tempo track lane is visible at the top of the timeline with at least the default tick-0 BPM point (120.0)
- [ ] Clicking on the tempo lane adds a new tempo point; the canvas redraws immediately
- [ ] Dragging a tempo point updates both the BPM value displayed in the lane and the value read by the audio engine within one buffer period
- [ ] The tick-0 point cannot be deleted; the delete option is disabled in its context menu
- [ ] Linear interpolation between two points produces a smooth curve on the canvas and a smooth audible accelerando/ritardando on playback
- [ ] Step interpolation shows a flat line with a vertical jump and produces an instant BPM change at the transition point during playback
- [ ] The transport bar BPM display reflects the current BPM at the playhead position and updates in real time during playback through a ramp
- [ ] BBT position in the transport bar remains accurate (bar numbers advance at the correct wall-clock times) through a 60→180 BPM ramp
- [ ] The metronome click track fires at the correct sample positions through tempo changes — no audible drift
- [ ] The arrangement scheduler places clips at the correct sample positions when a tempo ramp precedes them
- [ ] Tempo-synced delay updates its echo time continuously through a BPM ramp
- [ ] `tick_to_sample(sample_to_tick(s)) == s` round-trip within 1 sample for all tested positions
- [ ] `bpm_at_tick` and `tick_to_sample` execute in < 1 μs per call (O(log n) verified with 1000 points)
- [ ] No audio glitches, buffer underruns, or log errors during a 60-second playback test with a 10-point tempo map
- [ ] Tempo map is persisted in the project file and fully restored on reload with identical playback behavior
- [ ] All unit tests pass; overall Rust test coverage for `tempo_map.rs` >= 90%

## Notes

Created: 2026-02-23

**Design note — ticks as the stable time unit:** This sprint deliberately keeps ticks (960 PPQ) as the intermediate representation for all time values — note positions, clip start/end, automation points, loop region. Ticks are tempo-independent: a note at tick 1920 is always "bar 1 beat 3" regardless of tempo. Sample positions are derived from ticks via the tempo map at evaluation time. This avoids the alternative approach of converting everything to samples upfront, which would require re-stamping every note and clip whenever the tempo map changes.

**Design note — no AtomicF32 for BPM on audio thread:** The existing `bpm: AtomicF32` is removed rather than kept alongside the tempo map. Keeping both would create a consistency hazard (which source of truth wins?). Callers that previously used `set_bpm` are migrated to `set_tempo_point(tick: 0, bpm: value, interp: Step)`. The `set_bpm` Tauri command is kept as a thin convenience wrapper over `set_tempo_point` for backward compatibility with any existing frontend code from Sprint 25.

**Design note — Arc swap vs. ArcSwap crate:** To avoid adding the `arc-swap` crate dependency, the audio thread receives new `CumulativeTempoMap` snapshots via a `crossbeam_channel::bounded(1)`. The audio thread calls `try_recv()` at buffer start (non-blocking, O(1)). If a new map is received, it replaces the thread-local `Arc<CumulativeTempoMap>` reference. The old `Arc` is held in a local variable until the end of the callback frame and then dropped — at which point the refcount may reach zero. If no other thread holds a reference, the memory is freed. Because this drop happens at the end of the callback frame (not in the DSP hot loop), it is safe in practice. If the refcount is > 1 (main thread still holds a reference), the drop is a no-op. Teams that want stricter no-alloc guarantees can swap to the `arc-swap` crate in a follow-up.

**Follow-up backlog items:**
- Time signature automation (per-bar time signatures)
- Tap tempo as a way to set the tick-0 BPM point
- Export of tempo map as SMF tempo change events in Sprint 43 (MIDI Export)
