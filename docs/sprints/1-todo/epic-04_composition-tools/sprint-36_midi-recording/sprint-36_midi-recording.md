---
sprint: 36
title: "MIDI Recording"
type: fullstack
epic: 4
status: planning
created: 2026-02-23T12:31:29Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 36: MIDI Recording

## Overview

| Field | Value |
|-------|-------|
| Sprint | 36 |
| Title | MIDI Recording |
| Type | fullstack |
| Epic | 4 |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Capture live MIDI keyboard performances in real time and record them as note events into piano roll patterns, enabling users to play their MIDI controller and see the performance appear as editable notes.

## Background

Sprint 11 (Piano Roll) provides a visual editor for drawing and editing MIDI notes manually. Sprint 3 (MIDI I/O) provides the infrastructure to receive MIDI input from hardware controllers. However, no sprint currently captures a live MIDI keyboard performance and records it into a pattern's note list in real time. Sprint 11 explicitly deferred this with a broken cross-reference to Sprint 9, which only handles audio recording to WAV files. This sprint bridges the gap: when the user arms a MIDI or instrument track and presses record, incoming MIDI note-on/note-off events are timestamped against the transport clock and inserted into the active pattern as `MidiNote` entries visible in the piano roll.

## Requirements

### Functional Requirements

- [ ] Record-arm a MIDI or Instrument track to enable MIDI recording on that track
- [ ] When transport is in record mode and a track is armed, incoming MIDI note-on/note-off events from Sprint 3 MIDI I/O are captured with transport-clock timestamps
- [ ] Note-on/note-off pairs are converted to `MidiNote { pitch, startTick, durationTicks, velocity }` entries (960 PPQ, matching Sprint 11)
- [ ] Recorded notes are inserted into the active pattern on the armed track in real time
- [ ] Quantize-on-record option: snap recorded note start times to a user-selectable grid (off, 1/4, 1/8, 1/16, 1/32) during capture
- [ ] Overdub mode: record new notes on top of existing pattern content without erasing
- [ ] Replace mode: clear existing notes in the recorded region before inserting new notes
- [ ] Metronome click during recording (optional, toggleable) using transport tempo from Sprint 25
- [ ] Tauri commands: `set_record_mode` (overdub/replace), `set_record_quantize`, `toggle_metronome`
- [ ] React record controls: record mode toggle (overdub/replace), quantize selector, metronome on/off — integrated into transport bar or track header

### Non-Functional Requirements

- [ ] MIDI event timestamping accuracy within 1 ms of actual input time (uses transport tick clock, not wall clock)
- [ ] No heap allocations on the recording hot path — use pre-allocated ring buffer for incoming events
- [ ] Recording must not introduce latency or audio glitches in the playback engine
- [ ] Handle stuck notes gracefully: if note-off is missed, auto-close note after configurable timeout (2 bars default)

## Dependencies

- **Sprints**: Sprint 3 (MIDI I/O — provides `MidiEvent` stream from hardware), Sprint 11 (Piano Roll — defines `MidiNote` type and pattern note list), Sprint 12 (Pattern System — patterns that hold note data), Sprint 25 (Transport & Tempo — provides tick clock for timestamping)
- **External**: MIDI controller hardware (or virtual MIDI port for testing)

## Scope

### In Scope

- `src-tauri/src/midi/recording.rs` — `MidiRecorder` struct: receives MIDI events, timestamps against transport, converts to `MidiNote`, writes to pattern
- `src-tauri/src/midi/metronome.rs` — `Metronome`: generates click audio on beat boundaries during recording
- Tauri commands for record mode, quantize, and metronome control
- Integration with Sprint 3 MIDI event bus (subscribe to incoming note events)
- Integration with Sprint 12 pattern store (write recorded notes into pattern)
- Integration with Sprint 25 transport clock (get current tick position)
- React UI: record arm button on track header (Sprint 30), record mode/quantize controls
- Pre-allocated `crossbeam_channel` ring buffer for lock-free MIDI event passing to recorder

### Out of Scope

