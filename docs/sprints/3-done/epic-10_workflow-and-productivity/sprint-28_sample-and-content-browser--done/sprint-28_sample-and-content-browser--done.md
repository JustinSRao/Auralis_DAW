---
sprint: 28
title: "Sample & Content Browser"
type: fullstack
epic: 10
status: done
created: 2026-02-23T00:00:00Z
started: 2026-04-05T11:54:38Z
completed: 2026-04-05
hours: null
workflow_version: "3.1.0"
coverage_threshold: 75



---

# Sprint 28: Sample & Content Browser

## Overview

| Field | Value |
|-------|-------|
| Sprint | 28 |
| Title | Sample & Content Browser |
| Type | fullstack |
| Epic | 10 - Workflow & Productivity |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Build a dockable browser panel where users can navigate their file system to find audio samples, preview them before loading, and drag them directly onto tracks or the sampler. Includes a Favorites system and recent folders list.

## Background

Sprint 7 (sampler) allows loading samples but requires knowing the exact file path. In practice, producers navigate large sample libraries constantly. Without a browser panel, the workflow is: open file dialog → navigate manually → load. A browser panel makes this: click file in panel → hear preview → drag to sampler. This is one of the highest-frequency interactions in any DAW session.

## Requirements

### Functional Requirements

- [ ] File system tree panel navigating drives and folders
- [ ] Audio file preview: click a file to hear a short preview (cpal output, no engine required)
- [ ] Preview auto-stops when another file is clicked or panel is closed
- [ ] Drag audio file from browser onto a sampler instrument or audio track to load it
- [ ] Favorites: right-click any folder to add to Favorites; Favorites section pinned at top of browser
- [ ] Recent folders: last 10 accessed folders remembered
- [ ] Filter: show only audio files (WAV, MP3, FLAC, OGG, AIFF) — hide other file types
- [ ] Search: filter visible files by filename substring within current folder

### Non-Functional Requirements

- [ ] Folder expand/collapse is instant (no blocking I/O on UI thread)
- [ ] Preview latency < 200ms from click to first audio output
- [ ] Browser panel is resizable and dockable (left or right side)

## Dependencies

- **Sprints**:
  - Sprint 2 (Core Audio Engine) — audio output for preview playback
  - Sprint 7 (Sample Player & Sampler) — drag-to-sampler integration

## Scope

### In Scope

- `src-tauri/src/browser/mod.rs` — file system listing commands (async, non-blocking)
- `src-tauri/src/browser/preview.rs` — audio file preview player (short decode + cpal output)
- Tauri commands: `list_directory`, `get_drives`, `preview_file`, `stop_preview`, `save_favorite`, `remove_favorite`, `get_favorites`, `get_recent_folders`
- `src/components/daw/BrowserPanel.tsx` — main browser panel with tree + file list
- `src/components/daw/browser/FolderTree.tsx`
- `src/components/daw/browser/FileList.tsx`
- `src/stores/browserStore.ts` — current path, favorites, recents, search query

### Out of Scope

- VST preset browsing (Epic 8 VST sprint)
- Project file browser (separate from sample browser)
- Cloud sample library integration (backlog)
- Waveform thumbnail rendering in browser (backlog)

## Technical Approach

`list_directory` uses `tokio::fs` for async directory reads, returning `Vec<FileEntry>` (name, path, size, is_dir, is_audio). Preview uses a minimal cpal output stream (separate from the main audio engine) that decodes the first 3 seconds via symphonia and plays back immediately. Drag-and-drop uses the Tauri drag-and-drop API to pass a file path to the drop target (sampler or audio track). Favorites and recents are stored in the app config (Sprint 27's `AppConfig`).

## Tasks

### Phase 1: Planning
- [ ] Design `FileEntry` and directory listing API
- [ ] Design preview player lifecycle (start, stop, overlap handling)
- [ ] Plan drag-and-drop protocol between browser and drop targets

### Phase 2: Implementation
- [ ] Implement `list_directory` and `get_drives` commands (async)
- [ ] Implement preview player with symphonia decode + cpal output
- [ ] Build `FolderTree.tsx` with lazy expand
- [ ] Build `FileList.tsx` with audio-file filter and search
- [ ] Implement drag from `FileList` using HTML5 drag events + Tauri path transfer
- [ ] Implement favorites and recents in `browserStore.ts` (persisted via Sprint 27 config)
- [ ] Build `BrowserPanel.tsx` assembling all sub-components with resize handle

### Phase 3: Validation
- [ ] Unit test: `list_directory` returns correct entries for a known test directory
- [ ] Unit test: audio file filter correctly identifies WAV/MP3/FLAC/OGG
- [ ] Component test: folder tree expands on click
- [ ] Component test: search filters file list correctly
- [ ] Manual: drag a WAV file from browser onto sampler loads it correctly
- [ ] Manual: preview plays within 200ms and stops when another file is clicked

### Phase 4: Documentation
- [ ] Rustdoc on all `browser::` public types and commands
- [ ] README section: supported audio formats and preview limitations

## Acceptance Criteria

- [ ] Browser panel shows file system tree and file list
- [ ] Clicking an audio file plays a preview within 200ms
- [ ] Dragging to sampler loads the sample
- [ ] Favorites and recents persist across restarts
- [ ] Search filters files by name
- [ ] All tests pass

## Notes

Created: 2026-02-23
