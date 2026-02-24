---
sprint: 4
title: "Project File System"
type: fullstack
epic: 1
status: in-progress
created: 2026-02-22T22:07:32Z
started: 2026-02-23T16:56:35Z
completed: null
hours: null
workflow_version: "3.1.0"


---

# Sprint 4: Project File System

## Overview

| Field | Value |
|-------|-------|
| Sprint | 4 |
| Title | Project File System |
| Type | fullstack |
| Epic | 1 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Design and implement the `.mapp` project file format that stores all DAW state — tracks, patterns, automation, instrument settings, mixer routing, and plugin configurations — so projects can be saved and loaded completely.

## Background

A DAW is only useful if you can save your work and come back to it. The project file format is the spine of everything: it must capture every piece of state from every component in the app. This sprint defines the format and implements save/load with no data loss, including embedded sample references and plugin state blobs.

## Requirements

### Functional Requirements

- [ ] Save all project state to a `.mapp` file (JSON-based zip archive)
- [ ] Load a `.mapp` file and fully restore all state
- [ ] Project file includes: BPM, time signature, tracks, patterns, automation, mixer routing, instrument configs, effect chain configs, plugin state blobs
- [ ] Sample files referenced by relative path within a project folder
- [ ] Auto-save every 5 minutes to a temp file
- [ ] "Save As" / "Open" / "New Project" commands
- [ ] Recent projects list (stored in app settings)
- [ ] Project file versioning for forward compatibility

### Non-Functional Requirements

- [ ] Save must complete in under 2 seconds for typical projects
- [ ] File format must be human-readable (JSON inner layer) for debugging
- [ ] Backwards compatibility: newer app versions must open older project files

## Dependencies

- **Sprints**: Sprint 1 (scaffold), Sprint 2 (audio engine state), Sprint 3 (MIDI state)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/project/format.rs` — ProjectFile, all sub-structs, serde impls
- `src-tauri/src/project/io.rs` — save_project, load_project, auto_save
- `src-tauri/src/project/version.rs` — version migration logic
- Tauri commands: `save_project`, `load_project`, `new_project`, `get_recent_projects`
- `.mapp` format spec documentation

### Out of Scope

- Exporting audio (Sprint 22)
- Cloud sync (not planned)
- Collaborative editing (not planned)

## Technical Approach

`.mapp` files are ZIP archives containing `project.json` (main state) and a `samples/` folder for embedded audio files. `project.json` is serialized with `serde_json` from a `ProjectFile` struct tree. A `SchemaVersion` field enables migration. Auto-save writes to `{project_name}.autosave.mapp` in the same directory. The Zustand frontend store serializes to JSON which is sent to Rust for wrapping and saving.

## Tasks

### Phase 1: Planning
- [ ] Design complete `ProjectFile` schema covering all current and planned features
- [ ] Choose zip library (`zip` crate)
- [ ] Plan versioning strategy (semver schema field)

### Phase 2: Implementation
- [ ] Implement `ProjectFile` and all sub-structs with serde
- [ ] Implement `save_project` (serialize → zip → write)
- [ ] Implement `load_project` (read → unzip → deserialize)
- [ ] Implement auto-save timer (tokio interval)
- [ ] Implement version migration (v1 → v2 etc.)
- [ ] Register Tauri commands
- [ ] Write round-trip tests: save then load, verify equality

### Phase 3: Validation
- [ ] Round-trip test with all fields populated
- [ ] Test opening a v1 file with v2 app (migration)
- [ ] Test corrupt/truncated file handling (graceful error)

### Phase 4: Documentation
- [ ] `.mapp` format spec in `docs/`
- [ ] Rustdoc on all project:: types

## Acceptance Criteria

- [ ] `save_project` creates a valid `.mapp` file
- [ ] `load_project` restores identical state from that file
- [ ] All project fields (BPM, tracks, patterns, routing) survive round-trip
- [ ] Auto-save writes every 5 minutes without interrupting playback
- [ ] Unknown future fields are ignored gracefully (forwards compat)
- [ ] Round-trip integration tests pass

## Notes

Created: 2026-02-22
