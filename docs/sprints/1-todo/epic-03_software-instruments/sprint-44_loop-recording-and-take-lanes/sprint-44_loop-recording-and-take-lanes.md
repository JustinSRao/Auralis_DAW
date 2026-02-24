---
sprint: 44
title: "Loop Recording and Take Lanes"
type: fullstack
epic: 3
status: planning
created: 2026-02-23T17:06:06Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 44: Loop Recording and Take Lanes

## Overview

| Field | Value |
|-------|-------|
| Sprint | 44 |
| Title | Loop Recording and Take Lanes |
| Type | fullstack |
| Epic | 3 |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Enable loop recording — when recording with the transport loop enabled, each pass through the loop region creates a new "take" stored in take lanes, allowing users to audition individual takes and composite (comp) the best sections from different takes into a final performance.

## Background

Loop recording is the standard way to capture multiple attempts at a difficult passage. A vocalist loops a chorus 5 times, picks the best phrases from each take, and comps them into one perfect performance. Both Sprint 36 (MIDI Recording) and Sprint 9 (Audio Recording) explicitly defer loop recording with take lanes. Without this, users must manually re-record, rename, and arrange multiple clips — a tedious workflow that breaks creative flow. Every professional DAW (Logic, Pro Tools, Ableton, Cubase) provides loop recording with take lanes and comping.

## Requirements

### Functional Requirements

- [ ] When transport loop is active and recording is armed, each pass through the loop region creates a new take on the armed track
- [ ] Audio takes: each loop pass writes a separate WAV file via Sprint 9's `AudioRecorder`
- [ ] MIDI takes: each loop pass creates a separate `Pattern` via Sprint 36's `MidiRecorder`
- [ ] Take lanes UI: stacked sub-rows under the main track row in the timeline, one row per take
- [ ] Click a take lane to set it as the active take (heard during playback)
- [ ] Comp mode: split any take at an arbitrary point (razor tool on take lanes), select which take is active in each region by clicking the desired section
- [ ] Visual: active comp regions highlighted, inactive regions dimmed
- [ ] Flatten comp: merge the selected regions from different takes into a single clip or pattern, replacing the take lanes with one final result
- [ ] Take counter display on track header showing "Take 3/5" during recording
- [ ] Delete individual takes (right-click → Delete Take)
- [ ] Works for both Audio and MIDI track types
- [ ] Tauri commands: `set_active_take`, `split_take_at`, `select_comp_region`, `flatten_comp`, `delete_take`, `get_take_lanes`
- [ ] Tauri event: `take_created` (emitted at each loop boundary during recording)

### Non-Functional Requirements

- [ ] Supports up to 32 takes per loop region without UI performance degradation
- [ ] Seamless take transitions at loop boundaries — no click or gap between the end of one pass and the start of the next
- [ ] Audio crossfade (5 ms) at comp splice points to prevent clicks when comping between takes
- [ ] Take WAV files stored in project temp directory (`{project_dir}/.mapp-temp/takes/`)
- [ ] Flattened comp for audio creates a new WAV file; original takes can be deleted to save disk space

## Dependencies

