---
sprint: 48
title: "UI Accessibility & Code Correctness"
type: fullstack
epic: 12
status: planning
created: 2026-04-07T15:36:07Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 48: UI Accessibility & Code Correctness

## Overview

| Field | Value |
|-------|-------|
| Sprint | 48 |
| Title | UI Accessibility & Code Correctness |
| Type | fullstack |
| Epic | 12 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix five specific deferred code correctness and UX issues in the React/TypeScript frontend: the `MenuBar` accessibility gap, the `TrackHeader` double-cast type smell, the piano roll pattern reload bug, a missing log warning in `create_sequencer`, and missing runtime validation in `sequencerStore.ts`.

## Background

These items were deferred from Sprints 10, 12, and 30 postmortems. Each is a targeted fix to an existing component or function — no new features are introduced:

- **Sprint 30 debt (`MenuBar`)**: The `MenuBar` component in `src/components/daw/` uses plain HTML `<button>` elements for dropdown menus. This lacks keyboard navigation (`arrow key` traversal), proper focus management, and ARIA role/expanded state. Users navigating by keyboard cannot access menu items after the first level.
- **Sprint 30 debt (`TrackHeader` double cast)**: `TrackHeader.tsx` uses `(e.target as unknown as HTMLInputElement)` to access the input value. This double cast circumvents TypeScript's type system and hides a real type mismatch. The correct fix is to use TypeScript type narrowing (`e.target instanceof HTMLInputElement`) or to use `(e.currentTarget as HTMLInputElement)` which is always the bound element.
- **Sprint 12 debt (piano roll pattern reload)**: The `openForPattern` function in the pattern/piano roll system loads pattern notes once at component mount. If the user double-clicks a different pattern block, the piano roll shows stale notes from the previously opened pattern. The fix is to add the `patternId` as a dependency in the `useEffect` that fetches pattern notes, so the piano roll refreshes whenever the active pattern changes.
- **Sprint 10 debt (`create_sequencer` warning)**: When `create_sequencer` is called and `synth_midi_tx` is `None`, it silently succeeds without informing the developer that MIDI output is disconnected. A `log::warn!` macro call should be added so this state is visible in the log.
- **Sprint 10 debt (`snapToState` validation)**: In `sequencerStore.ts`, the `snapToState` function casts `pattern_length` and `time_div` from raw JSON values to TypeScript types without validating them. Invalid or `null` values from a malformed state snapshot can silently produce `NaN` in downstream arithmetic, causing invisible sequencer timing bugs. Runtime validation with early-exit or fallback to defaults is required.

## Requirements

### Functional Requirements

- [ ] `MenuBar` dropdown menus use Radix UI `DropdownMenu` components with full keyboard navigation (arrow keys, Escape to close, Enter/Space to select) and correct ARIA `role="menu"` / `aria-expanded` attributes
- [ ] `TrackHeader.tsx` removes the `(e.target as unknown as HTMLInputElement)` double cast and uses proper TypeScript type narrowing
- [ ] Piano roll refreshes its note list whenever the active `patternId` changes — `useEffect` has `patternId` in its dependency array
- [ ] `create_sequencer` in Rust logs `log::warn!("synth_midi_tx is None — MIDI output will be silent")` when the channel is absent
- [ ] `snapToState` in `sequencerStore.ts` validates `pattern_length` and `time_div` before use, falling back to safe defaults (`pattern_length = 16`, `time_div = '1/16'`) if values are missing, non-numeric, or out of range

### Non-Functional Requirements

- [ ] No visual or behavioral regressions — existing menu functionality is preserved in the Radix refactor
- [ ] TypeScript strict mode compilation continues to pass after the double-cast fix
- [ ] The `snapToState` validation must not introduce any new Zustand store state shape changes that break serialization

## Dependencies

- **Sprints**: Sprint 10 (Step Sequencer — sequencer store and create_sequencer), Sprint 12 (Pattern Management — openForPattern), Sprint 30 (DAW Shell — MenuBar and TrackHeader)
- **External**: Radix UI `DropdownMenu` (already in the dependency tree from Sprint 30)

## Scope

### In Scope

- `MenuBar` refactor from plain `<button>` to Radix UI `DropdownMenu`
- `TrackHeader.tsx` type narrowing fix
- Piano roll `useEffect` dependency array fix for `patternId`
- `log::warn!` addition in `create_sequencer` when `synth_midi_tx` is `None`
- Runtime validation for `pattern_length` and `time_div` in `sequencerStore.ts` `snapToState`

### Out of Scope

- New menu items or menu structure changes
- Full WCAG audit (separate sprint if needed)
- Sequencer new features or new store state fields
- Piano roll new editing features

## Technical Approach

### MenuBar Radix Refactor

Replace each top-level menu trigger (`<button>`) with a `<DropdownMenu.Root>` + `<DropdownMenu.Trigger>` pair. Replace each dropdown list with `<DropdownMenu.Content>` containing `<DropdownMenu.Item>` elements. Radix UI handles keyboard navigation (arrow keys, Escape, Tab) and ARIA attributes automatically. Wire existing `onClick` handlers to `onSelect` callbacks on `DropdownMenu.Item`. Preserve all existing menu actions and visual styling via Tailwind classes on the Radix primitives.

