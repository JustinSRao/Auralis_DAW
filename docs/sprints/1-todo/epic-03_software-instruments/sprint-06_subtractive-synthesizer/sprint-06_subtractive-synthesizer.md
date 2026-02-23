---
sprint: 6
title: "Subtractive Synthesizer"
type: fullstack
epic: 3
status: planning
created: 2026-02-22T22:09:57Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 6: Subtractive Synthesizer

## Overview

| Field | Value |
|-------|-------|
| Sprint | 6 |
| Title | Subtractive Synthesizer |
| Type | fullstack |
| Epic | 3 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build a polyphonic subtractive synthesizer as a Rust DSP AudioNode with saw/square/sine/triangle oscillators, an ADSR amplitude envelope, a resonant low-pass filter, and a React UI with virtual knobs for all parameters.

## Background

A subtractive synthesizer is the most fundamental software instrument in any DAW. Without it, users have no way to create melodic or harmonic sounds from scratch. This sprint delivers the first playable instrument that integrates with the audio engine (Sprint 2) and the MIDI system (Sprint 3), proving the full signal chain: MIDI note-on → DSP voice → audio output.

## Requirements

### Functional Requirements

- [ ] Oscillator waveforms: sawtooth, square (with pulse width), sine, and triangle — selectable per voice
- [ ] 8-voice polyphony: up to 8 simultaneous MIDI notes each get an independent voice
- [ ] ADSR envelope controls the amplitude of each voice (attack, decay, sustain, release)
- [ ] State-variable low-pass filter with cutoff frequency (20 Hz – 20 kHz) and resonance (0.0 – 1.0)
- [ ] Filter cutoff can be modulated by the ADSR envelope with a dedicated envelope amount knob
- [ ] Master volume and detune controls at the synth level
- [ ] MIDI note-on triggers a voice, MIDI note-off triggers release phase of ADSR
- [ ] Tauri commands: `set_synth_param` (takes param name + f32 value), `get_synth_state`
- [ ] React UI shows knobs for: waveform, attack, decay, sustain, release, cutoff, resonance, env amount, volume, detune

### Non-Functional Requirements

- [ ] All DSP runs on the audio thread — no allocations, no locks
- [ ] Voice stealing: when all 8 voices are used, steal the oldest note
- [ ] Total CPU use of 8 active voices below 5% on a modern CPU at 256 sample buffer
- [ ] Parameter changes from UI applied atomically via `atomic_float` — no audio glitches on knob movement

## Dependencies

- **Sprints**: Sprint 2 (AudioEngine and AudioNode trait), Sprint 3 (MIDI I/O delivers note events to instruments)
- **External**: None (pure Rust DSP, no external audio libraries needed)

## Scope

### In Scope

- `src-tauri/src/instruments/synth.rs` — `SubtractiveSynth` struct implementing `AudioNode`
- `src-tauri/src/instruments/synth/oscillator.rs` — waveform generators (saw, square, sine, tri)
- `src-tauri/src/instruments/synth/envelope.rs` — ADSR state machine
- `src-tauri/src/instruments/synth/filter.rs` — one-pole low-pass or state-variable filter
- `src-tauri/src/instruments/synth/voice.rs` — `SynthVoice` combining oscillator + envelope + filter
- Tauri commands: `create_synth_instrument`, `set_synth_param`, `get_synth_state`
- React `SynthPanel` component with rotary `Knob` subcomponent and waveform selector buttons

### Out of Scope

- LFO modulation (can be added as automation in Sprint 14)
- Wavetable or FM synthesis
- Portamento / glide
- MIDI CC mapping (Sprint 3 delivers basic note on/off only)

## Technical Approach

`SubtractiveSynth` holds an array of 8 `SynthVoice` slots and a `SynthParams` struct of `AtomicF32` values for all knobs. On each audio callback, the synth iterates active voices and mixes their output into the output buffer. Each `SynthVoice` runs an `Oscillator` → `Filter` → `AdsrEnvelope` signal path. The oscillator uses a phase accumulator incremented by `frequency / sample_rate` per sample. The filter is a one-pole IIR low-pass (or biquad state-variable for resonance), with coefficients recomputed when cutoff changes. MIDI events arrive via a `crossbeam-channel` receiver polled at the start of each audio callback. The React `SynthPanel` reads `SynthParams` from Zustand and calls `invoke('set_synth_param', ...)` on knob change, debounced to avoid flooding IPC.

## Tasks

### Phase 1: Planning
- [ ] Design `SynthParams` struct — list all named parameters with min/max/default values
- [ ] Choose filter algorithm: one-pole (simple) vs. biquad state-variable (better resonance)
- [ ] Design voice allocation and stealing strategy

### Phase 2: Implementation
- [ ] Implement `Oscillator` with saw, square, sine, triangle waveforms
- [ ] Implement `AdsrEnvelope` state machine with per-sample tick
- [ ] Implement `SynthFilter` (biquad low-pass with resonance)
- [ ] Implement `SynthVoice` combining all three
- [ ] Implement `SubtractiveSynth` with 8-voice pool and voice stealing
- [ ] Wire MIDI note-on/off events to voice trigger/release
- [ ] Expose `AtomicF32` parameters and implement `set_synth_param` Tauri command
- [ ] Build React `Knob` rotary component (SVG-based, mouse drag to adjust)
- [ ] Build React `SynthPanel` with all knobs wired to Zustand + Tauri invoke
- [ ] Register synth in AudioGraph and route output to master bus

### Phase 3: Validation
- [ ] Play a C-major chord (4 notes) via MIDI — all 4 voices audible with no clicks
- [ ] Test voice stealing: play 9 notes — oldest voice taken over cleanly
- [ ] Sweep cutoff knob during playback — no audio glitches or zipper noise
- [ ] Verify ADSR release: note-off fades out correctly at various release settings
- [ ] CPU profiling: 8 voices active < 5% CPU at 256 sample buffer on test machine

### Phase 4: Documentation
- [ ] Rustdoc on `SubtractiveSynth`, `SynthVoice`, `Oscillator`, `AdsrEnvelope`, `SynthFilter`
- [ ] Document parameter names, units, and ranges in `SynthParams`

## Acceptance Criteria

- [ ] Playing MIDI notes through the synth produces audible audio on the audio output device
- [ ] All 4 waveform types sound distinctly different (saw has harmonic buzz, sine is pure tone)
- [ ] ADSR envelope shapes the volume correctly (slow attack fades in, long release fades out)
- [ ] Filter cutoff knob audibly changes the timbre (fully open = bright, closed = muffled)
- [ ] Resonance increases the filter peak at cutoff frequency
- [ ] 8 simultaneous MIDI notes all sound without glitching
- [ ] Knob changes in React are reflected in audio within the next audio callback

## Notes

Created: 2026-02-22
