---
sprint: 19
title: "Reverb & Delay Effects"
type: fullstack
epic: 6
status: planning
created: 2026-02-22T22:10:13Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 19: Reverb & Delay Effects

## Overview

| Field | Value |
|-------|-------|
| Sprint | 19 |
| Title | Reverb & Delay Effects |
| Type | fullstack |
| Epic | 6 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement an algorithmic reverb effect (Schroeder/Freeverb architecture) and a stereo delay effect with tempo sync and ping-pong mode, both as Rust DSP `AudioEffect` implementations with React UIs.

## Background

Reverb and delay are the two most commonly used time-based effects in music production — reverb creates the sense of acoustic space and delay adds rhythmic echoes. Without them, sounds feel dry and lifeless in the mix. Both effects are implemented in Rust on the audio thread (as they need low-latency processing) and sit in the mixer channel insert slots from Sprint 17.

## Requirements

### Functional Requirements

**Reverb:**
- [ ] Room size (0.0–1.0): controls the decay time (small room to large hall)
- [ ] Decay / RT60 (0.1 s – 10 s): time for reverb to fall -60 dB
- [ ] Pre-delay (0 – 100 ms): delay before reverb tail begins
- [ ] Wet/dry mix (0.0–1.0)
- [ ] Damping (0.0–1.0): high-frequency absorption (simulates soft surfaces)
- [ ] Stereo width (0.0–1.0)

**Delay:**
- [ ] Delay time (1 ms – 2000 ms) or tempo-synced (1/32 to 1/1 note divisions at master BPM)
- [ ] Feedback (0.0–0.99): amount of delayed signal fed back into input
- [ ] Ping-pong mode: alternates delay between left and right channels
- [ ] Wet/dry mix (0.0–1.0)
- [ ] High-cut filter on feedback path (softens repeats over time)

**Both:**
- [ ] Tauri commands: `set_reverb_param`, `set_delay_param`, `get_reverb_state`, `get_delay_state`
- [ ] Each is a separate `AudioEffect` that can be inserted independently

### Non-Functional Requirements

- [ ] Reverb and delay delay lines use pre-allocated ring buffers — no heap allocation during audio callback
- [ ] Maximum delay line length: 2 s × sample_rate = 88200 samples at 44100 Hz (pre-allocated)
- [ ] Combined CPU usage of reverb + delay on one channel < 3% at 256 buffer size

## Dependencies

- **Sprints**: Sprint 17 (mixer insert slots), Sprint 21 (effect chain integration), Sprint 2 (master BPM for delay tempo sync)
- **External**: None (pure Rust DSP)

## Scope

### In Scope

- `src-tauri/src/effects/reverb.rs` — `AlgorithmicReverb` (8 parallel comb filters + 4 series allpass filters, Schroeder/Freeverb architecture)
- `src-tauri/src/effects/reverb/comb_filter.rs` and `allpass_filter.rs` — building blocks
- `src-tauri/src/effects/delay.rs` — `StereoDelay` with ring buffer, ping-pong, feedback, high-cut
- Tauri commands for both effects
- React `ReverbPanel`: knobs for room size, decay, pre-delay, damping, width, wet/dry
- React `DelayPanel`: delay time input (ms or note sync), feedback knob, ping-pong toggle, wet/dry, high-cut knob

### Out of Scope

- Convolution reverb (IR-based) — expensive, backlog
- Multi-tap delay
- Reverse reverb

## Technical Approach

**Reverb (Freeverb):** 8 parallel comb filters (each a simple delay with one-pole lowpass feedback: `y = x*gain + delay[i] * (damping * (1-damping_coeff) + prev_out * damping_coeff)`), followed by 4 allpass filters in series. Left and right channels use slightly different delay line lengths for stereo width. Pre-delay is implemented as a separate ring buffer delay before the comb filter bank. The wet signal is mixed with the dry input using the wet/dry ratio.

**Stereo Delay:** A ring buffer of `max_delay_samples` length holds the delay line. Each callback, the write head advances by one buffer, and the read head lags by `delay_time_samples`. Feedback adds `output * feedback` back to the write position. Ping-pong alternates which channel the feedback feeds (left → right → left). A one-pole IIR high-cut filter on the feedback path simulates tape delay character. Tempo sync converts the selected note division to `60.0 / bpm * division_factor * sample_rate` samples.

## Tasks

### Phase 1: Planning
- [ ] Derive comb and allpass filter delay line lengths (Freeverb prime number choices for density)
- [ ] Design `ReverbParams` and `DelayParams` structs with `AtomicF32` fields
- [ ] Plan React panel layout for both effects

### Phase 2: Implementation
- [ ] Implement `CombFilter` with configurable delay length and damping
- [ ] Implement `AllpassFilter`
- [ ] Implement `AlgorithmicReverb` with 8 comb + 4 allpass, stereo, pre-delay
- [ ] Implement `StereoDelay` with ring buffer, feedback, ping-pong, high-cut
- [ ] Implement tempo sync delay time computation from master BPM
- [ ] Tauri commands for `set_reverb_param` and `set_delay_param`
- [ ] Build React `ReverbPanel` with all knobs
- [ ] Build React `DelayPanel` with time input (toggle ms vs. note sync), feedback, ping-pong switch
- [ ] Integrate both into the `AudioEffect` trait for use in effect chain (Sprint 21)

### Phase 3: Validation
- [ ] Send a short percussive sound into reverb — audible decay tail with configurable length
- [ ] Room size 0.1 (small room) vs 0.9 (large hall) — clearly different reverb character
- [ ] Delay at 500 ms — echo heard 500 ms after input signal
- [ ] Delay tempo synced to 1/4 at 120 BPM — echo at 500 ms intervals (60000/120 = 500 ms)
- [ ] Ping-pong mode — echoes alternate left/right
- [ ] Feedback 0.8 — multiple echoes fading over time; no runaway feedback at 0.99

### Phase 4: Documentation
- [ ] Rustdoc on `AlgorithmicReverb` with Freeverb architecture description and comb delay lengths
- [ ] Document delay ring buffer and feedback clamp logic

## Acceptance Criteria

- [ ] Reverb produces an audible decay tail on any audio input
- [ ] Room size changes audibly affect the length of the reverb tail
- [ ] Pre-delay adds a gap before the reverb tail begins
- [ ] Delay produces discrete echoes at the configured time
- [ ] Delay tempo sync locks echo timing to the project BPM
- [ ] Ping-pong alternates echoes between left and right channels
- [ ] Wet/dry mix blends the effect with the dry signal correctly
- [ ] Both effects can be inserted into mixer channels via the effect chain

## Notes

Created: 2026-02-22
