---
sprint: 39
title: "Sidechain Compression"
type: fullstack
epic: 6
status: completed
created: 2026-02-23T17:05:46Z
started: 2026-03-31T10:41:59Z
completed: 2026-03-31T12:00:00Z
hours: 1.5
workflow_version: "3.1.0"

---

# Sprint 39: Sidechain Compression

## Overview

| Field | Value |
|-------|-------|
| Sprint | 39 |
| Title | Sidechain Compression |
| Type | fullstack |
| Epic | 6 |
| Status | Completed |
| Created | 2026-02-23 |
| Started | 2026-03-31 |
| Completed | 2026-03-31 |

## Goal

Enable sidechain routing in the mixer so that one channel's post-fader audio feeds the detector input of a compressor on another channel, unlocking classic sidechain pumping effects such as a kick drum ducking a bass line or pad.

## Background

Sprint 17 explicitly deferred sidechain routing between channels. Sprint 20 built the `Compressor` with its `EnvelopeFollower` operating solely on the channel's own input signal. Sprint 21 wired effect chains together as strictly linear insert chains with no cross-channel signal paths. The result is a fully functional compressor that has no way to receive trigger signal from a different track — a critical gap for professional mixing.

Sidechain compression is one of the most widely used techniques in modern music production. The canonical use case is routing a kick drum channel as the sidechain source into a compressor on a bass or pad channel: every time the kick hits, the compressor briefly ducks the bass, creating rhythmic "pumping" that glues the low end together. Without sidechain support, users must rely on external tools or workarounds, making this a first-class feature requirement for the DAW's mixing epic. This sprint adds the cross-channel signal tap, the `SidechainRouter` coordinator, an optional high-pass filter on the sidechain input for transient focus, and the UI to configure and visualize it all.

## Requirements

### Functional Requirements

