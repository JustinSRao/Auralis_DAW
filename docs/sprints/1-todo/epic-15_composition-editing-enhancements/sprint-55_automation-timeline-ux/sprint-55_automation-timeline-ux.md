---
sprint: 55
title: "Automation & Timeline UX"
type: fullstack
epic: 15
status: planning
created: 2026-04-07T15:41:52Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 55: Automation & Timeline UX

## Overview

| Field | Value |
|-------|-------|
| Sprint | 55 |
| Title | Automation & Timeline UX |
| Type | fullstack |
| Epic | 15 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Add an automation lane creation UI, implement the deferred pre-roll transport seeking in the punch controller, and move track expand toggles to the track list sidebar — completing the deferred Sprint 14 and Sprint 38 composition UX work.

## Background

These three items were deferred from Sprints 14 and 38 postmortems:

- **Sprint 14 debt (automation lane creation UI)**: Automation lanes exist in the data model and can be created programmatically, but there is no UI for a user to add one. The track header's expand area should have a "+" button that opens a parameter picker dropdown listing all automatable parameters for that track's instrument and effects chain. Without this, automation is inaccessible to users.
- **Sprint 38 debt (pre-roll transport seeking)**: The punch-in controller has a `pre_roll_bars` field in its state that is intended to make the transport seek back N bars before the punch-in point and start playback from there, giving the musician time to hear context before recording begins. Currently this field is stored but the actual transport seek is never executed — the punch-in simply starts recording from the punch-in point directly. The fix is to implement the transport seek to `punch_in_tick - (pre_roll_bars * ticks_per_bar)` before starting playback when punch-in is armed.
- **Sprint 14 debt (track expand toggle location)**: The current track expand/collapse toggle is placed inconsistently compared to the main DAW shell layout established in Sprint 30. The toggles should be in the `TrackList` sidebar (the left panel showing track headers), not inline in the arrangement area. This makes the UI consistent with professional DAW conventions (Logic, Ableton) where automation and instrument lanes are expanded from the track header sidebar.

## Requirements

### Functional Requirements

- [ ] **Automation lane creation UI**: Each track header in the `TrackList` sidebar has an expand area (revealed by clicking a disclosure triangle) that shows a "+" button. Clicking the "+" button opens a dropdown listing all automatable parameters for that track's instrument (e.g., "Filter Cutoff", "Reverb Size", "Volume"). Selecting a parameter creates an automation lane for it, which appears below the track in the arrangement view.
- [ ] **Pre-roll transport seeking**: When punch-in is armed (punch-in mode enabled, punch-in point set), and the user presses Play, the transport seeks to `punch_in_tick - (pre_roll_bars * ticks_per_bar)` and begins playback from there. Recording begins when the playhead reaches `punch_in_tick`. The `pre_roll_bars` value is configurable in the punch-in UI (already has the field — the seek just needs to be implemented).
- [ ] **Track expand toggle in sidebar**: The track expand/collapse toggle (the disclosure triangle) is positioned in the `TrackList` track header component, not in the arrangement grid. Clicking it in the sidebar expands/collapses that track's automation lanes and instrument sub-lanes both in the sidebar and in the arrangement grid simultaneously.

### Non-Functional Requirements

- [ ] The automatable parameter list in the "+" dropdown is generated dynamically from the track's current instrument and effect chain — it updates if the user changes the instrument on the track
- [ ] Pre-roll seek must use the same transport seek mechanism as the existing "go to beginning" and "loop back" transport operations — no separate seek implementation
- [ ] Track expand state is stored in the track UI state (not the project model) — expand/collapse does not dirty the project for save purposes

## Dependencies

- **Sprints**: Sprint 14 (Automation Lanes — data model and arrangement view), Sprint 25 (Transport & Tempo — transport seek API), Sprint 29/52 (Parameter IDs — automatable parameter list), Sprint 30 (DAW Shell — TrackList sidebar component, track header layout), Sprint 38 (Punch Recording — punch controller state with `pre_roll_bars`)
- **External**: None

## Scope

### In Scope

- "+" button in track header expand area for adding automation lanes
- Parameter picker dropdown with the track's automatable parameters
- Automation lane creation IPC command invocation from UI
- Pre-roll transport seek implementation in punch controller
- Track expand/collapse toggle moved to `TrackList` sidebar track header

### Out of Scope

- Automation breakpoint editing UI (drawing automation curves — that is a separate sprint if not yet done)
- Automation recording from live CC input
- Pre-roll metronome click track
- New punch-in UI features beyond the seek fix

## Technical Approach

### Automation Lane Creation UI

