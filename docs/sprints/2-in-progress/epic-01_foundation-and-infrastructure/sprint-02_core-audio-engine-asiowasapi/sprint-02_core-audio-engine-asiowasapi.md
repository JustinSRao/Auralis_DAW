---
sprint: 2
title: "Core Audio Engine (ASIO/WASAPI)"
type: backend
epic: 1
status: done
created: 2026-02-22T22:07:26Z
started: 2026-02-23T02:00:33Z
completed: 2026-02-23T04:30:00Z
hours: 2.5
workflow_version: "3.1.0"
coverage_threshold: 60
# Justification: Real-time audio thread not unit-testable; verified via smoke/integration tests


---

# Sprint 2: Core Audio Engine (ASIO/WASAPI)

## Overview

| Field | Value |
|-------|-------|
| Sprint | 2 |
| Title | Core Audio Engine (ASIO/WASAPI) |
| Type | backend |
| Epic | 1 - Foundation & Infrastructure |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build the real-time audio engine in Rust using `cpal` with ASIO support, running on a dedicated audio thread with lock-free communication to the rest of the app.

## Background

All sound in the DAW flows through the audio engine. It must run on a dedicated real-time thread with minimal latency, process audio in small buffers (256 samples at 44100 Hz = ~5.8ms), and communicate with the main thread safely using lock-free primitives. This sprint builds the engine shell, device enumeration, and a test tone generator to prove end-to-end audio works before any instruments are built.

## Requirements

### Functional Requirements

- [ ] Enumerate all available ASIO and WASAPI audio devices
- [ ] Allow selecting input and output devices via Tauri commands
- [ ] Start/stop the audio engine from the frontend
- [ ] Audio engine runs on a dedicated real-time thread (not the Tokio thread pool)
- [ ] Play a test sine tone (440 Hz) to verify audio output
- [ ] Support sample rates: 44100 Hz and 48000 Hz
- [ ] Support buffer sizes: 128, 256, 512, 1024 samples
- [ ] Frontend can query device list and current engine status

### Non-Functional Requirements

- [ ] Audio callback must complete in under half the buffer period
- [ ] Zero heap allocations on the audio thread
- [ ] Thread-safe parameter updates via `atomic_float` and `crossbeam-channel`
- [ ] Graceful fallback to WASAPI if ASIO not available

## Dependencies

- **Sprints**: Sprint 1 (Project Scaffold) must be complete
- **External**: ASIO4ALL driver (optional — user-installed for lowest latency)

## Scope

### In Scope

- `src-tauri/src/audio/engine.rs` — AudioEngine struct, stream management
- `src-tauri/src/audio/devices.rs` — device enumeration (ASIO + WASAPI)
- `src-tauri/src/audio/graph.rs` — AudioGraph and AudioNode trait (stub)
- Tauri commands: `get_audio_devices`, `set_audio_device`, `start_engine`, `stop_engine`, `set_engine_config`
- Test tone node (440 Hz sine wave)

### Out of Scope

- Instrument audio processing (Sprints 6-9)
- Mixer routing (Sprint 17)
- Effects processing (Sprints 18-21)
- Audio recording from mic (Sprint 9)

## Technical Approach

Use `cpal` crate with the `asio` Cargo feature (Windows-only). The engine runs inside a `cpal` output stream callback on a system audio thread. An `AudioGraph` holds a `Vec<Box<dyn AudioNode>>`. Parameters flow from the main thread to the audio thread via `crossbeam-channel` for discrete commands and `atomic_float` for continuous knob values. Device enumeration returns serializable structs to the frontend via Tauri IPC.

## Tasks

### Phase 1: Planning
- [ ] Research `cpal` ASIO build requirements (asio-sys, ASIO SDK headers)
- [ ] Design `AudioEngine`, `AudioGraph`, and `AudioNode` trait API
- [ ] Plan Tauri command surface for audio control

### Phase 2: Implementation
- [ ] Implement device enumeration (ASIO + WASAPI hosts)
- [ ] Implement `AudioEngine::start()` / `stop()` with cpal stream
- [ ] Implement `SineTestNode` — 440 Hz sine wave generator
- [ ] Add lock-free command channel (crossbeam)
- [ ] Register Tauri commands in `lib.rs`
- [ ] Write smoke test: engine starts and produces audio output

### Phase 3: Validation
- [ ] Test ASIO path with ASIO4ALL installed
- [ ] Test WASAPI fallback without ASIO4ALL
- [ ] 60-second stress test — no glitches at 256 buffer size
- [ ] Verify no heap allocations in audio callback

### Phase 4: Documentation
- [ ] README section: Audio setup & ASIO4ALL install guide
- [ ] Inline rustdoc on all public `audio::` types

## Acceptance Criteria

- [ ] `get_audio_devices` returns list with at least one device
- [ ] `start_engine` produces audible 440 Hz sine tone
- [ ] `stop_engine` stops audio with no crash
- [ ] ASIO device used when ASIO4ALL present
- [ ] WASAPI fallback works without ASIO4ALL
- [ ] No panics in 60-second audio stress test
- [ ] Cargo warns about zero allocations on audio thread

## Notes

Created: 2026-02-22

## Postmortem

See [Sprint 2 Postmortem](./sprint-2_postmortem.md)
