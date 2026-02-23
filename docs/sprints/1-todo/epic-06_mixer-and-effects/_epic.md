---
epic: 06
title: "Mixer & Effects"
status: planning
created: 2026-02-22
started: null
completed: null
---

# Epic 06: Mixer & Effects

## Overview

Delivers a full professional mixing environment and a suite of built-in audio effects for the DAW. This epic includes a channel-strip mixer with faders, pan, mute, solo, sends, and buses; parametric EQ and filter effects; algorithmic reverb and stereo delay; a dynamics section (compressor, limiter, noise gate); and a flexible drag-and-drop effect chain per mixer channel. All DSP processing is implemented in Rust on the audio thread.

## Success Criteria

- [ ] Mixer view shows all tracks as channel strips with working fader, pan, mute, and solo controls
- [ ] Send routing to aux buses functions correctly and independently of channel direct output
- [ ] Parametric EQ with visual frequency response curve is insertable on any channel
- [ ] Reverb and delay effects process in real time with no glitches at 256 sample buffer
- [ ] Compressor correctly reduces gain above threshold and displays gain reduction on a meter
- [ ] Effect chain order can be changed via drag-and-drop and individual effects can be bypassed

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| 17 | Full Mixer (Tracks, Routing, Sends, Buses) | planned |
| 18 | EQ & Filter Effects | planned |
| 19 | Reverb & Delay Effects | planned |
| 20 | Compression & Dynamics | planned |
| 21 | Effect Chain & Modular Routing | planned |

## Backlog

- [ ] Spectrum analyzer display on EQ
- [ ] Sidechain input routing for compressor

## Notes

Created: 2026-02-22
