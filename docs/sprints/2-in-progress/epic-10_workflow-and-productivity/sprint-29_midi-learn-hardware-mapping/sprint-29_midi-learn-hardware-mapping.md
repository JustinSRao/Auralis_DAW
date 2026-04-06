---
sprint: 29
title: "MIDI Learn & Hardware Controller Mapping"
type: fullstack
epic: 10
status: in-progress
created: 2026-02-23T00:00:00Z
started: 2026-04-05T14:10:34Z
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 75

---

# Sprint 29: MIDI Learn & Hardware Controller Mapping

## Overview

| Field | Value |
|-------|-------|
| Sprint | 29 |
| Title | MIDI Learn & Hardware Controller Mapping |
| Type | fullstack |
| Epic | 10 - Workflow & Productivity |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Implement a MIDI Learn system that lets users right-click any automatable parameter and map it to an incoming MIDI CC message from a hardware controller. Mappings are saved in the project file and a mapping table lets users view and delete all active mappings.

## Background

Sprint 3 (MIDI I/O) routes MIDI note events to instruments, but MIDI CC messages (the signals sent by hardware knob/fader controllers) are currently not routed to any DAW parameters. Producers who use hardware controllers (Akai APC, Novation Launch Control, etc.) expect to twist a physical knob and see a DAW parameter respond. Without MIDI Learn, the DAW is hardware-unfriendly and requires mouse-only operation.

## Requirements

### Functional Requirements

- [ ] MIDI Learn mode: right-click any automatable parameter → "MIDI Learn" enters listen mode
- [ ] While in listen mode, the next incoming CC message on any channel is mapped to that parameter
- [ ] Mapping active: incoming CC value (0–127) is scaled to the parameter's min/max range in real time
- [ ] MIDI Mapping table panel: shows all active mappings (parameter name, CC number, channel, range)
- [ ] Mappings deletable from the mapping table
- [ ] Mappings saved in the project file (`.mapp`) and restored on load
- [ ] Global MIDI CC pass-through: unmapped CCs do not block MIDI note flow

### Non-Functional Requirements

- [ ] CC-to-parameter routing latency < 5ms from MIDI input to parameter change
- [ ] Mapping resolution: full 0–127 range scales smoothly with no stepping artifacts
- [ ] Up to 128 active mappings supported simultaneously with no performance degradation

## Dependencies

- **Sprints**:
  - Sprint 3 (MIDI I/O System) — MIDI event bus must be running
  - Sprint 2 (Core Audio Engine) — parameter change pathway (atomic_float / crossbeam-channel)

## Scope

### In Scope

- `src-tauri/src/midi/mapping.rs` — `MidiMapping` struct, `MappingRegistry`, CC-to-parameter dispatch
- Tauri commands: `start_midi_learn`, `cancel_midi_learn`, `delete_midi_mapping`, `get_midi_mappings`
- Tauri events: `midi-learn-captured` (emitted when CC detected in learn mode)
- `src/components/daw/MidiMappingPanel.tsx` — mapping table panel
- `src/hooks/useMidiLearn.ts` — hook: activates learn mode on a parameter, listens for `midi-learn-captured`
- Integration: project file serialization (Sprint 4 `.mapp` format) extended to include mappings
- Context menu: "MIDI Learn" option added to all automatable parameter controls

### Out of Scope

- MIDI Program Change mapping (backlog)
- MIDI clock sync (Sprint 3 or backlog)
- Macro knobs — one CC controlling multiple parameters (Epic 10 backlog)
- MPE (MIDI Polyphonic Expression) support (backlog)

## Technical Approach

`MappingRegistry` in Rust holds a `HashMap<(u8 channel, u8 cc), ParameterId>`. The MIDI event loop (Sprint 3) checks incoming CC messages against the registry; on match, it writes the scaled value to the parameter's `AtomicFloat` or sends a command on its `crossbeam-channel`. MIDI Learn mode sets a `pending_learn: Option<ParameterId>` in a `Mutex`; the next CC message completes the mapping and emits `midi-learn-captured`. The frontend `useMidiLearn` hook calls `start_midi_learn(paramId)` and listens for the event to confirm. The mapping table subscribes to `get_midi_mappings` on open.

## Tasks

### Phase 1: Planning
- [ ] Define `ParameterId` — a stable string identifier for every automatable parameter
- [ ] Design `MappingRegistry` and its interaction with the MIDI event loop
- [ ] Plan context menu integration strategy for parameter controls

### Phase 2: Implementation
- [ ] Define `ParameterId` enum/string scheme and register all current automatable parameters
- [ ] Implement `MappingRegistry` with CC dispatch in MIDI event loop
- [ ] Implement `start_midi_learn` / cancel / delete Tauri commands
- [ ] Implement `midi-learn-captured` event emission on CC capture
- [ ] Build `useMidiLearn` hook
- [ ] Add "MIDI Learn" to context menu of all parameter knobs/sliders
- [ ] Build `MidiMappingPanel.tsx` table
- [ ] Extend Sprint 4 project file save/load to include mappings

### Phase 3: Validation
- [ ] Unit test: `MappingRegistry` dispatches CC to correct parameter
- [ ] Unit test: CC value 0 and 127 map to parameter min and max correctly
- [ ] Unit test: deleting a mapping removes it from the registry
- [ ] Integration test: MIDI learn capture → CC movement → parameter changes
- [ ] Manual: turn physical hardware knob → DAW parameter moves in real time

### Phase 4: Documentation
- [ ] Rustdoc on `MappingRegistry` and `MidiMapping`
- [ ] README section: how to use MIDI Learn with hardware controllers

## Acceptance Criteria

- [ ] Right-click any parameter → MIDI Learn → twist CC knob → mapping created
- [ ] Mapped CC controls parameter in real time with < 5ms latency
- [ ] Mapping table shows all active mappings
- [ ] Deleting a mapping stops the CC from affecting the parameter
- [ ] Mappings survive project save/load cycle
- [ ] All unit tests pass

## Notes

Created: 2026-02-23
