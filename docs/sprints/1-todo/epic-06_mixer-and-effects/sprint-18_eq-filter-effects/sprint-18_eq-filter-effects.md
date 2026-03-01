---
sprint: 18
title: "EQ & Filter Effects"
type: fullstack
epic: 6
status: planning
created: 2026-02-22T22:10:12Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 18: EQ & Filter Effects

## Overview

| Field | Value |
|-------|-------|
| Sprint | 18 |
| Title | EQ & Filter Effects |
| Type | fullstack |
| Epic | 6 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement a parametric EQ effect with low shelf, high shelf, and 4 midrange bands plus standalone low-pass and high-pass filters, all using Rust biquad DSP, with a visual frequency response curve display in React.

## Background

EQ is the most essential mixing tool — it lets engineers shape the tonal character of every sound by boosting or cutting specific frequency ranges. A parametric EQ with visual feedback is the standard in professional DAWs. This sprint implements the EQ as an insertable effect that sits in the mixer channel insert slots built in Sprint 17.

## Requirements

### Functional Requirements

- [ ] Low shelf band: frequency (20 Hz – 1 kHz), gain (-18 dB to +18 dB)
- [ ] High shelf band: frequency (1 kHz – 20 kHz), gain (-18 dB to +18 dB)
- [ ] 4 parametric peak/notch bands: frequency (20 Hz – 20 kHz), gain (-18 to +18 dB), Q factor (0.1–10.0)
- [ ] Low-pass filter: cutoff frequency, 12 dB/octave slope (1-pole biquad)
- [ ] High-pass filter: cutoff frequency, 12 dB/octave slope (1-pole biquad)
- [ ] Each band can be individually enabled/disabled
- [ ] Visual frequency response curve: draws the combined magnitude response of all active bands from 20 Hz to 20 kHz on a log-frequency axis in React canvas
- [ ] Clicking/dragging a band handle on the frequency curve directly adjusts that band's frequency and gain
- [ ] Tauri commands: `set_eq_band`, `enable_eq_band`, `get_eq_state`

### Non-Functional Requirements

- [ ] Biquad filter coefficients recomputed only when parameters change (not every sample)
- [ ] 6-band EQ CPU overhead < 1% on a modern CPU at 256 buffer size
- [ ] Frequency response curve canvas redraws in < 5 ms on parameter change

## Dependencies

- **Sprints**: Sprint 17 (mixer insert slots — EQ plugin inserted into a channel's effect chain)
- **Note**: Sprint 21 (Effect Chain) runs after this sprint and integrates EQ as an insertable type. Sprint 18 must run before Sprint 21, not the reverse.
- **External**: None (biquad DSP implemented in pure Rust)

## Scope

### In Scope

- `src-tauri/src/effects/eq.rs` — `ParametricEq` struct implementing `AudioEffect` trait
- `src-tauri/src/effects/eq/biquad.rs` — `BiquadFilter` with coefficients for peaking, shelf, LP, HP types
- Coefficient computation functions for each filter type (Robert Bristow-Johnson Audio EQ cookbook formulas)
- Tauri commands: `set_eq_band`, `enable_eq_band`, `get_eq_state`
- React `EqPanel` with frequency response canvas and draggable band handles
- React `BiquadBandControl` for each of the 6 bands (frequency knob, gain knob, Q knob)

### Out of Scope

- Dynamic EQ (gain changes based on signal level — separate plugin concept)
- Linear-phase EQ (zero-latency minimum-phase only in this sprint)
- Spectrum analyzer overlay (backlog)
- Mid/side EQ mode

## Technical Approach

`ParametricEq` holds 6 `BiquadFilter` instances in series. Each `BiquadFilter` stores its `a0, a1, a2, b0, b1, b2` coefficients and `x1, x2, y1, y2` state variables. The direct form II transposed biquad difference equation is applied per sample: `y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]`. Coefficients are computed from frequency, gain, Q using the Audio EQ Cookbook formulas (peaking: `H(s) = (s^2 + s*(A/Q) + 1) / (s^2 + s/(A*Q) + 1)`). When a parameter changes, the new coefficients are computed on the main thread and sent to the audio thread via a `crossbeam_channel` command. The React frequency response curve evaluates the complex transfer function `H(e^jw)` for 200 frequency points logarithmically spaced from 20 Hz to 20 kHz and draws the resulting magnitude in dB as an SVG or canvas path.

## Tasks

### Phase 1: Planning
- [ ] Implement and test biquad coefficient formulas for all filter types (unit test with expected frequency responses)
- [ ] Design `EqBand` parameter struct and `AudioEffect` trait for use in effect chain
- [ ] Plan frequency response canvas coordinate system (log-x, dB-y)

### Phase 2: Implementation
- [ ] Implement `BiquadFilter` with difference equation and coefficient update
- [ ] Implement coefficient functions: peaking, low shelf, high shelf, LP, HP
- [ ] Implement `ParametricEq` (6 biquads in series) as `AudioEffect`
- [ ] Implement `set_eq_band` and `enable_eq_band` Tauri commands
- [ ] Compute frequency response curve in `get_eq_frequency_response` Tauri command
- [ ] Build React `EqPanel` frequency response canvas with log-frequency x-axis
- [ ] Render one draggable handle per enabled band on the canvas
- [ ] Wire band handle drag to update frequency and gain via Tauri invoke
- [ ] Build band parameter rows (knobs) below the canvas for precise numeric editing

### Phase 3: Validation
- [ ] Peaking band at 1 kHz, +6 dB, Q=1.0 — audio level at 1 kHz is boosted by +6 dB (measured)
- [ ] Low shelf at 200 Hz, +4 dB — all frequencies below 200 Hz boosted
- [ ] High-pass at 80 Hz — all frequencies below 80 Hz attenuated by 12 dB/octave
- [ ] Frequency response curve matches the measured audio output
- [ ] Disabling a band — that band's boost/cut is removed from the sound

### Phase 4: Documentation
- [ ] Rustdoc on `BiquadFilter`, coefficient formulas (cite Audio EQ Cookbook)
- [ ] Document filter types and transfer function equations in comments

## Acceptance Criteria

- [ ] All 6 EQ bands apply their boost/cut at the configured frequency
- [ ] Q factor controls the bandwidth of peaking bands (low Q = wide, high Q = narrow)
- [ ] Low and high shelf apply a shelf at the configured frequency
- [ ] LP and HP filters attenuate outside the cutoff frequency at 12 dB/octave
- [ ] Frequency response canvas accurately shows the combined effect of all active bands
- [ ] Individual bands can be disabled without changing the other bands
- [ ] EQ parameters persist in the project file

## Notes

Created: 2026-02-22
