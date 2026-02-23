---
sprint: 3
title: "MIDI I/O System"
type: fullstack
epic: 1
status: in-progress
created: 2026-02-22T22:07:32Z
started: 2026-02-23T12:12:39Z
completed: null
hours: null
workflow_version: "3.1.0"


---

# Sprint 3: MIDI I/O System

## Overview

| Field | Value |
|-------|-------|
| Sprint | 3 |
| Title | MIDI I/O System |
| Type | fullstack |
| Epic | 1 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement full MIDI input and output in Rust using `midir`, enabling the DAW to receive notes from MIDI keyboards and send MIDI to external devices.

## Background

MIDI is how physical keyboards, pads, and controllers communicate with the DAW. Without MIDI I/O, the user can't play instruments in real-time or record MIDI performances. This sprint builds device enumeration, a live MIDI event stream to the audio engine, and a MIDI event bus that the rest of the app subscribes to.

## Requirements

### Functional Requirements

- [ ] Enumerate all connected MIDI input and output devices
- [ ] Open a MIDI input port and stream events to the audio engine
- [ ] Open a MIDI output port and send MIDI messages out
- [ ] Parse standard MIDI messages: NoteOn, NoteOff, ControlChange, PitchBend, AfterTouch
- [ ] MIDI events delivered to audio engine with sub-millisecond latency
- [ ] Frontend can list devices and select active MIDI input/output
- [ ] Hot-plug detection: new devices appear without restart

### Non-Functional Requirements

- [ ] MIDI callback runs on its own OS thread (midir default)
- [ ] MIDI events forwarded to audio thread via lock-free channel
- [ ] No dropped MIDI events under normal load

## Dependencies

- **Sprints**: Sprint 1 (scaffold), Sprint 2 (audio engine — needs the MIDI event receiver)
- **External**: Any USB MIDI device for testing (optional — Windows MIDI is built-in)

## Scope

### In Scope

- `src-tauri/src/midi/manager.rs` — MidiManager: enumerate, open, close ports
- `src-tauri/src/midi/events.rs` — MidiEvent enum and parser
- `src-tauri/src/midi/bus.rs` — MidiEventBus (broadcast to subscribers)
- Tauri commands: `get_midi_devices`, `set_midi_input`, `set_midi_output`
- Integration with AudioEngine event queue

### Out of Scope

- MIDI clock / sync (can add later)
- MIDI file (.mid) import/export (Sprint 4)
- Piano roll MIDI recording (Sprint 12)

## Technical Approach

Use `midir` crate for platform MIDI I/O. `MidiManager` holds open connections. Incoming raw bytes are parsed into `MidiEvent` enums. Events are sent via `crossbeam-channel` to the audio engine (same lock-free channel pattern as Sprint 2). A `MidiEventBus` broadcasts to multiple subscribers (instruments, sequencer, recorder) using `crossbeam-channel` broadcast. Device enumeration is called on startup and on a periodic re-scan thread for hot-plug.

## Tasks

### Phase 1: Planning
- [ ] Confirm `midir` API for Windows (WINMM backend)
- [ ] Design `MidiEvent` enum covering all needed message types
- [ ] Design `MidiEventBus` subscriber pattern

### Phase 2: Implementation
- [ ] Implement `MidiManager` (enumerate, open input, open output)
- [ ] Implement MIDI byte parser → `MidiEvent`
- [ ] Implement `MidiEventBus` with crossbeam broadcast
- [ ] Wire MIDI events into audio engine message queue
- [ ] Add Tauri commands for device selection
- [ ] Write unit tests for MIDI byte parser

### Phase 3: Validation
- [ ] Test with virtual MIDI device (loopMIDI or Windows built-in)
- [ ] Send NoteOn/NoteOff and verify audio engine receives them
- [ ] Hot-plug test: connect device while app running

### Phase 4: Documentation
- [ ] Rustdoc on MidiManager and MidiEvent
- [ ] README: how to test MIDI without hardware (loopMIDI)

## Acceptance Criteria

- [ ] `get_midi_devices` returns connected MIDI devices
- [ ] NoteOn/NoteOff events received from MIDI input and logged
- [ ] Events forwarded to audio engine with correct pitch/velocity
- [ ] MIDI output sends bytes to selected output port
- [ ] Hot-plug: new device appears in list without restart
- [ ] MIDI parser unit tests pass (100% coverage of message types)

## Notes

Created: 2026-02-22