- **Sprints**: Sprint 9 (Audio Recording — `AudioRecorder` writes WAV files), Sprint 12 (Pattern System — patterns hold MIDI notes), Sprint 13 (Song Timeline — timeline track rows where take lanes appear), Sprint 25 (Transport — loop region, loop active flag, tick position), Sprint 30 (Track Management — `Track` struct, track armed state), Sprint 36 (MIDI Recording — `MidiRecorder` captures notes into patterns)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio/take_lane.rs` — `TakeLane`, `Take`, `CompRegion` structs and management logic
- `src-tauri/src/audio/loop_recorder.rs` — `LoopRecordController` that monitors loop boundaries and signals recorders to finalize/start new takes
- Extension to `Track` (Sprint 30) with `take_lanes: Option<Vec<TakeLane>>` field
- Extension to Sprint 9 `AudioRecorder` to accept loop-boundary stop/start commands from `LoopRecordController`
- Extension to Sprint 36 `MidiRecorder` to accept loop-boundary stop/start commands
- Comp logic: `CompRegion { start_tick, end_tick, take_index }` defines which take is active per region
- Flatten operation: reads comp regions, copies the active sections into a new clip/pattern
- Audio crossfade at comp splice points (5 ms linear ramp)
- Tauri commands for all take lane operations
- React `TakeLaneView.tsx` — stacked take rows under the parent track in the timeline
- React `CompOverlay.tsx` — visual comp region highlights on take lanes
- Take counter badge on `TrackHeader` during recording

### Out of Scope

- Automatic best-take detection (AI-based pitch/timing analysis — backlog)
- Take lanes for step sequencer patterns (Sprint 10 manages its own state)
- Cross-track comping (comping between takes on different tracks)
- Punch recording with takes (Sprint 38 owns punch; integration is backlog)
- Playlist/versioning (multiple comp variations — backlog)

## Technical Approach

`LoopRecordController` subscribes to transport position updates (Sprint 25). When loop mode and recording are both active, it monitors the tick position. At the loop end boundary, it sends `FinalizeCurrentTake` to the active recorder (Sprint 9 `AudioRecorder` or Sprint 36 `MidiRecorder`), which closes the current WAV file or finalizes the current pattern. It immediately sends `StartNewTake` to begin the next pass. The finalized take is wrapped in a `Take { id, take_number, clip_or_pattern_id, loop_start_tick, loop_end_tick }` and appended to the track's `TakeLane`.

For comping, the track maintains a `Vec<CompRegion>` sorted by `start_tick`. Each `CompRegion` references a `take_index` indicating which take is active in that time range. The default comp is a single region spanning the entire loop with `take_index = 0` (most recent take). When the user splits a take lane at a point, the region is split into two, and clicking a different take in a region changes its `take_index`. During playback, the arrangement scheduler reads the comp regions and routes audio/MIDI from the appropriate take for each section.

Flattening iterates the comp regions, copies the appropriate audio samples (or MIDI notes) from each referenced take into a new WAV file (or pattern), applies 5 ms crossfades at splice points, and replaces the take lanes with the single result.

## Tasks

### Phase 1: Planning
- [ ] Design `TakeLane`, `Take`, and `CompRegion` data structures
- [ ] Plan the `LoopRecordController` integration with Sprint 9 and Sprint 36 recorders
- [ ] Design the take lane UI layout (stacked rows, click-to-select, split tool)
- [ ] Plan comp playback routing through the arrangement scheduler

### Phase 2: Implementation
- [ ] Implement `TakeLane`, `Take`, `CompRegion` structs in `take_lane.rs`
- [ ] Implement `LoopRecordController` — monitors loop boundaries, signals recorders
- [ ] Extend Sprint 9 `AudioRecorder` with `FinalizeCurrentTake` / `StartNewTake` commands
- [ ] Extend Sprint 36 `MidiRecorder` with `FinalizeCurrentTake` / `StartNewTake` commands
- [ ] Extend `Track` struct with `take_lanes` field and persistence in project file
- [ ] Implement comp region logic: split, select take per region, merge adjacent same-take regions
- [ ] Implement flatten operation with audio crossfade at splice points
- [ ] Implement comp-aware playback in arrangement scheduler (read from correct take per region)
- [ ] Add all Tauri commands: `set_active_take`, `split_take_at`, `select_comp_region`, `flatten_comp`, `delete_take`, `get_take_lanes`
- [ ] Emit `take_created` Tauri event at each loop boundary
- [ ] Build React `TakeLaneView.tsx` — stacked rows per take, click to activate
- [ ] Build React `CompOverlay.tsx` — visual highlights on active comp regions
- [ ] Add take counter badge to `TrackHeader` during recording
- [ ] Add right-click context menu on takes (Delete Take, Set Active)

### Phase 3: Validation
- [ ] Loop record 4 MIDI takes — all 4 takes visible in take lanes with correct content
- [ ] Loop record 3 audio takes — 3 separate WAV files created, all auditionable
- [ ] Click take 2 in take lane — playback switches to take 2
- [ ] Split a take at bar 3, select take 1 for bars 1-3 and take 3 for bars 3-5 — comp plays correctly
- [ ] Flatten comp — single clip/pattern replaces take lanes, sounds identical to the comp
- [ ] Audio comp splice points have no clicks (crossfade applied)
- [ ] Delete a take — take removed from lane, comp regions referencing it fall back to nearest take
- [ ] 20 takes recorded — UI remains responsive, no audio glitches

### Phase 4: Documentation
- [ ] Rustdoc on `TakeLane`, `Take`, `CompRegion`, `LoopRecordController`
- [ ] Document the loop recording flow: transport loop → LoopRecordController → recorder → take lane → comp → flatten
- [ ] Document comp region data structure and playback routing

## Acceptance Criteria

- [ ] Loop recording creates a new take on each loop pass for both audio and MIDI tracks
- [ ] Take lanes display all takes stacked under the track in the timeline
- [ ] Clicking a take makes it the active playback source
- [ ] Comp mode allows splitting takes and selecting different takes per region
- [ ] Flatten merges comp regions into a single clip/pattern
- [ ] No clicks at loop boundaries or comp splice points
- [ ] Take lane state persists in the project file
- [ ] All tests pass

## Notes

Created: 2026-02-23
Both Sprint 36 (MIDI Recording) and Sprint 9 (Audio Recording) explicitly defer loop recording with take lanes to this sprint. Sprint 38 (Punch In/Out) is separate — punch + loop recording integration is backlog.
