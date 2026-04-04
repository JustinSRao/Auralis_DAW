---
sprint: 27
title: "Settings & Preferences UI"
type: fullstack
epic: 9
status: done
created: 2026-02-23T00:00:00Z
started: 2026-04-03T17:57:30Z
completed: 2026-04-03
hours: null
workflow_version: "3.1.0"
coverage_threshold: 75


---

# Sprint 27: Settings & Preferences UI

## Overview

| Field | Value |
|-------|-------|
| Sprint | 27 |
| Title | Settings & Preferences UI |
| Type | fullstack |
| Epic | 9 - Settings & Preferences |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Build a Settings panel that surfaces all existing IPC configuration commands — audio device selection, buffer size, sample rate, MIDI routing — in a user-facing UI, and adds persistent storage for preferences so choices survive app restarts.

## Background

Sprints 2 and 3 built Tauri commands for audio device selection and MIDI routing, but there is currently no UI entry point for these commands. Users cannot change their audio interface or buffer size without modifying code. This sprint creates the Settings panel and a preferences persistence layer so the DAW is self-configurable by end users.

## Requirements

### Functional Requirements

- [ ] Settings panel accessible via menu or keyboard shortcut (e.g. Ctrl+,)
- [ ] Audio tab: output device selector, input device selector, sample rate, buffer size
- [ ] MIDI tab: enable/disable per MIDI input/output device; show device names
- [ ] General tab: default project folder (file picker), auto-save interval toggle
- [ ] UI tab: theme selector (dark/light), UI zoom level
- [ ] All settings persisted to a local config file (TOML or JSON in app data dir)
- [ ] Settings loaded and applied on app startup before audio engine starts

### Non-Functional Requirements

- [ ] Settings changes that require audio engine restart prompt the user before applying
- [ ] Invalid settings (e.g. unavailable device) fall back gracefully with an error message
- [ ] Config file is human-readable (TOML preferred)

## Dependencies

- **Sprints**:
  - Sprint 2 (Core Audio Engine) — `get_audio_devices`, `set_audio_device`, `set_engine_config`
  - Sprint 3 (MIDI I/O System) — `get_midi_devices`, `set_midi_device_enabled`

## Scope

### In Scope

- `src-tauri/src/config/mod.rs` — `AppConfig` struct, load/save to TOML in app data dir
- `src-tauri/src/config/commands.rs` — Tauri commands: `get_config`, `save_config`
- `src/components/daw/SettingsPanel.tsx` — modal/drawer settings panel with tab navigation
- `src/components/daw/settings/AudioSettingsTab.tsx`
- `src/components/daw/settings/MidiSettingsTab.tsx`
- `src/components/daw/settings/GeneralSettingsTab.tsx`
- `src/components/daw/settings/UiSettingsTab.tsx`
- `src/stores/settingsStore.ts` — Zustand settings state, hydrated from `get_config` on startup

### Out of Scope

- Keyboard shortcut remapping UI (backlog in Epic 9)
- Cloud/sync preferences
- Plugin scan paths (VST3 sprint owns that)

## Technical Approach

`AppConfig` is a Rust struct (serde-serializable to TOML) stored in the OS app data directory via `tauri::api::path::app_data_dir`. On startup, `lib.rs` loads config and passes audio/MIDI settings to the engine before starting. Changes in the Settings panel call `save_config` and selectively call existing audio/MIDI commands. Buffer size and sample rate changes that require an engine restart show a confirmation dialog; other settings apply immediately.

## Tasks

### Phase 1: Planning
- [ ] Define `AppConfig` schema covering all configurable fields
- [ ] Decide config file format and location (TOML in `%APPDATA%/maestro/`)
- [ ] Sketch settings panel layout (tabs, controls per tab)

### Phase 2: Implementation
- [ ] Implement `AppConfig` struct with serde TOML serialization
- [ ] Implement load/save config Tauri commands
- [ ] Wire config load into app startup sequence (before audio engine start)
- [ ] Build `SettingsPanel.tsx` modal with tab navigation
- [ ] Build each settings tab component
- [ ] Implement `settingsStore.ts` — load on mount, optimistic updates, save on change
- [ ] Handle engine-restart-required confirmation flow

### Phase 3: Validation
- [ ] Unit test: `AppConfig` serializes and deserializes correctly (round-trip)
- [ ] Unit test: missing config file returns default config
- [ ] Component test: each tab renders correct controls for mock config
- [ ] Component test: changing audio device calls correct Tauri command
- [ ] Manual: settings survive app restart

### Phase 4: Documentation
- [ ] Rustdoc on `AppConfig` and all config commands
- [ ] README section: config file location and format

## Acceptance Criteria

- [ ] Settings panel opens via Ctrl+, and from menu
- [ ] Audio device, buffer size, sample rate changeable without editing code
- [ ] MIDI devices can be enabled/disabled per device
- [ ] All settings persist across app restarts
- [ ] Unavailable device shows error and falls back to default
- [ ] All tests pass

## Notes

Created: 2026-02-23
