---
sprint: 61
title: "Test Suite Quality"
type: fullstack
epic: 18
status: planning
created: 2026-04-07T15:46:32Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 61: Test Suite Quality

## Overview

| Field | Value |
|-------|-------|
| Sprint | 61 |
| Title | Test Suite Quality |
| Type | fullstack |
| Epic | 18 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix six specific deferred test infrastructure issues: `TrackList.test.tsx` mock failures, `act()` warnings in audio/MIDI settings tests, missing `ResizeObserver` polyfill, a MIDI recording integration test, vitest worktree exclusion, and a global canvas mock — completing the deferred test debt from Sprints 3, 11, 13, 32, 36, and 41.

## Background

These items were deferred from multiple sprint postmortems:

- **Sprint 13/44 debt (`TrackList.test.tsx`)**: The `TrackList.test.tsx` component tests fail with `useTrackStore.getState is not a function`. This error occurs because the test mock for `useTrackStore` returns an object that does not include the `getState` static method that Zustand adds to all stores. This bug has broken through multiple sprints (Sprint 13, Sprint 30, Sprint 44) without being fixed. The mock must be updated to include `getState` as a function.
- **Sprint 3 debt (`act()` warnings)**: `AudioSettingsPanel.test.tsx` and `MidiSettingsPanel.test.tsx` produce React `act()` warnings: "When testing, code that causes React state updates should be wrapped into act(...)". These warnings indicate that state updates triggered by user interactions in the test are not wrapped in `act()`. The fix wraps all `fireEvent` / `userEvent` calls that trigger state updates in `act()`.
- **Sprint 32 debt (`ResizeObserver` polyfill)**: `DAWLayout.test.tsx` throws `ReferenceError: ResizeObserver is not defined` in the jsdom test environment. jsdom does not implement `ResizeObserver`. A polyfill stub must be added to `src/test/setup.ts` so all tests that render components using `ResizeObserver` (layout components, panels) do not throw this error.
- **Sprint 36 debt (MIDI recording integration test)**: The core MIDI recording flow — arm a MIDI track → hit record → send a NoteOn event → stop → verify the pattern contains the note — has zero automated test coverage. This is the most important user-facing flow in the DAW and should have at least one integration test verifying it works end-to-end (with a simulated MIDI event bus).
- **Sprint 41 debt (vitest worktree exclusion)**: The vitest configuration does not exclude `.claude/worktrees/**`. When the workflow system creates worktrees (parallel agent branches), their test files can be picked up by vitest, causing duplicate test runs, false failures from stale code, and confusing test output.
- **Sprint 11 debt (global canvas mock)**: Components that use `HTMLCanvasElement` (Piano Roll, Timeline, Waveform Editor) require individual canvas mocks in each test file. Adding `HTMLCanvasElement.prototype.getContext = () => null` globally to `src/test/setup.ts` eliminates this per-test boilerplate and prevents `not implemented` errors from leaking into canvas-using component tests.

## Requirements

### Functional Requirements

- [ ] **`TrackList.test.tsx` fix**: The `useTrackStore` mock in `TrackList.test.tsx` includes a `getState` function that returns the mock state, matching the Zustand store interface. All `TrackList.test.tsx` tests pass without `useTrackStore.getState is not a function` errors.
- [ ] **`act()` warnings fixed**: All `act()` warnings in `AudioSettingsPanel.test.tsx` and `MidiSettingsPanel.test.tsx` are resolved by wrapping state-updating interactions in `act()` or using `@testing-library/user-event` which handles `act()` wrapping automatically.
- [ ] **`ResizeObserver` polyfill**: `src/test/setup.ts` adds a global `ResizeObserver` stub:
  ```typescript
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  ```
  `DAWLayout.test.tsx` and any other test that renders components using `ResizeObserver` runs without throwing `ReferenceError`.
- [ ] **MIDI recording integration test**: A test (Rust integration test or vitest test with mocked IPC) arms a MIDI track, simulates pressing Record, injects a `NoteOn(note=60, velocity=100)` event via the MIDI event bus, stops recording, and asserts that the resulting pattern contains a note at pitch 60.
- [ ] **Vitest worktree exclusion**: `vitest.config.ts` `exclude` array includes `'.claude/worktrees/**'` so stale worktree test files are never picked up during normal test runs.
- [ ] **Global canvas mock**: `src/test/setup.ts` adds `HTMLCanvasElement.prototype.getContext = () => null` globally. All canvas-using component tests (Piano Roll, Timeline, Waveform Editor) run without per-test canvas setup.

