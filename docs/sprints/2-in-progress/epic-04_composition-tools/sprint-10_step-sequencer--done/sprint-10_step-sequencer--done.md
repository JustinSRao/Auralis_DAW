---
sprint: 10
title: "Step Sequencer"
type: fullstack
epic: 4
status: done
created: 2026-02-22T22:10:02Z
started: 2026-03-06T13:44:08Z
completed: 2026-03-06
hours: null
workflow_version: "3.1.0"




---

# Sprint 10: Step Sequencer

## Overview

| Field | Value |
|-------|-------|
| Sprint | 10 |
| Title | Step Sequencer |
| Type | fullstack |
| Epic | 4 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build a step sequencer that drives any instrument with a configurable 16/32/64-step grid, with per-step note, velocity, gate length, and probability controls, synced to the master engine tempo.

## Background

A step sequencer is the fastest way to create melodic loops — users click steps to set notes and the engine plays them in order. Unlike the drum machine (Sprint 8), this sequencer allows different notes per step (melodic sequences) and connects to any instrument, making it a versatile composition tool. It is the first composition tool in Epic 4 and pairs with the piano roll (Sprint 11) for longer note sequences.

## Requirements

### Functional Requirements

- [ ] Configurable pattern length: 16, 32, or 64 steps
- [ ] Per-step settings: note (MIDI note number, C0–G10), velocity (1–127), gate length (as fraction of step duration, 0.1–1.0), probability (0–100%)
- [ ] Steps can be toggled on/off independently of their settings
- [ ] Sequence routes to any connected instrument via an assignable instrument output slot
- [ ] Tempo sync: locked to master BPM (from Sprint 2 audio engine)
- [ ] Configurable time division: 1/4, 1/8, 1/16, 1/32 per step
- [ ] Global transpose: shift all step notes up/down by semitones
- [ ] Tauri commands: `set_sequencer_step`, `set_sequencer_length`, `set_sequencer_time_div`, `get_sequencer_state`

### Non-Functional Requirements

- [ ] Step trigger timing within ±1 audio buffer period of intended beat position
- [ ] Probability randomization is per-step and re-evaluated each time the step is reached
- [ ] React grid renders smoothly at playback speeds up to 1/32 at 200 BPM (200 × 32/4 = 1600 triggers/min)

## Dependencies

- **Sprints**: Sprint 2 (master BPM clock), Sprint 3 (MIDI output to drive instruments), Sprint 6 / Sprint 7 (instruments that receive the note events)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/sequencer/step_sequencer.rs` — `StepSequencer` struct with step clock and note output
- `src-tauri/src/sequencer/step.rs` — `SequencerStep` (note, velocity, gate, probability, enabled)
- Tauri commands: `set_sequencer_step`, `set_sequencer_length`, `set_sequencer_time_div`, `set_sequencer_transpose`, `get_sequencer_state`
- Tauri event: `sequencer_step_changed` (current step index, for UI highlight)
- React `StepSequencerPanel`: horizontal step grid, per-step note selector (click+drag or number input), velocity bar per step, gate knob per step, probability knob per step, length/time-div controls

### Out of Scope

- Euclidean rhythm generation
- Multiple simultaneous sequencer lanes (one instrument per sequencer)
- MIDI import/export of sequence
- Polyrhythmic mode (different lengths per track — covered by pattern system in Sprint 12)

## Technical Approach

`StepSequencer` is an audio-thread component that tracks the current step position using a sample counter advancing each audio callback. When the sample counter crosses a step boundary (computed from BPM and time division), it reads the current `SequencerStep`, evaluates probability with a fast PRNG, and if the step fires, sends a MIDI note-on event to the connected instrument's event queue, and schedules a note-off after `gate_fraction × step_duration_samples` samples. Step data is stored in a fixed-size array of `SequencerStep` and updated atomically from the main thread via a `crossbeam_channel` command queue. The current step index is sent to the frontend as a Tauri event via a channel-to-event relay pattern matching the drum machine.

## Tasks

### Phase 1: Planning
- [ ] Define `SequencerStep` data structure with all per-step fields
- [ ] Plan step clock algorithm with correct handling of time division changes mid-pattern
- [ ] Design React grid component — decide row layout (one row of steps with multi-parameter editing)

### Phase 2: Implementation
- [ ] Implement `SequencerStep` struct and `StepSequencer` with step clock
- [ ] Implement probability evaluation with fast PRNG (no `rand` heap allocation on audio thread)
- [ ] Implement gate duration (schedule note-off within same buffer or flag for next buffer)
- [ ] Implement `set_sequencer_step` Tauri command (partial step update by field name)
- [ ] Emit `sequencer_step_changed` event per step for UI highlight
- [ ] Build React step grid: row of toggle buttons with per-step note/velocity/gate/probability settings
- [ ] Add per-step popover or sub-row for editing velocity, gate, probability
- [ ] Add transpose slider and time-division/length selectors

### Phase 3: Validation
- [ ] Program a C-major ascending scale across 8 steps — plays correctly at 120 BPM
- [ ] Set step 4 probability to 50% — step fires roughly half the time over many bars
- [ ] Change time division to 1/32 at 140 BPM — sequence plays fast without timing drift
- [ ] Global transpose +12 — all notes sound one octave higher
- [ ] Step highlight in UI tracks current position accurately

### Phase 4: Documentation
- [ ] Rustdoc on `StepSequencer`, `SequencerStep`, step clock algorithm
- [ ] Document time division formula and probability PRNG choice

## Acceptance Criteria

- [ ] Steps play notes at the correct MIDI pitch for the assigned instrument
- [ ] Velocity differences per step are audible in the instrument output
- [ ] Gate length shorter than 1.0 causes notes to end before the next step
- [ ] Probability 0% never fires; 100% always fires; 50% fires approximately half the time
- [ ] Pattern loops continuously and seamlessly without timing gaps
- [ ] Current step column highlighted in UI in real time during playback

## Notes

Created: 2026-02-22
