---
sprint: 47
title: "EQ Persistence, samplesPerBar, PPQN & Freeze Effect Chain Fixes"
type: fullstack
epic: 12
status: planning
created: 2026-04-07T15:35:26Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 47: EQ Persistence, samplesPerBar, PPQN & Freeze Effect Chain Fixes

## Overview

| Field | Value |
|-------|-------|
| Sprint | 47 |
| Title | EQ Persistence, samplesPerBar, PPQN & Freeze Effect Chain Fixes |
| Type | fullstack |
| Epic | 12 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix four correctness bugs that have been deferred from prior sprints: EQ band settings lost on project reload, `samplesPerBar` defaulting to zero before the first transport tick, PPQN constant divergence across modules, and track freeze skipping the effect chain during offline render.

## Background

These four bugs were identified during Sprint 21, 40, 41, and 45 postmortems and tracked in DEFERRED.md. Each causes incorrect behavior during normal DAW usage:

- **D-005 (EQ persistence)**: Sprint 21 completed effect chain serialization, which now unblocks fixing EQ band parameter persistence. When a project is saved and reloaded, all EQ band settings (`filter_type`, `frequency`, `gain_db`, `q`, `enabled`) are silently discarded. Users lose their EQ work on every project reload.
- **Sprint 45 debt (`samplesPerBar`)**: Timeline and clip drag code initializes `samplesPerBar` to `0` and waits for the first `TransportSnapshot` tick event to populate it. On first open, before playback starts, any clip dragging operation uses `0`, producing garbage pixel positions and making the timeline feel broken on first load.
- **Sprint 41 debt (PPQN divergence)**: Some modules (e.g., the MIDI import path) were written assuming 960 PPQ, while the sequencer and transport use 480 PPQ. This causes MIDI files to import at double speed and transport tick events to misalign with pattern positions.
- **Sprint 40 debt (freeze effect chain)**: The offline bounce renderer in `audio/freeze.rs` runs only the instrument DSP node and writes raw unprocessed audio. The track's effect chain (EQ, reverb, compressor, etc.) is never applied, so frozen audio sounds different from live playback.

All four fixes are isolated to specific files with well-understood solutions. No new features are added.

## Requirements

### Functional Requirements

- [ ] **EQ persistence**: `EqBandParams[]` (filter_type, frequency, gain_db, q, enabled) serialize into the project's effect chain save/load in `project/format.rs`; a round-trip save-and-reload restores all EQ band values exactly
- [ ] **`samplesPerBar` initialization**: The timeline/clip drag code reads the initial `samplesPerBar` value from `TransportSnapshot` on component mount, not from the first tick event; clip dragging works correctly before playback has ever started
- [ ] **PPQN constant**: A single `TICKS_PER_BEAT: u32 = 480` constant is defined in `src-tauri/src/constants.rs`; all modules that previously hardcoded `960` or `480` are updated to reference this constant
- [ ] **Freeze effect chain**: The offline bounce render in `audio/freeze.rs` applies the track's full `AudioEffect` trait chain after instrument DSP, producing frozen audio identical to live playback

### Non-Functional Requirements

- [ ] No heap allocations introduced on the audio thread as a result of any fix
- [ ] All four fixes are covered by regression tests (unit or integration)
- [ ] All existing passing tests continue to pass after the fixes

## Dependencies

- **Sprints**: Sprint 21 (Effect chain serialization — unblocks D-005), Sprint 25 (Transport & Tempo — `TransportSnapshot` definition), Sprint 40 (Track Freeze — freeze render path)
- **External**: None

## Scope

### In Scope

- EQ band `serde` struct updates and round-trip test in `project/format.rs`
- `samplesPerBar` mount-time initialization from `TransportSnapshot` in the React timeline component
- `constants.rs` creation with `TICKS_PER_BEAT` and updating all call sites
- Effect chain application pass in `audio/freeze.rs` offline render loop

### Out of Scope

- New EQ features, new filter types, or EQ UI changes
- MIDI clock sync to external hardware (beyond PPQN correctness)
- New freeze/bounce UI controls
- Performance optimizations unrelated to these four bugs

## Technical Approach

### D-005: EQ Persistence

In `effects/eq.rs`, ensure `EqBandParams` derives `serde::Serialize` and `serde::Deserialize`. In `project/format.rs`, add `eq_bands: Vec<EqBandParams>` to the effect chain serialization struct. On project load, deserialize the `eq_bands` field and call the EQ's `set_bands()` method. Add a unit test that serializes a project with non-default EQ settings, deserializes it, and asserts all band values are preserved.

### `samplesPerBar` Fix

