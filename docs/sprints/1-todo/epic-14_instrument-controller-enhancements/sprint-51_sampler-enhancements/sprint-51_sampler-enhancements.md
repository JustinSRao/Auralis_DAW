---
sprint: 51
title: "Sampler Enhancements"
type: fullstack
epic: 14
status: planning
created: 2026-04-07T15:38:55Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 51: Sampler Enhancements

## Overview

| Field | Value |
|-------|-------|
| Sprint | 51 |
| Title | Sampler Enhancements |
| Type | fullstack |
| Epic | 14 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Add loop point controls, root note and MIDI range selectors, a per-zone preview button, and initial factory presets to the sampler — completing the deferred Sprint 7 and Sprint 34 instrument UI work.

## Background

The Sprint 7 sampler delivers basic zone playback but left several practical controls unimplemented. Users cannot enable looping or set loop boundaries from the UI, cannot configure which MIDI notes trigger a zone, and cannot audition samples without a connected MIDI keyboard. Sprint 34 factory presets for the Sampler type were left empty. These gaps make the sampler difficult to use in practice:

- **Sprint 7 debt (loop point controls)**: `SamplerPanel` has no UI to enable/disable looping or to set the loop start and end frames. The Rust `SamplerZone` struct already stores `loop_enabled: bool`, `loop_start: usize`, and `loop_end: usize` fields. The UI just needs controls wired to these existing fields.
- **Sprint 7 debt (root note and MIDI range)**: Each zone has `root_note: u8`, `min_note: u8`, and `max_note: u8` fields set to defaults at load time but not editable from the UI. A root note selector (MIDI note picker) and min/max note fields in the zone row would let users correctly map samples to keyboard ranges.
- **Sprint 7 debt (zone preview button)**: There is no way to audition a zone without sending MIDI from an external device. A preview button per zone should send a `NoteOn` at the zone's root note followed by a `NoteOff` after 500ms, allowing users to hear the sample with a single click.
- **Sprint 34 debt (factory presets)**: The factory preset JSON files for the `Sampler` instrument type are empty. At least 3-5 factory presets should be provided to give users a starting point.

## Requirements

### Functional Requirements

- [ ] **Loop point controls**: Each zone row in `SamplerPanel` shows an "Enable Loop" toggle checkbox, a "Loop Start" frame number input, and a "Loop End" frame number input. Changes update the zone in real time via IPC.
- [ ] **Root note selector**: Each zone row shows a root note selector (MIDI note 0-127, displayed as note name, e.g., "A4"). Changing the root note updates the playback pitch mapping.
- [ ] **MIDI range fields**: Each zone row shows "Min Note" and "Max Note" fields (0-127, displayed as note names). These define the key range that triggers this zone.
- [ ] **Zone preview button**: Each zone row has a "Preview" button that sends a `NoteOn` at the zone's root note (velocity 100) to the sampler, followed by a `NoteOff` after 500ms. The preview is audible through the main audio output.
- [ ] **Factory presets**: At least 4 factory preset JSON files exist in `src-tauri/resources/presets/sampler/`:
  - `sustain_pad.json` — long attack, slow release, looping enabled
  - `staccato.json` — very short release, no loop, full velocity sensitivity
  - `ambient_long.json` — slow attack, long decay, looping with crossfade
  - `plucked_short.json` — instant attack, fast decay, no loop
- [ ] Factory presets are embedded via `include_str!()` in the presets module and appear in the preset browser under the Sampler category

### Non-Functional Requirements

- [ ] Loop start/end frame inputs validate that `loop_start < loop_end <= sample_length` before sending to Rust; invalid values show an inline error and are not sent
- [ ] The preview button debounces — rapid clicks do not stack multiple NoteOn events; a second click within 500ms cancels the previous NoteOff and extends the preview
- [ ] Factory preset JSON files follow the existing preset schema exactly (same structure as user-saved sampler presets)

## Dependencies

- **Sprints**: Sprint 7 (Sampler — zone data model and IPC commands), Sprint 34 (Presets — factory preset embedding mechanism and preset browser)
- **External**: None

## Scope

### In Scope

- Loop point enable/disable toggle, loop start frame input, loop end frame input in `SamplerPanel`
- Root note selector in zone row (MIDI note 0-127 with note name display)
- Min note and max note fields in zone row
- Per-zone preview button (sends NoteOn/NoteOff at root note)
- 4 factory preset JSON files for Sampler type
- Factory preset embedding in the presets module

### Out of Scope

- Crossfade loop implementation (the loop points are stored; crossfade audio is a future enhancement)
- Zone map grid editor (separate sprint — this sprint is the zone row controls only)
- SFZ/SF2 file import
- Multi-velocity zone layers

## Technical Approach

### Loop Point Controls

In `src/components/instruments/SamplerPanel.tsx`, add to each zone row:
- A checkbox: `<input type="checkbox" checked={zone.loop_enabled} onChange={...}>`
- A number input for loop start: `<input type="number" value={zone.loop_start} min={0} max={zone.sample_length - 1}>`
- A number input for loop end: `<input type="number" value={zone.loop_end} min={zone.loop_start + 1} max={zone.sample_length}>`