In the `TrackList` sidebar's track header component, add a collapsible section below the track name/controls. This section has a "+" button. When clicked, it queries `ipc.getAutomatableParameters(trackId)` which returns a list of `{ label: string, parameterId: ParameterId }` entries based on the track's instrument and effects. Render this list as a Radix `DropdownMenu`. On selection, call `ipc.createAutomationLane(trackId, parameterId)`. The arrangement view already listens for automation lane changes and renders lanes below their parent track.

The `get_automatable_parameters` Tauri command iterates the track's instrument and effect chain and returns their registered `ParameterId` entries with human-readable labels from a label lookup table.

### Pre-Roll Transport Seeking

In `src-tauri/src/audio/` (or `midi/` — wherever the punch controller logic lives), in the function that handles "arm punch-in + start playback":
```rust
let pre_roll_ticks = punch_state.pre_roll_bars * ticks_per_bar;
let start_tick = punch_state.punch_in_tick.saturating_sub(pre_roll_ticks);
transport.seek(start_tick); // use existing seek API
transport.start_playback();
// Recording begins automatically when playhead reaches punch_in_tick
```
The `ticks_per_bar` value comes from `constants::TICKS_PER_BEAT * time_signature_numerator` (using the constant defined in Sprint 47).

### Track Expand Toggle Relocation

In `TrackList.tsx` (or equivalent), add a disclosure triangle `<button>` to each track header row. This button toggles `isExpanded` in the local track UI state (a `Map<trackId, boolean>` in the track UI store or as local component state). When `isExpanded` is true, the track header in the sidebar shows sub-rows for automation lanes and the arrangement grid expands the corresponding track's row height to show automation lanes. The existing arrangement track height logic should already respond to a track's lane count — ensure the expand toggle is wired to the same state variable that controls lane visibility.

## Tasks

### Phase 1: Planning
- [ ] Review Sprint 14 automation lane data model — confirm the arrangement view already renders automation lanes when they exist
- [ ] Locate the punch controller armed-start code path in the Rust backend
- [ ] Review `TrackList.tsx` current track header layout — identify where the expand toggle currently lives and where it should move

### Phase 2: Backend Implementation
- [ ] Implement `get_automatable_parameters(track_id)` Tauri command — returns list of `{ label, parameter_id }` from the track's instrument and effects
- [ ] Implement pre-roll seek in the punch controller: compute `start_tick`, call `transport.seek(start_tick)` before starting playback when punch-in is armed
- [ ] Confirm `create_automation_lane(track_id, parameter_id)` IPC command exists (from Sprint 14); add if missing

### Phase 3: Frontend Implementation
- [ ] Add collapsible expand section to each track header in `TrackList` sidebar
- [ ] Add "+" button to expand section that opens `get_automatable_parameters` query
- [ ] Render parameter picker as Radix `DropdownMenu`; on select call `ipc.createAutomationLane`
- [ ] Move the track expand/collapse disclosure triangle to the `TrackList` track header (remove from arrangement grid if it was there)
- [ ] Wire expand toggle to the same `isExpanded` state that controls automation lane visibility in the arrangement

### Phase 4: Tests
- [ ] Add Rust unit test: with `pre_roll_bars = 2` at BPM 120, punch at bar 4 — verify transport seeks to bar 2
- [ ] Add Rust unit test: `get_automatable_parameters` for a track with synth + reverb returns synth and reverb parameters
- [ ] Add component test: clicking "+" in track header shows parameter picker dropdown
- [ ] Add component test: expand toggle in sidebar toggles automation lane visibility

### Phase 5: Validation
- [ ] Manual test: arm punch-in at bar 4, set pre-roll 2 bars, press Play — verify playback starts at bar 2
- [ ] Manual test: add automation lane for "Filter Cutoff" via the "+" button — verify lane appears in arrangement
- [ ] Manual test: collapse a track using the sidebar toggle — verify automation lanes hide in both sidebar and arrangement
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] Track header expand area in `TrackList` sidebar has a "+" button that opens a parameter picker
- [ ] Selecting a parameter from the picker creates an automation lane visible in the arrangement view
- [ ] Pre-roll transport seeking is functional: playback starts N bars before the punch-in point when `pre_roll_bars > 0`
- [ ] Track expand/collapse toggle is in the `TrackList` sidebar track header, consistent with the Sprint 30 DAW shell layout
- [ ] Expanding/collapsing a track in the sidebar correctly shows/hides automation lanes in both the sidebar and the arrangement grid
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 14 debt | Automation lane creation UI ("+" button + parameter picker) | `TrackList` sidebar + `get_automatable_parameters` command |
| Sprint 38 debt | Pre-roll transport seeking in punch controller | `src-tauri/src/audio/` (punch controller) |
| Sprint 14 debt | Track expand toggles moved to TrackList sidebar | `src/components/daw/TrackList.tsx` |

## Notes

Created: 2026-04-07
