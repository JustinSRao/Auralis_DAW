---
sprint: 53
title: "Drum Machine Enhancements"
type: fullstack
epic: 14
status: planning
created: 2026-04-07T15:40:13Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 53: Drum Machine Enhancements

## Overview

| Field | Value |
|-------|-------|
| Sprint | 53 |
| Title | Drum Machine Enhancements |
| Type | fullstack |
| Epic | 14 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Wire the drum machine to the master transport clock for BPM, add MIDI note output per pad step, add per-pad volume and pan controls, and add missing factory drum kit presets — completing the deferred Sprint 8 and Sprint 34 drum machine work.

## Background

These four items were deferred from Sprints 8 and 34 postmortems:

- **Sprint 8 debt (master transport clock BPM)**: The drum machine currently has its own internal BPM slider that operates independently of the master transport tempo. When a user changes the master BPM, the drum machine does not follow. In a DAW, all instruments must lock to the master tempo. The fix is to wire the drum machine's tick scheduler to read BPM from `TransportClock` rather than its internal state, and to hide or disable the redundant internal BPM slider.
- **Sprint 8 debt (MIDI note output per step)**: When a drum machine step fires, it currently only triggers internal sample playback. Optionally, it should also send a MIDI note out on a configurable channel and note number. This allows the drum machine to drive external MIDI hardware (drum expanders, groove boxes) in sync with the pattern. Each pad needs a configurable output MIDI channel (1-16) and output MIDI note number.
- **Sprint 8 debt (per-pad mixer controls)**: Each of the 16 drum pads currently plays at fixed volume with no panning. Adding a volume knob and pan knob per pad allows users to mix the kit without routing through the main mixer. The mix is applied in the drum machine's mix stage before the output signal reaches the main audio graph.
- **Sprint 34 debt (additional factory drum kits)**: The existing factory presets only include "Acoustic Kit" and "Electronic Kit". Two or three additional factory kits are needed to give users more variety out of the box.

## Requirements

### Functional Requirements

- [ ] **Master clock BPM**: The drum machine tick scheduler reads BPM from `TransportClock` via the existing transport state. The internal BPM slider is removed from the UI (or hidden/disabled with a tooltip "BPM controlled by master transport"). When the user changes master BPM, the drum machine immediately adjusts its tick timing.
- [ ] **MIDI note output per step**: Each drum pad has two configurable fields: `midi_out_channel: Option<u8>` (1-16 or None to disable) and `midi_out_note: u8` (0-127). When `midi_out_channel` is Some, each step fire sends a MIDI NoteOn on the configured channel and note, followed by a NoteOff after one step duration.
- [ ] **Per-pad volume and pan**: Each drum pad has a `volume: f32` (0.0-1.0, default 1.0) and `pan: f32` (-1.0 to +1.0, default 0.0). The drum machine's mix stage applies `volume * pan_matrix` to each pad's sample before summing. Volume and pan are exposed as a small knob pair per pad in the drum machine UI.
- [ ] **Factory presets**: Two or three new factory drum kit JSON presets exist in `src-tauri/resources/presets/drum_machine/`:
  - `lo_fi_kit.json` — uses gritty/lo-fi characteristic settings (low-pass filtered, reduced velocity range)
  - `minimal_kit.json` — sparse kit with kick, snare, and hi-hat only with clean settings
  - Optionally: `latin_kit.json` — percussion-focused with congas, bongos, shakers
- [ ] New factory presets are embedded via `include_str!()` and appear in the preset browser

### Non-Functional Requirements

- [ ] BPM is read from `TransportClock` atomically — no mutex access on the audio thread for BPM lookup
- [ ] MIDI note output is sent via the existing MIDI event bus — no new MIDI output path needed
- [ ] Per-pad volume/pan multiply is integer arithmetic or pre-multiplied float — no allocation on the audio thread
- [ ] Factory preset JSON files pass schema validation (same schema as user-saved drum machine presets)

## Dependencies

- **Sprints**: Sprint 8 (Drum Machine — pad data model, tick scheduler, mix stage), Sprint 25 (Transport & Tempo — `TransportClock` BPM access), Sprint 3 (MIDI I/O — MIDI event bus for note output), Sprint 34 (Presets — factory preset embedding mechanism)
- **External**: None

## Scope

### In Scope

- Master transport clock BPM wiring in drum machine tick scheduler
- Removal/disabling of internal drum machine BPM slider
- Per-pad `midi_out_channel` and `midi_out_note` fields with UI controls
- MIDI note output via event bus when a step fires
- Per-pad `volume` and `pan` fields with knob controls in the drum machine UI
- Volume/pan applied in the drum machine mix stage
- 2-3 additional factory drum kit presets

### Out of Scope

- Per-step velocity or probability (tracked as a separate enhancement in the backlog)
- Drum machine pattern length changes
- Swing/shuffle timing
- Per-pad effects chains

## Technical Approach

### Master Clock BPM Wiring

In the drum machine's tick scheduler (likely in `instruments/drum_machine.rs` or `audio/`), replace the internal `self.bpm` field read with a read from `transport_clock.bpm()` (an atomic or channel-based read). The tick interval in samples becomes:
```rust
let bpm = transport_clock.bpm(); // atomic f32 read
let samples_per_beat = sample_rate * 60.0 / bpm;
let samples_per_step = samples_per_beat / (steps_per_beat as f32);
```
Remove the `internal_bpm` field from the `DrumMachine` struct. In `DrumMachinePanel.tsx`, remove the BPM slider or replace it with a read-only display showing the master BPM.

