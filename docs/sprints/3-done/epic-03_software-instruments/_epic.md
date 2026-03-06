---
epic: 03
title: "Software Instruments"
status: done
created: 2026-02-22
started: null
completed: 2026-03-06T13:43:49Z

total_hours: 0.0
---

# Epic 03: Software Instruments

## Overview

Implements all built-in sound-generating instruments for the DAW. This epic covers a polyphonic subtractive synthesizer, a multi-sample player and sampler, a step-based drum machine, and live audio recording from microphone or line-in. Each instrument is implemented as a Rust DSP AudioNode and exposed to the React UI via Tauri IPC.

## Success Criteria

- [ ] Subtractive synth plays 8 polyphonic voices with ADSR and low-pass filter, driven by MIDI
- [ ] Sampler loads WAV/MP3/FLAC files and pitch-maps them across MIDI note range with loop points
- [ ] Drum machine plays a 16-step pattern per pad in sync with the master tempo
- [ ] Live audio recording captures microphone/line-in input and places the result on an audio track
- [ ] All instruments integrate with the AudioGraph from Sprint 2 and respond to automation
- [ ] LFO modulation routes to synth parameters (filter cutoff, pitch, amplitude) with all waveforms

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| 6 | Subtractive Synthesizer | planned |
| 7 | Sample Player & Sampler | planned |
| 8 | Drum Machine | planned |
| 9 | Audio Recording (Live Input) | planned |
| 33 | LFO Modulation Routing | planned |

## Backlog

- [ ] Wavetable oscillator option for the synth
- [ ] Granular sampler mode

## Notes

Created: 2026-02-22
