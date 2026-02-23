---
sprint: 30
title: "Main DAW Shell & Track Management"
type: fullstack
epic: 1
status: planning
created: 2026-02-23T00:00:00Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 75
---

# Sprint 30: Main DAW Shell & Track Management

## Overview

| Field | Value |
|-------|-------|
| Sprint | 30 |
| Title | Main DAW Shell & Track Management |
| Type | fullstack |
| Epic | 1 - Foundation & Infrastructure |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Build the main application window layout that houses all DAW components, define the canonical Track data type (covering MIDI, audio, and instrument tracks), and implement track creation, deletion, naming, reordering, and color assignment. This is the structural frame that all other sprints hang their components on.

## Background

Sprint 1 produced a blank Tauri window with a React scaffold. Every subsequent sprint creates individual components (timeline canvas, mixer channel strips, browser panel, transport bar) but no sprint assembles them into an actual DAW window. More critically, no sprint defines what a "track" *is* — Sprint 13 draws timeline track rows, Sprint 17 builds mixer channel strips, Sprint 9 records to audio tracks — but without a shared `Track` data type and track management system, these sprints will produce incompatible track representations. This sprint establishes both the window frame and the track architecture before any track-touching sprints execute.

## Requirements

### Functional Requirements

- [ ] Main window layout: transport bar (top strip), collapsible browser panel (left), track list + timeline area (center), collapsible mixer panel (bottom)
- [ ] Menu bar: File (New, Open, Save, Save As, Recent Projects), Edit (Undo, Redo), View (toggle panels), Help
- [ ] Track types defined and selectable: MIDI Track, Audio Track, Instrument Track
- [ ] Track list panel (left column of the timeline area): track name, type icon, color swatch, mute button, solo button, record-arm button, instrument assignment label
- [ ] Create new track: "+" button or right-click context menu in track list
- [ ] Delete track: right-click → Delete, with confirmation dialog
- [ ] Rename track: double-click track name in the track list
- [ ] Reorder tracks: drag-and-drop track headers up/down
- [ ] Track color: click color swatch → color picker
- [ ] Track state persisted in Zustand `trackStore` and saved to the project file (Sprint 4)

### Non-Functional Requirements

- [ ] Panel collapse/expand is animated and does not cause audio interruption
- [ ] Track list reorder is smooth at 60 fps for up to 32 tracks
- [ ] Track type is immutable after creation (changing type requires delete + recreate)

## Dependencies

- **Sprints**: Sprint 1 (React scaffold), Sprint 4 (project file — track list must save/load)

## Scope

### In Scope

- `src-tauri/src/project/track.rs` — `Track` struct, `TrackType` enum (Midi, Audio, Instrument), `TrackId` (uuid), rustdoc on all types
- Tauri commands: `create_track`, `delete_track`, `rename_track`, `reorder_tracks`, `set_track_color`
- `src/components/daw/DawLayout.tsx` — CSS Grid main window layout
- `src/components/daw/TrackList.tsx` — track list panel, add/delete controls
- `src/components/daw/TrackHeader.tsx` — individual track row header (name, mute, solo, arm, color)
- `src/components/daw/MenuBar.tsx` — application menu bar
- `src/stores/trackStore.ts` — Zustand store: `tracks[]`, `createTrack()`, `deleteTrack()`, `renameTrack()`, `reorderTracks()`

### Out of Scope

- Timeline clip content (Sprint 13 owns the canvas)
- Mixer channel strip content (Sprint 17 owns the DSP and fader UI)
- Instrument panel content (Sprints 6-9 own their UIs, assigned via track header)
- Track grouping / folders (backlog)
- Track freeze / bounce (backlog)

## Technical Approach

`TrackType` is a Rust enum serialized as a string tag in the `.mapp` project file. `Track` holds: `id: Uuid`, `name: String`, `track_type: TrackType`, `color: u32 (RGBA)`, `muted: bool`, `solo: bool`, `armed: bool`. The `trackStore` in Zustand mirrors this as a `Map<TrackId, Track>` with an ordered `trackOrder: TrackId[]` array for display sequence. `DawLayout` uses CSS Grid with named areas (`transport`, `browser`, `tracklist`, `timeline`, `mixer`). Panel collapse is managed via a `layoutStore` toggling CSS class names. The menu bar uses Radix UI `DropdownMenu` for accessibility.

## Tasks

### Phase 1: Planning
- [ ] Finalize `Track` and `TrackType` schema — consider all fields other sprints will need (e.g. `instrument_id` for instrument tracks)
- [ ] Design CSS Grid layout with exact row/column sizing and resize behavior
- [ ] Confirm panel visibility toggles do not affect audio thread state

### Phase 2: Implementation
- [ ] Define `Track`, `TrackType`, `TrackId` in `src-tauri/src/project/track.rs`
- [ ] Add Tauri commands for all track CRUD operations
- [ ] Integrate track list into Sprint 4 project file save/load
- [ ] Build `DawLayout.tsx` CSS Grid with Transport, Browser, TrackList+Timeline, Mixer areas
- [ ] Build `MenuBar.tsx` with File/Edit/View/Help menus wired to Tauri commands
- [ ] Build `TrackList.tsx` and `TrackHeader.tsx` with mute/solo/arm/color/rename
- [ ] Implement drag-to-reorder in track list
- [ ] Build `trackStore.ts` with all CRUD actions
- [ ] Wire color picker (Radix UI Popover + color input)

### Phase 3: Validation
- [ ] Unit test: `create_track` returns a track with correct defaults for each type
- [ ] Unit test: `reorder_tracks` correctly updates order and rejects invalid indices
- [ ] Component test: track list renders N tracks from mock store
- [ ] Component test: double-click rename enters edit mode, Enter confirms, Escape cancels
- [ ] Manual: drag three tracks, confirm order change persists after project save/load

### Phase 4: Documentation
- [ ] Rustdoc on `Track`, `TrackType`, all Tauri commands
- [ ] TSDoc on `DawLayout` explaining the CSS Grid named areas
- [ ] README note: track type is immutable after creation

## Acceptance Criteria

- [ ] Main window shows Transport, Browser, TrackList+Timeline, and Mixer areas in correct positions
- [ ] All three track types can be created from the "+" button
- [ ] Tracks can be renamed, reordered, muted, soloed, armed, and recolored
- [ ] Track list with 10 tracks persists through project save/load cycle
- [ ] Menu bar File menu invokes correct Tauri commands
- [ ] All tests pass

## Notes

Created: 2026-02-23
Track type architecture note: `TrackType::Instrument` combines inline MIDI + instrument assignment in one track. `TrackType::Midi` is a MIDI-only track that routes to a separately instantiated instrument. `TrackType::Audio` holds recorded or imported audio clips. Bus/Return tracks are defined in Sprint 17 (Mixer).