- [ ] Each compressor instance (as an `EffectSlot` in any channel's `EffectChain`) has an optional sidechain source selector
- [ ] Sidechain source selector lists all available mixer channels by name and includes a "None" (self) option to revert to standard compression
- [ ] When a sidechain source is selected, the compressor's `EnvelopeFollower` reads from the source channel's post-fader stereo buffer instead of its own input buffer
- [ ] The sidechain signal does not alter the audio output of the source channel — tapping is strictly read-only
- [ ] A two-pole high-pass filter (Butterworth, 12 dB/oct) on the sidechain input path is configurable from 20 Hz to 500 Hz, defaulting to 100 Hz, to focus detection on kick transients rather than sub-bass rumble
- [ ] The HPF can be disabled (bypass) for full-spectrum detection
- [ ] The gain reduction meter on `CompressorPanel` continues to display the gain reduction being applied to the destination channel, so the user can see the pumping effect
- [ ] Sidechain routing works for any compressor insert at any slot position within a channel's effect chain
- [ ] Sidechain source assignment and HPF cutoff/bypass are persisted in the project file as part of the compressor's `EffectState`
- [ ] Tauri commands: `set_sidechain_source`, `remove_sidechain`, `set_sidechain_filter`

### Non-Functional Requirements

- [ ] Sidechain buffer tap adds zero latency — the source channel's post-fader buffer is computed before the destination channel's effect chain in the mixer's topological processing order
- [ ] No heap allocations on the audio callback thread — sidechain buffer references are pre-wired at configuration time; no dynamic dispatch or allocation occurs during sample processing
- [ ] Sidechain routing configuration changes (add, remove, change source) are applied at the next audio callback boundary via `crossbeam_channel` command, not mid-buffer
- [ ] If the sidechain source channel is deleted or removed, the compressor silently reverts to self-detection without a crash or audio glitch
- [ ] Up to 64 simultaneous active sidechain connections supported without measurable CPU overhead
- [ ] The `SidechainRouter` is lock-free on the read path — the audio thread reads an `Arc<AtomicPtr<SidechainMap>>` that the control thread swaps atomically on change

## Dependencies

- **Sprints**: Sprint 2 (Audio Engine — `AudioNode` trait, `crossbeam_channel` command pattern, `AtomicF32`), Sprint 17 (Full Mixer — `MixerChannel` post-fader buffer, mixer processing order, channel IDs), Sprint 20 (Compression & Dynamics — `Compressor`, `EnvelopeFollower`, `get_compressor_state` command, gain reduction meter), Sprint 21 (Effect Chain & Modular Routing — `EffectChain`, `EffectSlot`, `AudioEffect` trait, `EffectState` serialization)
- **External**: None (pure Rust DSP; biquad HPF computed from standard digital filter coefficients)

## Scope

### In Scope

- `src-tauri/src/audio/mixer/sidechain.rs` — `SidechainRouter` struct that maintains a mapping of `(destination_channel_id, effect_slot_index) -> source_channel_id` and exposes a lock-free read path for the audio thread
- Extension to `src-tauri/src/effects/compressor.rs` — add `sidechain_buffer: Option<Arc<SidechainTap>>` field to `Compressor`; when present, the `EnvelopeFollower` processes samples from the tap instead of the main input buffer
- New `src-tauri/src/audio/mixer/sidechain_tap.rs` — `SidechainTap` is a fixed-size buffer (one audio callback worth of post-fader stereo samples) written by the source `MixerChannel` each callback and read by any connected compressor downstream in the same callback
- Extension to `src-tauri/src/audio/mixer/channel.rs` — each `MixerChannel` writes its post-fader stereo output into its `SidechainTap` before the signal reaches the master bus; sidechain taps allocated at channel creation and shared via `Arc`
- `src-tauri/src/effects/dynamics/sidechain_hpf.rs` — two-pole Butterworth high-pass filter operating on sidechain buffer before envelope detection; coefficient update on cutoff change via `crossbeam_channel` command
- Tauri commands: `set_sidechain_source(channel_id, slot_index, source_channel_id)`, `remove_sidechain(channel_id, slot_index)`, `set_sidechain_filter(channel_id, slot_index, cutoff_hz, enabled)`
- React `SidechainSourceSelector` component: dropdown on `CompressorPanel` listing all channel names plus "None (Self)"; shows source channel name in green when active
- React `SidechainHpfControl` component: frequency knob (20–500 Hz) and enable toggle embedded in `CompressorPanel` below the sidechain source selector, visible only when a sidechain source is selected
- React gain reduction meter on `CompressorPanel` continues to work unchanged — gain reduction is driven by the sidechain signal but the meter still reflects what is happening to the destination channel

### Out of Scope

- Sidechain routing to effects other than `Compressor` (e.g., sidechain to gate or vocoder — backlog)
- Pre-fader sidechain taps (only post-fader taps in this sprint; pre-fader is a backlog use case)
- Sidechain from an aux bus output (only from named mixer channels; bus sidechain is backlog)
- Multiband sidechain compression (backlog)
- Ducking automation via sidechain (the compressor handles the ducking; explicit volume automation is separate)
- Visual sidechain signal display / oscilloscope in the compressor UI (backlog)

## Technical Approach

The mixer's audio callback processes channels in topological order. Sprint 17's `Mixer` already evaluates all instrument/audio channels before the master bus. Sidechain routing exploits this ordering: the source channel's `MixerChannel::process()` writes its post-fader stereo output into a `SidechainTap` (a fixed `[f32; BUFFER_SIZE * 2]` array wrapped in an `Arc`) before returning. Because the destination channel is processed later in the same callback pass, the tap already contains fresh samples at the point when the destination compressor runs.

`SidechainRouter` holds a `HashMap<(ChannelId, SlotIndex), Arc<SidechainTap>>` and is managed on the control thread. When the user configures a sidechain connection, the control thread builds a new map and swaps an `Arc` pointer atomically so the audio thread sees the new routing at the next callback without any allocation in the hot path. The audio thread holds an `Arc<SidechainRouter>` cloned at initialization; it calls `router.get_tap(channel_id, slot_index)` which returns `Option<&Arc<SidechainTap>>` with zero allocation.

`Compressor` gains an optional `sidechain: Option<Arc<SidechainTap>>` field. In `process(buffer)`, before the per-sample gain computation loop, the code checks `sidechain`: if `Some(tap)`, it reads stereo pairs from `tap.buffer` for envelope detection only, while still applying the resulting gain to `buffer` (the destination channel's own audio). If `None`, behavior is identical to Sprint 20 — the envelope follower reads from `buffer` itself.

The `SidechainHpf` is a direct-form II transposed biquad filter. Butterworth HPF coefficients are computed at cutoff change time (on the control thread) and sent to the audio thread via `crossbeam_channel`. On receipt, the audio thread updates the biquad coefficients before the next callback. The HPF processes the sidechain buffer in place into a local stack-allocated scratch array of `BUFFER_SIZE * 2` `f32` values. This scratch array is stack-allocated (not heap), satisfying the no-allocation requirement. The filtered signal is then passed to the `EnvelopeFollower`.

Mixer processing order guarantee: `SidechainRouter` is consulted during `Mixer::build_processing_order()` (called from the control thread on any routing change, not the audio thread). If channel B sidechains to channel A, `channel_a` is placed before `channel_b` in the evaluation order. A simple DFS over the dependency graph detects cycles and returns an error if one is found (e.g., A sidechains to B and B sidechains to A), preventing deadlocks or undefined behavior.

## Tasks

### Phase 1: Planning
- [ ] Map the exact Sprint 17 `MixerChannel` buffer representation and confirm a `SidechainTap` can be populated during `channel.process()` without a second allocation
- [ ] Confirm Sprint 20 `Compressor` struct layout — identify where to inject the sidechain buffer reference and verify `EnvelopeFollower` can accept an external slice
- [ ] Derive two-pole Butterworth HPF coefficient formulas for direct-form II transposed and validate against reference values at 100 Hz / 44100 Hz
- [ ] Design the processing order sort algorithm — DFS topological sort with cycle detection for sidechain dependency edges
- [ ] Decide stack scratch buffer size strategy for the HPF intermediate buffer (constant `BUFFER_SIZE` or `max_buffer_size` constant from audio engine config)

### Phase 2: Implementation
- [ ] Implement `SidechainTap` as a fixed stereo buffer (`Arc<SidechainTap>` with interior mutability via `UnsafeCell` write from source channel and safe read from destination compressor; document the aliasing invariant)
- [ ] Extend `MixerChannel::process()` to write post-fader output into `self.sidechain_tap` after the fader/pan stage
- [ ] Implement `SidechainRouter` with `HashMap<(ChannelId, SlotIndex), Arc<SidechainTap>>`, atomic `Arc` swap for lock-free update, and `get_tap()` read method
- [ ] Implement `SidechainHpf` biquad HPF with stack-allocated scratch buffer and coefficient update via `crossbeam_channel`
- [ ] Extend `Compressor::process()` to optionally read from `SidechainTap` + `SidechainHpf` for envelope detection while applying gain to the main buffer
- [ ] Extend `EnvelopeFollower` to accept `process_detection(detection_slice: &[f32], output_slice: &mut [f32])` overload that separates detection input from gain-applied output
- [ ] Implement topological sort with cycle detection in `Mixer::build_processing_order()` — update this whenever sidechain routing changes
- [ ] Implement Tauri commands: `set_sidechain_source`, `remove_sidechain`, `set_sidechain_filter`
- [ ] Extend `EffectState` / `CompressorState` serialization (Sprint 21 preset format) to include `sidechain_source_id: Option<ChannelId>`, `sidechain_hpf_cutoff_hz: f32`, `sidechain_hpf_enabled: bool`
- [ ] Build React `SidechainSourceSelector`: dropdown populated from Zustand channel list, calls `set_sidechain_source` / `remove_sidechain` on change
- [ ] Build React `SidechainHpfControl`: frequency knob (logarithmic scale 20–500 Hz) + enable toggle, visible only when sidechain source is not "None"
- [ ] Integrate both new controls into `CompressorPanel` below the existing parameter knobs

### Phase 3: Validation
- [ ] Route kick drum channel as sidechain source to a compressor on the bass channel — confirm bass ducks on every kick hit, audible pumping effect
- [ ] Set HPF cutoff to 150 Hz — confirm detection is triggered by kick transient but not by sub-bass content (bass does not duck continuously)
- [ ] Disable HPF — confirm the compressor now responds to the full-bandwidth sidechain signal
- [ ] Remove sidechain source (set to "None") — confirm compressor reverts to compressing its own input signal
- [ ] Delete the sidechain source channel while compression is active — confirm no crash, compressor reverts gracefully to self-detection
- [ ] Configure a sidechain cycle (A sidechains B, B sidechains A) via the `set_sidechain_source` command — confirm the command returns an error and routing is unchanged
- [ ] Run profiler during playback with 8 active sidechain connections — confirm no heap allocations on the audio thread and no measurable CPU increase beyond the compressor DSP cost itself
- [ ] Save and reload project — sidechain source assignment, HPF cutoff, and HPF enable state are restored correctly

### Phase 4: Documentation
- [ ] Rustdoc on `SidechainRouter`, `SidechainTap`, `SidechainHpf`, and the extended `Compressor` sidechain fields
- [ ] Document the `SidechainTap` aliasing invariant: source channel writes once per callback before any destination compressor reads; reads and writes never overlap within a single callback pass
- [ ] Document the topological sort strategy for sidechain-aware processing order in `Mixer::build_processing_order()`
- [ ] Document the Butterworth HPF coefficient derivation (cutoff frequency, sample rate, direct-form II transposed coefficients)

## Acceptance Criteria

- [ ] A compressor on channel B correctly ducks channel B's audio in response to transients from channel A when A is set as B's sidechain source
- [ ] The sidechain high-pass filter reduces low-frequency content in the sidechain detection signal without affecting the source channel's audible output
- [ ] The source channel's audio is completely unaffected by being used as a sidechain source
- [ ] Removing a sidechain source reverts the compressor to self-detection with no glitch
- [ ] Deleting a sidechain source channel does not crash the application or audio engine
- [ ] Cyclic sidechain routing is rejected by the command with a descriptive error
- [ ] No heap allocations occur on the audio thread during sidechain-enabled compression (verified by profiling)
- [ ] Sidechain configuration (source channel, HPF cutoff, HPF enabled) round-trips through project save and load
- [ ] All Rust unit tests pass; DSP unit tests cover: HPF coefficient correctness, `EnvelopeFollower` external-slice overload, gain reduction applied to main buffer when sidechain active
- [ ] React `SidechainSourceSelector` populates with current channel names and updates on channel add/remove

## Notes

Created: 2026-02-23
This sprint closes the sidechain gap explicitly deferred by Sprint 17 (mixer routing) and Sprint 20 (compressor). It also extends Sprint 21's `EffectState` serialization schema — a coordinated change that must be backward-compatible with any presets saved before Sprint 39 executes (absent sidechain fields default to `None` / disabled on deserialize).
