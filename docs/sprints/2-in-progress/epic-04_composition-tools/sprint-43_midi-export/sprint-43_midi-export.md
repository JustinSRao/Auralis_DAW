---
sprint: 43
title: "MIDI Export"
type: fullstack
epic: 4
status: planning
created: 2026-02-23T17:06:03Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 80
---

# Sprint 43: MIDI Export

## Overview

| Field | Value |
|-------|-------|
| Sprint | 43 |
| Title | MIDI Export |
| Type | fullstack |
| Epic | 4 - Composition Tools |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Export MIDI patterns and full arrangements as Standard MIDI Files (.mid), enabling users to share compositions with other DAWs, notation software, or collaborators.

## Background

Sprint 32 (MIDI File Import) completed the inbound side of the MIDI round-trip — users can bring external MIDI content into the DAW. Export is the essential complement: users need to be able to take what they have composed and move it out. This is a baseline expectation of any professional DAW and directly enables collaboration with musicians using Ableton, FL Studio, Logic, or notation tools like MuseScore. Without export, the DAW is a closed system for MIDI composition, which severely limits its value.

The internal data model is already well-suited for this: Sprint 11 defines `MidiNote { id, pitch, startTick, durationTicks, velocity }` at 960 PPQ, Sprint 12 provides `Pattern` objects containing note lists, Sprint 13 holds arrangement clip placements with `{ patternId, trackId, startBar, durationBars }`, and Sprint 25 provides the BPM and time signature. All the raw material exists — this sprint adds the serialization path outward.

## Requirements

### Functional Requirements

