---
sprint: 16
title: "Time Stretch & Pitch Shift"
type: fullstack
epic: 5
status: planning
created: 2026-02-22T22:10:12Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 16: Time Stretch & Pitch Shift

## Overview

| Field | Value |
|-------|-------|
| Sprint | 16 |
| Title | Time Stretch & Pitch Shift |
| Type | fullstack |
| Epic | 5 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement time stretching using the `rubato` crate to change clip duration to match project BPM, and pitch shifting using a phase vocoder to transpose clips in semitones independently of tempo.

## Background

Imported audio samples and loops rarely match the project's BPM out of the box. Time stretching allows a 125 BPM loop to be stretched to fit a 140 BPM project without changing pitch. Pitch shifting allows a vocal sample to be transposed to fit a different key. These two operations are fundamental to modern sample-based music production and complete the Audio Editing epic.

## Requirements

### Functional Requirements

- [ ] Time stretch: scale an audio clip's duration by a ratio (0.5×–2.0×) without changing pitch
- [ ] BPM match: given the clip's original BPM (manually entered or detected) and the project BPM, compute the correct stretch ratio and apply it
- [ ] Pitch shift: transpose a clip by –24 to +24 semitones without changing duration
- [ ] Per-clip stretch ratio and pitch shift stored as metadata in the project (non-destructive: original buffer unchanged, processed on playback)
- [ ] UI: per-clip stretch handle in the waveform editor (drag to change ratio visually), and semitone pitch knob
- [ ] Option to bake/render the stretch to a new audio file for lower CPU on playback
- [ ] Tauri commands: `set_clip_time_stretch`, `set_clip_pitch_shift`, `bake_clip_stretch`, `detect_clip_bpm`

### Non-Functional Requirements

- [ ] Time stretch processing runs on a Tokio background task (not audio thread)
- [ ] Stretched audio pre-rendered to an intermediate buffer before playback to avoid real-time stretching CPU cost
- [ ] Pitch shift quality: no audible artifacts for shifts within ±12 semitones on tonal content

## Dependencies

- **Sprints**: Sprint 15 (waveform editor — stretch handles integrated there), Sprint 7 (audio buffers from sampler are the source), Sprint 2 (master BPM for BPM-match calculation)
- **External**: `rubato` crate for sample rate conversion / time stretching; phase vocoder implemented in Rust (or `rubato` pitch shift mode)

## Scope

### In Scope

- `src-tauri/src/audio_editing/time_stretch.rs` — `time_stretch_buffer(buffer, ratio)` using rubato `FftFixedIn` resampler
- `src-tauri/src/audio_editing/pitch_shift.rs` — phase vocoder pitch shift implementation
- `src-tauri/src/audio_editing/bpm_detector.rs` — basic onset-based BPM detection for imported clips
- Per-clip metadata fields: `stretch_ratio: f32`, `pitch_shift_semitones: i8`, `original_bpm: Option<f32>`
- Tauri commands: `set_clip_time_stretch`, `set_clip_pitch_shift`, `bake_clip_stretch`, `detect_clip_bpm`
- React: stretch ratio display in waveform editor toolbar, semitone pitch knob on clip properties panel

### Out of Scope

- Real-time time stretching on the audio thread (pre-render only in this sprint)
- Formant preservation for vocal pitch shifting (advanced algorithm — backlog)
- Automatic BPM detection with high accuracy (basic detection only; manual override always available)

## Technical Approach

Time stretching uses `rubato::FftFixedIn` resampler as a general-purpose sample rate converter. To stretch by ratio `r`, the input is resampled from `sample_rate` to `sample_rate / r` (which changes duration by `r`). The output is stored in a new `ProcessedBuffer` associated with the clip. Pitch shifting is implemented as a phase vocoder: the signal is converted to the frequency domain using a short-time Fourier transform (STFT) with a Hann window, frequency bins are shifted by `2^(semitones/12)`, then the modified spectrum is inverse-transformed back to time domain with overlap-add. Both operations run in a `tokio::spawn_blocking` task to avoid blocking the async runtime. After processing, the clip's playback source is switched from the original buffer to the processed buffer. BPM detection uses onset detection (energy difference between successive short frames) and autocorrelation to estimate tempo.

## Tasks

### Phase 1: Planning
- [ ] Evaluate `rubato` FftFixedIn API for time stretch quality vs. SincFixedIn
- [ ] Design STFT phase vocoder parameters (window size: 2048, hop size: 512)
- [ ] Define `ProcessedBuffer` caching strategy (cache by clip ID + stretch ratio + pitch shift)

### Phase 2: Implementation
- [ ] Implement `time_stretch_buffer(buffer, ratio, sample_rate)` using rubato
- [ ] Implement STFT phase vocoder `pitch_shift_buffer(buffer, semitones, sample_rate)`
- [ ] Implement `detect_clip_bpm` using onset detection and autocorrelation
- [ ] Implement `set_clip_time_stretch` Tauri command (updates metadata + triggers re-render)
- [ ] Implement `set_clip_pitch_shift` Tauri command
- [ ] Implement `bake_clip_stretch` — write processed buffer to WAV in project `audio/` folder
- [ ] React: add stretch ratio display and edit field in waveform editor toolbar
- [ ] React: add semitone pitch shift knob in clip properties sidebar
- [ ] React: BPM match button — auto-compute stretch ratio from clip BPM vs. project BPM

### Phase 3: Validation
- [ ] Stretch a 4-bar loop at 125 BPM to project 140 BPM — duration change is correct (ratio = 125/140)
- [ ] Pitch shift a vocal sample +5 semitones — pitch is perceptibly higher, duration unchanged
- [ ] Bake stretch — resulting WAV file length matches expected stretched duration
- [ ] BPM detect a 120 BPM drum loop — reported BPM is 120 ± 2 BPM
- [ ] Stretch ratio 0.5× and 2.0× — extreme stretches have no crashes, artifacts are acceptable

### Phase 4: Documentation
- [ ] Rustdoc on `time_stretch_buffer`, `pitch_shift_buffer`, phase vocoder parameters
- [ ] Document BPM detection algorithm and accuracy limitations

## Acceptance Criteria

- [ ] A loop stretched to match project BPM plays back at the correct duration
- [ ] A clip pitch-shifted by +12 semitones sounds one octave higher
- [ ] Pitch shift does not change the clip's duration
- [ ] Time stretch does not change the clip's pitch
- [ ] Bake creates a new WAV file at the stretched length
- [ ] BPM match button correctly computes the stretch ratio from original and project BPM
- [ ] Stretch and pitch values persist in the project file and restore on load

## Notes

Created: 2026-02-22
