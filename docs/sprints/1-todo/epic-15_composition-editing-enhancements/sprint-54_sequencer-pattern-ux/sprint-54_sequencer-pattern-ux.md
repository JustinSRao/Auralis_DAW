---
sprint: 54
title: "Sequencer & Pattern UX"
type: fullstack
epic: 15
status: planning
created: 2026-04-07T15:41:11Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 54: Sequencer & Pattern UX

## Overview

| Field | Value |
|-------|-------|
| Sprint | 54 |
| Title | Sequencer & Pattern UX |
| Type | fullstack |
| Epic | 15 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix four deferred sequencer and pattern UX correctness issues: the step sequencer's hardcoded instrument target, the piano roll's stale pattern notes on double-click, a hardcoded sample rate in `Timeline.tsx`, and missing runtime validation in `sequencerStore.ts`.

## Background

These items were deferred from Sprints 10, 12, and 13 postmortems:

- **Sprint 11 debt (instrument selector in step sequencer)**: The step sequencer always sends its MIDI output to the subtractive synthesizer, regardless of what instrument is on the track. There is no UI control to select which instrument (synth, sampler, drum machine) receives the sequencer's MIDI events. Users with tracks containing a sampler or drum machine cannot use the step sequencer for those instruments.
- **Sprint 12 debt (piano roll stale notes on pattern double-click)**: `openForPattern` in the piano roll loads the pattern's notes once at component mount via a `useEffect` with no dependency on the pattern ID. When the user double-clicks a different pattern block in the arrangement, the piano roll does not reload — it continues showing the previously opened pattern's notes. The fix is to add `patternId` as a dependency to the `useEffect`.
- **Sprint 13 debt (hardcoded sample rate in `Timeline.tsx`)**: `Timeline.tsx` uses the hardcoded value `44100` to convert between tick positions and pixel positions. If the user has configured a different sample rate (48000 Hz, 96000 Hz) via the audio settings, timeline pixel positions will be wrong. The fix is to read `sample_rate` from `TransportSnapshot` instead.
- **Sprint 10 debt (`snapToState` validation)**: In `sequencerStore.ts`, `snapToState` casts `pattern_length` and `time_div` from raw JSON without validating them. Invalid or `null` values can silently produce `NaN` in downstream arithmetic, causing invisible sequencer timing bugs.

Note: The piano roll `useEffect` dependency fix and the `snapToState` validation appear in both Sprint 48 and Sprint 54 because they were flagged from two different source sprints. If Sprint 48 ships first, verify whether those two items are already resolved before re-implementing here. This sprint's primary new work is the instrument selector dropdown and the hardcoded sample rate fix.

## Requirements

### Functional Requirements

- [ ] **Instrument selector dropdown**: The step sequencer UI has a dropdown control (above or alongside the step grid) that lists the available instruments on the current track (synth, sampler, drum machine). The selected instrument receives the sequencer's MIDI events. The selection persists with the sequencer state.
- [ ] **Piano roll pattern reload**: The piano roll's note-loading `useEffect` has `patternId` in its dependency array. Double-clicking a different pattern block refreshes the piano roll to show the new pattern's notes. (Verify against Sprint 48 — fix once, mark done in both.)
- [ ] **Sample rate from `TransportSnapshot`**: `Timeline.tsx` replaces the hardcoded `44100` constant with a value read from `TransportSnapshot.sample_rate`. The timeline correctly renders tick positions at all supported sample rates (44100, 48000, 88200, 96000 Hz).
- [ ] **`snapToState` validation**: `sequencerStore.ts` `snapToState` validates `pattern_length` (must be a positive integer) and `time_div` (must be a known valid string) before use, falling back to safe defaults. (Verify against Sprint 48 — fix once, mark done in both.)

### Non-Functional Requirements

- [ ] The instrument selector dropdown reads from the same track instrument state that the rest of the DAW uses — no duplicated instrument enumeration logic
- [ ] `sample_rate` from `TransportSnapshot` is read once on mount and updated whenever the transport state changes — no polling

## Dependencies

- **Sprints**: Sprint 10 (Step Sequencer — MIDI output target, sequencer store), Sprint 11 (Instrument selection — available instruments per track), Sprint 12 (Pattern Management — openForPattern, pattern ID), Sprint 13 (Arrangement/Timeline — Timeline.tsx, TransportSnapshot), Sprint 25 (Transport & Tempo — TransportSnapshot.sample_rate), Sprint 30 (DAW Shell — track model with instrument type)
- **External**: None

## Scope

### In Scope

- Instrument selector dropdown in the step sequencer UI
- MIDI output routing based on selected instrument
- `patternId` dependency in piano roll note-loading `useEffect` (if not already fixed by Sprint 48)
- `TransportSnapshot.sample_rate` read in `Timeline.tsx` replacing hardcoded `44100`
- `snapToState` validation in `sequencerStore.ts` (if not already fixed by Sprint 48)

### Out of Scope

