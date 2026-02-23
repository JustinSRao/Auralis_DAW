---
sprint: 23
title: "VST3 Plugin Host (Rust)"
type: fullstack
epic: 8
status: planning
created: 2026-02-22T22:10:14Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 23: VST3 Plugin Host (Rust)

## Overview

| Field | Value |
|-------|-------|
| Sprint | 23 |
| Title | VST3 Plugin Host (Rust) |
| Type | fullstack |
| Epic | 8 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build a Rust VST3 plugin host using `vst3-sys` that scans plugin directories, loads .vst3 bundles, instantiates plugins, routes audio and MIDI through them, handles parameter reads/writes, and persists plugin state as bytes in the project file.

## Background

VST3 plugin support dramatically expands the DAW's capabilities — users can load thousands of free and commercial VST3 instruments and effects from the internet. Without a plugin host, the DAW is limited to its built-in instruments and effects. Implementing the host in Rust gives direct access to the COM-based VST3 interface without a C++ wrapper.

## Requirements

### Functional Requirements

- [ ] Scan configurable VST3 search paths (default: `C:\Program Files\Common Files\VST3`) for `.vst3` bundles
- [ ] Load a VST3 bundle: enumerate components, create an instrument (`Instrument`) or effect (`MFx`) component
- [ ] Initialize plugin (set sample rate, block size, bus configuration) via `IComponent` and `IAudioProcessor`
- [ ] Process audio: pass input buffers and MIDI event list to plugin per audio callback via `IAudioProcessor::process`
- [ ] Expose plugin parameters: enumerate all parameters via `IEditController`, read current values, write changed values
- [ ] Save plugin state: call `IComponent::getState` and store the opaque byte blob in the project file
- [ ] Restore plugin state: call `IComponent::setState` with saved bytes on project load
- [ ] Tauri commands: `scan_vst3_plugins`, `load_vst3_plugin`, `unload_vst3_plugin`, `set_vst3_param`, `get_vst3_params`, `save_vst3_state`, `load_vst3_state`

### Non-Functional Requirements

- [ ] Plugin scan runs on a Tokio blocking task (not audio thread) — scan can be slow for large plugin counts
- [ ] Audio processing (IAudioProcessor::process) must be called from the audio thread with no additional locking
- [ ] Plugin host must not crash the entire DAW if a plugin panics (catch_unwind or OS-level isolation — best effort)
- [ ] Supports VST3 SDK 3.7.x API

## Dependencies

- **Sprints**: Sprint 2 (AudioGraph / AudioNode trait — VST3 instrument and effect both implement AudioNode), Sprint 17 (mixer insert chain — VST3 effect inserted like any built-in effect), Sprint 21 (EffectChain — VST3 effect type registered as an insertable effect)
- **External**: `vst3-sys` Rust crate (Steinberg VST3 FFI bindings)

## Scope

### In Scope

- `src-tauri/src/vst3/scanner.rs` — `scan_vst3_directory(path)` returning `Vec<PluginInfo>`
- `src-tauri/src/vst3/loader.rs` — load `.vst3` DLL/bundle, create `IComponent`, connect to `IAudioProcessor`
- `src-tauri/src/vst3/host.rs` — `Vst3Host` struct: implements `IHostApplication`, `IComponentHandler` for parameter notifications
- `src-tauri/src/vst3/instrument.rs` — `Vst3Instrument` implementing `AudioNode` (MIDI in, audio out)
- `src-tauri/src/vst3/effect.rs` — `Vst3Effect` implementing `AudioEffect` (audio in, audio out)
- `src-tauri/src/vst3/params.rs` — parameter enumeration and value normalization
- Tauri commands: all listed above
- Plugin state serialization: `Vec<u8>` stored as base64 in project JSON

### Out of Scope

- Plugin native GUI window (Sprint 24)
- VST3 MIDI output from plugin (synth that generates MIDI — uncommon use case)
- VST2 support (VST2 SDK no longer available)
- Plugin sandboxing in a separate process

## Technical Approach

`vst3-sys` provides raw FFI bindings to the VST3 interfaces (`IComponent`, `IAudioProcessor`, `IEditController`, `IHostApplication`). The scanner walks the search path for directories ending in `.vst3`, loads the contained `.dll` via `libloading::Library`, and calls `GetPluginFactory()` to enumerate plugin classes. The `Vst3Host` struct implements `IHostApplication` and `IComponentHandler` as Rust COM objects using `vst3-sys`'s `implement_interfaces!` macro or manual vtable construction. Audio processing calls `IAudioProcessor::process` with a `ProcessData` struct containing the input/output bus buffers (as raw `*mut f32` slices) and an `EventList` of MIDI events. Plugin parameters are mapped between normalized VST3 values (0.0–1.0) and plain values using `IEditController::normalizedParamToPlain`. State is retrieved as an `IBStream` implementation backed by a `Vec<u8>`.

## Tasks

### Phase 1: Planning
- [ ] Study VST3 SDK 3.7 C++ headers and map to `vst3-sys` Rust bindings equivalents
- [ ] Design `PluginInfo` struct (name, vendor, category, uid, path, class_id)
- [ ] Plan `IHostApplication` and `IComponentHandler` COM implementation in Rust

### Phase 2: Implementation
- [ ] Implement VST3 directory scanner using `walkdir` crate
- [ ] Implement `GetPluginFactory` call and class enumeration
- [ ] Implement `IHostApplication` and `IComponentHandler` Rust COM objects
- [ ] Implement plugin initialization: set sample rate, block size, activate bus configurations
- [ ] Implement `IAudioProcessor::process` call from audio thread (per audio callback)
- [ ] Implement `Vst3Instrument` AudioNode (note events → plugin → audio output)
- [ ] Implement `Vst3Effect` AudioEffect (audio in → plugin → audio out)
- [ ] Implement parameter enumeration and read/write via `IEditController`
- [ ] Implement state save (`IBStream` read) and restore (`IBStream` write)
- [ ] Tauri commands wiring all operations

### Phase 3: Validation
- [ ] Scan system VST3 folder — at least one free plugin (e.g., LABS by Spitfire) is listed
- [ ] Load a free VST3 synth — MIDI notes trigger audio output through the plugin
- [ ] Load a free VST3 effect (e.g., Valhalla Supermassive free) — processes audio correctly
- [ ] Adjust a plugin parameter — change audible in real time
- [ ] Save and reload project — plugin state is restored (parameters match saved values)
- [ ] Load a plugin that reports an error — DAW continues running without crash

### Phase 4: Documentation
- [ ] Rustdoc on `Vst3Host`, `Vst3Instrument`, `Vst3Effect`, scanner, loader, state I/O
- [ ] Document VST3 initialization sequence and bus configuration assumptions

## Acceptance Criteria

- [ ] `scan_vst3_plugins` returns a list of all valid VST3 plugins in the scan path
- [ ] A VST3 instrument plugin produces audio when MIDI notes are sent to it
- [ ] A VST3 effect plugin processes audio inserted in a mixer channel
- [ ] Plugin parameters can be read and written via Tauri commands
- [ ] Plugin state saves and restores correctly across project save/load cycles
- [ ] Scanning and loading does not block the audio thread
- [ ] A plugin that fails to load returns an error message without crashing the DAW

## Notes

Created: 2026-02-22
