---
sprint: 15
title: "Waveform Editor (Cut, Trim, Reverse, Splice)"
type: fullstack
epic: 5
status: done
created: 2026-02-22T22:10:12Z
started: 2026-03-20T00:24:40Z
completed: 2026-03-20
hours: null
workflow_version: "3.1.0"


---

# Sprint 15: Waveform Editor (Cut, Trim, Reverse, Splice)

## Overview

| Field | Value |
|-------|-------|
| Sprint | 15 |
| Title | Waveform Editor (Cut, Trim, Reverse, Splice) |
| Type | fullstack |
| Epic | 5 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build a non-destructive waveform editor with visual zoom, cut, trim, reverse, and splice-at-zero-crossing operations, backed by a full undo/redo history, rendered in React canvas.

## Background

Raw recorded audio and imported samples often need trimming, cutting, and rearranging before they fit a project perfectly. A waveform editor gives users fine-grained control over audio clips at the sample level. This sprint completes the Audio Editing epic's first sprint — handling destructive-style edits non-destructively so the user can always undo.

## Requirements

### Functional Requirements

- [ ] Display a waveform overview for an audio clip (stereo or mono) rendered in a React canvas
- [ ] Horizontal zoom: from full-clip view down to individual sample level
- [ ] Cursor/selection: click to place cursor, click-drag to create a time selection region
- [ ] Cut: remove selected region from clip and split into two separate clips
- [ ] Trim: move clip start or end inward to the cursor position (non-destructive — buffer unchanged, just offset/length metadata)
- [ ] Reverse: flip the audio buffer of the selected region horizontally
- [ ] Splice at zero crossing: snap the cursor or selection edges to the nearest zero crossing in the audio buffer
- [ ] Undo/redo: full history stack — all operations reversible with Ctrl+Z / Ctrl+Y
- [ ] Waveform overview shows the selection region highlighted in a different color

### Non-Functional Requirements

- [ ] Waveform rendering uses downsampled peak data for performance (pre-compute min/max per pixel column) — no per-sample iteration on each draw
- [ ] Undo history stores operation metadata (not full audio buffer copies) — reverse stores start/end frame indices
- [ ] All waveform editing operations run on a Tokio task (not audio thread or main thread)

## Dependencies

- **Sprints**: Sprint 9 (recorded audio clips — source material for editing), Sprint 7 (imported sample buffers — also editable), Sprint 4 (project file system stores clip metadata)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio_editing/waveform_editor.rs` — edit operation implementations (cut, trim, reverse, splice)
- `src-tauri/src/audio_editing/waveform_editor/peak_cache.rs` — per-clip downsampled peak data for rendering
- `src-tauri/src/audio_editing/edit_history.rs` — undo/redo stack with operation enum
- Tauri commands: `get_waveform_peaks`, `cut_clip`, `trim_clip`, `reverse_clip`, `splice_at_zero_crossing`, `undo_edit`, `redo_edit`
- React `WaveformEditor` canvas component: peak waveform display, cursor, selection highlight, playback position marker
- React toolbar: zoom controls, tool selector (cursor/trim/cut/splice), undo/redo buttons

### Out of Scope

- Time stretching (Sprint 16)
- Spectral editing
- Fade in/out handles (backlog — rendered as automation on volume parameter)
- Multi-clip crossfades

## Technical Approach

Each audio clip in the project has an associated `PeakCache` — an array of `(min: f32, max: f32)` pairs, one per display pixel column at 1x zoom. The React waveform canvas requests peak data from Rust via `get_waveform_peaks(clip_id, start_frame, end_frame, pixel_width)` which returns the downsampled pairs. The canvas draws a filled waveform shape using these peaks. Editing operations work on a `ClipEdit` enum: `Cut { start_frame, end_frame }`, `Trim { new_start, new_end }`, `Reverse { start_frame, end_frame }`. These are pushed to the undo stack as operation records containing enough data to reconstruct the inverse operation. For `Reverse`, the actual audio buffer bytes are flipped in a Tokio task and the peak cache is invalidated. For `Cut` and `Trim`, only metadata (start frame, end frame offsets) is modified — the underlying buffer is unchanged. Zero-crossing splice finds the nearest sample at which the waveform crosses 0.0 using a linear scan from the cursor position.

## Tasks

### Phase 1: Planning
- [ ] Define `ClipEdit` operation enum and undo record structure for each operation type
- [ ] Design `PeakCache` generation algorithm and invalidation strategy
- [ ] Plan canvas coordinate system: frame-to-pixel mapping at different zoom levels

### Phase 2: Implementation
- [ ] Implement `PeakCache` generation (downsample audio buffer to min/max pairs per pixel)
- [ ] Implement `get_waveform_peaks` Tauri command (returns serialized peak data for a frame range)
- [ ] Implement `trim_clip` (adjust clip start/end frame metadata, no buffer copy)
- [ ] Implement `cut_clip` (split clip at cursor position into two clips in project)
- [ ] Implement `reverse_clip` (flip selected frame range in buffer, update peak cache)
- [ ] Implement `splice_at_zero_crossing` (scan audio buffer for nearest zero crossing)
- [ ] Implement undo/redo stack with `undo_edit` and `redo_edit` Tauri commands
- [ ] Build React `WaveformEditor` canvas (draw waveform peaks, cursor, selection box)
- [ ] Build toolbar with zoom slider, tool toggle buttons, undo/redo
- [ ] Wire Ctrl+Z/Y to undo/redo commands

### Phase 3: Validation
- [ ] Load a 30-second WAV clip — waveform renders in < 100 ms
- [ ] Trim the clip start — clip plays from the new position correctly
- [ ] Cut a region — two separate clips appear in the project
- [ ] Reverse a selected region — audio plays backwards in that section
- [ ] Undo all operations — waveform restores to original state step by step
- [ ] Zoom to sample level — individual waveform cycles visible

### Phase 4: Documentation
- [ ] Rustdoc on `waveform_editor`, `PeakCache`, `EditHistory`, each operation
- [ ] Document zero-crossing search algorithm and performance bounds

## Acceptance Criteria

- [ ] Waveform renders visually for any loaded audio clip with correct amplitude shape
- [ ] Trim operation changes clip start/end without audible discontinuity
- [ ] Cut splits the clip into two pieces that play back-to-back correctly
- [ ] Reverse plays the selected region in reverse (audible backwards effect)
- [ ] Splice-at-zero-crossing snaps cursor to a zero crossing point in the waveform
- [ ] Ctrl+Z undoes the last edit; Ctrl+Y re-applies it across all operation types
- [ ] Zoom in/out changes the visible time range without changing playback

## Postmortem

See [Sprint 15 Postmortem](./sprint-15_postmortem.md)

## Notes

Created: 2026-02-22
