---
sprint: 11
title: "Piano Roll Editor"
type: fullstack
epic: 4
status: in-progress
created: 2026-02-22T22:10:02Z
started: 2026-03-06T18:43:03Z
completed: null
hours: null
workflow_version: "3.1.0"


---

# Sprint 11: Piano Roll Editor

## Overview

| Field | Value |
|-------|-------|
| Sprint | 11 |
| Title | Piano Roll Editor |
| Type | fullstack |
| Epic | 4 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build a fully interactive piano roll MIDI editor rendered in React canvas, with a vertical piano keyboard, a time-grid note display, drag-to-place and resize note bars, a velocity lane, quantization, and copy/paste operations.

## Background

The piano roll is the primary interface for detailed MIDI composition — it lets users see every note in a clip as a bar on a time-pitch grid and edit them precisely. Unlike the step sequencer which works best for rhythmic and short patterns, the piano roll handles long melodic phrases, chords, and complex velocity dynamics. It edits the MIDI data stored in a pattern (from Sprint 12 Pattern System).

## Requirements

### Functional Requirements

- [ ] Vertical piano keyboard on the left edge: clicking a key plays the note immediately via instrument preview
- [ ] Time grid with bar and beat markers; zoom level adjustable (x zoom: 1–16 bars visible, y zoom: 1–7 octaves visible)
- [ ] Notes displayed as colored horizontal bars; bar length = note duration, vertical position = MIDI pitch
- [ ] Draw mode: click empty space to create a new note; drag right edge to resize duration; drag body to move
- [ ] Select mode: click/drag to select one or more notes; selected notes highlighted
- [ ] Delete: press Delete or right-click selected notes to remove them
- [ ] Velocity lane at bottom: vertical bars per note showing velocity (1–127); drag to adjust
- [ ] Quantization: snap note start and end to selectable grid (1/4, 1/8, 1/16, 1/32)
- [ ] Copy/paste: Ctrl+C / Ctrl+V for selected notes (paste at playhead position)
- [ ] Undo/redo: Ctrl+Z / Ctrl+Y for all note editing operations

### Non-Functional Requirements

- [ ] Canvas rendering must handle up to 10,000 notes without frame drops (virtualized rendering — only draw visible notes)
- [ ] All note operations are O(n) or better with no full canvas redraws for single note edits
- [ ] Piano roll state stored in Zustand and serialized into the pattern's MIDI note list

## Dependencies

- **Sprints**: Sprint 12 (Pattern System — piano roll edits a pattern's MIDI note list), Sprint 6/7 (instrument preview on piano key click)
- **External**: None (React canvas / `<canvas>` API only)

## Scope

### In Scope

- `src/components/PianoRoll/PianoRoll.tsx` — main canvas component with mouse event handling
- `src/components/PianoRoll/PianoKeyboard.tsx` — vertical piano key strip on left
- `src/components/PianoRoll/VelocityLane.tsx` — velocity bar canvas at bottom
- `src/components/PianoRoll/usePianoRollState.ts` — hook for note CRUD and undo/redo history
- MIDI note data type: `{ id, pitch, startTick, durationTicks, velocity }`
- Quantization snap logic
- Zoom controls (horizontal and vertical sliders)

### Out of Scope

- MIDI file import/export (backlog)
- Real-time MIDI recording into the piano roll (Sprint 36 — MIDI Recording)
- Automation lanes inside the piano roll (Sprint 14)
- Multiple patterns open simultaneously

## Technical Approach

The piano roll is a React component rendering two stacked `<canvas>` elements: a static background grid (redrawn only on zoom change) and a dynamic note layer (redrawn on any note change). Mouse events are translated into beat/pitch coordinates using the current zoom/scroll transform. Notes are stored as an array of `MidiNote` objects in Zustand. The undo/redo stack is implemented as an array of snapshots (immutable note arrays). The velocity lane is a third canvas below the main grid. Quantization snaps the mouse position to the nearest tick grid boundary before creating or moving notes. The piano keyboard emits a `preview_note` Tauri event that triggers a brief note-on/off on the active instrument.

## Tasks

### Phase 1: Planning
- [ ] Define `MidiNote` TypeScript type and tick resolution (960 PPQ standard)
- [ ] Design canvas coordinate system: pixels per beat, pixels per semitone at default zoom
- [ ] Plan mouse state machine: Idle → Drawing / Moving / Resizing / Selecting

### Phase 2: Implementation
- [ ] Build background grid canvas (bar/beat lines, octave labels, black-key rows)
- [ ] Build note layer canvas with note rendering (colored bars)
- [ ] Implement mouse-down → draw new note with drag-to-set-duration
- [ ] Implement click-to-select and rubber-band drag select
- [ ] Implement note drag (move pitch + start time) with quantization snap
- [ ] Implement note resize (drag right edge)
- [ ] Implement Delete key handler
- [ ] Build velocity lane canvas with draggable velocity bars
- [ ] Implement copy/paste with Ctrl+C/V (paste at playhead)
- [ ] Implement undo/redo with Ctrl+Z/Y using snapshot history
- [ ] Build zoom/scroll controls (horizontal scroll bar, zoom slider)
- [ ] Build `PianoKeyboard` with note preview on click

### Phase 3: Validation
- [ ] Draw 100 notes across 8 bars — all render correctly with no overlap artifacts
- [ ] Move a note — it updates position immediately with no flicker
- [ ] Resize a note — duration changes in real time as mouse drags
- [ ] Undo 10 operations — state correctly reverts each time
- [ ] Zoom in to 1/32 grid — notes snap to 1/32 beat divisions
- [ ] 10,000 note stress test — canvas renders in under 16 ms

### Phase 4: Documentation
- [ ] Inline JSDoc on `PianoRoll`, `usePianoRollState`, coordinate transform functions
- [ ] Document tick resolution (960 PPQ) and quantization grid in comments

## Acceptance Criteria

- [ ] Clicking on the empty grid creates a new note at the correct pitch and position
- [ ] Dragging the right edge of a note resizes its duration with quantization snap
- [ ] Dragging a note body moves it to a new pitch/time position
- [ ] Selected notes are deleted with the Delete key
- [ ] Velocity bars in the velocity lane reflect note velocity and can be dragged to change it
- [ ] Ctrl+Z undoes the last operation; Ctrl+Y re-applies it
- [ ] Copy/paste duplicates selected notes offset by the paste position
- [ ] Zoom controls change the visible range of beats and pitches

## Notes

Created: 2026-02-22
