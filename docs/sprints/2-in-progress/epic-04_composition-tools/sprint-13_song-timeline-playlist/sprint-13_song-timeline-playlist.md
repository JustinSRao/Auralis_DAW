---
sprint: 13
title: "Song Timeline & Playlist"
type: fullstack
epic: 4
status: in-progress
created: 2026-02-22T22:10:03Z
started: 2026-03-10T14:20:54Z
completed: null
hours: null
workflow_version: "3.1.0"


---

# Sprint 13: Song Timeline & Playlist

## Overview

| Field | Value |
|-------|-------|
| Sprint | 13 |
| Title | Song Timeline & Playlist |
| Type | fullstack |
| Epic | 4 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build the song timeline (playlist/arrangement view) as a React canvas that shows all tracks horizontally across time, allowing patterns to be dragged, placed, resized, and deleted, with a moving playhead, bar/beat rulers, and loop markers.

## Background

The song timeline is the top-level view of a complete composition — it shows where every pattern is placed relative to song time and across all tracks. Without it, users can only play individual patterns in a loop; the timeline is what lets them build a full song with intro, verse, chorus, and outro. It consumes patterns from Sprint 12 and sends arrangement position data to the Rust engine for ordered playback.

## Requirements

### Functional Requirements

- [ ] Horizontal timeline canvas with vertical tracks (one row per track) and time flowing left to right
- [ ] Bar/beat ruler at the top showing bar numbers and beat subdivisions at current zoom level
- [ ] Patterns displayed as colored blocks on their track row at their start bar position
- [ ] Drop patterns from the pattern browser onto the timeline at any bar position
- [ ] Drag pattern blocks horizontally to move them; drag right edge to resize duration (up to pattern's maximum length in bars)
- [ ] Right-click pattern block: delete, duplicate at position
- [ ] Playhead (vertical line) moves in real time during playback, synced to master transport
- [ ] Loop region: click-drag on the ruler to set loop start/end; playback loops when loop enabled
- [ ] Click on ruler to jump playhead to that bar position
- [ ] Horizontal scroll and zoom (bars per screen width) controls

### Non-Functional Requirements

- [ ] Canvas renders up to 200 pattern blocks across 20 tracks without frame rate drop
- [ ] Playhead position updates at 30 Hz from a Tauri event, not blocking the audio thread
- [ ] Scroll and zoom changes apply within one React render frame

## Dependencies

- **Sprints**: Sprint 12 (Pattern System — patterns dragged from browser), Sprint 2 (transport position event for playhead), Sprint 4 (arrangement data persisted in project)
- **External**: None (React canvas)

## Scope

### In Scope

- `src/components/Timeline/Timeline.tsx` — main canvas component
- `src/components/Timeline/TimeRuler.tsx` — bar/beat ruler canvas
- `src/components/Timeline/TrackRow.tsx` — per-track clip block rendering
- `src/components/Timeline/PlayheadOverlay.tsx` — playhead and loop region overlay
- `src/components/Timeline/useTimelineState.ts` — placement, drag, resize, scroll, zoom state
- Zustand `arrangementStore`: `clipPlacements: { patternId, trackId, startBar, durationBars }[]`
- Tauri event subscription: `transport_position_changed` → update playhead position
- Tauri commands: `add_arrangement_clip`, `move_arrangement_clip`, `delete_arrangement_clip`, `set_loop_region`

### Out of Scope

- Audio rendering / mixing of arranged clips (the engine needs arrangement data, but full playback of arranged clips spans multiple sprints)
- Video track support
- Clip crossfades on the timeline
- Track reordering (backlog)

## Technical Approach

The timeline is a layered canvas system: the background grid and ruler are drawn once (or on zoom/scroll), the clip blocks are drawn on the clip layer canvas, and the playhead/loop overlay is drawn on a top canvas updated at 30 Hz. Clip placement uses a `Map<ClipId, { patternId, trackId, startBar, durationBars }>` stored in Zustand's `arrangementStore`. A canvas coordinate utility converts bar positions to x-pixels and track indices to y-pixels. Mouse events implement a state machine: Idle → Dragging (on mousedown on a clip) → Resizing (on mousedown on clip right edge within 8 px). Drop events from the pattern browser (HTML5 drag) read the pattern ID from dataTransfer and compute the dropped bar position from the mouse x coordinate. The audio engine receives arrangement data as a serialized clip list on project load and transport start.

## Tasks

### Phase 1: Planning
- [ ] Design `ArrangementClip` data type and canvas coordinate system (pixels per bar at 1x zoom)
- [ ] Plan playhead update mechanism: Tauri event from audio thread → React state → canvas redraw
- [ ] Define loop region data type (start bar, end bar, enabled)

### Phase 2: Implementation
- [ ] Build background grid canvas (track rows, bar grid lines)
- [ ] Build `TimeRuler` canvas with bar numbers and beat subdivisions
- [ ] Build clip block rendering (colored rectangle with pattern name label)
- [ ] Implement HTML5 drop handler from pattern browser → create `ArrangementClip`
- [ ] Implement clip drag-to-move mouse handler
- [ ] Implement clip right-edge drag-to-resize handler
- [ ] Implement right-click context menu (delete, duplicate)
- [ ] Implement ruler click to set playhead (call `set_transport_position` Tauri command)
- [ ] Implement loop region drag on ruler (shift+drag or dedicated loop tool)
- [ ] Subscribe to `transport_position_changed` Tauri event for real-time playhead
- [ ] Add horizontal scroll bar and zoom slider
- [ ] Persist arrangement clip list in `arrangementStore` and project save

### Phase 3: Validation
- [ ] Drag 10 patterns from the browser onto 5 tracks — all appear at correct positions
- [ ] Move a clip — it snaps to bar boundaries and updates position correctly
- [ ] Resize a clip — duration changes, clip block width updates
- [ ] Playhead moves smoothly during playback (no jitter at 30 Hz update rate)
- [ ] Set loop region — playback loops between start and end markers

### Phase 4: Documentation
- [ ] JSDoc on `Timeline`, `useTimelineState`, coordinate utility functions
- [ ] Document `ArrangementClip` type and canvas layering architecture

## Acceptance Criteria

- [ ] Patterns dropped from the browser appear as blocks on the timeline at the correct bar position
- [ ] Clip blocks can be dragged to a new bar position on the same or different track
- [ ] Clip right-edge resize changes duration correctly
- [ ] Right-click delete removes the clip from the timeline and arrangement store
- [ ] Playhead moves in real time during transport playback
- [ ] Loop region markers can be set by dragging on the ruler
- [ ] Timeline state persists in the project file and restores on load

## Notes

Created: 2026-02-22
