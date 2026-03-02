---
sprint: 8
title: "Drum Machine"
type: fullstack
epic: 3
status: planning
created: 2026-02-22T22:09:57Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 8: Drum Machine

## Overview

| Field | Value |
|-------|-------|
| Sprint | 8 |
| Title | Drum Machine |
| Type | fullstack |
| Epic | 3 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build a 16-pad drum machine where each pad plays a sample file on a 16-step grid, with per-step velocity, configurable swing, and real-time tempo sync to the master audio engine clock.

## Background

Drum machines are central to modern music production across virtually every genre. This sprint delivers a dedicated rhythmic performance tool that is simpler and faster to program than a full piano roll — users click grid steps to enable them and the engine handles timing automatically, synchronized to the global BPM set in Sprint 2's audio engine.

## Requirements

### Functional Requirements

- [ ] Up to 16 pads, each pad loaded with an individual sample (WAV/MP3/FLAC)
- [ ] 16-step grid per pad (expandable to 32 steps via a button)
- [ ] Each step can be on/off with a per-step velocity (1–127)
- [ ] Swing/shuffle: delay every even step by a configurable percentage (0–50%)
- [ ] Tempo sync: step playback is locked to the master engine BPM and time signature
- [ ] Start/stop/reset controls for the drum machine playback independently or linked to global transport
- [ ] Active step highlighted in the React UI as it plays
- [ ] Tauri commands: `set_drum_step`, `load_drum_pad_sample`, `set_drum_swing`, `set_drum_pattern_length`

### Non-Functional Requirements

- [ ] Step trigger timing accuracy within ±1 audio buffer period (< 6 ms at 256 samples / 44100 Hz)
- [ ] Pattern state serializable as a compact JSON blob for project file storage
- [ ] UI step grid renders at 60 fps with no jank during playback using React canvas or CSS grid

## Dependencies

- **Sprints**: Sprint 2 (master engine clock / BPM), Sprint 3 (optional MIDI trigger output per pad), Sprint 7 (sample decoding via symphonia — reuse)
- **External**: `symphonia` (already added in Sprint 7)

## Scope

### In Scope

- `src-tauri/src/instruments/drum_machine.rs` — `DrumMachine` AudioNode
- `src-tauri/src/instruments/drum_machine/pad.rs` — `DrumPad` (sample buffer + step pattern)
- `src-tauri/src/instruments/drum_machine/pattern.rs` — `DrumPattern` (16×16 step/velocity grid)
- `src-tauri/src/instruments/drum_machine/clock.rs` — step clock tied to master BPM
- Tauri commands: `set_drum_step`, `load_drum_pad_sample`, `set_drum_swing`, `set_drum_bpm`, `get_drum_state`
- React `DrumMachinePanel`: 16-column step grid, pad labels, velocity per step (right-click), playhead column highlight, swing knob, length selector

### Out of Scope

- Individual pad EQ or effects (Sprint 18+)
- MIDI input to trigger pads in real time (Sprint 3 delivers note input, but drum machine uses internal clock)
- Pattern chaining / song mode (Sprint 12 Pattern System covers this)

## Technical Approach

`DrumMachine` implements `AudioNode` and holds a step clock counter driven by the master sample position. On each audio callback, it computes whether any step boundary falls within the current buffer window using `step_duration_samples = (60.0 / bpm) / steps_per_beat * sample_rate`. Swing is applied by adding a delay offset (in samples) to every even-numbered step. When a step triggers, the matching `DrumPad`'s sample buffer is retrieved and a single-shot `SamplerVoice` is started (reusing Sprint 7's voice). The React UI receives the current step index via a Tauri event (`drum_machine_step_changed`) emitted from the audio callback thread via a crossbeam channel relayed by the main thread, used to highlight the active column.

## Tasks

### Phase 1: Planning
- [ ] Design `DrumPattern` data structure (16 pads × 32 steps with velocity per step)
- [ ] Design step clock algorithm that handles BPM changes mid-pattern without drift
- [ ] Plan React step grid component — CSS grid vs. canvas

### Phase 2: Implementation
- [ ] Implement step clock in `DrumMachine` tied to master sample position
- [ ] Implement swing offset calculation per even step
- [ ] Implement `DrumPad` sample playback (reuse SamplerVoice from Sprint 7)
- [ ] Implement `set_drum_step` and `load_drum_pad_sample` Tauri commands
- [ ] Emit `drum_machine_step_changed` event from audio thread → frontend via relay channel
- [ ] Build React `DrumMachinePanel` with 16 × 16 step grid (click to toggle)
- [ ] Right-click step to set velocity (1–127) in a small popover
- [ ] Add swing knob and pattern length selector (16 / 32 steps)
- [ ] Wire pad sample load to drag-and-drop file drop on pad label

### Phase 3: Validation
- [ ] At 120 BPM play a simple kick-on-1-and-3 pattern — timing is steady
- [ ] Apply 25% swing — even steps audibly delayed
- [ ] Change BPM to 80 and 160 during playback — pattern speed changes cleanly
- [ ] Load 16 pads each with a sample — all fire correctly on their steps
- [ ] Active step highlight follows playback at 60 fps without lag

### Phase 4: Documentation
- [ ] Rustdoc on `DrumMachine`, `DrumPad`, `DrumPattern`, step clock logic
- [ ] Document swing calculation formula in code

## Acceptance Criteria

- [ ] 16-step pattern plays in sync with master BPM at multiple tempo values
- [ ] Each pad plays its assigned sample on its active steps
- [ ] Per-step velocity differences are audible (louder step sounds louder)
- [ ] Swing control shifts even steps by the configured percentage
- [ ] Active step column in the UI is highlighted as it plays
- [ ] Pattern state saves and restores correctly in the project file

## Notes

Created: 2026-02-22
