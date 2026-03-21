---
sprint: 21
title: "Effect Chain & Modular Routing"
type: fullstack
epic: 6
status: planning
created: 2026-02-22T22:10:13Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 21: Effect Chain & Modular Routing

## Overview

| Field | Value |
|-------|-------|
| Sprint | 21 |
| Title | Effect Chain & Modular Routing |
| Type | fullstack |
| Epic | 6 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement a drag-and-drop effect chain per mixer channel that allows inserting, reordering, and bypassing any combination of built-in effects, with parallel wet/dry routing per effect and preset save/recall.

## Background

While Sprints 18–20 built the individual effect DSP, this sprint wires them all together into a unified insert chain management system. A flexible effect chain is what distinguishes a professional DAW — users need to stack EQ → Compressor → Reverb in that order, reorder them freely, bypass effects for A/B comparison, and save their effect configurations as presets.

## Requirements

### Functional Requirements

- [ ] Each mixer channel has an effect chain of up to 16 inserts (EQ, Compressor, Limiter, Gate, Reverb, Delay, VST3 in Sprint 23)
- [ ] Drag-and-drop to reorder effects within the chain — audio processing order updates immediately
- [ ] Drag effects from an effect browser panel into a channel's chain
- [ ] Bypass toggle per effect (effect is skipped in the processing chain while bypassed)
- [ ] Per-effect wet/dry blend: parallel routing (dry signal mixed with processed signal at configurable ratio)
- [ ] Save a channel's effect chain as a named preset (stored in project and as a standalone file)
- [ ] Load presets from the preset browser — applies the full chain configuration to the selected channel
- [ ] Remove an effect from the chain (with confirmation if it has parameter data)
- [ ] Tauri commands: `add_effect_to_chain`, `remove_effect_from_chain`, `reorder_effect_chain`, `bypass_effect`, `set_effect_wet_dry`, `save_chain_preset`, `load_chain_preset`

### Non-Functional Requirements

- [ ] Reordering the effect chain applies atomically — no audio glitch during reorder (swap chain pointer)
- [ ] Bypassed effects consume zero CPU (skipped entirely in the processing loop)
- [ ] Effect chain serialized to/from project file as a list of `{type, params, bypass, wet_dry}` entries

## Dependencies

- **Sprints**: Sprint 17 (mixer channel insert slots — placeholder structure built there), Sprint 18 (EQ AudioEffect), Sprint 19 (Reverb, Delay AudioEffect), Sprint 20 (Compressor, Limiter, Gate AudioEffect)
- **External**: None

## Scope

### In Scope

- `src-tauri/src/audio/effect_chain.rs` — `EffectChain` holding `Vec<Box<dyn AudioEffect>>` with bypass and wet/dry per slot
- `src-tauri/src/audio/effect_chain/parallel_router.rs` — wet/dry blend (dry path + wet effect path)
- Tauri commands: `add_effect_to_chain`, `remove_effect_from_chain`, `move_effect_in_chain`, `bypass_effect`, `set_effect_wet_dry`, `save_chain_preset`, `load_chain_preset`, `get_chain_state`
- React `EffectChainPanel`: vertical list of effect slots with drag handles, bypass toggles, wet/dry knobs, remove buttons
- React `EffectBrowser`: categorized list of all available effect types (EQ, Compressor, Reverb, etc.), drag to chain
- React `PresetBrowser`: list of saved presets, apply button, save-as-preset button

### Out of Scope

- Effect routing graphs (only linear insert chains in this sprint — no parallel branches)
- Per-band side-chain routing (backlog)
- VST3 inserts (Sprint 23/24)

## Technical Approach

`EffectChain` holds a `Vec<EffectSlot>` where each `EffectSlot` contains `Box<dyn AudioEffect>`, an `AtomicBool` for bypass, and an `AtomicF32` for wet/dry. The chain is processed in order: for each slot, if bypass is false, the effect processes the buffer; if wet_dry < 1.0, a dry copy is mixed back in. Reordering is done by sending a new index order via a `crossbeam_channel` command to the audio thread, which rearranges its internal `Vec` at the start of the next callback (atomic swap via `Arc<Mutex<...>>` double-buffer). The `AudioEffect` trait requires `process(buffer: &mut [f32])` and `get_state() -> EffectState`. Presets are serialized as a `Vec<EffectPreset>` stored as JSON in the project's `presets/` folder via the `hound` crate's file I/O utilities.

## Tasks

### Phase 1: Planning
- [ ] Define `AudioEffect` trait with `process`, `get_state`, `set_param`, `bypass` methods
- [ ] Design `EffectSlot` and `EffectChain` data structures
- [ ] Plan atomic chain reorder strategy (double-buffer swap)

### Phase 2: Implementation
- [ ] Implement `EffectChain` with linear insert processing and bypass/wet-dry per slot
- [ ] Implement `ParallelRouter` for per-effect wet/dry blending (dry copy buffer)
- [ ] Implement chain reorder command (atomic swap at next audio callback boundary)
- [ ] Implement `add_effect_to_chain` / `remove_effect_from_chain` / `move_effect_in_chain` Tauri commands
- [ ] Implement `save_chain_preset` / `load_chain_preset` with JSON serialization
- [ ] Build React `EffectChainPanel` with HTML5 drag-and-drop reordering and bypass toggles
- [ ] Build React `EffectBrowser` with categorized effect list and drag-to-chain
- [ ] Build React `PresetBrowser` with save/load buttons
- [ ] Integrate `EffectChain` into `MixerChannel` from Sprint 17

### Phase 3: Validation
- [ ] Add EQ → Compressor → Reverb to a channel — signal passes through all three in order
- [ ] Drag Reverb above Compressor — processing order updates, sound changes accordingly
- [ ] Bypass EQ — EQ no longer affects signal; re-enable — EQ re-applies
- [ ] Wet/dry 0.5 on reverb — dry signal audible alongside reverb tail
- [ ] Save preset, clear chain, load preset — chain is restored with all parameters
- [ ] Bypassed effect incurs zero CPU (profile audio callback with all effects bypassed)

### Phase 4: Documentation
- [ ] Rustdoc on `EffectChain`, `EffectSlot`, `AudioEffect` trait, `ParallelRouter`
- [ ] Document preset file format (JSON schema for effect chain presets)

## Acceptance Criteria

- [ ] Effects can be added to a channel's chain from the effect browser
- [ ] Drag-and-drop reorders effects; audio processing order changes immediately
- [ ] Bypass toggle silences an effect's contribution without removing it from the chain
- [ ] Wet/dry knob blends effect output with unprocessed signal
- [ ] Effect chain presets save all effect types, parameters, and bypass/wet-dry state
- [ ] Loading a preset restores the full chain configuration on the target channel
- [ ] Removing an effect from the chain correctly updates audio processing

## Notes

Created: 2026-02-22
