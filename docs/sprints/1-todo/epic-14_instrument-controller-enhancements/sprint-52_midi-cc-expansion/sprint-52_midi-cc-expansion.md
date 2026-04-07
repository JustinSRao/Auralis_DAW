---
sprint: 52
title: "MIDI CC Expansion"
type: fullstack
epic: 14
status: planning
created: 2026-04-07T15:39:35Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 52: MIDI CC Expansion

## Overview

| Field | Value |
|-------|-------|
| Sprint | 52 |
| Title | MIDI CC Expansion |
| Type | fullstack |
| Epic | 14 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Expand MIDI Learn to cover sampler and drum machine parameters, add a proper Radix context menu to knobs, and show an active mapping indicator on knobs that have an assigned CC — completing the deferred Sprint 29 MIDI controller work.

## Background

Sprint 29 implemented MIDI Learn for the subtractive synthesizer's parameters only. Three deferred items remain:

- **Sprint 29 debt (`register_sampler_targets` / `register_drum_targets`)**: The MIDI CC mapping system only registers synth parameters as MIDI Learn targets. Sampler ADSR parameters (attack, decay, sustain, release per zone) and drum machine parameters (master BPM, swing amount, per-pad velocity) are not mappable. Users with hardware controllers cannot map knobs to sampler or drum machine controls.
- **Sprint 29 debt (knob right-click context menu)**: The current knob right-click handler shows a minimal placeholder menu or nothing useful. A proper Radix `ContextMenu` with structured options ("MIDI Learn", "Clear Mapping", "Set Range Min", "Set Range Max", "Reset to Default") would make MIDI assignment and parameter management significantly more efficient.
- **Sprint 29 debt (active mapping indicator)**: Knobs with an active CC assignment show no visual indication that they are mapped. Users have no way to tell which controls are MIDI-mapped without entering MIDI Learn mode. A small colored dot or a tooltip showing "CC 74" on hover would make the mapping state immediately visible.

## Requirements

### Functional Requirements

- [ ] **`register_sampler_targets`**: Sampler ADSR parameters (attack, decay, sustain, release — per zone or global) are registered as MIDI Learn targets in the CC mapping system and are mappable via the MIDI Learn workflow
- [ ] **`register_drum_targets`**: Drum machine parameters (master BPM, swing amount, per-pad volume/velocity scale for each of the 16 pads) are registered as MIDI Learn targets and are mappable via MIDI Learn
- [ ] **Knob context menu**: Right-clicking any knob opens a Radix `ContextMenu` with the following items:
  - "MIDI Learn" — enters MIDI Learn mode for this parameter (same as current left-click-MIDI-Learn flow)
  - "Clear Mapping" — removes the CC assignment for this parameter (grayed out if no mapping)
  - "Set Range Min" — sets the parameter's minimum MIDI-mapped value to the current knob value
  - "Set Range Max" — sets the parameter's maximum MIDI-mapped value to the current knob value
  - "Reset to Default" — resets the parameter to its factory default value
- [ ] **Active mapping indicator**: Any knob with an active CC assignment displays a small visual indicator (e.g., a filled circle dot in the accent color at the bottom of the knob) and shows a tooltip on hover with the text "MIDI CC [number]" (e.g., "MIDI CC 74")

### Non-Functional Requirements

- [ ] The context menu must not interfere with the existing knob drag interaction — right-click on knob opens menu; left-click-drag still adjusts value
- [ ] Sampler and drum machine parameter IDs must follow the same `ParameterId` enum convention used by the synth
- [ ] The mapping indicator must not affect knob layout or cause layout shifts — it overlays or extends the existing knob component without resizing it

## Dependencies

- **Sprints**: Sprint 29 (MIDI Learn — CC mapping registry, ParameterId enum, MIDI Learn workflow), Sprint 7 (Sampler — ADSR parameters), Sprint 8 (Drum Machine — BPM, swing, pad parameters)
- **External**: Radix UI `ContextMenu` (already in the dependency tree)

## Scope

### In Scope

- `register_sampler_targets` function wiring sampler ADSR to the CC mapping registry
- `register_drum_targets` function wiring drum machine BPM, swing, and per-pad parameters to the CC mapping registry
- Radix UI `ContextMenu` on the `Knob` component with the 5 menu items listed above
- Active CC mapping indicator (dot + tooltip) on mapped knobs

### Out of Scope

- 14-bit CC support (separate sprint if needed)
- Automation recording from CC input
- New MIDI Learn UI flows beyond the context menu additions
- Mapping indicators on non-knob controls (sliders, toggles — future work)

## Technical Approach

### register_sampler_targets

In `src-tauri/src/midi/cc_mapping.rs` (or wherever `register_synth_targets` is defined), add a `register_sampler_targets` function that calls the registration API for each sampler parameter. Define `ParameterId` variants:
```rust
ParameterId::SamplerAttack,
ParameterId::SamplerDecay,
ParameterId::SamplerSustain,
ParameterId::SamplerRelease,
```
Call `register_sampler_targets` alongside `register_synth_targets` during engine initialization.

### register_drum_targets

Add `register_drum_targets` similarly with:
```rust
ParameterId::DrumBpm,
ParameterId::DrumSwing,
ParameterId::DrumPadVelocity(pad_index: u8), // 0-15
```
Register all 16 pad velocity targets plus BPM and swing.