- [ ] Export a single pattern as a Type 0 MIDI file (single-track, all notes in one MTrk chunk)
- [ ] Export the full arrangement as a Type 1 MIDI file (multi-track: one MTrk per DAW track, plus a tempo/time-signature track at index 0)
- [ ] Include a tempo meta-event (`FF 51 03`) in the MIDI header track derived from the transport BPM (Sprint 25); if Sprint 41 (Tempo Automation) is complete and a tempo map is available, write all tempo change points
- [ ] Include a time signature meta-event (`FF 58 04`) derived from the transport time signature (Sprint 25)
- [ ] Preserve all note attributes: pitch (0–127), velocity (1–127), start tick, and duration ticks
- [ ] In arrangement export, flatten each track's clip placements into a single event stream with correct absolute tick offsets (clip start bar converted to ticks using PPQ and time signature)
- [ ] Configurable PPQ on export — default 960 to match internal representation; allow 480 for compatibility with older software
- [ ] Export dialog with two modes: "Single Pattern" (exports currently open pattern) and "Full Arrangement" (exports all tracks)
- [ ] Native OS file save dialog (via Tauri's `dialog::save_file`) filtering for `.mid` files, defaulting the filename to the pattern name or project name
- [ ] After successful export, show a non-blocking success toast in the UI with the saved file path
- [ ] Graceful error handling: if PPQ conversion produces a zero-duration note or out-of-range tick, clamp and log a warning — never crash or silently corrupt the file

### Non-Functional Requirements

- [ ] Export handles arrangements with up to 100 tracks without degrading UX (single operation, no spinner required for typical sizes)
- [ ] A large arrangement (1,000+ notes across all tracks) exports in under 1 second on the target machine
- [ ] Exported files are valid Standard MIDI Files — must be importable back into this DAW via Sprint 32 and must open without errors in at least one third-party tool (e.g., a free online MIDI validator or MuseScore)
- [ ] PPQ rescaling (if export PPQ differs from internal 960 PPQ) is lossless for tick values that divide evenly; non-divisible ticks are rounded to the nearest output tick

## Dependencies

- **Sprints**:
  - Sprint 3 (MIDI I/O) — provides `MidiEvent` enum definitions (`NoteOn`, `NoteOff`, `CC`, `PitchBend`) used as the shared MIDI vocabulary
  - Sprint 11 (Piano Roll Editor) — defines `MidiNote { id, pitch, startTick, durationTicks, velocity }` at 960 PPQ; this is the source note format
  - Sprint 12 (Pattern System) — provides `Pattern` struct and `PatternManager`; export reads note lists from here
  - Sprint 13 (Song Timeline) — provides arrangement clip placements `{ patternId, trackId, startBar, durationBars }`; arrangement export iterates these
  - Sprint 25 (Transport & Tempo) — provides project BPM and time signature used for tempo/time-signature meta-events
  - Sprint 32 (MIDI File Import) — establishes `midly` crate as the project's MIDI file library; this sprint reuses it for writing
- **Optional**:
  - Sprint 41 (Tempo Automation) — if complete, the tempo map it provides is written as a sequence of tempo change meta-events; if not complete, a single constant-tempo event is written
- **External**:
  - `midly` crate (already a dependency from Sprint 32) — used for writing Standard MIDI Files

## Scope

### In Scope

- `src-tauri/src/midi/export.rs` — `MidiExporter` struct with `export_pattern()` and `export_arrangement()` methods; `ExportOptions` config struct; PPQ rescaling utility
- Tauri commands: `export_midi_pattern(pattern_id, path, options)` and `export_midi_arrangement(path, options)`, both invoked from the frontend after the save dialog resolves
- `src/components/daw/ExportMidiDialog.tsx` — modal dialog with pattern vs. arrangement mode selector, PPQ selector (960 / 480), and export button that opens the OS save dialog
- Integration with Sprint 12 `PatternManager` to read note data
- Integration with Sprint 13 arrangement store to read clip placements and compute absolute tick offsets
- Integration with Sprint 25 transport state to read BPM and time signature
- Conditional integration with Sprint 41 tempo map (feature-flagged: if `TempoMap` type exists in scope, use it; otherwise use constant BPM)

### Out of Scope

- MIDI import (Sprint 32)
- Exporting MIDI CC automation data (Sprint 14 Automation Editor — backlog)
- Exporting SysEx or program change events
- Exporting audio tracks as audio files (Sprint 22 — Audio Export)
- Type 2 MIDI files (rare sequential pattern format — not used in practice)
- Real-time MIDI output to external hardware during playback (Sprint 3 handles live output)
- Stem export or bouncing instrument tracks to audio

## Technical Approach

### Rust: MidiExporter

`MidiExporter` is a pure data-transformation struct (no audio thread involvement, no locking constraints). It reads pattern and arrangement data from the Rust-side state, which is accessed under the existing `Arc<Mutex<>>` guard used throughout the project — this is acceptable because export is a user-initiated, one-shot operation, not a real-time callback.

**Type 0 export (single pattern):**

1. Read the target `Pattern`'s note list: `Vec<MidiNote>`.
2. Convert each `MidiNote` to a pair of MIDI events: `NoteOn` at `startTick` and `NoteOff` at `startTick + durationTicks`.
3. If export PPQ differs from internal 960 PPQ, rescale all tick values: `output_tick = (internal_tick * export_ppq) / 960`.
4. Sort all events by absolute tick, then compute delta ticks (each event's tick minus the previous event's tick).
5. Build a `midly::Track` from the delta-tick events, prepending a tempo meta-event (`midly::MetaMessage::Tempo`) and a time signature meta-event (`midly::MetaMessage::TimeSignature`).
6. Wrap in a `midly::Smf` with `header.format = midly::Format::SingleTrack` and `header.timing = midly::Timing::Metrical(export_ppq)`.
7. Write to the file path using `midly::Smf::write_std()`.

**Type 1 export (full arrangement):**

1. Collect all clip placements from the arrangement store, grouped by `trackId`.
2. For each track, iterate its clip placements in order. For each placement, compute the clip's absolute tick offset: `clip_start_tick = start_bar * beats_per_bar * ppq`. Read the referenced `Pattern`'s notes and offset each note's `startTick` by `clip_start_tick`.
3. Flatten each track's offsetted notes into a single sorted event list. Convert to `NoteOn`/`NoteOff` pairs and compute delta ticks.
4. Build one `midly::Track` per DAW track.
5. Prepend a dedicated tempo/time-signature track at index 0 (MIDI convention for Type 1 files): if Sprint 41's tempo map is available, emit one `Tempo` meta-event per tempo change point; otherwise emit a single `Tempo` meta-event at tick 0 derived from the transport BPM (`microseconds_per_beat = 60_000_000 / bpm`).
6. Wrap all tracks in a `midly::Smf` with `header.format = midly::Format::Parallel`.
7. Write to the file path.

**PPQ rescaling:** implemented as a pure function `rescale_tick(tick: u32, src_ppq: u16, dst_ppq: u16) -> u32` to enable isolated unit testing.

### React: ExportMidiDialog

A modal dialog triggered from a menu item (e.g., File > Export MIDI). The dialog contains:
- A radio group: "Single Pattern" / "Full Arrangement"
- A PPQ selector: 960 (default) / 480
- An "Export..." button that calls `window.__TAURI__.dialog.save({ filters: [{ name: 'MIDI', extensions: ['mid'] }] })`, then invokes the appropriate Tauri command with the resolved path and options
- Success/error toast feedback

All Tauri IPC calls are wrapped in typed functions in `src/lib/ipc.ts` per project convention.

## Tasks

### Phase 1: Planning

- [ ] Confirm `midly` crate write API: verify `Smf::write_std()` produces spec-compliant files for both Type 0 and Type 1
- [ ] Define `ExportOptions` struct: `{ export_ppq: u16, include_tempo_map: bool }`
- [ ] Map out the tick-offset computation for arrangement clips: confirm `start_bar * beats_per_bar * ppq` formula against Sprint 13's `startBar` semantics (0-indexed bars)
- [ ] Identify the Rust state access path: which `ManagedState` struct holds patterns and arrangement clips; confirm mutex access pattern is consistent with existing commands

### Phase 2: Implementation

- [ ] Add `MidiExporter` struct with `export_pattern(pattern_id, path, options)` method
- [ ] Implement `MidiNote` to `NoteOn`/`NoteOff` event conversion with absolute tick sorting
- [ ] Implement delta-tick computation from absolute tick sorted event list
- [ ] Implement `rescale_tick(tick, src_ppq, dst_ppq)` utility function
- [ ] Implement tempo meta-event generation from transport BPM (constant tempo path)
- [ ] Implement conditional tempo map path: if `TempoMap` is available (Sprint 41), iterate change points; otherwise fall back to constant BPM
- [ ] Implement `export_arrangement(path, options)` method: clip offset computation, per-track flattening, Type 1 file construction with tempo track at index 0
- [ ] Add Tauri command `export_midi_pattern(pattern_id: String, path: String, options: ExportOptions) -> Result<(), String>`
- [ ] Add Tauri command `export_midi_arrangement(path: String, options: ExportOptions) -> Result<(), String>`
- [ ] Register both commands in `tauri::Builder` in `main.rs`
- [ ] Add typed IPC wrappers to `src/lib/ipc.ts`: `exportMidiPattern()` and `exportMidiArrangement()`
- [ ] Build `ExportMidiDialog.tsx` with mode selector, PPQ selector, OS save dialog trigger, and success/error toast
- [ ] Wire export dialog to a menu item or toolbar button in the main DAW layout

### Phase 3: Validation

- [ ] Unit test: `rescale_tick` — verify `rescale_tick(960, 960, 480) == 480`, `rescale_tick(480, 960, 480) == 240`, edge case tick 0 stays 0
- [ ] Unit test: single-pattern Type 0 export — build a `Pattern` with 3 known notes, export to a temp file, re-parse with `midly` and assert correct note count, pitches, velocities, and durations (round-trip)
- [ ] Unit test: arrangement Type 1 export — two tracks, two clips each; verify exported file has 3 MTrk chunks (tempo track + 2 track chunks) and notes appear at correct absolute ticks after clip offset
- [ ] Unit test: tempo meta-event — export a pattern at BPM 120, parse the result, assert tempo event value is `500000` microseconds per beat
- [ ] Unit test: PPQ rescaling on export — export at 480 PPQ, assert all note ticks are halved relative to 960 PPQ internal values
- [ ] Unit test: zero-duration guard — a `MidiNote` with `durationTicks = 0` is clamped to `durationTicks = 1` with a warning, not written as a zero-length note
- [ ] Unit test: empty pattern export — exporting a pattern with no notes produces a valid, empty Type 0 MIDI file (just header + empty MTrk) without panic
- [ ] Manual: export a pattern from the piano roll — open the exported `.mid` file in an external MIDI viewer or re-import via Sprint 32 — confirm notes match
- [ ] Manual: export a full arrangement — import the resulting Type 1 file into a second tool and verify track count and note positions
- [ ] Performance: export an arrangement of 100 tracks with 1,000 total notes — confirm wall-clock time is under 1 second

### Phase 4: Documentation

- [ ] Rustdoc on `MidiExporter`, `ExportOptions`, `rescale_tick`, and all public methods
- [ ] Document the Type 0 vs. Type 1 decision logic in a module-level comment in `export.rs`
- [ ] JSDoc on `ExportMidiDialog` props and the two IPC wrapper functions in `ipc.ts`
- [ ] Add a note in the sprint-32 import file's "Out of Scope" cross-reference confirming this sprint (43) is the owner of export

## Acceptance Criteria

- [ ] Exporting a single pattern produces a valid Type 0 `.mid` file containing all notes at correct pitches, velocities, and durations
- [ ] Exporting the full arrangement produces a valid Type 1 `.mid` file with one MTrk per DAW track plus a tempo/time-signature track at index 0
- [ ] The tempo meta-event in the exported file reflects the project BPM from Sprint 25 transport state
- [ ] The time signature meta-event in the exported file reflects the project time signature
- [ ] Changing the export PPQ to 480 produces a file where all tick values are correctly rescaled from the internal 960 PPQ
- [ ] The OS file save dialog opens, filters for `.mid`, and the file is written to the selected path
- [ ] A success toast with the saved file path appears after a successful export
- [ ] Exporting an empty pattern does not crash — it produces a valid empty MIDI file
- [ ] An exported file can be re-imported via Sprint 32 and the notes round-trip correctly (pitch, velocity, duration preserved within one-tick rounding tolerance)
- [ ] All unit tests pass; coverage on `export.rs` >= 80%
- [ ] No `unwrap()` calls in `export.rs` — all error paths use `?` with `anyhow::Result`

## Notes

Created: 2026-02-23

Sprint 32 (MIDI File Import) established `midly` as the project's MIDI file crate. This sprint reuses it for writing, completing the MIDI round-trip. The `midly` crate supports both reading (`Smf::parse`) and writing (`Smf::write_std`) Standard MIDI Files, so no new crate dependency is required.

The Sprint 41 (Tempo Automation) integration is explicitly optional and feature-flagged at the call site. If Sprint 41 has not yet been implemented when this sprint executes, the exporter falls back to a single constant-tempo meta-event. This avoids a hard dependency on Sprint 41 and keeps Sprint 43 independently executable.

For arrangement export, the clip start-tick computation uses: `clip_start_tick = start_bar * beats_per_bar * export_ppq`. This assumes `startBar` in Sprint 13 is 0-indexed (bar 0 = tick 0). If Sprint 13 uses 1-indexed bars, the formula must be adjusted to `(start_bar - 1) * beats_per_bar * export_ppq`. This must be confirmed during Phase 1 planning against the actual Sprint 13 data model.
