---
sprint: 38
title: "Punch In/Out Recording"
type: fullstack
epic: 3
status: planning
created: 2026-02-23T12:32:35Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 38: Punch In/Out Recording

## Overview

| Field | Value |
|-------|-------|
| Sprint | 38 |
| Title | Punch In/Out Recording |
| Type | fullstack |
| Epic | 3 |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Enable punch in/out recording — the ability to set punch-in and punch-out markers so the DAW only records between those two points while playing back the rest of the arrangement, allowing users to fix mistakes in a specific section without re-recording the entire take.

## Background

Sprint 9 (Audio Recording) explicitly placed punch in/out out of scope: "Punch-in/out recording (record only between markers)." Sprint 36 (MIDI Recording) similarly deferred it. No sprint picked it up. Punch recording is a standard DAW workflow: the user sets a punch-in point (e.g., bar 5) and a punch-out point (e.g., bar 9), arms a track, presses play from bar 1, listens to the existing arrangement, and the DAW automatically starts recording only when the transport hits bar 5 and stops recording at bar 9 — all while playback continues uninterrupted. This is the standard way to fix a wrong note or bad vocal phrase mid-take.

## Requirements

### Functional Requirements

- [ ] Punch-in marker: a transport position (bar:beat:tick) where recording starts automatically
- [ ] Punch-out marker: a transport position where recording stops automatically
- [ ] Punch mode toggle: when enabled, recording only occurs between punch-in and punch-out markers
- [ ] Works for both audio recording (Sprint 9) and MIDI recording (Sprint 36)
- [ ] During playback before punch-in: track plays back existing content (or silence if empty)
- [ ] At punch-in: recording begins seamlessly — audio input captured to WAV (Sprint 9) or MIDI events captured to pattern (Sprint 36)
- [ ] At punch-out: recording stops seamlessly — existing content after punch-out continues playing
- [ ] Punch markers visible on the transport ruler / timeline as draggable flags
- [ ] Punch markers snap to the quantization grid
- [ ] Tauri commands: `set_punch_in`, `set_punch_out`, `toggle_punch_mode`, `get_punch_markers`
- [ ] React UI: punch-in/out buttons in transport bar, draggable markers on timeline ruler

### Non-Functional Requirements

- [ ] Recording start/stop at punch points must be sample-accurate (no clicks or gaps at boundaries)
- [ ] Crossfade at punch boundaries: apply a short (5–10 ms) crossfade between existing content and newly recorded material to prevent clicks
- [ ] Punch mode state persists in the project file
- [ ] Pre-roll option: start playback N bars before punch-in to give the performer time to prepare

## Dependencies

- **Sprints**: Sprint 9 (Audio Recording — punch extends the audio recording engine), Sprint 25 (Transport — provides bar/beat position and pre-roll), Sprint 36 (MIDI Recording — punch extends the MIDI recording engine), Sprint 13 (Timeline — displays punch markers on the ruler)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio/punch.rs` — `PunchController`: monitors transport position and sends record-start/record-stop commands at punch boundaries
- Extension to Sprint 9's audio recording: accept start/stop commands from `PunchController` instead of only user button press
- Extension to Sprint 36's MIDI recording: accept start/stop commands from `PunchController`
- Crossfade logic at punch boundaries (short fade-in at punch-in, fade-out at punch-out)
- Punch marker state in transport store
- React punch marker UI on timeline ruler (draggable flags)
- React punch mode toggle button in transport bar
- Pre-roll setting (number of bars before punch-in to start playback)

### Out of Scope

- Loop recording with multiple takes / comp lanes
- Automatic punch detection (auto-punch based on signal threshold)
- Punch recording on multiple tracks simultaneously (single armed track only for v1)

## Technical Approach

`PunchController` subscribes to transport position updates (Sprint 25). When punch mode is active and recording is armed, it watches the tick position. At `punch_in_tick`, it sends a `StartRecording` command to the appropriate recorder (Sprint 9 `AudioRecorder` or Sprint 36 `MidiRecorder`). At `punch_out_tick`, it sends `StopRecording`. For audio, a short crossfade envelope (linear ramp, 5 ms = ~220 samples at 44.1 kHz) is applied at the punch-in and punch-out boundaries to prevent clicks. The punch-in crossfade ramps the new recording from 0→1 while the existing content ramps 1→0. The punch-out crossfade does the reverse. For MIDI, no crossfade is needed — notes simply start/stop being captured. Pre-roll sets the transport start position to `punch_in_tick - pre_roll_bars * ticks_per_bar` so the performer hears context before recording begins.

## Tasks

### Phase 1: Planning
- [ ] Define `PunchController` interface and its integration points with Sprint 9 and Sprint 36 recorders
- [ ] Design crossfade algorithm for audio punch boundaries
- [ ] Plan punch marker UI placement on the timeline ruler

### Phase 2: Implementation
- [ ] Implement `PunchController` with punch-in/punch-out tick monitoring
- [ ] Extend Sprint 9 `AudioRecorder` to accept start/stop commands from `PunchController`
- [ ] Extend Sprint 36 `MidiRecorder` to accept start/stop commands from `PunchController`
- [ ] Implement audio crossfade at punch boundaries (fade-in at punch-in, fade-out at punch-out)
- [ ] Implement pre-roll: transport starts N bars before punch-in
- [ ] Add Tauri commands: `set_punch_in`, `set_punch_out`, `toggle_punch_mode`, `get_punch_markers`
- [ ] Add punch marker state to transport store and project file persistence
- [ ] Build React punch marker flags on timeline ruler (draggable, snappable)
- [ ] Build React punch mode toggle button in transport bar
- [ ] Build React pre-roll setting control

### Phase 3: Validation
- [ ] Set punch-in at bar 5, punch-out at bar 9, record audio — only bars 5-9 are recorded; bars before and after are unchanged
- [ ] MIDI punch: record MIDI between punch points — only notes in that range appear in the pattern
- [ ] Crossfade: no audible click at punch-in or punch-out boundaries in audio recording
- [ ] Pre-roll: with 2-bar pre-roll, playback starts at bar 3 when punch-in is bar 5
- [ ] Punch markers are draggable on the timeline ruler and snap to grid
- [ ] Punch mode persists after project save/load

### Phase 4: Documentation
- [ ] Rustdoc on `PunchController`, crossfade algorithm, punch mode state machine
- [ ] Document integration points with Sprint 9 and Sprint 36 recorders

## Acceptance Criteria

- [ ] Punch mode records only between the punch-in and punch-out markers
- [ ] Works for both audio and MIDI recording
- [ ] No clicks or gaps at punch boundaries (crossfade applied for audio)
- [ ] Punch markers are visible and draggable on the timeline
- [ ] Pre-roll provides lead-in bars before the punch-in point
- [ ] Punch state persists in the project file
- [ ] All tests pass

## Notes

Created: 2026-02-23
Sprint 9 explicitly deferred this: "Punch-in/out recording (record only between markers)." This sprint picks up that deferred scope and extends both audio (Sprint 9) and MIDI (Sprint 36) recording engines.