Wire each to an IPC call: `ipc.setSamplerZoneLoop(trackId, zoneIndex, { loop_enabled, loop_start, loop_end })`. The corresponding Tauri command updates the zone in the sampler instrument and takes effect immediately.

### Root Note and MIDI Range Selectors

Add a `NoteSelector` helper component (a `<select>` or `<input type="number">` with a note-name display) that converts MIDI note numbers (0-127) to display strings ("C-1" through "G9"). Render one for `root_note`, one for `min_note`, one for `max_note` in each zone row. Wire to `ipc.setSamplerZoneRange(trackId, zoneIndex, { root_note, min_note, max_note })`.

### Zone Preview Button

Add a "Preview" button to each zone row. On click:
1. Call `ipc.samplerPreviewZone(trackId, zoneIndex)` — a new Tauri command that:
   - Sends a `NoteOn` event at `zone.root_note` with velocity 100 to the sampler's MIDI input
   - Schedules a `NoteOff` for 500ms later via `tokio::time::sleep`
2. If already previewing (state tracked in component), cancel the previous timeout and restart.

The Tauri command is straightforward: use the existing MIDI event bus to inject the NoteOn/NoteOff without requiring an external MIDI device.

### Factory Presets

Create `src-tauri/resources/presets/sampler/sustain_pad.json`, `staccato.json`, `ambient_long.json`, `plucked_short.json` following the exact schema of user-saved sampler presets (name, instrument_type: "sampler", parameters object with ADSR and zone config). In `src-tauri/src/presets/mod.rs` (or wherever factory presets are embedded), add `include_str!()` calls for each new file, parallel to the existing synth factory presets. Verify they appear in the preset browser under "Sampler" after the fix.

## Tasks

### Phase 1: Planning
- [ ] Review `SamplerPanel.tsx` current zone row layout — identify insertion points for new controls
- [ ] Review existing `SamplerZone` Rust struct fields — confirm `loop_enabled`, `loop_start`, `loop_end`, `root_note`, `min_note`, `max_note` exist
- [ ] Check existing Tauri IPC commands for sampler zone updates — determine which are missing and need to be added
- [ ] Review the existing factory preset embedding mechanism in `src-tauri/src/presets/`

### Phase 2: Backend Implementation
- [ ] Add or verify Tauri command `set_sampler_zone_loop(track_id, zone_index, loop_params)` in `src-tauri/src/`
- [ ] Add or verify Tauri command `set_sampler_zone_range(track_id, zone_index, range_params)` in `src-tauri/src/`
- [ ] Add Tauri command `preview_sampler_zone(track_id, zone_index)` — sends NoteOn at root_note, schedules NoteOff after 500ms
- [ ] Create factory preset JSON files: `sustain_pad.json`, `staccato.json`, `ambient_long.json`, `plucked_short.json`
- [ ] Embed factory presets with `include_str!()` in `src-tauri/src/presets/`

### Phase 3: Frontend Implementation
- [ ] Add loop enable toggle, loop start input, and loop end input to each zone row in `SamplerPanel.tsx`
- [ ] Add `NoteSelector` helper component for MIDI note number → name display
- [ ] Add root note selector to each zone row
- [ ] Add min note and max note fields to each zone row
- [ ] Add per-zone "Preview" button with debounce logic
- [ ] Add typed wrapper functions in `src/lib/ipc.ts` for the three new commands
- [ ] Add inline validation: loop start must be less than loop end; show error if invalid

### Phase 4: Tests
- [ ] Add component test: loop start input rejects values >= loop end (shows validation error)
- [ ] Add component test: preview button calls `ipc.samplerPreviewZone` with correct track and zone index
- [ ] Add Rust unit test: `preview_sampler_zone` command emits NoteOn event to MIDI bus
- [ ] Verify factory presets appear in preset browser under Sampler category

### Phase 5: Validation
- [ ] Manual test: enable looping on a zone, set loop start/end — verify looped playback
- [ ] Manual test: change root note — verify pitch mapping shifts correctly
- [ ] Manual test: set min/max note range — verify only notes within range trigger the zone
- [ ] Manual test: click Preview — verify zone plays for ~500ms without MIDI hardware
- [ ] Manual test: load each factory preset — verify it loads correctly and sounds reasonable
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] Loop enable toggle, loop start, and loop end controls are visible in each zone row and update the zone in real time
- [ ] Loop start/end validation prevents `loop_start >= loop_end` values from being sent to Rust
- [ ] Root note selector and min/max note fields are editable per zone and affect playback mapping
- [ ] Preview button plays the zone's root note for ~500ms through the audio output without MIDI hardware
- [ ] 4 factory presets (`sustain_pad`, `staccato`, `ambient_long`, `plucked_short`) appear in the preset browser under Sampler
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 7 debt | Loop point controls (enable, start, end) | `src/components/instruments/SamplerPanel.tsx` |
| Sprint 7 debt | Root note selector and MIDI range fields | `src/components/instruments/SamplerPanel.tsx` |
| Sprint 7 debt | Per-zone preview button | `SamplerPanel.tsx` + new Tauri command |
| Sprint 34 debt | Factory presets for Sampler type | `src-tauri/resources/presets/sampler/` |

## Notes

Created: 2026-04-07
