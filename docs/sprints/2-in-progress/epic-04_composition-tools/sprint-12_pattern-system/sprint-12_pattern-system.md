---
sprint: 12
title: "Pattern System"
type: fullstack
epic: 4
status: in-progress
created: 2026-02-22T22:10:03Z
started: 2026-03-06T20:24:41Z
completed: null
hours: null
workflow_version: "3.1.0"

---

# Sprint 12: Pattern System

## Overview

| Field | Value |
|-------|-------|
| Sprint | 12 |
| Title | Pattern System |
| Type | fullstack |
| Epic | 4 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement a named pattern system per track where each pattern holds MIDI notes or audio clip references, patterns can be created, duplicated, renamed, and reordered, and a pattern browser panel provides quick access to all patterns in the project.

## Background

DAWs organize music into reusable blocks called patterns (also called clips or scenes in other DAWs). A pattern represents one loop or section — for example, "Verse Beat", "Chorus Melody". By managing patterns as first-class entities, users can build song arrangements (Sprint 13) by placing patterns on the timeline and reusing the same pattern in multiple places without duplicating data.

## Requirements

### Functional Requirements

- [ ] Each track can have multiple named patterns (default name: "Pattern {N}")
- [ ] Each pattern holds either a MIDI note list (for instrument tracks) or audio clip file reference (for audio tracks)
- [ ] Create, rename, duplicate, and delete patterns from the pattern browser panel
- [ ] Pattern length is configurable in bars (1, 2, 4, 8, 16, 32)
- [ ] Double-clicking a pattern in the browser opens it for editing in the piano roll (MIDI) or waveform editor (audio)
- [ ] Patterns can be dragged from the browser onto the song timeline (Sprint 13 integration)
- [ ] Patterns are persisted in the project file (Sprint 4 project file system)
- [ ] Tauri commands: `create_pattern`, `rename_pattern`, `duplicate_pattern`, `delete_pattern`, `get_patterns_for_track`

### Non-Functional Requirements

- [ ] Pattern data stored as a serializable struct in the project's JSON/binary format
- [ ] A project can have up to 500 patterns without UI performance degradation
- [ ] Pattern browser renders pattern list with virtualization if count > 50

## Dependencies

- **Sprints**: Sprint 4 (project file system — patterns stored in project state)
- **Note**: Sprint 11 (Piano Roll) depends on this sprint, not the reverse. Sprint 12 must run before Sprint 11.
- **External**: None

## Scope

### In Scope

- `src-tauri/src/project/pattern.rs` — `Pattern` struct with id, name, track_id, content (MidiNotes | AudioClip), length_bars
- `src-tauri/src/project/pattern_manager.rs` — CRUD operations on patterns
- Tauri commands: `create_pattern`, `rename_pattern`, `duplicate_pattern`, `delete_pattern`, `get_patterns_for_track`, `set_pattern_length`
- React `PatternBrowser` panel: scrollable list of patterns per track, create/rename/duplicate/delete buttons, drag handle for timeline drops
- React `PatternContextMenu` on right-click: rename, duplicate, delete, open in editor

### Out of Scope

- Pattern playback looping on the timeline (Sprint 13)
- Step sequencer patterns (separate data structure — Sprint 10 manages its own state)
- MIDI import from external files
- Pattern color customization (backlog)

## Technical Approach

`Pattern` is a plain data struct with a UUID `id`, a `name` String, a `track_id`, a `content` enum (`MidiContent(Vec<MidiNote>)` or `AudioContent(PathBuf)`), and a `length_bars` field. All patterns for the current project are stored in a `HashMap<PatternId, Pattern>` in the `ProjectState`. Tauri commands operate on this HashMap and persist changes to the project file via `save_project`. Duplicate creates a deep clone with a new UUID. The React `PatternBrowser` fetches patterns from `projectStore.patterns` (Zustand) and renders them in a scrollable list. Double-click invokes navigation to the piano roll or waveform editor with the pattern's ID in the route. Drag events set the pattern ID in the drag dataTransfer for the timeline drop target (Sprint 13).

## Tasks

### Phase 1: Planning
- [ ] Define `Pattern` struct and `PatternContent` enum in Rust
- [ ] Design `PatternBrowser` React component layout — tree grouped by track or flat list
- [ ] Plan pattern ID scheme (UUID v4)

### Phase 2: Implementation
- [ ] Implement `Pattern` and `PatternContent` in `src-tauri/src/project/pattern.rs`
- [ ] Add `HashMap<PatternId, Pattern>` to `ProjectState`
- [ ] Implement `create_pattern`, `rename_pattern`, `duplicate_pattern`, `delete_pattern` Tauri commands
- [ ] Implement `get_patterns_for_track` and `set_pattern_length` commands
- [ ] Update project file serialization to include patterns
- [ ] Build React `PatternBrowser` component with create/delete/rename UI
- [ ] Implement right-click `PatternContextMenu`
- [ ] Wire double-click to navigate to piano roll / waveform editor with pattern ID
- [ ] Implement drag-from-browser (HTML5 drag API with pattern ID in dataTransfer)

### Phase 3: Validation
- [ ] Create 10 patterns for a track — all appear in browser
- [ ] Rename a pattern — new name persists after project save and reload
- [ ] Duplicate a pattern — duplicate has independent MIDI note list (editing one does not affect the other)
- [ ] Delete a pattern — removed from browser and project
- [ ] Drag pattern from browser (confirm dataTransfer contains pattern ID for Sprint 13 drop)

### Phase 4: Documentation
- [ ] Rustdoc on `Pattern`, `PatternContent`, `PatternManager`
- [ ] Document pattern ID format and content enum variants

## Acceptance Criteria

- [ ] Patterns can be created, renamed, duplicated, and deleted from the browser
- [ ] Pattern length in bars is configurable and stored correctly
- [ ] Patterns persist in the project file and restore correctly on load
- [ ] Double-clicking a MIDI pattern opens the piano roll with that pattern's note data
- [ ] Drag from pattern browser provides the pattern ID for timeline drop targets
- [ ] 500 patterns in a project do not cause UI lag in the browser

## Notes

Created: 2026-02-22
