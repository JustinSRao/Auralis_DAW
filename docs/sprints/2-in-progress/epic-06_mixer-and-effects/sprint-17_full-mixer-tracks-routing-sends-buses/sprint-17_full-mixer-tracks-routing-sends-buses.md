---
sprint: 17
title: "Full Mixer (Tracks, Routing, Sends, Buses)"
type: fullstack
epic: 6
status: In Progress
created: 2026-02-22T22:10:12Z
started: 2026-03-21T02:42:05Z
completed: null
hours: null
workflow_version: "3.1.0"

---

# Sprint 17: Full Mixer (Tracks, Routing, Sends, Buses)

## Overview

| Field | Value |
|-------|-------|
| Sprint | 17 |
| Title | Full Mixer (Tracks, Routing, Sends, Buses) |
| Type | fullstack |
| Epic | 6 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build the full mixer in Rust — a multi-channel audio mixing graph with per-channel fader, pan, mute, and solo, send routing to aux buses, and a master bus — with a React vertical fader channel-strip UI.

## Background

Every DAW needs a mixer to balance, pan, and route audio from multiple tracks and instruments to the final output. Without the mixer, all instruments play at the same volume with no way to balance them. This sprint builds the foundational audio routing graph that all subsequent effect sprints (18-21) will insert into.

## Requirements

### Functional Requirements

- [ ] Each instrument/audio track has a dedicated mixer channel with: volume fader (0.0–2.0, unity at 1.0), pan (-1.0 left to +1.0 right), mute (silence channel without stopping playback), solo (silence all other channels)
- [ ] At least 4 configurable aux/send buses (e.g., "Reverb Bus", "Delay Bus")
- [ ] Each channel has a send knob per bus (send level 0.0–1.0) routing a copy of the signal post-fader
- [ ] Master bus channel with its own fader and pan; final output to audio engine output
- [ ] Parallel routing: pre-fader sends available for parallel compression use cases
- [ ] Insert effects slots: 8 insert slots per channel (populated in Sprint 21)
- [ ] Tauri commands: `set_channel_fader`, `set_channel_pan`, `set_channel_mute`, `set_channel_solo`, `set_channel_send`, `add_bus`, `remove_bus`

### Non-Functional Requirements

- [ ] Mixing graph evaluated in topological order each audio callback — no circular routing
- [ ] All channel parameter changes (fader, pan) applied via `AtomicF32` — glitch-free during playback
- [ ] Master bus output peak level emitted as Tauri event at 30 Hz for level meters in UI
- [ ] Per-channel peak level (L/R) emitted as Tauri event at 30 Hz for individual channel strip meters
- [ ] Mixer supports up to 64 channels without CPU spike

## Dependencies

- **Sprints**: Sprint 2 (AudioGraph and AudioNode trait — mixer is a composite node in the graph), Sprint 6/7/8/9 (instruments produce audio that flows into mixer channels)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio/mixer.rs` — `Mixer` struct managing all channels and buses
- `src-tauri/src/audio/mixer/channel.rs` — `MixerChannel` (fader, pan, mute, solo, sends, insert slots)
- `src-tauri/src/audio/mixer/bus.rs` — `AuxBus` (accumulates send signals, has its own fader)
- `src-tauri/src/audio/mixer/master.rs` — `MasterBus` (final sum, output to audio engine)
- Tauri commands for all channel/bus parameter mutations
- Tauri event: `master_level_changed` (peak L/R for master bus meter)
- Tauri event: `channel_level_changed` (channel_id, peak L/R for per-channel meters at 30 Hz)
- Per-channel peak/RMS computation in each `MixerChannel` during audio callback (same pattern as master bus)
- React `MixerView`: scrollable row of vertical channel strips with fader, pan knob, mute/solo buttons, send knobs, channel name label
- React `LevelMeter` component: animated bar showing peak level, with clip indicator (red if > 0 dBFS) — instantiated per channel strip AND on master bus

### Out of Scope

- Effect inserts (Sprint 21 populates insert slots)
- Sidechain routing between channels
- Sub-group channel routing (channels routing to a group, then to master)
- MIDI routing in the mixer

## Technical Approach

`Mixer` is an `AudioNode` that owns all channels and buses. In the audio callback, it iterates all instrument outputs (received via shared ring buffers or direct `Arc<Mutex<Vec<f32>>>` — reviewed for lock-free alternative), applies fader gain and stereo pan (equal-power pan law: `L = cos(angle), R = sin(angle)` for angle in [0, π/2]), checks mute/solo flags, and sums into the master bus buffer. Send amounts are applied to copy a proportion of the post-fader signal into each aux bus buffer. Aux buses are summed and inserted back into the main mix before the master fader. All per-channel parameters (fader, pan, send levels) are `AtomicF32`. Mute and solo flags are `AtomicBool`. Solo logic: if any channel is soloed, all non-soloed channels are silenced.

## Tasks

### Phase 1: Planning
- [ ] Design mixer graph signal flow diagram (instrument → channel → insert chain → send → bus → master)
- [ ] Decide channel buffer passing strategy: `Arc<[f32]>` per channel vs. shared large buffer with channel offsets
- [ ] Plan solo logic: any-solo flag computed from channel solo atomics before each callback

### Phase 2: Implementation
- [ ] Implement `MixerChannel` with fader, pan (equal-power), mute/solo atomics, send levels
- [ ] Implement `AuxBus` accumulator with its own fader
- [ ] Implement `MasterBus` with peak level computation and event emission
- [ ] Implement per-channel peak level computation in `MixerChannel` and `channel_level_changed` event emission at 30 Hz
- [ ] Implement `Mixer` aggregating all channels, buses, master in correct signal order
- [ ] Register all instrument outputs as mixer channel inputs in AudioGraph
- [ ] Implement all Tauri commands for channel/bus parameter control
- [ ] Build React `MixerView` with horizontal scroll of channel strips
- [ ] Build React `ChannelStrip` with fader (click-drag vertical), pan knob, mute/solo buttons
- [ ] Build React `LevelMeter` animated bar updated from Tauri events
- [ ] Add send knob row per channel for each aux bus

### Phase 3: Validation
- [ ] Run 4 instruments; adjust each fader individually — independent volume control confirmed
- [ ] Pan a channel hard left — audio comes only from left output
- [ ] Mute a channel — no audio from that instrument; other channels unaffected
- [ ] Solo a channel — only that channel heard; press solo again to deactivate
- [ ] Send to aux bus at 50% — aux bus receives half the channel signal
- [ ] Master level meter responds in real time to audio level changes
- [ ] Per-channel level meters on each channel strip display peak levels in real time

### Phase 4: Documentation
- [ ] Rustdoc on `Mixer`, `MixerChannel`, `AuxBus`, `MasterBus`, pan law formula
- [ ] Document signal flow order and atomic parameter update guarantees

## Acceptance Criteria

- [ ] Each instrument/track has an independent channel fader that controls its volume
- [ ] Pan moves audio between left and right output channels
- [ ] Mute silences a channel without affecting others
- [ ] Solo silences all non-soloed channels
- [ ] Send routing feeds signal into aux buses at the configured send level
- [ ] Master bus level meter displays peak level in real time
- [ ] Each channel strip displays its own peak level meter updated in real time
- [ ] All mixer parameters persist in the project file

## Notes

Created: 2026-02-22
