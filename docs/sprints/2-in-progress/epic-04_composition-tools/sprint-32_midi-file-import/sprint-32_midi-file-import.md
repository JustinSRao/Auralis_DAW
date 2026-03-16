---
sprint: 32
title: "MIDI File Import"
type: fullstack
epic: 4
status: in-progress
created: 2026-02-23T00:00:00Z
started: 2026-03-15T18:48:05Z
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 80

---

# Sprint 32: MIDI File Import

## Overview

| Field | Value |
|-------|-------|
| Sprint | 32 |
| Title | MIDI File Import |
| Type | fullstack |
| Epic | 4 - Composition Tools |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Allow users to import standard MIDI (.mid) files and convert them into DAW patterns that appear in the pattern browser and can be placed in the piano roll or arrangement. Support Type 0 (single-track) and Type 1 (multi-track) MIDI files.

## Background

The piano roll (Sprint 11) enables manual note entry, and MIDI export is in the Epic 4 backlog. However importing MIDI is a primary workflow for producers working with loops, chord packs, or reference tracks — vast libraries of MIDI content are available online and none of it can be used without import. This sprint completes the MIDI round-trip (import ↔ export) and opens the app to all MIDI-based content workflows.

## Requirements

### Functional Requirements

- [ ] File picker dialog filtering for `.mid` / `.midi` files
- [ ] Parse MIDI Type 0 (single track) — all events imported as one pattern
- [ ] Parse MIDI Type 1 (multi-track) — each MIDI track imported as a separate pattern
- [ ] Preserve: note pitch, velocity, note duration (note-on/note-off delta), channel
- [ ] Preserve: tempo map (first tempo event used to suggest project BPM if no tempo set)
- [ ] Preserve: time signature from MIDI header
- [ ] Imported patterns appear in the pattern browser (Sprint 12) named after the MIDI filename + track name
- [ ] Import dialog shows track list for Type 1 files with checkboxes to select which tracks to import
- [ ] Graceful error on malformed MIDI files (show error message, do not crash)

### Non-Functional Requirements

- [ ] Import of a 100-track, 10-minute MIDI file completes in < 3 seconds
- [ ] Note timing is preserved to the nearest MIDI tick (no quantization applied during import)

## Dependencies

- **Sprints**:
  - Sprint 11 (Piano Roll Editor) — note format: `MidiNote { pitch, velocity, start_beat, duration_beats }`
  - Sprint 12 (Pattern System) — imported data creates `Pattern` objects in the pattern store

## Scope

### In Scope

- `src-tauri/src/midi/import.rs` — MIDI file parser using the `midly` crate; `MidiImporter`, `ImportedTrack`, `ImportedNote`
- Tauri commands: `import_midi_file(path) -> Vec<ImportedTrack>`, `create_patterns_from_import(tracks)`
- `src/components/daw/MidiImportDialog.tsx` — import dialog with track selection checkboxes and BPM suggestion
- Integration: on confirm, calls `create_patterns_from_import` → patterns land in `patternStore` (Sprint 12)

### Out of Scope

- MIDI export (Epic 4 backlog — separate sprint)
- Importing SysEx, controller events, or program change events (backlog)
- Importing audio-embedded MIDI from DAW projects
- Type 2 MIDI files (rare, backlog)

## Technical Approach

Use the `midly` crate for MIDI parsing (handles both Type 0 and Type 1, all tick resolution modes). `MidiImporter::parse(path)` reads the file and converts raw tick-based events into `ImportedNote` structs with beat-relative timing using the file's ticks-per-quarter value. A tempo map pass converts absolute ticks to beats. Each MIDI track produces one `ImportedTrack { name, notes: Vec<ImportedNote>, suggested_bpm }`. The React import dialog renders the track list with checkboxes; on confirm, selected tracks are sent to `create_patterns_from_import` which creates `Pattern` entries in the Rust project state and emits a `patterns_updated` Tauri event so the frontend pattern store refreshes.

## Tasks

### Phase 1: Planning
- [ ] Evaluate `midly` crate for Type 0/1 support and tick-to-beat conversion
- [ ] Define `ImportedNote` and `ImportedTrack` structs
- [ ] Design import dialog UX (single-track auto-imports; multi-track shows selection)

### Phase 2: Implementation
- [ ] Implement `MidiImporter::parse()` using `midly`
- [ ] Implement tick-to-beat conversion with tempo map handling
- [ ] Implement Tauri `import_midi_file` command (opens file dialog, parses, returns track list)
- [ ] Implement `create_patterns_from_import` command
- [ ] Build `MidiImportDialog.tsx` (track list, BPM suggestion display, import button)
- [ ] Integrate with `patternStore` to add imported patterns

### Phase 3: Validation
- [ ] Unit test: parse a known Type 0 MIDI file — verify correct note count, pitches, durations
- [ ] Unit test: parse a Type 1 MIDI file — verify correct track count and note distribution
- [ ] Unit test: tempo map extraction — verify correct BPM from tempo event
- [ ] Unit test: malformed file returns error, does not panic
- [ ] Manual: import a MIDI chord progression — notes appear correctly in piano roll

### Phase 4: Documentation
- [ ] Rustdoc on `MidiImporter`, `ImportedTrack`, `ImportedNote`
- [ ] README note: supported MIDI types and known limitations (no SysEx, no Type 2)

## Acceptance Criteria

- [ ] File picker opens and filters for `.mid` / `.midi`
- [ ] Type 0 MIDI file imports as a single pattern with correct notes
- [ ] Type 1 MIDI file shows track selection dialog; selected tracks become patterns
- [ ] Tempo from MIDI file is suggested in the import dialog
- [ ] Imported patterns appear in the pattern browser
- [ ] Malformed file shows error message without crashing
- [ ] All unit tests pass; coverage ≥ 80%

## Notes

Created: 2026-02-23