### Non-Functional Requirements

- [ ] After all fixes, the full vitest test suite runs without warnings, errors from missing browser APIs, or `act()` warnings
- [ ] The MIDI recording integration test completes in under 5 seconds without real audio hardware
- [ ] All fixes are additive — no existing passing tests are broken

## Dependencies

- **Sprints**: Sprint 3 (MIDI I/O — MIDI event bus for integration test), Sprint 11 (Step Sequencer — pattern notes data structure), Sprint 13 (Arrangement/Timeline — DAWLayout component), Sprint 30 (DAW Shell — TrackList component), Sprint 32 (MIDI Import — DAWLayout usage triggering ResizeObserver), Sprint 36 (MIDI Recording — arm/record/stop flow), Sprint 41 (PPQN/constants — worktree context), Sprint 58/59 (Code Quality — test infrastructure from those sprints should be complete first)
- **External**: None

## Scope

### In Scope

- `TrackList.test.tsx` `getState` mock fix
- `act()` wrapping in `AudioSettingsPanel.test.tsx` and `MidiSettingsPanel.test.tsx`
- `ResizeObserver` polyfill in `src/test/setup.ts`
- MIDI recording integration test (one test covering the core record flow)
- `.claude/worktrees/**` exclusion in `vitest.config.ts`
- Global `HTMLCanvasElement.prototype.getContext = () => null` in `src/test/setup.ts`

### Out of Scope

- Full test coverage targets (covered by Epic 17/18 other sprints)
- Performance benchmarks
- End-to-end UI tests (Playwright)
- New feature tests

## Technical Approach

### TrackList.test.tsx Fix

The Zustand store's `getState` is a static method added to the store hook. The mock must include it:
```typescript
vi.mock('../stores/trackStore', () => ({
  useTrackStore: Object.assign(
    vi.fn((selector) => selector(mockTrackState)),
    { getState: vi.fn(() => mockTrackState) }
  ),
}));
```
If `src/test/storeMocks.ts` has been created by Sprint 58 with a proper mock factory, import from there instead. Update all `TrackList.test.tsx` tests to use the fixed mock.

### act() Warnings Fix

Replace `fireEvent.click(button)` patterns with `await act(async () => { fireEvent.click(button); })` in the failing tests, or switch to `@testing-library/user-event`'s `userEvent.click(button)` which handles act wrapping internally:
```typescript
import userEvent from '@testing-library/user-event';
const user = userEvent.setup();
await user.click(button);
```
The `user-event` approach is preferred as it more accurately simulates real user interactions.

### ResizeObserver Polyfill

In `src/test/setup.ts`, add:
```typescript
// ResizeObserver polyfill for jsdom
global.ResizeObserver = class ResizeObserver {
  observe(_target: Element) {}
  unobserve(_target: Element) {}
  disconnect() {}
};
```
This must be added before `@testing-library/jest-dom/extend-expect` or any component imports in the setup file.

### MIDI Recording Integration Test

Add a Rust integration test in `src-tauri/src/` (under `#[cfg(test)]`) or a vitest test with the Tauri IPC mocked:

**Rust approach:**
```rust
#[tokio::test]
async fn test_midi_recording_captures_note() {
    let (engine, event_bus) = build_test_engine(); // test helper
    engine.arm_record(track_id).await;
    engine.start_recording().await;
    event_bus.inject(MidiEvent::NoteOn { channel: 1, note: 60, velocity: 100 });
    tokio::time::sleep(Duration::from_millis(100)).await;
    engine.stop_recording().await;
    let pattern = engine.get_pattern(track_id).await;
    assert!(pattern.notes.iter().any(|n| n.pitch == 60));
}
```
This test uses the existing MIDI event bus and does not require real MIDI hardware.

### Vitest Worktree Exclusion

