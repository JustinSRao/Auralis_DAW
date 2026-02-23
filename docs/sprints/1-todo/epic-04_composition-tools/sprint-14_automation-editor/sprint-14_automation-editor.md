---
sprint: 14
title: "Automation Editor"
type: fullstack
epic: 4
status: planning
created: 2026-02-22T22:10:03Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 14: Automation Editor

## Overview

| Field | Value |
|-------|-------|
| Sprint | 14 |
| Title | Automation Editor |
| Type | fullstack |
| Epic | 4 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement an automation system that records real-time parameter changes as breakpoint curves, allows drawing automation with linear, exponential, and step interpolation modes, and applies automation values to instrument and effect parameters during playback via `AtomicF32`.

## Background

Automation makes a song dynamic — volume fades, filter sweeps, panning moves, and effect depth changes over time. Without automation, every parameter stays static for the whole song. This sprint builds the recording engine, the breakpoint curve data model, and the visual automation lane editor that appears below tracks in the timeline, completing the full composition toolset in Epic 4.

## Requirements

### Functional Requirements

- [ ] Any automatable parameter (synth knob, mixer fader, effect knob) can have an automation lane
- [ ] Record mode: while transport plays, moving a knob records timestamped control-point values
- [ ] Draw mode: click on an automation lane canvas to add breakpoints; drag breakpoints to adjust value/time
- [ ] Three interpolation modes per segment: linear (ramp), exponential (curved), step (hold until next point)
- [ ] Delete breakpoints by right-clicking or selecting and pressing Delete
- [ ] Automation lane displays the interpolated curve between breakpoints as a smooth line
- [ ] During playback, the automation engine reads the curve at the current transport position and writes values to the parameter's `AtomicF32`
- [ ] Automation lanes are stored per-parameter in the pattern's automation map
- [ ] Automation can be enabled/disabled per lane without deleting data
- [ ] Tauri commands: `set_automation_point`, `delete_automation_point`, `set_automation_interp`, `get_automation_lane`

### Non-Functional Requirements

- [ ] Automation evaluation on the audio thread must be O(log n) lookup (binary search by time) with no allocation
- [ ] Support at least 1000 breakpoints per lane without performance degradation
- [ ] Record mode captures control points at the audio buffer rate (every ~5.8 ms at 256 samples / 44100 Hz)

## Dependencies

- **Sprints**: Sprint 13 (timeline provides the track/pattern context for automation lanes), Sprint 2 (transport position for playback engine), Sprint 6 (synth parameters are `AtomicF32` — automation writes to these)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/automation/lane.rs` — `AutomationLane` with sorted `Vec<ControlPoint>`
- `src-tauri/src/automation/engine.rs` — `AutomationEngine` that evaluates lanes during playback
- `src-tauri/src/automation/record.rs` — records parameter changes during transport playback
- Tauri commands: `set_automation_point`, `delete_automation_point`, `set_automation_interp_mode`, `get_automation_lane`, `enable_automation_lane`
- React `AutomationLane` canvas component: shows breakpoints as circles, draws interpolated curve, handles click/drag
- React `AutomationHeader` sidebar: parameter selector dropdown, enable/disable toggle, record button
- Integration: parameter knobs in `SynthPanel`, `MixerChannel`, etc. emit `automation_record_event` when moved during record mode

### Out of Scope

- LFO-style cyclic modulation (separate modulation system, backlog)
- Per-clip automation (automation here is pattern-scoped)
- Automation of VST3 plugin parameters (Sprint 24)
- MIDI CC automation recording (only internal parameters in this sprint)

## Technical Approach

`AutomationLane` stores a `Vec<ControlPoint>` (each `{ tick: u64, value: f32, interp: Interp }`) sorted by tick. Evaluation uses binary search to find the surrounding points and interpolates: linear uses `lerp`, exponential uses `value_a * (value_b/value_a)^t`, step returns `value_a`. The `AutomationEngine` holds a `HashMap<ParameterId, AutomationLane>` and is called once per audio callback. For each active lane, it evaluates the curve at `current_tick` and writes the result to the corresponding `AtomicF32` in the instrument or mixer parameter table. Record mode is triggered when the transport is playing and `record_enabled` is set: parameter change events (sent from React via Tauri IPC) are timestamped with the current tick and inserted into the lane sorted by tick. The React `AutomationLane` canvas uses quadratic bezier curves to draw smooth interpolated visuals between breakpoints.

## Tasks

### Phase 1: Planning
- [ ] Define `ControlPoint` struct (tick, value, interp mode) and `AutomationLane`
- [ ] Enumerate all automatable parameters across all instruments and effects (assign stable `ParameterId` keys)
- [ ] Design `AutomationEngine` integration point in the audio callback

### Phase 2: Implementation
- [ ] Implement `AutomationLane` with sorted insert, binary search evaluation, linear/exp/step interpolation
- [ ] Implement `AutomationEngine` — per-callback evaluate all enabled lanes and apply to `AtomicF32`
- [ ] Implement record mode: capture timestamped parameter changes from IPC events into lanes
- [ ] Implement Tauri commands for lane CRUD (add/delete/modify control points, enable/disable lane)
- [ ] Build React `AutomationLane` canvas (draw curve, render breakpoint circles, drag handler)
- [ ] Build `AutomationHeader` sidebar with parameter selector and record toggle
- [ ] Wire record mode: when recording active, knob movement in React sends automation event via Tauri
- [ ] Integrate automation lanes into timeline view (show lanes below each track row when expanded)
- [ ] Persist automation lanes in project file

### Phase 3: Validation
- [ ] Record filter cutoff sweep on the synth — curve appears in automation lane, plays back correctly
- [ ] Draw a volume fade (linear) — fader value changes smoothly during playback
- [ ] Switch to exponential interpolation — curve is visually curved and sounds different from linear
- [ ] 1000 control points in one lane — evaluation stays under 1 μs per audio callback
- [ ] Disable lane — parameter returns to its manual value during playback

### Phase 4: Documentation
- [ ] Rustdoc on `AutomationLane`, `ControlPoint`, interpolation formulas, `AutomationEngine`
- [ ] Document `ParameterId` key naming convention

## Acceptance Criteria

- [ ] Moving a knob during record produces a visible automation curve in the lane after transport stops
- [ ] Playback applies automation — the parameter audibly changes over time as the curve dictates
- [ ] Linear interpolation produces a straight-line ramp between control points
- [ ] Exponential interpolation produces a curved ramp (faster at start or end)
- [ ] Step interpolation holds the value constant until the next control point
- [ ] Breakpoints can be added, moved, and deleted in the draw mode
- [ ] Disabling a lane bypasses automation for that parameter
- [ ] Automation data persists in the project file and restores correctly

## Notes

Created: 2026-02-22
