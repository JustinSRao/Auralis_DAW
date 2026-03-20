---
sprint: 31
title: "Arrangement Playback Engine"
type: backend
epic: 4
status: done
created: 2026-02-23T00:00:00Z
started: 2026-03-15T17:18:51Z
completed: 2026-03-15
hours: null
workflow_version: "3.1.0"
coverage_threshold: 65
# Justification: Core scheduling loop runs on audio thread — tested via integration smoke tests; BBT scheduling logic is unit-testable


---

# Sprint 31: Arrangement Playback Engine

## Overview

| Field | Value |
|-------|-------|
| Sprint | 31 |
| Title | Arrangement Playback Engine |
| Type | backend |
| Epic | 4 - Composition Tools |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Implement the Rust backend scheduler that reads arrangement clip placements (from Sprint 13) and triggers the correct patterns on the correct tracks at sample-accurate bar positions during transport playback. Without this sprint the arrangement view is display-only — patterns placed on the timeline produce no sound.

## Background

Sprint 13 builds the arrangement UI canvas and stores clip placements in Zustand + the project file. Sprint 2 runs the audio engine. Sprint 25 runs the transport clock. But none of these sprints connect the dots: when the transport plays bar 3, the clips starting at bar 3 must be triggered. This scheduling logic lives between the transport clock and the AudioGraph and is non-trivial — it requires sample-accurate scheduling, handling of clips spanning the loop boundary, and correct behavior on stop/seek. This sprint closes the gap and makes the arrangement actually play back.

## Requirements

### Functional Requirements

- [ ] When transport plays, patterns placed on the arrangement are triggered at their start bar, sample-accurately
- [ ] Multiple clips across multiple tracks play simultaneously without interference
- [ ] When a clip ends, its pattern stops (no sound bleed)
- [ ] Seeking (clicking on the timeline ruler) reschedules all active and upcoming clips correctly
- [ ] Loop region: clips that overlap the loop boundary repeat correctly
- [ ] Stop: all active clip playback halts cleanly within one buffer period
- [ ] Arrangement data (clip list) sent to the audio thread when arrangement changes and on project load

### Non-Functional Requirements

- [ ] Clip start timing is within ±1 sample of the scheduled bar position
- [ ] Scheduler processes the entire clip list in < 1ms per audio callback
- [ ] No heap allocations in the scheduling hot path

## Dependencies

- **Sprints**:
  - Sprint 2 (Core Audio Engine) — AudioGraph and audio callback architecture
  - Sprint 12 (Pattern System) — patterns are what clips reference
  - Sprint 13 (Song Timeline & Playlist) — clip placement data structure
  - Sprint 25 (Transport & Tempo Engine) — BBT position and transport events

## Scope

### In Scope

- `src-tauri/src/audio/scheduler.rs` — `ArrangementScheduler` struct, per-callback clip scheduling loop
- `src-tauri/src/audio/scheduler.rs` — `ScheduledClip` struct: `{ clip_id, track_id, pattern_id, start_sample, end_sample }`
- Integration: `ArrangementScheduler` integrated into the audio engine callback alongside `AudioGraph`
- Tauri commands: `set_arrangement_clips` (sends full clip list to audio thread via crossbeam-channel)
- Event from React: when arrangement store changes, call `set_arrangement_clips` to sync audio thread

### Out of Scope

- UI for the arrangement (Sprint 13)
- Pattern sequencer playback within a clip (the step sequencer Sprint 10 and piano roll Sprint 11 own that)
- Real-time clip recording (backlog — would extend this scheduler)

## Technical Approach

`ArrangementScheduler` holds a sorted `Vec<ScheduledClip>` (sorted by `start_sample`). On each audio callback it receives the current sample position from `TransportClock` and scans for clips that should start or stop within the current buffer window `[position, position + buffer_size)`. Starting a clip sends a `StartPattern(pattern_id, track_id)` command to the relevant `AudioNode` via its crossbeam-channel. Stopping sends `StopPattern`. The clip list is updated atomically via a `crossbeam-channel` single-producer / single-consumer queue: the main thread sends a new `Vec<ScheduledClip>` and the audio thread swaps it in at buffer boundary. BBT-to-sample conversion uses the same math as `TransportClock` so bar positions and sample positions stay consistent.

## Tasks

### Phase 1: Planning
- [ ] Design `ScheduledClip` data type and its relationship to `ArrangementClip` from Sprint 13
- [ ] Design clip start/stop command protocol for sending to AudioNodes
- [ ] Specify loop boundary behavior (clip that starts in loop but ends after loop end)

### Phase 2: Implementation
- [ ] Implement `ScheduledClip` and bar-to-sample conversion utility
- [ ] Implement `ArrangementScheduler::tick()` — per-callback scheduling scan
- [ ] Implement clip start/stop command dispatch to AudioNode channels
- [ ] Integrate scheduler into audio engine callback
- [ ] Implement `set_arrangement_clips` Tauri command with crossbeam update channel
- [ ] Wire React arrangement store changes to call `set_arrangement_clips`
- [ ] Handle seek: recalculate all active clips on transport position change

### Phase 3: Validation
- [ ] Unit test: `tick()` fires start event at correct sample for known bar/BPM
- [ ] Unit test: `tick()` fires stop event at clip end
- [ ] Unit test: seek mid-clip fires stop on old clip, start on new position correctly
- [ ] Unit test: loop boundary — clip wraps correctly
- [ ] Integration test: place 3 patterns on 2 tracks, play back — all 3 play at correct times
- [ ] Stress test: 32 clips across 16 tracks — no timing drift over 60 seconds

### Phase 4: Documentation
- [ ] Rustdoc on `ArrangementScheduler`, `ScheduledClip`, and the scheduling algorithm
- [ ] Inline comments explaining loop boundary edge cases

## Acceptance Criteria

- [ ] Placing patterns on the timeline and pressing Play produces audio from those patterns at the correct bar positions
- [ ] Multiple tracks play simultaneously without any track silencing another
- [ ] Clicking on the ruler mid-playback seeks correctly with no stuck notes
- [ ] Loop region causes arrangement to cycle without glitches
- [ ] Stop silences all clips within one buffer period
- [ ] All unit tests pass

## Notes

Created: 2026-02-23