In `vitest.config.ts`, locate the `exclude` array (under `test:`) and add:
```typescript
test: {
  exclude: [
    'node_modules/**',
    '.claude/worktrees/**',  // add this
    // ... existing excludes
  ],
}
```

### Global Canvas Mock

In `src/test/setup.ts`, add:
```typescript
// Canvas mock — getContext returns null in jsdom; components must handle this gracefully
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => null,
  writable: true,
});
```

## Tasks

### Phase 1: Planning
- [ ] Run the current test suite — capture all existing failures and warnings
- [ ] Confirm `TrackList.test.tsx` fails with `getState is not a function` — identify the exact mock location
- [ ] Run `AudioSettingsPanel.test.tsx` and `MidiSettingsPanel.test.tsx` — capture `act()` warning lines
- [ ] Run `DAWLayout.test.tsx` — confirm `ResizeObserver` error
- [ ] Review Sprint 36 recording flow — identify the Rust function and IPC command to use in the integration test

### Phase 2: Test Setup Fixes
- [ ] Add `ResizeObserver` polyfill to `src/test/setup.ts`
- [ ] Add global canvas `getContext` mock to `src/test/setup.ts`
- [ ] Add `.claude/worktrees/**` to vitest exclude list in `vitest.config.ts`

### Phase 3: Individual Test Fixes
- [ ] Fix `useTrackStore` mock in `TrackList.test.tsx` to include `getState`
- [ ] Verify all `TrackList.test.tsx` tests pass after the mock fix
- [ ] Fix `act()` warnings in `AudioSettingsPanel.test.tsx` — use `userEvent` or explicit `act()`
- [ ] Fix `act()` warnings in `MidiSettingsPanel.test.tsx` — use `userEvent` or explicit `act()`

### Phase 4: MIDI Recording Integration Test
- [ ] Implement `build_test_engine()` test helper in Rust (or reuse existing one if present)
- [ ] Write MIDI recording integration test: arm → record → inject NoteOn → stop → assert note in pattern
- [ ] Run the test — verify it passes without real MIDI hardware

### Phase 5: Validation
- [ ] Run full vitest suite — zero failing tests, zero `act()` warnings, zero `ResizeObserver` errors, zero canvas errors
- [ ] Run `cargo test` — MIDI recording integration test passes
- [ ] Verify `.claude/worktrees/**` are excluded from test runs (create a dummy worktree test file and verify it is not picked up)
- [ ] Run test suite 3 consecutive times — verify zero flaky failures

## Acceptance Criteria

- [ ] `TrackList.test.tsx` passes with no `useTrackStore.getState is not a function` errors
- [ ] `AudioSettingsPanel.test.tsx` and `MidiSettingsPanel.test.tsx` run without `act()` warnings
- [ ] `DAWLayout.test.tsx` runs without `ReferenceError: ResizeObserver is not defined`
- [ ] Piano Roll, Timeline, and Waveform Editor component tests run without per-test canvas setup (global mock handles it)
- [ ] MIDI recording integration test exists and passes: arm → NoteOn inject → stop → note in pattern
- [ ] Vitest does not pick up test files under `.claude/worktrees/`
- [ ] Full test suite runs 3 consecutive times without any failures

## Deferred Item Traceability

| Source | Description | Fix Location |
|--------|-------------|--------------|
| Sprint 13/44 debt | `TrackList.test.tsx` `getState is not a function` | `TrackList.test.tsx` mock |
| Sprint 3 debt | `act()` warnings in AudioSettings/MidiSettings tests | `AudioSettingsPanel.test.tsx`, `MidiSettingsPanel.test.tsx` |
| Sprint 32 debt | `ResizeObserver` polyfill missing in setup.ts | `src/test/setup.ts` |
| Sprint 36 debt | MIDI recording integration test missing | `src-tauri/src/` integration tests |
| Sprint 41 debt | `.claude/worktrees/**` not excluded from vitest | `vitest.config.ts` |
| Sprint 11 debt | Per-test canvas mock boilerplate | `src/test/setup.ts` |

## Notes

Created: 2026-04-07
The `TrackList.test.tsx` failure has persisted through Sprints 13, 30, and 44. It must be fixed in this sprint without further deferral. If the `storeMocks.ts` factory from Sprint 58 is available, use it to provide the correct mock shape.