### MIDI Note Output

Add `midi_out_channel: Option<u8>` and `midi_out_note: u8` to the `Pad` struct. When a step fires, after triggering the sample, check:
```rust
if let Some(channel) = pad.midi_out_channel {
    midi_event_bus.send(MidiEvent::NoteOn { channel, note: pad.midi_out_note, velocity: 100 });
    // NoteOff scheduled after one step duration via transport scheduler
}
```
In the drum machine UI, add a small configuration area per pad (expandable or in a settings popover) with a channel selector (dropdown 1-16 or "Off") and a note number field.

### Per-Pad Volume and Pan

Add `volume: f32` (0.0-1.0) and `pan: f32` (-1.0 to +1.0) to the `Pad` struct. In the mix stage, compute the left/right amplitudes:
```rust
let left_gain = pad.volume * (1.0 - pad.pan.max(0.0));
let right_gain = pad.volume * (1.0 + pad.pan.min(0.0));
```
Apply to the pad's sample output before summing into the master drum mix buffer. In the UI, add a tiny volume knob and pan knob below each pad button, using the existing `Knob` component with a compact size variant.

### Factory Presets

Create the JSON files following the existing preset schema. Each preset specifies pad sample assignments (using built-in sample paths), ADSR, and the new volume/pan/midi fields at their defaults. Embed with `include_str!()` alongside the existing `acoustic_kit.json` and `electronic_kit.json`.

## Tasks

### Phase 1: Planning
- [ ] Locate the drum machine BPM read point in the tick scheduler
- [ ] Confirm `TransportClock` BPM is accessible from the drum machine's audio thread context (atomic read)
- [ ] Review the `Pad` struct fields — identify what needs to be added
- [ ] Review the drum machine mix stage — locate where pad samples are summed

### Phase 2: Backend Implementation
- [ ] Remove `internal_bpm` field from `DrumMachine` struct; wire to `transport_clock.bpm()` in tick scheduler
- [ ] Add `midi_out_channel: Option<u8>` and `midi_out_note: u8` to `Pad` struct
- [ ] Implement MIDI NoteOn/NoteOff dispatch when a step fires and `midi_out_channel` is Some
- [ ] Add `volume: f32` and `pan: f32` to `Pad` struct with defaults 1.0 and 0.0
- [ ] Apply volume/pan gain in the drum machine mix stage
- [ ] Update `DrumMachine` project serde to include new pad fields with backwards-compatible defaults
- [ ] Create factory preset JSON files: `lo_fi_kit.json`, `minimal_kit.json`
- [ ] Embed new factory presets with `include_str!()` in `src-tauri/src/presets/`

### Phase 3: Frontend Implementation
- [ ] Remove or replace the BPM slider in `DrumMachinePanel.tsx` with a read-only master BPM display
- [ ] Add volume knob (compact) and pan knob (compact) per pad in the drum machine grid
- [ ] Add MIDI output configuration per pad (channel dropdown + note number field, in a pad settings popover)
- [ ] Add typed IPC wrapper functions for any new Tauri commands

### Phase 4: Tests
- [ ] Add Rust unit test: drum machine tick interval uses `TransportClock` BPM, not internal field
- [ ] Add Rust unit test: when `midi_out_channel` is Some and a step fires, MIDI event bus receives NoteOn
- [ ] Add Rust unit test: per-pad volume 0.5 produces output at 50% amplitude
- [ ] Add Rust unit test: per-pad pan +1.0 routes all signal to right channel
- [ ] Verify factory presets load and parse correctly

### Phase 5: Validation
- [ ] Manual test: change master BPM — verify drum machine follows immediately
- [ ] Manual test: configure a pad with MIDI out channel 1 note 36, record MIDI — verify note events in recording
- [ ] Manual test: set pad volume to 0.0 — verify pad is silent; set to 0.5 — verify half amplitude
- [ ] Manual test: set pad pan to +1.0 — verify audio only on right channel
- [ ] Manual test: load "Lo-Fi Kit" preset — verify it loads and pads are assigned
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] Drum machine BPM follows master transport clock — internal BPM slider is removed from the UI
- [ ] Changing master BPM immediately changes drum machine tick rate with no UI interaction required
- [ ] Each drum pad has configurable MIDI output channel and note; when enabled, step fires produce MIDI NoteOn/NoteOff events
- [ ] Each drum pad has a volume knob (0.0-1.0) and pan knob (-1.0 to +1.0) visible in the drum machine UI
- [ ] Volume and pan affect the pad's audio output correctly in the mix stage
- [ ] "Lo-Fi Kit" and "Minimal Kit" factory presets appear in the preset browser under Drum Machine
- [ ] New pad fields (`volume`, `pan`, `midi_out_channel`, `midi_out_note`) are serialized to project file with backwards-compatible defaults
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 8 debt | Drum machine follows master transport BPM | `instruments/drum_machine.rs`, `DrumMachinePanel.tsx` |
| Sprint 8 debt | MIDI note output per pad step | `instruments/drum_machine.rs` (step dispatch) |
| Sprint 8 debt | Per-pad volume and pan knobs | `instruments/drum_machine.rs` (mix stage) + UI |
| Sprint 34 debt | Additional factory drum kit presets | `src-tauri/resources/presets/drum_machine/` |

## Notes

Created: 2026-04-07
