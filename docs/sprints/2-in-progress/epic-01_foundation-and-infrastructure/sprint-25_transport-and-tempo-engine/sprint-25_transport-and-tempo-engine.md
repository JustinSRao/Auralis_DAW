---
sprint: 25
title: "Transport & Tempo Engine"
type: fullstack
epic: 1
status: planning
created: 2026-02-23T00:00:00Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 65
# Justification: Audio thread clock not unit-testable; BBT logic and loop region covered by unit tests; clock jitter verified by integration test
---

# Sprint 25: Transport & Tempo Engine

## Overview

| Field | Value |
|-------|-------|
| Sprint | 25 |
| Title | Transport & Tempo Engine |
| Type | fullstack |
| Epic | 1 - Foundation & Infrastructure |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Build the master transport system: play/stop/pause/record controls, BPM engine, time signature support, and a metronome click track. Every timing-dependent component in the DAW — step sequencer, piano roll playback, song timeline, automation — subscribes to this single authoritative clock.

## Background

Without an explicit sprint owning transport and tempo, the clock risks being partially implemented in multiple sprints (step sequencer, song timeline) with no coherent shared design. This sprint establishes the authoritative timing source before any sequencing work begins, so Sprints 10–14 can depend on a clean, tested API rather than duplicate or conflict on clock logic.

## Requirements

### Functional Requirements

- [ ] Transport controls: Play, Stop, Pause, Record arm
- [ ] BPM control: 20–300 BPM, adjustable while running
- [ ] Time signature: configurable numerator and denominator (4/4, 3/4, 6/8, etc.)
- [ ] Metronome: audible click track synced to transport, with accent on beat 1
- [ ] Transport state broadcasts to all subscribers via Tauri events
- [ ] Playhead position tracked in bars:beats:ticks (BBT) and absolute samples
- [ ] Loop region: set loop start/end, toggle loop mode
- [ ] Frontend transport bar UI: play/stop button, BPM input, time signature selector, loop toggle

### Non-Functional Requirements

- [ ] BPM changes take effect within one buffer period (< 6ms at 256 samples / 44100 Hz)
- [ ] Clock jitter < 1 sample at 44100 Hz over a 60-second run
- [ ] Transport state readable by audio thread via lock-free path only

## Dependencies

- **Sprints**: Sprint 2 (Core Audio Engine) — transport clock is driven by the audio callback

## Scope

### In Scope

- `src-tauri/src/audio/transport.rs` — `TransportState`, `TransportClock`, BBT position tracking
- `src-tauri/src/audio/metronome.rs` — `MetronomeNode` (click track `AudioNode`)
- Tauri commands: `transport_play`, `transport_stop`, `transport_pause`, `set_bpm`, `set_time_signature`, `get_transport_state`, `set_loop_region`, `toggle_loop`
- `src/components/daw/TransportBar.tsx` — transport bar UI component
- `src/stores/transportStore.ts` — Zustand transport state with Tauri event subscription

### Out of Scope

- MIDI clock sync output/input (Sprint 3 MIDI system)
- Tempo automation / tempo track changes over time (Epic 4 backlog)
- Tap tempo UI (backlog)
- Ableton Link sync (backlog)

## Technical Approach

`TransportClock` lives inside the audio engine and advances the playhead by `buffer_size` samples per audio callback. BPM, time signature, and loop settings flow from the main thread via `crossbeam-channel` (discrete commands). The clock maintains `TransportState` (playing, position in samples, BBT) written to an `Arc<RwLock>` only on state transitions (never in the hot path) and emitted as a Tauri event at ~60 fps via a background polling task. `MetronomeNode` reads the BBT position to determine beat boundaries and generates a short sine burst.

## Tasks

### Phase 1: Planning
- [ ] Design `TransportState` and `TransportClock` structs and thread-safety model
- [ ] Define Tauri command surface and event emission strategy
- [ ] Design `TransportBar` React component layout

### Phase 2: Implementation
- [ ] Implement `TransportClock` integrated into audio engine callback loop
- [ ] Implement BBT position calculation from sample position and BPM
- [ ] Implement loop region wrap logic
- [ ] Implement `MetronomeNode` click track AudioNode
- [ ] Add Tauri commands for all transport operations
- [ ] Build `TransportBar.tsx` with play/stop, BPM input, time sig, loop toggle
- [ ] Wire `transportStore.ts` to Tauri event subscription

### Phase 3: Validation
- [ ] Unit test: BBT position advances correctly at several BPMs
- [ ] Unit test: loop region wraps playhead at loop end
- [ ] Unit test: BPM change recalculates samples-per-beat correctly
- [ ] Integration test: play → stop → play returns to position 0 or loop start
- [ ] Manual: metronome click audible and on-beat at 80, 120, 160 BPM

### Phase 4: Documentation
- [ ] Rustdoc on all public `audio::transport` types
- [ ] Comment on clock advancement algorithm in `TransportClock::advance()`

## Acceptance Criteria

- [ ] Play/stop/pause work from the UI transport bar
- [ ] BPM change reflected in audio within one buffer period
- [ ] Metronome click is audible and in sync at various BPMs
- [ ] Loop region plays back correctly and wraps cleanly
- [ ] `get_transport_state` returns current position in both BBT and absolute samples
- [ ] No timing drift over a 60-second playback test
- [ ] All unit tests pass

## Notes

Created: 2026-02-23
