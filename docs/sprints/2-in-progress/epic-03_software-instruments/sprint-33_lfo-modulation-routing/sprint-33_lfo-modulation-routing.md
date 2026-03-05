---
sprint: 33
title: "LFO Modulation Routing"
type: fullstack
epic: 3
status: in-progress
created: 2026-02-23T00:00:00Z
started: 2026-03-05T13:52:11Z
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 80


---

# Sprint 33: LFO Modulation Routing

## Overview

| Field | Value |
|-------|-------|
| Sprint | 33 |
| Title | LFO Modulation Routing |
| Type | fullstack |
| Epic | 3 - Software Instruments |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Add LFO (Low Frequency Oscillator) sources to the modulation system so synthesizer and effect parameters can be modulated in real time at sub-audio rates — enabling vibrato (pitch LFO), tremolo (amplitude LFO), filter sweeps, and more. LFOs run continuously regardless of transport state.

## Background

Sprint 6 (Subtractive Synthesizer) explicitly defers LFO to "Sprint 14 automation." However, Sprint 14 implements *timeline automation* — static, drawn-in parameter curves that play once during song playback. An LFO is fundamentally different: it is a continuously running oscillator that loops at audio-rate-adjacent frequencies (0.01–20 Hz) and runs live regardless of whether the transport is playing. If this distinction is not addressed, the synthesizer ships with zero modulation routing — no vibrato, no filter wobble, no tremolo. Since these are basic synthesizer features expected by any producer, this sprint adds proper LFO infrastructure.

## Requirements

### Functional Requirements

- [ ] LFO waveforms: sine, triangle, sawtooth up, sawtooth down, square, sample-and-hold (random stepped)
- [ ] Rate: 0.01 Hz – 20 Hz (continuous knob)
- [ ] BPM sync: optional — rate expressed as note division (1/4, 1/8, 1/16, 1/32, etc.) synced to transport BPM
- [ ] Depth: 0.0 – 1.0 (scales modulation amount applied to the destination parameter)
- [ ] Phase reset on note-on: optional toggle — LFO restarts at 0° each time a key is pressed
- [ ] Destinations: any `AtomicF32` parameter on the synth (filter cutoff, oscillator pitch, amplitude, resonance) or effects (send amount, delay feedback, reverb mix)
- [ ] At least one LFO per instrument instance (two LFOs for the synth is desirable)
- [ ] LFO UI panel integrated into the synth UI (Sprint 6) and accessible from effects (Sprints 18-20)

### Non-Functional Requirements

- [ ] LFO runs on the audio thread — zero allocations, zero locks in the tick function
- [ ] BPM sync recalculates LFO rate within one buffer period when transport BPM changes

## Dependencies

- **Sprints**:
  - Sprint 2 (Core Audio Engine) — audio thread architecture, `AtomicF32` parameter system
  - Sprint 6 (Subtractive Synthesizer) — LFO modulates synth `AtomicF32` parameters
  - Sprint 25 (Transport & Tempo Engine) — BPM value for sync mode

## Scope

### In Scope

- `src-tauri/src/instruments/lfo.rs` — `Lfo` struct (waveform, phase, rate, depth), `LfoParams` with `AtomicF32` fields, `Lfo::tick(sample_rate) -> f32`
- `src-tauri/src/instruments/lfo.rs` — `LfoTarget` enum: all routable destinations
- Integration: `SubtractiveSynth` (Sprint 6) gains `lfo: Lfo` field; LFO output modulates `cutoff_atomic` and `pitch_atomic` each callback
- `src/components/instruments/LfoPanel.tsx` — LFO sub-panel (rate, depth, waveform, sync toggle, phase reset toggle, destination selector)
- Integration: `LfoPanel` embedded in `SynthPanel.tsx` from Sprint 6

### Out of Scope

- Envelope-following LFO (sidechain modulation — backlog)
- LFO modulating another LFO (backlog)
- LFO modulation display / scope visualization (backlog)
- Applying LFO to VST3 plugin parameters (Sprint 24 can extend this)

## Technical Approach

`Lfo` is a plain struct (no `Box`, no `dyn`) with a phase accumulator. `tick(sample_rate: f32) -> f32` advances the phase and returns the current LFO value in `[-1.0, 1.0]`. In BPM sync mode, rate is derived from `transport_bpm / (beats_per_cycle)`. The modulated parameter is computed as `base_value + lfo_output * depth * (param_max - param_min)` and written to the destination `AtomicF32` each callback before the DSP runs. `LfoParams` is a struct of `AtomicF32` values (rate, depth, waveform index, sync enabled) so the UI can update them without locking. Phase reset on note-on is implemented in the MIDI event handler: on `NoteOn`, call `lfo.reset_phase()` if the toggle is set.

## Tasks

### Phase 1: Planning
- [ ] Define `LfoTarget` enum covering all routeable destinations across synth and effects
- [ ] Decide: one LFO or two per synth instance (two preferred — one for pitch, one for filter)
- [ ] Confirm phase reset toggle interaction with voice polyphony (mono LFO vs. per-voice)

### Phase 2: Implementation
- [ ] Implement `Lfo` struct with all 6 waveforms and BPM sync
- [ ] Add `lfo` field to `SubtractiveSynth`, integrate into audio callback
- [ ] Implement `LfoTarget` routing in synth callback (LFO output applied to destination atomic)
- [ ] Register `LfoParams` Tauri `set_lfo_param` command
- [ ] Build `LfoPanel.tsx` with rate knob, depth knob, waveform buttons, sync toggle, destination select
- [ ] Embed `LfoPanel` in `SynthPanel.tsx`

### Phase 3: Validation
- [ ] Unit test: sine LFO at 1 Hz completes one full cycle in exactly `sample_rate` ticks
- [ ] Unit test: BPM sync at 120 BPM, 1/4 note = 0.5 Hz rate
- [ ] Unit test: LFO output stays within `[-1.0, 1.0]` for all waveforms across 1000 ticks
- [ ] Unit test: phase reset — after `reset_phase()`, first tick returns value near 0
- [ ] Manual: enable filter cutoff LFO — audible periodic filter sweep on held note
- [ ] Manual: enable pitch LFO — audible vibrato on held note
- [ ] Manual: BPM sync — LFO rate changes when transport BPM changes

### Phase 4: Documentation
- [ ] Rustdoc on `Lfo`, `LfoParams`, `LfoTarget`
- [ ] Comment the waveform generation formulas for each waveform type

## Acceptance Criteria

- [ ] LFO visibly modulates filter cutoff and pitch from the UI panel
- [ ] All 6 waveforms produce audibly distinct modulation shapes
- [ ] BPM sync mode locks LFO rate to transport tempo
- [ ] Phase reset on note-on restarts the LFO shape consistently
- [ ] LFO rate and depth knobs respond in real time without audio glitches
- [ ] All unit tests pass; coverage ≥ 80%

## Notes

Created: 2026-02-23
