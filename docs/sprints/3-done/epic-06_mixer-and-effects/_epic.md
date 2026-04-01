---
epic: 06
title: "Mixer & Effects"
status: done
created: 2026-02-22
started: null
completed: 2026-03-31T20:35:45Z

total_hours: 5.8
---

# Epic 06: Mixer & Effects

## Overview

Delivers a full professional mixing environment and a suite of built-in audio effects for the DAW. This epic includes a channel-strip mixer with faders, pan, mute, solo, sends, and buses; parametric EQ and filter effects; algorithmic reverb and stereo delay; a dynamics section (compressor, limiter, noise gate); a flexible drag-and-drop effect chain per mixer channel; audio clip playback from disk through the mixer; clip fades and crossfades; sidechain compression; and sub-group bus routing. All DSP processing is implemented in Rust on the audio thread.

## Success Criteria

- [ ] Mixer view shows all tracks as channel strips with working fader, pan, mute, and solo controls
- [ ] Send routing to aux buses functions correctly and independently of channel direct output
- [ ] Parametric EQ with visual frequency response curve is insertable on any channel
- [ ] Reverb and delay effects process in real time with no glitches at 256 sample buffer
- [ ] Compressor correctly reduces gain above threshold and displays gain reduction on a meter
- [ ] Effect chain order can be changed via drag-and-drop and individual effects can be bypassed
- [ ] Recorded and imported audio clips play back at the correct position through the mixer
- [ ] Audio clip fade-in and fade-out handles are configurable with multiple curve types
- [ ] Sidechain compression allows one channel to duck another (e.g., kick ducking bass)
- [ ] Sub-group buses allow routing multiple tracks to a shared bus for collective processing

## Sprints

| Sprint | Title | Status | Key Dependencies |
|--------|-------|--------|-----------------|
| 17 | Full Mixer (Tracks, Routing, Sends, Buses) | planned | Sprint 2, 6-9, 30 |
| 18 | EQ & Filter Effects | planned | Sprint 17 |
| 19 | Reverb & Delay Effects | planned | Sprint 17 |
| 20 | Compression & Dynamics | planned | Sprint 17 |
| 21 | Effect Chain & Modular Routing | planned | Sprint 17 |
| 37 | Audio Clip Playback Engine | planned | Sprint 2, 9, 13, 17, 25, 31 |
| 39 | Sidechain Compression | planned | Sprint 17, 20, 21 |
| 42 | Sub-Group Bus Routing | planned | Sprint 17, 21 |
| 45 | Audio Clip Fades | planned | Sprint 13, 15, 37 |

## Backlog

- [ ] Spectrum analyzer display on EQ
- [ ] LFO modulation of effect parameters (Sprint 33 extends this)

## Notes

Created: 2026-02-22
Updated: Sprint 37 (Audio Clip Playback Engine) moved here from Epic 04 — it has a hard dependency on Sprint 17 (Mixer). Sprint 39 (Sidechain Compression), Sprint 42 (Sub-Group Bus Routing), and Sprint 45 (Audio Clip Fades) added. Sprint 45 moved here from Epic 05 — it depends on Sprint 37.