In the React timeline component (likely `src/components/timeline/Timeline.tsx`), the `samplesPerBar` state variable is currently initialized to `0`. Change the initialization to derive from the `TransportSnapshot` returned by a synchronous Tauri IPC call (e.g., `ipc.getTransportSnapshot()`) in a `useEffect` that runs on mount before any tick events arrive. This guarantees `samplesPerBar` is valid the moment the component renders.

### PPQN Constant

Create `src-tauri/src/constants.rs` with:
```rust
/// Ticks (PPQN) per quarter-note beat used throughout the engine.
pub const TICKS_PER_BEAT: u32 = 480;
```
Add `pub mod constants;` to `lib.rs`. Search all `.rs` files for literal `960` and `480` used in PPQN context and replace with `constants::TICKS_PER_BEAT` (and `constants::TICKS_PER_BEAT * 2` where 960 was intentional double-resolution). Add a unit test asserting the constant value so a change triggers a test failure.

### Freeze Effect Chain

In `audio/freeze.rs`, after the instrument DSP produces its output buffer, iterate through the track's `Vec<Box<dyn AudioEffect>>` and call `effect.process(&mut buffer, sample_rate)` for each effect in order, exactly as the live playback path does. The effect chain reference must be passed into the freeze render function. Add a test that bounces a track with a known gain-reducing effect and verifies the output amplitude is reduced.

## Tasks

### Phase 1: Planning
- [ ] Reproduce D-005: save a project with custom EQ bands, reload, confirm bands are reset to defaults
- [ ] Reproduce `samplesPerBar` bug: open a fresh project, drag a clip before pressing play, confirm incorrect positioning
- [ ] Confirm PPQN divergence: import a MIDI file and verify note positions in the piano roll vs expected
- [ ] Confirm freeze effect chain bug: freeze a track with reverb, bounce, compare to live playback
- [ ] Identify exact file and line for each fix

### Phase 2: Backend Implementation
- [ ] Add `Serialize`/`Deserialize` derives to `EqBandParams` in `effects/eq.rs` if missing
- [ ] Add `eq_bands` field to effect chain serialization struct in `project/format.rs`
- [ ] Wire EQ band deserialization into project load path
- [ ] Create `src-tauri/src/constants.rs` with `TICKS_PER_BEAT: u32 = 480`
- [ ] Add `pub mod constants;` to `src-tauri/src/lib.rs`
- [ ] Replace all hardcoded PPQN literals across all `.rs` files with `constants::TICKS_PER_BEAT`
- [ ] Pass effect chain into freeze render function in `audio/freeze.rs`
- [ ] Add effect processing loop in the freeze offline render after instrument DSP

### Phase 3: Frontend Implementation
- [ ] Initialize `samplesPerBar` from `TransportSnapshot` on mount in `Timeline.tsx` (or equivalent)
- [ ] Remove or guard the `samplesPerBar = 0` initialization that waits for the first tick

### Phase 4: Tests
- [ ] Add unit test: EQ band round-trip serialize → deserialize preserves all fields
- [ ] Add unit test: `TICKS_PER_BEAT` constant has value `480`
- [ ] Add unit test: freeze render with a -6 dB gain effect produces output at half amplitude
- [ ] Add component test: `samplesPerBar` is non-zero immediately on timeline mount (mock `TransportSnapshot`)

### Phase 5: Validation
- [ ] Manual smoke test: save/reload project with custom EQ — verify bands are intact
- [ ] Manual smoke test: open project, drag a clip before pressing play — verify correct positioning
- [ ] Manual smoke test: import a MIDI file — verify note timing is correct
- [ ] Manual smoke test: freeze a track with reverb — verify effect audible in frozen audio
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] EQ band parameters (`filter_type`, `frequency`, `gain_db`, `q`, `enabled`) survive a project save-and-reload cycle with exact value preservation
- [ ] `samplesPerBar` is non-zero and correct immediately on timeline component mount, before any tick event fires
- [ ] All modules reference `constants::TICKS_PER_BEAT` — no hardcoded `960` or `480` in PPQN context
- [ ] Frozen track audio output includes effect chain processing (verified by amplitude/frequency comparison)
- [ ] All regression tests for the four fixes pass
- [ ] All pre-existing tests continue to pass

## Deferred Item Traceability

| Deferred ID | Description | Fix Location |
|-------------|-------------|--------------|
| D-005 | EQ parameter persistence | `effects/eq.rs`, `project/format.rs` |
| Sprint 45 debt | `samplesPerBar` zero-initialization | `src/components/timeline/Timeline.tsx` |
| Sprint 41 debt | PPQN constant divergence | `src-tauri/src/constants.rs` + all call sites |
| Sprint 40 debt | Freeze skips effect chain | `audio/freeze.rs` |

## Notes

Created: 2026-04-07
Blocked by: Sprint 21 (effect chain serialization) — now complete, unblocks D-005.
