---
sprint: 56
title: "Audio Editing Enhancements"
type: fullstack
epic: 15
status: planning
created: 2026-04-07T15:42:35Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 56: Audio Editing Enhancements

## Overview

| Field | Value |
|-------|-------|
| Sprint | 56 |
| Title | Audio Editing Enhancements |
| Type | fullstack |
| Epic | 15 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix three deferred audio editing issues: add selection-based partial reverse in the waveform editor, fix waveform stretch controls to show metadata without a loaded buffer, and consider extracting a dedicated `clipStore` to decouple waveform operations from the project store.

## Background

These items were deferred from Sprints 15 and 16 postmortems:

- **Sprint 15 debt (partial-region reverse)**: The current "reverse" operation in the waveform editor replaces the entire audio clip with a reversed version. Users frequently want to reverse only a selected region (e.g., a specific drum hit or phrase), leaving the rest of the clip intact. The fix adds a selection-aware reverse that reverses only the sample range within the current selection, if a selection exists, or falls back to full-clip reverse if no selection is made.
- **Sprint 16 debt (stretch controls metadata)**: The waveform editor's time stretch and pitch shift controls show blank/zero values for "current length in bars" and "current pitch offset in cents" until a waveform buffer is loaded. If the user opens the editor before the waveform has decoded (or if the clip is very short), they see no useful information. The fix is to derive these display values from the clip's metadata (stored in the project model) rather than from the decoded buffer. The clip already stores its duration in ticks and its pitch shift offset — these can be displayed immediately.
- **Sprint 15 debt (`clipStore` extraction)**: The waveform edit commands (reverse, normalize, trim) currently reach into `fileStore.currentProject` to access and mutate audio clip data. This creates tight coupling between the waveform editor UI and the project store, making both harder to test and refactor. The correct approach is a dedicated `clipStore` in Zustand that owns the current waveform editor state. The question for this sprint is whether to implement the extraction or document it as a future refactor.

## Requirements

### Functional Requirements

- [ ] **Partial-region reverse**: In the waveform editor, when the user has an active selection (start sample to end sample), the "Reverse" operation reverses only the selected region in-place in the audio buffer. If no selection is active, behavior is unchanged (full clip reverse). The operation is undoable via the Sprint 26 undo stack.
- [ ] **Stretch controls metadata display**: The waveform editor's time stretch controls display the clip's current length in bars (computed from the clip's tick duration and current BPM) and the current pitch offset in cents (from the clip's stored pitch shift value) immediately on render, without waiting for a decoded waveform buffer to be available. When the buffer loads, the display values may refine if more accurate data is available, but they must not be blank before that.
- [ ] **`clipStore` decision**: Either: (a) extract `clipStore` as a new Zustand store with waveform edit state decoupled from `fileStore.currentProject`, or (b) create a `docs/decisions/clipstore-extraction.md` documenting the scope, risk, and recommendation for a future sprint. The decision is made based on implementation effort vs. sprint scope.

### Non-Functional Requirements

- [ ] Partial-region reverse is O(n) in the selected region length — no full buffer copy for the reverse operation
- [ ] Stretch control metadata computation is synchronous and pure — no async IPC call needed for the display values
- [ ] If `clipStore` is extracted: existing waveform editor tests continue to pass without modification

## Dependencies

- **Sprints**: Sprint 15 (Waveform Display — waveform editor component, selection state), Sprint 16 (Audio Clip Editing — reverse, stretch, pitch shift operations), Sprint 26 (Undo/Redo — for partial reverse undo), Sprint 25 (Transport — BPM for bar length calculation)
- **External**: None

## Scope

### In Scope

- Partial-region reverse in the waveform editor
- Stretch controls displaying clip metadata immediately (before buffer decode)
- `clipStore` extraction OR decision document
- Undo/redo integration for partial reverse

### Out of Scope

- New waveform editing operations beyond partial reverse
- New stretch algorithms (rubato quality already configured by Sprint 50)
- Waveform editor visual redesign

## Technical Approach

### Partial-Region Reverse

The waveform editor component maintains a `selection: { startSample: number, endSample: number } | null` state (already implemented in Sprint 15 for visual selection). When the user clicks "Reverse":
1. Check if `selection !== null`
2. If yes: call `ipc.reverseAudioClipRegion(clipId, selection.startSample, selection.endSample)`
3. If no: call the existing `ipc.reverseAudioClip(clipId)` (full clip)