### Knob Context Menu

Wrap the existing `Knob` component's root element in a `<ContextMenu.Root>` + `<ContextMenu.Trigger>`. Add `<ContextMenu.Content>` with `<ContextMenu.Item>` for each of the 5 actions. The `Knob` component receives a `parameterId` prop and a `ccMapping: CcMapping | null` prop from the parent. Menu items use these to dispatch the appropriate IPC calls:
- "MIDI Learn" → `ipc.startMidiLearn(parameterId)`
- "Clear Mapping" → `ipc.clearCcMapping(parameterId)` (disabled if `ccMapping === null`)
- "Set Range Min" → `ipc.setCcMappingRangeMin(parameterId, currentValue)`
- "Set Range Max" → `ipc.setCcMappingRangeMax(parameterId, currentValue)`
- "Reset to Default" → `ipc.resetParameterToDefault(parameterId)`

### Active Mapping Indicator

The `Knob` component already receives `ccMapping` prop. When `ccMapping !== null`, render a small filled circle (e.g., 6px diameter, accent color) absolutely positioned at the bottom center of the knob. Add a `title` attribute to the circle element with the text `"MIDI CC ${ccMapping.cc_number}"` — this provides native browser tooltip on hover. Optionally wrap in a Radix `Tooltip` for styled tooltip if the native tooltip is insufficient.

## Tasks

### Phase 1: Planning
- [ ] Review `register_synth_targets` implementation in `midi/cc_mapping.rs` — understand the registration API
- [ ] List all sampler ADSR parameters that should be registerable
- [ ] List all drum machine parameters (BPM, swing, per-pad velocity) that should be registerable
- [ ] Review current `Knob` component props — confirm it already receives or can receive `parameterId` and `ccMapping`

### Phase 2: Backend Implementation
- [ ] Add `SamplerAttack`, `SamplerDecay`, `SamplerSustain`, `SamplerRelease` to `ParameterId` enum
- [ ] Implement `register_sampler_targets` in `midi/cc_mapping.rs`
- [ ] Add `DrumBpm`, `DrumSwing`, `DrumPadVelocity(u8)` to `ParameterId` enum
- [ ] Implement `register_drum_targets` in `midi/cc_mapping.rs`
- [ ] Call both registration functions during engine/MIDI system initialization
- [ ] Add Tauri commands for context menu actions not already present: `clear_cc_mapping`, `set_cc_mapping_range_min`, `set_cc_mapping_range_max`, `reset_parameter_to_default`

### Phase 3: Frontend Implementation
- [ ] Add `parameterId` and `ccMapping` props to `Knob` component if not already present
- [ ] Wrap `Knob` root in `<ContextMenu.Root>` + `<ContextMenu.Trigger>`
- [ ] Add `<ContextMenu.Content>` with all 5 menu items and their IPC dispatch
- [ ] Disable "Clear Mapping" item when `ccMapping === null`
- [ ] Add active mapping dot indicator to `Knob` when `ccMapping !== null`
- [ ] Add tooltip (`title` attribute or Radix `Tooltip`) showing "MIDI CC N" on the indicator dot
- [ ] Add typed IPC wrapper functions in `src/lib/ipc.ts` for any new commands

### Phase 4: Tests
- [ ] Add Rust unit test: `register_sampler_targets` registers expected `ParameterId` variants
- [ ] Add Rust unit test: `register_drum_targets` registers all 16 pad velocity targets + BPM + swing
- [ ] Add component test: `Knob` with `ccMapping={null}` — right-click shows "Clear Mapping" item as disabled
- [ ] Add component test: `Knob` with `ccMapping={{ cc_number: 74 }}` — mapping indicator is visible, tooltip shows "MIDI CC 74"

### Phase 5: Validation
- [ ] Manual test: enter MIDI Learn mode for a sampler ADSR parameter — verify CC assignment works
- [ ] Manual test: enter MIDI Learn mode for drum machine BPM — verify CC assignment and live control
- [ ] Manual test: right-click a mapped knob — verify context menu shows all 5 items; click "Clear Mapping" — verify mapping removed and indicator disappears
- [ ] Manual test: hover over a mapped knob's indicator dot — verify tooltip shows correct CC number
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] Sampler ADSR parameters (attack, decay, sustain, release) are assignable via MIDI Learn
- [ ] Drum machine BPM, swing, and all 16 pad velocity parameters are assignable via MIDI Learn
- [ ] Right-clicking any knob opens a Radix context menu with all 5 items ("MIDI Learn", "Clear Mapping", "Set Range Min", "Set Range Max", "Reset to Default")
- [ ] "Clear Mapping" is disabled/grayed out when the knob has no active CC mapping
- [ ] Knobs with an active CC mapping display a visible colored dot indicator
- [ ] Hovering the indicator shows a tooltip with "MIDI CC N" where N is the assigned CC number
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 29 debt | `register_sampler_targets` for sampler ADSR | `src-tauri/src/midi/cc_mapping.rs` |
| Sprint 29 debt | `register_drum_targets` for drum machine params | `src-tauri/src/midi/cc_mapping.rs` |
| Sprint 29 debt | Radix `ContextMenu` on knobs with 5 actions | `src/components/` Knob component |
| Sprint 29 debt | Active CC mapping indicator on knobs | `src/components/` Knob component |

## Notes

Created: 2026-04-07
