---
sprint: 8
title: "Drum Machine"
type: fullstack
epic: 3
status: in-progress
created: 2026-02-22T22:09:57Z
started: 2026-03-04T16:15:47Z
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

- [x] Up to 16 pads, each pad loaded with an individual sample (WAV/MP3/FLAC)
- [x] 16-step grid per pad (expandable to 32 steps via a button)
- [x] Each step can be on/off with a per-step velocity (1–127)
- [x] Swing/shuffle: delay every even step by a configurable percentage (0–50%)
- [x] Tempo sync: step playback is locked to the master engine BPM and time signature
- [x] Start/stop/reset controls for the drum machine playback independently or linked to global transport
- [x] Active step highlighted in the React UI as it plays
- [x] Tauri commands: `set_drum_step`, `load_drum_pad_sample`, `set_drum_swing`, `set_drum_pattern_length`

### Non-Functional Requirements

- [x] Step trigger timing accuracy within ±1 audio buffer period (< 6 ms at 256 samples / 44100 Hz)
- [x] Pattern state serializable as a compact JSON blob for project file storage
- [x] UI step grid renders at 60 fps with no jank during playback using React canvas or CSS grid

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
- [x] Design `DrumPattern` data structure (16 pads × 32 steps with velocity per step)
- [x] Design step clock algorithm that handles BPM changes mid-pattern without drift
- [x] Plan React step grid component — CSS grid vs. canvas

### Phase 2: Implementation
- [x] Implement step clock in `DrumMachine` tied to master sample position
- [x] Implement swing offset calculation per even step
- [x] Implement `DrumPad` sample playback (reuse SamplerVoice from Sprint 7)
- [x] Implement `set_drum_step` and `load_drum_pad_sample` Tauri commands
- [x] Emit `drum_machine_step_changed` event from audio thread → frontend via relay channel
- [x] Build React `DrumMachinePanel` with 16 × 16 step grid (click to toggle)
- [x] Right-click step to set velocity (1–127) in a small popover
- [x] Add swing knob and pattern length selector (16 / 32 steps)
- [x] Wire pad sample load to drag-and-drop file drop on pad label

### Phase 3: Validation
- [x] At 120 BPM play a simple kick-on-1-and-3 pattern — timing is steady
- [x] Apply 25% swing — even steps audibly delayed
- [x] Change BPM to 80 and 160 during playback — pattern speed changes cleanly
- [x] Load 16 pads each with a sample — all fire correctly on their steps
- [x] Active step highlight follows playback at 60 fps without lag

### Phase 4: Documentation
- [x] Rustdoc on `DrumMachine`, `DrumPad`, `DrumPattern`, step clock logic
- [x] Document swing calculation formula in code

## Acceptance Criteria

- [x] 16-step pattern plays in sync with master BPM at multiple tempo values
- [x] Each pad plays its assigned sample on its active steps
- [x] Per-step velocity differences are audible (louder step sounds louder)
- [x] Swing control shifts even steps by the configured percentage
- [x] Active step column in the UI is highlighted as it plays
- [x] Pattern state saves and restores correctly in the project file

## Team Strategy

### Architecture Decisions
- **BPM**: Self-contained — `set_drum_bpm` command + `Arc<AtomicF32>` for lock-free reads on audio thread
- **Voices per pad**: 2 voices per pad × 16 pads = 32 total `SamplerVoice` instances in fixed arrays (no heap alloc)
- **Step highlight**: Tauri event — audio thread pushes `current_step` via `crossbeam_channel` → relay → `drum-step-changed` event

### Module Structure
```
src-tauri/src/instruments/drum_machine/
  mod.rs      DrumMachine AudioNode (holds clock, pads, command/step channels)
  clock.rs    StepClock — sample_position counter, step boundary detection, swing offset
  pattern.rs  DrumPattern — [DrumStep; 32] × 16 pads, velocity per step
  pad.rs      DrumPad — [SamplerVoice; 2], Arc<SampleBuffer>, name string
```

### DrumCommand Enum (channel-based, discrete)
```rust
enum DrumCommand {
    LoadSample { pad_idx: u8, name: String, buffer: Arc<SampleBuffer> },
    SetStep { pad_idx: u8, step_idx: u8, active: bool, velocity: u8 },
    SetPatternLength { length: u8 },   // 16 or 32
    Play, Stop, Reset,
}
```

### Atomics (continuous, lock-free on audio thread)
- `bpm: Arc<AtomicF32>` — 60.0–300.0
- `swing: Arc<AtomicF32>` — 0.0–0.5

### Step Clock Algorithm
```
step_duration = (60.0 / bpm / steps_per_beat) * sample_rate
swing_offset_even = swing * step_duration

For each buffer [sample_pos .. sample_pos + buffer_len]:
  current_step_with_swing = current_step + swing_offset if even
  step_start = current_step_with_swing * step_duration
  if step_start falls in [sample_pos, sample_pos + buffer_len):
    trigger all active pads for current_step
    emit current_step via step_tx channel
    advance current_step = (current_step + 1) % pattern_length
```

### React UI
- CSS grid: 16 columns (steps) × 16 rows (pads), no canvas
- Step buttons: `onClick` → toggle, `onContextMenu` → velocity popover
- Pad label: drag-and-drop target for sample file
- Transport row: Play/Stop/Reset buttons, BPM number input, Swing knob, Length dropdown

## Notes

Created: 2026-02-22
