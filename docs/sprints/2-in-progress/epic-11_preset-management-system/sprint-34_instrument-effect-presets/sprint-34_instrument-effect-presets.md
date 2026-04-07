---
sprint: 34
title: "Instrument & Effect Presets"
type: fullstack
epic: 11
status: in-progress
created: 2026-02-23T00:00:00Z
started: 2026-04-07T14:29:19Z
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 80


---

# Sprint 34: Instrument & Effect Presets

## Overview

| Field | Value |
|-------|-------|
| Sprint | 34 |
| Title | Instrument & Effect Presets |
| Type | fullstack |
| Epic | 11 - Preset Management System |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Add a preset system so users can save and load named configurations for all built-in instruments (synth, sampler, drum machine) and effects (EQ, reverb, delay, compressor). Ship a small factory preset library. Provide a preset browser panel for discovery.

## Background

Users can design sounds across Sprints 6-9 and configure effects in Sprints 18-20, but there is no mechanism to save a configuration and recall it later. Every session starts from default values. Preset management is one of the most-used features in any DAW — producers save their go-to sounds, iterate on patches, and build personal libraries. Without presets the instruments are functional but the workflow is frustrating. This sprint adds the save/load infrastructure and a preset browser applicable to all current instruments and effects.

## Requirements

### Functional Requirements

- [ ] Save current instrument or effect state as a named preset: right-click component header → "Save Preset..."
- [ ] Load preset from browser: double-click or "Load" button replaces current parameter values immediately
- [ ] Preset browser panel: filterable list grouped by type (Synth, Sampler, Drum Machine, EQ, Reverb, Delay, Compressor)
- [ ] Factory presets shipped with the app:
  - Synth: 5 patches (bass, lead, pad, pluck, keys)
  - Drum machine: 2 kits (acoustic, electronic)
  - EQ: 3 templates (low cut, presence boost, mastering curve)
- [ ] User presets stored as JSON in `%APPDATA%/maestro/presets/{type}/`
- [ ] Import preset: load a `.mapreset` JSON file from disk
- [ ] Export preset: save current instrument/effect state to a `.mapreset` file for sharing
- [ ] Delete user preset (factory presets cannot be deleted)
- [ ] Search/filter presets by name substring

### Non-Functional Requirements

- [ ] Loading a preset applies all parameter changes within one audio buffer (no pop/click)
- [ ] Preset browser opens and populates in < 500ms for up to 500 presets
- [ ] Preset JSON format is human-readable and stable across app versions

## Dependencies

- **Sprints**:
  - Sprint 6 (Subtractive Synthesizer) — synth parameter schema
  - Sprint 7 (Sample Player & Sampler) — sampler parameter schema
  - Sprint 8 (Drum Machine) — drum machine parameter schema
  - Sprint 18 (EQ & Filter Effects) — EQ parameter schema
  - Sprint 19 (Reverb & Delay Effects) — reverb/delay parameter schema
  - Sprint 20 (Compression & Dynamics) — compressor parameter schema

## Scope

### In Scope

- `src-tauri/src/presets/mod.rs` — `Preset` struct, `PresetType` enum, `PresetManager` (load/save/list/delete)
- `src-tauri/src/presets/factory.rs` — factory preset definitions embedded as `include_str!()` JSON
- Tauri commands: `save_preset`, `load_preset`, `list_presets`, `delete_preset`, `import_preset_file`, `export_preset_file`
- `src/components/daw/PresetBrowser.tsx` — browser panel with type filter, search, list
- `src/hooks/usePresets.ts` — hook for save/load from any instrument or effect component
- Factory preset JSON files in `src-tauri/resources/presets/`
- Integration: "Preset" header bar added to `SynthPanel`, drum machine, and each effect panel with load/save controls

### Out of Scope

- Cloud/shared preset library (backlog)
- Preset version migration (backlog — document schema version field for future use)
- VST3 plugin preset (`.vstpreset`) management — Sprint 24 owns that
- Preset morphing / A-B comparison (backlog)

## Technical Approach

`Preset` is a serde-serializable struct: `{ name: String, preset_type: PresetType, schema_version: u32, params: serde_json::Value }`. `params` is the untyped JSON blob for the specific instrument/effect (allows schema evolution without breaking old presets). `PresetManager` uses `tokio::fs` for async file I/O. Factory presets are embedded at compile time via `include_str!()` and loaded as a const slice. Loading a preset calls the existing `set_param` Tauri commands in a batch, or directly deserializes the `params` blob into the instrument's `Params` struct and applies it atomically. The preset browser subscribes to the preset list via a `presetsStore` Zustand store, refreshing on open. The header bar embedded in each instrument/effect panel shows the current preset name and has Save/Browse buttons.

## Tasks

### Phase 1: Planning
- [ ] Define `Preset` JSON schema with schema_version for forwards compatibility
- [ ] Decide param storage format per instrument type (snapshot of all `AtomicF32` values)
- [ ] Create factory preset content (name, values) for all 10 factory presets

### Phase 2: Implementation
- [ ] Implement `Preset`, `PresetType`, `PresetManager` in Rust
- [ ] Write factory preset JSON files and embed via `include_str!()`
- [ ] Implement all preset Tauri commands
- [ ] Build `PresetBrowser.tsx` with type filter tabs and search
- [ ] Build `usePresets` hook used by all instrument and effect panels
- [ ] Add preset header bar to `SynthPanel`, drum machine panel, and each effect panel
- [ ] Wire load preset → batch parameter apply on audio thread

### Phase 3: Validation
- [ ] Unit test: save then load preset round-trip — all parameters identical
- [ ] Unit test: factory presets parse without error
- [ ] Unit test: `list_presets` returns correct counts for user and factory presets
- [ ] Unit test: delete factory preset returns error; delete user preset succeeds
- [ ] Component test: preset browser filters by type correctly
- [ ] Manual: save synth patch, change all knobs, load saved preset — knobs return to saved values
- [ ] Manual: import .mapreset file from disk — preset appears in browser

### Phase 4: Documentation
- [ ] Rustdoc on `Preset`, `PresetType`, `PresetManager`, all commands
- [ ] Document `.mapreset` JSON schema in `docs/`
- [ ] README note: where user presets are stored

## Acceptance Criteria

- [ ] Right-click instrument header → "Save Preset" → preset appears in browser
- [ ] Double-click preset in browser → instrument parameters update immediately
- [ ] All 10 factory presets load without error and produce expected sounds
- [ ] Search filters preset list correctly
- [ ] Export/import round-trip preserves all parameter values
- [ ] Preset browser opens and populates in < 500ms
- [ ] All tests pass; coverage ≥ 80%

## Notes

Created: 2026-02-23