- Multi-instrument step sequencer (one sequencer per instrument simultaneously)
- Piano roll new editing features
- Timeline visual redesign

## Technical Approach

### Instrument Selector Dropdown

The step sequencer state must include a `target_instrument: InstrumentType` field (e.g., `Synth | Sampler | DrumMachine`). Add this to the `sequencerStore.ts` state. In `SequencerPanel.tsx`, add a `<select>` dropdown at the top of the panel that lists the instruments available on the current track (read from the track store). When the user changes the selection, update `target_instrument` in the store and dispatch an IPC call to `set_sequencer_instrument_target(track_id, instrument_type)` in Rust. The Rust side routes the sequencer's MIDI tick events to the appropriate instrument.

### Timeline Sample Rate Fix

In `Timeline.tsx`, locate all occurrences of `44100` used in pixel/tick calculations. Replace with a state variable `sampleRate` initialized from `TransportSnapshot.sample_rate` on mount:
```typescript
const [sampleRate, setSampleRate] = useState<number>(44100);
useEffect(() => {
  ipc.getTransportSnapshot().then(snap => setSampleRate(snap.sample_rate));
}, []);
// Also update on transport state change events
```
Replace each `44100` literal with `sampleRate` in the calculation formulas.

### Piano Roll Pattern Reload (if not fixed in Sprint 48)

Add `patternId` to the `useEffect` dependency array in the piano roll component:
```typescript
useEffect(() => {
  if (!patternId) return;
  ipc.getPatternNotes(patternId).then(notes => setNotes(notes));
}, [patternId]); // patternId in deps triggers reload on pattern change
```

### snapToState Validation (if not fixed in Sprint 48)

Same approach as described in Sprint 48: add type and range checks for `pattern_length` and `time_div` before assigning them in `snapToState`.

## Tasks

### Phase 1: Planning
- [ ] Confirm which items from this sprint's scope were already fixed by Sprint 48 (if Sprint 48 shipped first)
- [ ] Locate the step sequencer MIDI output dispatch in Rust — identify how the target instrument is currently determined
- [ ] Locate all `44100` literals in `Timeline.tsx` — map each to its calculation context

### Phase 2: Backend Implementation
- [ ] Add `target_instrument: InstrumentType` to sequencer state in Rust
- [ ] Add Tauri command `set_sequencer_instrument_target(track_id, instrument_type)` to route MIDI output to the selected instrument
- [ ] Update sequencer MIDI dispatch to use `target_instrument` when firing steps

### Phase 3: Frontend Implementation
- [ ] Add `target_instrument` field to `sequencerStore.ts`
- [ ] Add instrument selector `<select>` dropdown to `SequencerPanel.tsx`
- [ ] Wire dropdown selection to `ipc.setSequencerInstrumentTarget(trackId, instrumentType)`
- [ ] Replace hardcoded `44100` in `Timeline.tsx` with `sampleRate` state variable initialized from `TransportSnapshot`
- [ ] Subscribe to transport state change events to keep `sampleRate` current
- [ ] Fix piano roll `useEffect` dependency (if not done in Sprint 48)
- [ ] Fix `snapToState` validation (if not done in Sprint 48)

### Phase 4: Tests
- [ ] Add Rust unit test: sequencer MIDI output routes to sampler when `target_instrument = Sampler`
- [ ] Add component test: changing the instrument dropdown dispatches `setSequencerInstrumentTarget`
- [ ] Add component test: `Timeline` renders tick positions correctly at `sample_rate = 48000` vs `44100`
- [ ] Add unit test (if not covered by Sprint 48): `snapToState` with null `pattern_length` uses default 16

### Phase 5: Validation
- [ ] Manual test: add a sampler to a track, open step sequencer, select "Sampler" — verify steps trigger sampler
- [ ] Manual test: change audio device sample rate to 48000 Hz, open timeline — verify clip positions are correct
- [ ] Manual test: double-click different pattern blocks — verify piano roll updates each time
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] Step sequencer has an instrument selector dropdown; selecting "Sampler" routes MIDI events to the sampler on the track
- [ ] Piano roll reloads notes when the user double-clicks a different pattern block
- [ ] `Timeline.tsx` has no hardcoded `44100` — sample rate is read from `TransportSnapshot`
- [ ] `sequencerStore.ts` `snapToState` does not produce `NaN` for `pattern_length` or `time_div` from malformed input
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 11 debt | Instrument selector dropdown in step sequencer | `src/components/` SequencerPanel + Rust |
| Sprint 12 debt | Piano roll stale notes on pattern double-click | Piano roll component `useEffect` |
| Sprint 13 debt | Hardcoded `44100` in `Timeline.tsx` | `src/components/timeline/Timeline.tsx` |
| Sprint 10 debt | `snapToState` missing runtime validation | `src/stores/sequencerStore.ts` |

## Notes

Created: 2026-04-07
Items for piano roll `useEffect` and `snapToState` validation are shared with Sprint 48. The implementing sprint should mark both done once complete.
