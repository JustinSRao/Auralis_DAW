---
sprint: 20
title: "Compression & Dynamics"
type: fullstack
epic: 6
status: done
created: 2026-02-22T22:10:13Z
started: 2026-03-30T15:39:17Z
completed: 2026-03-30
hours: null
workflow_version: "3.1.0"


---

# Sprint 20: Compression & Dynamics

## Overview

| Field | Value |
|-------|-------|
| Sprint | 20 |
| Title | Compression & Dynamics |
| Type | fullstack |
| Epic | 6 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement a dynamics processing suite in Rust including a compressor (threshold, ratio, attack, release, knee, makeup gain), a brick-wall limiter, and a noise gate, with a gain reduction meter in the React UI.

## Background

Dynamics processors are essential mixing tools. A compressor tames loud peaks and glues sounds together; a limiter prevents digital clipping on the master bus; a noise gate silences background noise during quiet passages. Without dynamics control, mixes can sound uneven and amateur. This sprint completes the core effects suite alongside EQ (Sprint 18) and reverb/delay (Sprint 19).

## Requirements

### Functional Requirements

**Compressor:**
- [ ] Threshold (-60 to 0 dBFS): level above which compression starts
- [ ] Ratio (1:1 to ∞:1): degree of compression applied above threshold
- [ ] Attack (0.1 ms – 300 ms): time for compressor to respond to level exceeding threshold
- [ ] Release (10 ms – 3000 ms): time for compressor to stop compressing after level falls below threshold
- [ ] Knee (0.0 – 12 dB): softens the threshold transition; soft-knee mode
- [ ] Makeup gain (-12 to +24 dB): compensates for volume reduction
- [ ] Gain reduction meter: displays how many dB of gain reduction is currently being applied

**Limiter:**
- [ ] Ceiling (-12 to 0 dBFS): hard ceiling — no sample can exceed this level
- [ ] True peak limiting mode (oversampled detection)
- [ ] Release (1 ms – 1000 ms)

**Noise Gate:**
- [ ] Threshold (-80 to 0 dBFS): level below which the gate closes (silence)
- [ ] Attack (0.1 ms – 100 ms), Hold (0 ms – 2000 ms), Release (10 ms – 4000 ms)
- [ ] Range (0 to -90 dB): minimum attenuation when gate is closed

**All:**
- [ ] Tauri commands: `set_compressor_param`, `set_limiter_param`, `set_gate_param`, `get_compressor_state`

### Non-Functional Requirements

- [ ] All dynamics processing runs in the audio callback with no allocation
- [ ] Level detection uses a ballistic RMS or peak envelope follower with configurable attack/release time constants
- [ ] Gain reduction meter updates to frontend at 30 Hz via Tauri event

## Dependencies

- **Sprints**: Sprint 17 (mixer insert slots)
- **Note**: Sprint 21 (Effect Chain) runs after this sprint and integrates the compressor/limiter/gate as insertable types. Sprint 20 must run before Sprint 21, not the reverse.
- **External**: None (pure Rust DSP)

## Scope

### In Scope

- `src-tauri/src/effects/compressor.rs` — `Compressor` implementing `AudioEffect`
- `src-tauri/src/effects/limiter.rs` — `BrickwallLimiter` implementing `AudioEffect`
- `src-tauri/src/effects/noise_gate.rs` — `NoiseGate` implementing `AudioEffect`
- `src-tauri/src/effects/dynamics/envelope_follower.rs` — shared attack/release ballistic detector
- Tauri commands for all three processors
- Tauri event: `gain_reduction_changed` (per-channel gain reduction in dB, sent at 30 Hz)
- React `CompressorPanel`: knobs for all parameters + gain reduction meter (animated bar)
- React `LimiterPanel`: ceiling control and gain reduction meter
- React `GatePanel`: threshold, attack, hold, release, range knobs

### Out of Scope

- Multiband compression
- Sidechain input from another channel (backlog)
- Look-ahead compression (adds latency — backlog)
- VCA/FET/OPTO emulation models

## Technical Approach

The compressor uses a two-stage approach: (1) an envelope follower tracks the input level using ballistic attack/release smoothing (`level = (1 - coeff) * level + coeff * abs(sample)` where `coeff = exp(-1/(time_ms * sample_rate / 1000))`); (2) the gain computer computes gain reduction: `gain_db = min(0, (threshold - level_db) * (1/ratio - 1))` with soft-knee applied. Makeup gain is added. The limiter is a look-ahead-free brick-wall that clips any sample exceeding the ceiling to the ceiling level, using a release envelope to recover smoothly. The noise gate closes (applies `range` attenuation) when the envelope follower falls below threshold, with attack/hold/release state machine. Gain reduction in dB is stored in an `AtomicF32` for each processor and relayed to the frontend at 30 Hz.

## Tasks

### Phase 1: Planning
- [ ] Derive attack/release ballistic coefficient formulas and validate against reference values
- [ ] Design soft-knee gain computer — piece-wise linear or quadratic approximation
- [ ] Plan noise gate state machine (Open → Closing → Closed → Opening states)

### Phase 2: Implementation
- [ ] Implement `EnvelopeFollower` with attack/release time constants
- [ ] Implement gain computer (threshold + ratio + soft knee)
- [ ] Implement `Compressor` AudioEffect (envelope → gain compute → apply → makeup)
- [ ] Implement `BrickwallLimiter` with ceiling clip and release
- [ ] Implement `NoiseGate` with state machine (open/hold/close) and range control
- [ ] Implement `gain_reduction_changed` Tauri event emission at 30 Hz
- [ ] Tauri commands for all three processors
- [ ] Build React `CompressorPanel` with gain reduction meter (animated red bar that grows downward)
- [ ] Build React `LimiterPanel` and `GatePanel`

### Phase 3: Validation
- [ ] Apply compressor with ratio 4:1, threshold -12 dB — peaks above threshold compressed
- [ ] Makeup gain +6 dB — overall output level increases after compression
- [ ] Gain reduction meter shows dB of reduction accurately during active compression
- [ ] Limiter with ceiling -1 dBFS — no output sample exceeds -1 dBFS
- [ ] Noise gate threshold -40 dB — quiet passages silenced, loud passages pass through
- [ ] Slow attack on compressor — transients pass through before compression engages

### Phase 4: Documentation
- [ ] Rustdoc on `Compressor`, `BrickwallLimiter`, `NoiseGate`, `EnvelopeFollower`
- [ ] Document gain computer formula with soft-knee derivation
- [ ] Document ballistic coefficient formula and units

## Acceptance Criteria

- [ ] Compressor reduces gain for signals above threshold by the specified ratio
- [ ] Attack time delays onset of compression — fast transients pass through with slow attack
- [ ] Release time determines how quickly gain returns to unity after signal drops below threshold
- [ ] Makeup gain correctly compensates for the compression gain reduction
- [ ] Gain reduction meter animates in real time showing dB of compression applied
- [ ] Limiter prevents any output sample from exceeding the ceiling level
- [ ] Noise gate silences signal below threshold within the configured attack time

## Notes

Created: 2026-02-22
