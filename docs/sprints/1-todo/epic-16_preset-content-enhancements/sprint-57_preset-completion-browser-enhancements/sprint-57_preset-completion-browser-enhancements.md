---
sprint: 57
title: "Preset Completion & Browser Enhancements"
type: fullstack
epic: 16
status: planning
created: 2026-04-07T15:43:30Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 57: Preset Completion & Browser Enhancements

## Overview

| Field | Value |
|-------|-------|
| Sprint | 57 |
| Title | Preset Completion & Browser Enhancements |
| Type | fullstack |
| Epic | 16 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Add factory presets for Reverb, Delay, and Compressor effect types, persist the preset browser panel width across restarts, and add waveform thumbnail rendering to the sample browser file list — completing the deferred Sprint 28 and Sprint 34 content work.

## Background

These three items were deferred from Sprints 28 and 34 postmortems:

- **Sprint 34 debt (effect factory presets)**: The preset browser shows empty preset lists for Reverb, Delay, and Compressor effect types. Users who load these effects have no factory starting points. Reverb, Delay, and Compressor are the most-used effects in a DAW and must ship with meaningful factory presets to be useful out of the box.
- **Sprint 28 debt (PresetBrowser panel width persistence)**: The preset browser side panel width is controlled by a splitter/drag handle, but the width is not saved. On restart, the panel resets to its default width. This is a friction point for users who prefer a wider or narrower preset browser. The fix saves the panel width to `AppConfig` via the Sprint 27 preferences system.
- **Sprint 28 debt (waveform thumbnail in sample browser)**: The sample browser file list shows file names only, with no visual indication of the waveform shape. A small waveform thumbnail preview next to each audio file would let users quickly identify sample character (percussive vs. sustained, short vs. long) before auditioning. The existing audio preview infrastructure from Sprint 28 can decode audio; the thumbnail is a downsampled rendering of the decoded data.

## Requirements

### Functional Requirements

- [ ] **Reverb factory presets**: 3 factory preset JSON files in `src-tauri/resources/presets/reverb/`:
  - `room.json` — small room with short decay (~0.8s), moderate diffusion
  - `hall.json` — large hall with long decay (~3.0s), high diffusion
  - `plate.json` — plate reverb character: bright, medium decay (~1.5s), dense early reflections
- [ ] **Delay factory presets**: 3 factory preset JSON files in `src-tauri/resources/presets/delay/`:
  - `quarter_note.json` — delay time synced to quarter note, moderate feedback (~40%), no ping-pong
  - `dotted_eighth.json` — delay time synced to dotted eighth note, moderate feedback (~35%), no ping-pong
  - `ping_pong.json` — delay time synced to eighth note, ping-pong mode enabled, feedback ~30%
- [ ] **Compressor factory presets**: 3 factory preset JSON files in `src-tauri/resources/presets/compressor/`:
  - `gentle_glue.json` — low ratio (2:1), slow attack (30ms), slow release (200ms), light threshold (-12dB)
  - `hard_limiter.json` — high ratio (20:1), fast attack (1ms), fast release (10ms), threshold (-3dB)
  - `vocal_rider.json` — medium ratio (4:1), medium attack (10ms), medium release (80ms), threshold (-18dB)
- [ ] All 9 factory presets are embedded via `include_str!()` in `src-tauri/src/presets/` and appear in the preset browser under their respective effect categories
- [ ] **PresetBrowser panel width persistence**: The preset browser panel width (in pixels) is saved to `AppConfig` when the user releases the splitter drag handle, and restored from `AppConfig` on application startup
- [ ] **Waveform thumbnails in sample browser**: Each audio file entry in the sample browser file list displays a small waveform thumbnail (approximately 80×24 pixels) rendered as an inline SVG or `<canvas>`. Thumbnails are generated lazily on first view and cached in the application data directory. Subsequent views load from cache instantly.

### Non-Functional Requirements

- [ ] Factory preset JSON files pass schema validation against the existing effect preset schema
- [ ] Panel width is clamped to valid bounds (minimum 150px, maximum 600px) before saving and after loading
- [ ] Waveform thumbnail generation runs in a background Tauri task — the UI does not block while thumbnails are being generated; entries show a placeholder until the thumbnail is ready
- [ ] Thumbnail cache key is the file path + file modification timestamp — stale thumbnails are regenerated if the source file changes

## Dependencies

- **Sprints**: Sprint 28 (Sample Browser — audio preview infrastructure, file list UI), Sprint 27 (Settings UI — `AppConfig` save/load mechanism), Sprint 34 (Presets — factory preset embedding mechanism, preset browser panel)
- **External**: None

## Scope

### In Scope

- 3 Reverb factory presets (Room, Hall, Plate)
- 3 Delay factory presets (Quarter Note, Dotted Eighth, Ping-Pong)
- 3 Compressor factory presets (Gentle Glue, Hard Limiter, Vocal Rider)
- Factory preset embedding with `include_str!()`
- PresetBrowser panel width persisted to `AppConfig`
- Waveform thumbnail generation (background task) and rendering in sample browser file list
- Thumbnail disk cache

### Out of Scope

