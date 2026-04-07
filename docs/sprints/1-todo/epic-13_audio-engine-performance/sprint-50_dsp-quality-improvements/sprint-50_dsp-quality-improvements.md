---
sprint: 50
title: "DSP Quality Improvements"
type: fullstack
epic: 13
status: planning
created: 2026-04-07T15:38:05Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 50: DSP Quality Improvements

## Overview

| Field | Value |
|-------|-------|
| Sprint | 50 |
| Title | DSP Quality Improvements |
| Type | fullstack |
| Epic | 13 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix two specific deferred DSP quality issues: add PolyBLEP anti-aliasing to the subtractive synthesizer's saw and square oscillators, and investigate replacing the `unsafe impl Send` for `cpal::Stream` with a safer alternative.

## Background

These items were deferred from Sprints 2 and 6 postmortems:

- **Sprint 6 debt (PolyBLEP anti-aliasing)**: The subtractive synthesizer in `src-tauri/src/instruments/synth/` generates saw and square waveforms using a naive algorithm that produces strong aliasing at higher pitches. Above approximately C5, the overtone spectrum wraps around the Nyquist frequency and folds back as audible inharmonic content. PolyBLEP (Polynomial Band-Limited Step function) is a well-established, computationally cheap correction technique: at each sample where a waveform discontinuity occurs (the reset point of a saw or the polarity flip of a square), a correction polynomial is added to the output to cancel the aliasing energy. This fix requires no new dependencies and runs entirely in the existing DSP callback.
- **Sprint 2 debt (`unsafe impl Send` for cpal::Stream)**: The current audio engine uses `unsafe impl Send for AudioStream` (or similar) to move the `cpal::Stream` handle across thread boundaries. This bypasses Rust's thread-safety guarantees. The correct solution is a dedicated audio thread that owns the `Stream` for its entire lifetime, eliminating the need for the unsafe impl. However, this may involve significant refactoring of the engine startup/shutdown code. This sprint investigates feasibility, implements the safer alternative if feasible within the sprint scope, and documents the findings either way.

## Requirements

### Functional Requirements

- [ ] **PolyBLEP saw oscillator**: The subtractive synth's saw oscillator applies a PolyBLEP correction at the waveform discontinuity point (phase reset). Aliasing artifacts are inaudible at pitches up to the highest MIDI note (B8, approximately 7902 Hz) at 44100 Hz sample rate.
- [ ] **PolyBLEP square oscillator**: The subtractive synth's square oscillator applies PolyBLEP corrections at both rising and falling edges. Aliasing artifacts are inaudible across the full pitch range.
- [ ] **`unsafe impl Send` investigation**: A written investigation is documented (as an ADR or inline comments) covering: (a) whether `cpal::Stream` is actually used across threads in the current implementation, (b) what the risk of the current `unsafe impl Send` is, (c) whether a dedicated audio thread owner pattern is feasible without major refactoring, and (d) a recommendation. If the safer alternative is implemented in this sprint, the `unsafe impl Send` is removed; if deferred, the ADR documents why.
- [ ] Existing synth unit tests are updated to reflect PolyBLEP output values (reference output regenerated)

### Non-Functional Requirements

- [ ] PolyBLEP correction adds at most 5 floating-point operations per sample per oscillator — no significant CPU increase
- [ ] No heap allocations introduced in the oscillator hot path by the PolyBLEP implementation
- [ ] The investigation document is committed to `docs/adr/` or inline in the relevant source file

## Dependencies

- **Sprints**: Sprint 2 (Audio Engine — cpal stream setup), Sprint 6 (Synth — oscillator implementation), Sprint 49 (Audio Thread Safety — should complete first to ensure audio thread is clean before DSP changes)
- **External**: None (PolyBLEP is implemented from scratch; no new crates needed)

## Scope

### In Scope

- PolyBLEP correction for saw waveform in `instruments/synth/`
- PolyBLEP correction for square waveform in `instruments/synth/`
- Investigation of `unsafe impl Send` for `cpal::Stream` with written findings
- Implementation of safer alternative if feasible (dedicated audio thread owner pattern)
- Updated synth unit tests with new reference outputs

### Out of Scope