- Audio recording (Sprint 9 handles WAV capture)
- MIDI CC recording / automation recording (Sprint 14 Automation Editor or Sprint 29 MIDI Learn)
- Punch in/out recording (Sprint 37)
- Loop recording with take lanes
- MIDI file import (Sprint 32)

## Technical Approach

`MidiRecorder` subscribes to the MIDI event bus (from Sprint 3) via a `crossbeam_channel::Receiver<MidiEvent>`. When the transport is in record mode and a track is armed, each incoming note-on event is pushed into a `pending_notes: HashMap<u8, PendingNote>` keyed by pitch (to match note-off). The `startTick` is read from the transport clock at the moment of note-on. On note-off, the pending note is completed with `durationTicks = current_tick - startTick`, velocity from the note-on event, and the finished `MidiNote` is sent to the pattern store via a command channel. If quantize-on-record is enabled, `startTick` is snapped to the nearest grid boundary before storage. A stuck-note watchdog checks `pending_notes` each bar and auto-closes notes exceeding the timeout. The metronome generates a short click sample (sine wave burst) routed to the master bus at each beat boundary based on the transport tempo.

## Tasks

### Phase 1: Planning
- [ ] Define `MidiRecorder` struct and its channel connections to MIDI I/O, transport, and pattern store
- [ ] Design record arm state flow: track header button → Rust state → enable/disable recording on that track
- [ ] Plan quantize-on-record algorithm (nearest grid snap with configurable resolution)

### Phase 2: Implementation
- [ ] Implement `MidiRecorder` with pending note tracking and note-on/note-off pairing
- [ ] Integrate with Sprint 3 MIDI event bus as a subscriber
- [ ] Integrate with Sprint 25 transport clock for tick timestamping
- [ ] Implement quantize-on-record with selectable grid resolution
- [ ] Implement overdub vs. replace mode (replace clears pattern region before inserting)
- [ ] Implement stuck-note watchdog (auto-close after configurable timeout)
- [ ] Implement `Metronome` click generator routed to master bus
- [ ] Add Tauri commands: `set_record_mode`, `set_record_quantize`, `toggle_metronome`
- [ ] Add record arm state to `Track` struct (Sprint 30) and wire to `MidiRecorder`
- [ ] Build React record controls (mode toggle, quantize selector, metronome button)
- [ ] Emit `recording_started` / `recording_stopped` Tauri events for UI feedback

### Phase 3: Validation
- [ ] Record a 4-bar MIDI performance — notes appear in piano roll at correct positions
- [ ] Enable quantize-on-record at 1/8 — recorded notes snap to eighth-note grid
- [ ] Overdub: record new notes on top of existing pattern — both old and new notes present
- [ ] Replace: record into a region — old notes in that region are cleared
- [ ] Stuck note: hold a note and stop recording — note auto-closes at timeout boundary
- [ ] Metronome click audible on beat boundaries during recording, silent when off
- [ ] Recording does not cause audio glitches or playback interruption

### Phase 4: Documentation
- [ ] Rustdoc on `MidiRecorder`, `Metronome`, record mode enum, quantize algorithm
- [ ] Document the MIDI event flow: hardware → Sprint 3 → event bus → MidiRecorder → pattern store → piano roll

## Acceptance Criteria

- [ ] Playing a MIDI keyboard while recording produces editable notes in the piano roll pattern
- [ ] Note timing matches the transport position (notes land on the correct beats)
- [ ] Quantize-on-record snaps note starts to the selected grid resolution
- [ ] Overdub mode preserves existing notes; replace mode clears the recorded region
- [ ] Metronome provides audible beat clicks during recording when enabled
- [ ] Stuck notes are auto-closed after timeout
- [ ] No audio glitches or added latency during recording
- [ ] All tests pass

## Notes

Created: 2026-02-23
This sprint fixes the broken cross-reference in Sprint 11 which incorrectly cited Sprint 9 (audio recording) as the owner of MIDI recording. Sprint 11's out-of-scope now correctly references this sprint (Sprint 36).