- New preset tagging or search features (Sprint 57's scope is content completion only)
- Waveform editor in the sample browser (full waveform display on click — that is a future enhancement)
- Effect preset editing UI

## Technical Approach

### Factory Presets

Each preset JSON file follows the structure established by Sprint 34 for effect presets. Example for `room.json`:
```json
{
  "name": "Room",
  "effect_type": "Reverb",
  "parameters": {
    "room_size": 0.3,
    "decay_time": 0.8,
    "diffusion": 0.6,
    "damping": 0.5,
    "wet_dry_mix": 0.25
  }
}
```
Embed each with `include_str!("../resources/presets/reverb/room.json")` etc. in `src-tauri/src/presets/factory.rs` (or equivalent). Register them with the preset system so they appear in the preset browser with the category badge.

### Panel Width Persistence

Add a `preset_browser_width: Option<f32>` field to the `AppConfig` struct in `src-tauri/src/config/`. In the React `PresetBrowser` component, the splitter's `onDragEnd` handler calls `ipc.savePreferenceSingle("preset_browser_width", width)`. On component mount, read `AppConfig.preset_browser_width` via `ipc.getPreferences()` and apply it as the initial panel width.

Use the existing preference save/load mechanism from Sprint 27 — no new Tauri commands needed if `AppConfig` is already generic.

### Waveform Thumbnail Generation

Add a Tauri command `get_waveform_thumbnail(file_path: String) -> Result<Vec<f32>, Error>` that:
1. Computes a cache key from the file path + modification timestamp
2. Checks if a cached thumbnail JSON exists in `{app_data_dir}/thumbnail_cache/{hash}.json`
3. If cached: deserializes and returns the `Vec<f32>` (200 points)
4. If not cached: decodes the first 2 seconds of audio via symphonia, downsamples to 200 points by taking the max absolute value in each segment, serializes to JSON, writes to cache, and returns the data

In the sample browser file list component, for each audio file entry, call `ipc.getWaveformThumbnail(filePath)` on mount (or when scrolled into view via IntersectionObserver). While loading, show a placeholder bar. On receipt, render a small SVG path or canvas drawing connecting the 200 amplitude points.

## Tasks

### Phase 1: Planning
- [ ] Review existing factory preset embedding mechanism in `src-tauri/src/presets/` — confirm `include_str!()` pattern
- [ ] Confirm exact effect preset schema (field names and types) for Reverb, Delay, Compressor from Sprint 34
- [ ] Confirm `AppConfig` structure from Sprint 27 — determine how to add `preset_browser_width` field
- [ ] Assess thumbnail cache directory location (`app_data_dir` vs `cache_dir`)

### Phase 2: Backend Implementation
- [ ] Create `src-tauri/resources/presets/reverb/room.json`, `hall.json`, `plate.json`
- [ ] Create `src-tauri/resources/presets/delay/quarter_note.json`, `dotted_eighth.json`, `ping_pong.json`
- [ ] Create `src-tauri/resources/presets/compressor/gentle_glue.json`, `hard_limiter.json`, `vocal_rider.json`
- [ ] Embed all 9 new factory presets with `include_str!()` in the presets module
- [ ] Add `preset_browser_width: Option<f32>` to `AppConfig` struct
- [ ] Implement `get_waveform_thumbnail(file_path)` Tauri command with caching

### Phase 3: Frontend Implementation
- [ ] Add `ipc.getWaveformThumbnail` typed wrapper to `src/lib/ipc.ts`
- [ ] Update sample browser file list to request and render waveform thumbnails per audio file entry
- [ ] Show placeholder (thin gray bar) while thumbnail is loading
- [ ] Render 200-point amplitude data as SVG polyline in an 80×24px container
- [ ] Add splitter `onDragEnd` handler in `PresetBrowser` to save width via preferences IPC
- [ ] Apply saved `preset_browser_width` from `AppConfig` on `PresetBrowser` mount

### Phase 4: Tests
- [ ] Verify all 9 factory presets load via the preset browser and apply to their effect type without error
- [ ] Add Rust unit test: `get_waveform_thumbnail` returns 200 points for a known test audio file
- [ ] Add Rust unit test: second call with the same path returns cached result (cache hit)
- [ ] Add component test: sample browser file list renders thumbnail placeholder for audio files initially
- [ ] Verify `preset_browser_width` persists across simulated restart (save → load → check value)

### Phase 5: Validation
- [ ] Manual test: open preset browser, expand Reverb — verify Room, Hall, Plate presets appear
- [ ] Manual test: apply "Hall" preset to a reverb effect — verify parameters are set correctly
- [ ] Manual test: drag preset browser panel to 300px width, restart app — verify width is restored
- [ ] Manual test: open sample browser — verify waveform thumbnails appear for audio files after brief load
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] 9 factory presets (3 Reverb, 3 Delay, 3 Compressor) appear in the preset browser under their respective categories
- [ ] Each factory preset applies correct parameter values to the effect when loaded
- [ ] Preset browser panel width is restored from `AppConfig` on application startup
- [ ] Waveform thumbnails (80×24px) are visible in the sample browser file list for audio files
- [ ] Thumbnails are cached to disk — second view of the same file loads instantly
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 34 debt | Factory presets for Reverb (Room, Hall, Plate) | `src-tauri/resources/presets/reverb/` |
| Sprint 34 debt | Factory presets for Delay (Quarter, Dotted Eighth, Ping-Pong) | `src-tauri/resources/presets/delay/` |
| Sprint 34 debt | Factory presets for Compressor (Glue, Limiter, Vocal) | `src-tauri/resources/presets/compressor/` |
| Sprint 28 debt | PresetBrowser panel width not persisted | `AppConfig` + `PresetBrowser.tsx` |
| Sprint 28 debt | Waveform thumbnails in sample browser file list | `get_waveform_thumbnail` command + sample browser component |

## Notes

Created: 2026-04-07