In Rust, `reverse_audio_clip_region(clip_id, start_sample, end_sample)`:
- Load the clip's audio buffer
- Reverse only the slice `buffer[start_sample..end_sample]` in-place using `slice.reverse()`
- Write the modified buffer back
- Push an undo command that stores the reversed region's previous content

The in-place `slice.reverse()` is O(n/2) for the selected region — optimal.

### Stretch Controls Metadata Display

In the waveform editor component, the "current length in bars" is already computable from:
- `clip.duration_ticks` — stored in the project model
- `currentBpm` — available from the transport state
- `TICKS_PER_BEAT` — from the constants module

```typescript
const beatsPerBar = 4; // from time signature numerator (or from transport)
const ticksPerBar = TICKS_PER_BEAT * beatsPerBar;
const lengthInBars = clip.duration_ticks / ticksPerBar;
```

The "current pitch in cents" is just `clip.pitch_offset_cents` stored in the clip model.

These calculations are pure TypeScript — no async needed. Initialize the display values from clip props on render. When the waveform buffer eventually loads, the values can be confirmed/updated but should not be replaced with blanks during decode.

### `clipStore` Decision

Evaluate the extraction scope:
- Identify all places `fileStore.currentProject` is accessed for waveform clip data in the waveform editor components
- Estimate the refactor size (number of files, number of changed call sites)
- If the refactor is under ~2 hours of work: implement the extraction as a new `clipStore.ts`
- If larger: create `docs/decisions/clipstore-extraction.md` with the analysis and a recommendation for a future sprint

## Tasks

### Phase 1: Planning
- [ ] Review waveform editor `selection` state — confirm start/end sample values are tracked
- [ ] Locate `reverse_audio_clip` Tauri command in Rust — understand the buffer read/write path
- [ ] Identify the clip fields that provide tick duration and pitch offset
- [ ] Audit `fileStore` usage in waveform editor — estimate `clipStore` extraction effort

### Phase 2: Backend Implementation
- [ ] Add `reverse_audio_clip_region(clip_id, start_sample, end_sample)` Tauri command
- [ ] Implement in-place slice reverse for the specified sample range
- [ ] Push undo command capturing the reversed region's previous state

### Phase 3: Frontend Implementation
- [ ] Update the "Reverse" button handler in the waveform editor to check for active selection
- [ ] If selection active: call `ipc.reverseAudioClipRegion(clipId, selection.startSample, selection.endSample)`
- [ ] If no selection: call existing full reverse
- [ ] Fix stretch controls to compute and display length-in-bars and pitch-in-cents from clip props immediately on render (no buffer dependency)
- [ ] Add `ipc.reverseAudioClipRegion` typed wrapper to `src/lib/ipc.ts`
- [ ] Either extract `clipStore` or create the decision document

### Phase 4: Tests
- [ ] Add Rust unit test: `reverse_audio_clip_region` with samples [1,2,3,4,5] reversed from index 1 to 3 produces [1,4,3,2,5]
- [ ] Add component test: "Reverse" button with active selection calls `reverseAudioClipRegion` with correct bounds
- [ ] Add component test: "Reverse" button without selection calls `reverseAudioClip` (full clip)
- [ ] Add component test: stretch controls display non-blank length and pitch values before waveform buffer is loaded

### Phase 5: Validation
- [ ] Manual test: select a region in the waveform editor, click Reverse — verify only the selected region is reversed
- [ ] Manual test: no selection, click Reverse — verify entire clip is reversed (regression check)
- [ ] Manual test: open waveform editor on a clip — verify length in bars and pitch offset display immediately
- [ ] Manual test: undo a partial reverse — verify the region is restored
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] Partial-region reverse reverses only the selected sample range when a selection is active
- [ ] No-selection reverse continues to reverse the full clip (no regression)
- [ ] Partial reverse is undoable via the undo stack
- [ ] Stretch controls show "current length in bars" and "current pitch offset in cents" immediately on render, without a loaded waveform buffer
- [ ] Either `clipStore` is extracted from `fileStore.currentProject` OR `docs/decisions/clipstore-extraction.md` exists with the analysis
- [ ] All tests pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 15 debt | Partial-region reverse (selection-based) | Waveform editor component + `reverse_audio_clip_region` Tauri command |
| Sprint 16 debt | Stretch controls show metadata without buffer | Waveform editor stretch controls component |
| Sprint 15 debt | `clipStore` extraction from `fileStore` | `src/stores/clipStore.ts` or `docs/decisions/` |

## Notes

Created: 2026-04-07