### TrackHeader Double Cast Fix

Locate `(e.target as unknown as HTMLInputElement)` in `TrackHeader.tsx`. If this is in an `onChange` handler on an `<input>` element, the correct type is `(e.currentTarget as HTMLInputElement)` — `currentTarget` is always the element the handler is attached to, avoiding the need for any cast. If it appears in an event delegation scenario, add `if (!(e.target instanceof HTMLInputElement)) return;` guard before use.

### Piano Roll Pattern Reload Fix

Locate the `useEffect` in the piano roll component that calls `openForPattern(patternId)` or equivalent IPC to fetch notes. Add `patternId` to the dependency array: `useEffect(() => { loadNotes(patternId); }, [patternId])`. Ensure the effect also handles cleanup if an in-flight request arrives after `patternId` has changed (cancel previous request or ignore stale result).

### create_sequencer Warning

In `src-tauri/src/audio/` (or wherever `create_sequencer` is defined), locate the branch where `synth_midi_tx.is_none()` and add:
```rust
if synth_midi_tx.is_none() {
    log::warn!("create_sequencer: synth_midi_tx is None — sequencer MIDI output will be silent");
}
```

### snapToState Validation

In `sequencerStore.ts`, in the `snapToState` function, add validation before assigning `pattern_length` and `time_div`:
```typescript
const rawLength = state.pattern_length;
const patternLength = typeof rawLength === 'number' && isFinite(rawLength) && rawLength > 0
  ? Math.round(rawLength)
  : 16; // safe default

const validTimeDivs = ['1/4', '1/8', '1/16', '1/32'] as const;
const timeDiv = validTimeDivs.includes(state.time_div as typeof validTimeDivs[number])
  ? state.time_div
  : '1/16'; // safe default
```

## Tasks

### Phase 1: Planning
- [ ] Audit `MenuBar` component — list all menu items and their handlers to ensure none are missed in the Radix refactor
- [ ] Locate all instances of `(e.target as unknown as HTMLInputElement)` in the codebase — confirm it is only in `TrackHeader.tsx`
- [ ] Identify the exact `useEffect` in the piano roll that loads pattern notes
- [ ] Locate `create_sequencer` in the Rust codebase
- [ ] Locate `snapToState` in `sequencerStore.ts` and map the exact field assignments

### Phase 2: Backend Implementation
- [ ] Add `log::warn!` to `create_sequencer` when `synth_midi_tx` is `None`

### Phase 3: Frontend Implementation
- [ ] Refactor `MenuBar` to use Radix UI `DropdownMenu` — replace all plain button dropdowns
- [ ] Apply Tailwind styles to Radix `DropdownMenu.Content` and `DropdownMenu.Item` to match existing visual design
- [ ] Fix `TrackHeader.tsx` double cast with proper type narrowing
- [ ] Add `patternId` to the `useEffect` dependency array in the piano roll component
- [ ] Add stale-request guard in the piano roll note-load effect
- [ ] Add runtime validation for `pattern_length` and `time_div` in `sequencerStore.ts` `snapToState`

### Phase 4: Tests
- [ ] Add component test: `MenuBar` — verify keyboard navigation (ArrowDown opens, ArrowDown moves to next item, Enter selects)
- [ ] Add component test: `TrackHeader` — verify `onChange` fires without TypeScript error (type check in test)
- [ ] Add component test: piano roll re-renders note list when `patternId` prop changes
- [ ] Add unit test: `snapToState` with `pattern_length: null` uses default `16`
- [ ] Add unit test: `snapToState` with `time_div: 'invalid'` uses default `'1/16'`

### Phase 5: Validation
- [ ] Manual test: navigate `MenuBar` using only keyboard — verify all items reachable
- [ ] Manual test: double-click different pattern blocks — verify piano roll updates each time
- [ ] Run `tsc --noEmit` — verify no TypeScript errors after double-cast fix
- [ ] Run full test suite — all tests green

## Acceptance Criteria

- [ ] `MenuBar` dropdown menus are fully keyboard-navigable using arrow keys, Escape, and Enter/Space
- [ ] `MenuBar` has correct ARIA attributes (`role="menu"`, `aria-expanded`) — verified via browser accessibility tree
- [ ] `TrackHeader.tsx` contains no `as unknown as` double cast — uses proper type narrowing
- [ ] Piano roll note list updates when the user double-clicks a different pattern block
- [ ] `create_sequencer` emits a `warn` log entry when `synth_midi_tx` is `None`
- [ ] `snapToState` in `sequencerStore.ts` never produces `NaN` for `pattern_length` or `time_div`, even with malformed JSON input
- [ ] All new tests pass; all existing tests continue to pass

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 30 debt | `MenuBar` plain buttons lack keyboard nav | `src/components/daw/MenuBar.tsx` |
| Sprint 30 debt | `TrackHeader` double cast type smell | `src/components/daw/TrackHeader.tsx` |
| Sprint 12 debt | `openForPattern` stale notes on pattern change | Piano roll component `useEffect` |
| Sprint 10 debt | `create_sequencer` silent fail when MIDI tx None | `src-tauri/src/audio/` (sequencer init) |
| Sprint 10 debt | `snapToState` missing runtime validation | `src/stores/sequencerStore.ts` |

## Notes

Created: 2026-04-07
