---
sprint: 7
title: "Sample Player & Sampler"
type: fullstack
epic: 3
status: planning
created: 2026-02-22T22:09:57Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 7: Sample Player & Sampler

## Overview

| Field | Value |
|-------|-------|
| Sprint | 7 |
| Title | Sample Player & Sampler |
| Type | fullstack |
| Epic | 3 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build a polyphonic sample player instrument that loads WAV, MP3, and FLAC audio files, pitch-maps them across the MIDI keyboard with linear resampling, and supports per-zone loop points and an ADSR amplitude envelope.

## Background

Many DAW productions rely heavily on sample-based instruments — piano, strings, drums, and foley recorded from real instruments. A sampler complements the subtractive synth by allowing users to load any audio file and play it at different pitches. This sprint adds the second core instrument type and introduces the `symphonia` audio decoding crate into the engine.

## Requirements

### Functional Requirements

- [ ] Load audio files in WAV, MP3, and FLAC formats via `symphonia` crate
- [ ] Map a loaded sample to a root MIDI note (the note it plays back at original pitch)
- [ ] Pitch-shift playback to any MIDI note using linear resampling relative to root note
- [ ] Support multi-sample zones: different audio files triggered by different MIDI note ranges
- [ ] Per-zone configurable loop points (start sample index, end sample index, loop on/off)
- [ ] ADSR amplitude envelope applied to each sample voice (same engine as Sprint 6)
- [ ] Polyphony: up to 8 simultaneous sample voices
- [ ] Drag-and-drop audio file loading from the OS file system onto the sampler UI
- [ ] Tauri commands: `load_sample_zone`, `set_sampler_param`, `get_sampler_state`

### Non-Functional Requirements

- [ ] Audio file decoded once on load (not during the audio callback) and stored as `Vec<f32>` in memory
- [ ] Resampling uses linear interpolation — no heap allocation per sample in the audio callback
- [ ] Large files (> 100 MB) should not block the audio thread during load (decode on a Tokio task)
- [ ] Memory ceiling: warn if total loaded samples exceed 512 MB

## Dependencies

- **Sprints**: Sprint 2 (AudioEngine + AudioNode trait), Sprint 3 (MIDI note events), Sprint 6 (ADSR envelope implementation — reuse)
- **External**: `symphonia` crate for audio decoding (WAV, MP3, FLAC)

## Scope

### In Scope

- `src-tauri/src/instruments/sampler.rs` — `Sampler` struct implementing `AudioNode`
- `src-tauri/src/instruments/sampler/zone.rs` — `SampleZone` (root note, MIDI range, audio buffer, loop points)
- `src-tauri/src/instruments/sampler/voice.rs` — `SamplerVoice` (playback position, resampling, ADSR)
- `src-tauri/src/instruments/sampler/decoder.rs` — `decode_audio_file()` using symphonia
- Tauri commands: `load_sample_zone`, `remove_sample_zone`, `set_sampler_param`, `get_sampler_state`
- React `SamplerPanel` with zone list, drag-and-drop drop target, knobs (attack, decay, sustain, release), loop point controls

### Out of Scope

- Granular playback mode
- Pitch detection (auto-detect root note from file name or header)
- SFZ or SF2 soundfont import
- Sample time-stretching (Sprint 16)

## Technical Approach

`decode_audio_file` is called from a Tokio async task when a file is dropped or selected, decoding with `symphonia` into an interleaved `Vec<f32>` normalized to [-1.0, 1.0]. The decoded buffer is stored in `Arc<SampleBuffer>` and sent to the audio thread via `crossbeam-channel`. Each `SampleZone` holds an `Arc<SampleBuffer>`, a root MIDI note, a MIDI note range, and loop start/end frame indices. On MIDI note-on, `Sampler` finds the matching zone by note range, activates a `SamplerVoice` that tracks a fractional playback position. Per sample, the voice computes a pitch ratio (`2^((note - root)/12)`) and advances the position by that ratio, reading with linear interpolation between adjacent samples. Loop points wrap the playback position to the loop region when loop is enabled.

## Tasks

### Phase 1: Planning
- [ ] Design `SampleZone` and `SampleBuffer` data structures
- [ ] Plan drag-and-drop integration: Tauri file drop event → decode → load zone
- [ ] Confirm `symphonia` crate supports MP3 decoding on Windows without license issues

### Phase 2: Implementation
- [ ] Implement `decode_audio_file()` with symphonia (WAV, MP3, FLAC paths)
- [ ] Implement `SampleZone` with root note, range, buffer reference, loop points
- [ ] Implement `SamplerVoice` with fractional position, linear interpolation, ADSR
- [ ] Implement `Sampler` AudioNode with zone lookup, voice pool (8 voices), voice stealing
- [ ] Implement `load_sample_zone` Tauri command (async decode + send to audio thread)
- [ ] React: implement drag-and-drop file target in `SamplerPanel`
- [ ] React: build zone list view showing file name, root note, MIDI range
- [ ] React: add ADSR knobs and loop point numeric inputs
- [ ] Register Sampler in AudioGraph

### Phase 3: Validation
- [ ] Load a WAV file; play MIDI C4 (root) — sample plays at original pitch
- [ ] Play MIDI C5 — pitch is exactly one octave higher than C4
- [ ] Load an MP3 and FLAC — both decode without errors
- [ ] Enable loop — sample loops seamlessly between loop points with no click
- [ ] Stress test: 8 simultaneous voices playing a large sample — no glitches

### Phase 4: Documentation
- [ ] Rustdoc on `Sampler`, `SampleZone`, `SamplerVoice`, `decode_audio_file`
- [ ] Document supported file formats and memory limits in code comments

## Acceptance Criteria

- [ ] Drag a WAV file onto the sampler UI and it loads successfully
- [ ] Playing MIDI notes triggers the sample at the correct pitch relative to root note
- [ ] Multi-zone setup plays different samples for different MIDI note ranges
- [ ] Loop points cause the sample to repeat in the loop region until note-off
- [ ] ADSR controls the sample amplitude (attack fades in, release fades out)
- [ ] MP3 and FLAC files decode and play correctly
- [ ] 8 simultaneous voices play without audio glitches

## Notes

Created: 2026-02-22