- PolyBLEP for triangle waveform (triangle has no discontinuity; it is already band-limited at this level)
- MinBLEP (more accurate than PolyBLEP but heavier; PolyBLEP is sufficient for this project's quality target)
- Oversampling for distortion/saturation effects
- New oscillator types (wavetable, additive)
- Reverb algorithm changes (different epic)

## Technical Approach

### PolyBLEP Implementation

PolyBLEP works by detecting when the oscillator phase crosses a discontinuity and adding a correction polynomial to the output sample. The standard 2-point PolyBLEP for a saw wave is:

```
// t = fractional position within the step (0..1)
// dt = phase increment per sample (frequency / sample_rate)
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        2.0 * t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + 2.0 * t + 1.0
    } else {
        0.0
    }
}
```

For the **saw oscillator**: compute `phase_increment = frequency / sample_rate` each sample. The saw output is `2 * phase - 1`. Apply `output -= poly_blep(phase, phase_increment)` to correct the reset discontinuity.

For the **square oscillator**: compute the standard square as `if phase < duty_cycle { 1.0 } else { -1.0 }`. Apply PolyBLEP at both the rising edge (`phase = 0`) and falling edge (`phase = duty_cycle`): `output += poly_blep(phase, phase_increment) - poly_blep(fmod(phase - duty_cycle + 1.0, 1.0), phase_increment)`.

Both corrections are pure arithmetic — no branches beyond the if/else in `poly_blep`, no allocations.

### `unsafe impl Send` Investigation

Steps:
1. Locate `unsafe impl Send` in the codebase — identify the type and the file.
2. Determine where the `Stream` is created and which threads it is accessed on. `cpal::Stream` is `!Send` because the underlying audio system may not support cross-thread handle access on some platforms.
3. On Windows with WASAPI/ASIO, `cpal::Stream::play()` and `Stream::pause()` may be called from the same thread that created it. If the current code only calls these from the audio engine's own thread, the `unsafe impl Send` is unnecessary (the stream never actually moves).
4. Safer alternative: spawn a dedicated `std::thread` that (a) creates the `cpal::Stream`, (b) owns it for its entire lifetime, and (c) receives play/pause/stop commands via a `crossbeam_channel`. The stream never crosses a thread boundary; no `unsafe` is needed.
5. Write an ADR in `docs/adr/adr-001-cpal-stream-thread-safety.md` documenting the investigation findings and decision.

## Tasks

### Phase 1: Planning
- [ ] Locate the saw and square oscillator `process()` functions in `instruments/synth/`
- [ ] Verify the current phase accumulator variable name and increment calculation
- [ ] Locate `unsafe impl Send` in the codebase — identify the type name and file
- [ ] Trace `cpal::Stream` usage: which thread creates it, which threads call `play()`/`pause()`

### Phase 2: PolyBLEP Implementation
- [ ] Implement `poly_blep(t: f32, dt: f32) -> f32` helper function in `instruments/synth/`
- [ ] Apply PolyBLEP correction to the saw oscillator output
- [ ] Apply PolyBLEP correction to the square oscillator output (both rising and falling edges)
- [ ] Update existing saw and square oscillator unit tests with new reference output values

### Phase 3: unsafe impl Send Investigation
- [ ] Document findings: which thread creates and accesses the `cpal::Stream`
- [ ] Assess actual risk: does the stream ever cross a thread boundary in practice?
- [ ] Implement dedicated audio thread owner pattern if feasible within sprint scope
- [ ] OR document why the `unsafe impl Send` is kept, with justification, in an ADR
- [ ] Create `docs/adr/adr-001-cpal-stream-thread-safety.md`

### Phase 4: Tests
- [ ] Verify saw oscillator output at A4 (440 Hz) with PolyBLEP — compare spectrum to baseline
- [ ] Verify square oscillator output at A4 (440 Hz) with PolyBLEP — confirm aliasing reduction
- [ ] Run all synth unit tests — update reference values as needed
- [ ] Run full test suite — all tests green

### Phase 5: Validation
- [ ] Manual listening test: play chromatic scale on synth with saw wave — verify no audible aliasing above C5
- [ ] Manual listening test: play chromatic scale with square wave — verify clean sound at all pitches

## Acceptance Criteria

- [ ] Saw oscillator applies PolyBLEP correction — aliasing artifacts are inaudible at all pitches in the MIDI range
- [ ] Square oscillator applies PolyBLEP correction at rising and falling edges — aliasing is inaudible
- [ ] PolyBLEP implementation contains no heap allocations — pure arithmetic only
- [ ] All synth unit tests pass (with updated reference outputs for PolyBLEP output)
- [ ] `docs/adr/adr-001-cpal-stream-thread-safety.md` exists and documents the investigation findings and decision
- [ ] If a safer alternative was implemented: `unsafe impl Send` is removed from the codebase; if kept: ADR documents the justification
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 6 debt | PolyBLEP anti-aliasing for saw/square oscillators | `src-tauri/src/instruments/synth/` |
| Sprint 2 debt | `unsafe impl Send` for `cpal::Stream` investigation | `src-tauri/src/audio/`, `docs/adr/` |

## Notes

Created: 2026-04-07
PolyBLEP is a well-documented technique. Reference: "PolyBLEP: A First-Order Polynomial Band-Limited Step Function" by Valimaki and Pakarinen (2007). The implementation above is the standard 2-point version adequate for most applications.
