---
sprint: 58
title: "Frontend Code Quality"
type: fullstack
epic: 17
status: planning
created: 2026-04-07T15:44:25Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 58: Frontend Code Quality

## Overview

| Field | Value |
|-------|-------|
| Sprint | 58 |
| Title | Frontend Code Quality |
| Type | fullstack |
| Epic | 17 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Fix six specific deferred frontend code quality items: Tauri command validation tests against real command paths, `MasterStrip` memo wrapping, EQ biquad WASM extraction, `useKnobDrag` hook extraction, `ipc.ts` module splitting, and a shared store mock factory for tests.

## Background

These items were deferred from Sprints 13, 17, 21, and 28 postmortems and tracked in DEFERRED.md:

- **D-002 (`commands.rs` validation tests)**: The current tests for Tauri command validation exercise inline validation logic that is duplicated from the actual command functions. They do not call the real command code paths, so bugs in the command functions themselves are not caught. The tests need to be rewritten to call real Tauri command functions via the Tauri test harness with a properly initialized `State`.
- **D-003 (`MasterStrip` memo)**: The `MasterStrip` component re-renders on every parent update, even when its own props have not changed, because it is not wrapped in `React.memo`. In the mixer view, the parent updates frequently (on every audio meter tick), causing `MasterStrip` to re-render ~60 times per second unnecessarily. `React.memo` prevents re-renders when props are shallowly equal.
- **D-006 (EQ biquad WASM)**: The `EqPanel.tsx` component contains a JavaScript implementation of the biquad filter frequency response magnitude computation to draw the EQ curve on the canvas. This is a duplicate of the equivalent Rust function in `effects/eq.rs`. Numeric discrepancies between the two implementations cause the displayed EQ curve to differ from the actual audio effect. The fix is to compile the Rust `biquad_magnitude` function to WASM and call it from the React component, eliminating the duplicate and guaranteeing parity.
- **D-007 (`useKnobDrag` extraction)**: The knob drag interaction logic (pointer capture, delta computation, min/max clamping) was originally written inline in `BiquadBandControl`. It has since been copy-pasted into the compressor threshold knob and other controls. The fix is to extract it into a `src/hooks/useKnobDrag.ts` custom hook and replace all call sites with the shared hook.
- **Sprint 28 debt (`ipc.ts` split)**: `src/lib/ipc.ts` has grown to approximately 2,580 lines, making it difficult to navigate and causing slow TypeScript type checking. It should be split into domain-specific modules: `ipc/audio.ts`, `ipc/instruments.ts`, `ipc/effects.ts`, `ipc/presets.ts`, `ipc/browser.ts`, `ipc/project.ts`. A barrel re-export `ipc/index.ts` maintains backwards compatibility.
- **Sprint 13 debt (shared store mock factory)**: Every sprint's component tests reimplement the same boilerplate for mocking `useDAWLayoutStore`, `useTrackStore`, `useTransportStore`, etc. A shared `src/test/storeMocks.ts` factory module would let all tests import pre-built mocks instead of writing them fresh each time.

## Requirements

### Functional Requirements

- [ ] **D-002**: Rewrite `commands.rs` validation tests to call actual Tauri command functions via the Tauri State test harness — the test constructs a real `tauri::State<AppState>` and calls the command function directly
- [ ] **D-003**: `MasterStrip` is wrapped in `React.memo` — it does not re-render when parent re-renders with unchanged props
- [ ] **D-006**: EQ frequency response curve in `EqPanel.tsx` is computed by a WASM function compiled from the Rust `biquad_magnitude` implementation — no separate JS implementation exists
- [ ] **D-007**: `useKnobDrag` custom hook is extracted to `src/hooks/useKnobDrag.ts` and used by all knob components (EQ bands, compressor threshold, any other consumers)
- [ ] **Sprint 28 debt**: `src/lib/ipc.ts` is split into domain modules under `src/lib/ipc/` with a barrel re-export — all existing import sites (`import { ... } from '../lib/ipc'`) continue to work without modification
- [ ] **Sprint 13 debt**: `src/test/storeMocks.ts` exports pre-built mock factories for all major Zustand stores used in component tests

### Non-Functional Requirements

- [ ] No behavior changes — all refactors are purely structural
- [ ] TypeScript compilation (`tsc --noEmit`) passes after all changes
- [ ] All existing tests continue to pass after the refactors
- [ ] The WASM biquad module is tree-shaken correctly — not included in builds where `EqPanel` is not used

## Dependencies

- **Sprints**: Sprint 17 (EQ — `biquad_magnitude` Rust function), Sprint 21 (Mixer — `MasterStrip`), Sprint 28 (Sample Browser — `ipc.ts` growth), Sprint 48 (UI Accessibility & Code Correctness — should run first to resolve existing TypeScript errors before refactoring)
- **External**: `wasm-pack` for compiling Rust to WASM (or `wasm-bindgen` — needs to be added if not present)

## Scope

### In Scope

- D-002: Tauri command validation tests using real State test harness
- D-003: `React.memo` wrapping for `MasterStrip`
- D-006: WASM extraction of `biquad_magnitude` from Rust to replace JS duplicate in `EqPanel.tsx`
- D-007: `useKnobDrag` hook extraction and adoption at all knob call sites
- Sprint 28 debt: `ipc.ts` split into domain modules with barrel re-export
- Sprint 13 debt: `src/test/storeMocks.ts` shared mock factory

### Out of Scope

- New features or UI changes
- Migrating from Zustand (staying with Zustand)
- Other Tauri command tests beyond validation tests
- WASM compilation for effects other than EQ biquad

## Technical Approach

### D-002: Command Validation Tests

In the Tauri test harness, commands can be tested by constructing the state and calling the function directly (without the Tauri IPC layer). Example pattern:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, MockRuntime};

    #[test]
    fn test_create_track_validates_name() {
        let state = /* build AppState with test DB */;
        let result = create_track(state, "".to_string()); // empty name
        assert!(result.is_err());
    }
}
```
Rewrite existing validation tests to follow this pattern.

### D-003: MasterStrip Memo

```tsx
// Before
export function MasterStrip(props: MasterStripProps) { ... }

// After
export const MasterStrip = React.memo(function MasterStrip(props: MasterStripProps) { ... });
```
Add a component test verifying that `MasterStrip` does not re-render when only unrelated parent state changes.

### D-006: WASM Biquad Module

Add a Rust crate (or feature flag in the existing `src-tauri` crate) that compiles `biquad_magnitude(frequency: f32, sample_rate: f32, filter_type: &str, cutoff: f32, gain_db: f32, q: f32) -> f32` to WASM via `wasm-bindgen`. Build the WASM artifact as part of the Vite build (add a `prebuild` npm script). In `EqPanel.tsx`, import and call the WASM function instead of the inline JS math. Delete the JS implementation once WASM is wired.

If WASM compilation proves too complex within sprint scope, an acceptable fallback is: extract the shared biquad math into a TypeScript utility module with extensive unit tests against known reference values from the Rust implementation. Document this as a stepping stone toward full WASM parity.

### D-007: useKnobDrag Hook

Create `src/hooks/useKnobDrag.ts`:
```typescript
interface UseKnobDragOptions {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  sensitivity?: number; // pixels per full range, default 200
}

export function useKnobDrag(options: UseKnobDragOptions): {
  onPointerDown: (e: React.PointerEvent) => void;
}
```
The hook handles pointer capture, delta Y accumulation, value clamping, and calls `onChange`. Replace all inline knob drag logic in `BiquadBandControl`, compressor threshold knob, and any other knob components with `useKnobDrag`.

### ipc.ts Split

Create `src/lib/ipc/` directory with:
- `audio.ts` — audio device commands, transport, engine start/stop
- `instruments.ts` — synth, sampler, drum machine commands
- `effects.ts` — EQ, reverb, compressor, delay commands
- `presets.ts` — preset CRUD commands
- `browser.ts` — sample browser, file system commands
- `project.ts` — project save, load, track management commands
- `index.ts` — re-exports everything from all modules

Move functions from the existing `ipc.ts` into the appropriate module. Delete the original `ipc.ts` after all functions are moved. Run `tsc --noEmit` to verify no import breaks.

### Shared Store Mock Factory

Create `src/test/storeMocks.ts`:
```typescript
export function createMockDAWLayoutStore(overrides?: Partial<DAWLayoutState>) { ... }
export function createMockTrackStore(overrides?: Partial<TrackState>) { ... }
export function createMockTransportStore(overrides?: Partial<TransportState>) { ... }
// etc. for all major stores
```
Each factory returns a `vi.fn()` mock of the store hook with sensible defaults. Update at least 3 existing component test files to import from `storeMocks.ts` instead of defining mocks inline, as a proof of concept.

## Tasks

### Phase 1: Planning
- [ ] Identify which Tauri command validation tests need rewriting (D-002) — list test file names
- [ ] Identify all knob components with inline drag logic (D-007) — list file names
- [ ] Measure current `ipc.ts` line count and map functions to domains
- [ ] List all Zustand stores used in component tests (for `storeMocks.ts`)

### Phase 2: D-002 and D-003 (Backend/Frontend)
- [ ] Rewrite command validation tests to use Tauri State test harness (D-002)
- [ ] Wrap `MasterStrip` in `React.memo` (D-003)
- [ ] Add re-render prevention test for `MasterStrip`

### Phase 3: D-007 and ipc.ts Split
- [ ] Create `src/hooks/useKnobDrag.ts`
- [ ] Replace inline knob drag logic in `BiquadBandControl` with `useKnobDrag`
- [ ] Replace inline knob drag logic in compressor threshold knob
- [ ] Replace any other knob drag duplicates
- [ ] Create `src/lib/ipc/` directory and domain modules
- [ ] Move all IPC functions from `ipc.ts` to domain modules
- [ ] Create barrel re-export `src/lib/ipc/index.ts`
- [ ] Delete old `src/lib/ipc.ts`
- [ ] Run `tsc --noEmit` — fix any import errors

### Phase 4: D-006 and Store Mocks
- [ ] Attempt WASM compilation of `biquad_magnitude` via `wasm-bindgen`; fall back to shared TS utility if needed
- [ ] Replace JS biquad math in `EqPanel.tsx` with WASM or shared TS utility call
- [ ] Create `src/test/storeMocks.ts` with mock factories for all major stores
- [ ] Update 3+ existing test files to use `storeMocks.ts`

### Phase 5: Validation
- [ ] Run `tsc --noEmit` — zero errors
- [ ] Run all tests — all passing, no regressions
- [ ] Run `npm run build` — bundle size unchanged or smaller
- [ ] Verify EQ curve rendering matches expected frequency response (visual check)

## Acceptance Criteria

- [ ] D-002: Tauri command validation tests call real command functions via `tauri::test` harness — no inline-logic-only tests
- [ ] D-003: `MasterStrip` is wrapped in `React.memo` — confirmed non-re-rendering in tests
- [ ] D-006: EQ frequency response curve computed by WASM function (or shared TS utility with test coverage) — JS duplicate deleted
- [ ] D-007: `useKnobDrag` hook exists at `src/hooks/useKnobDrag.ts` and is used by all knob components
- [ ] Sprint 28 debt: `src/lib/ipc.ts` deleted; `src/lib/ipc/index.ts` barrel export works — no existing imports broken
- [ ] Sprint 13 debt: `src/test/storeMocks.ts` exists and is used by at least 3 component test files
- [ ] `tsc --noEmit` passes; all tests pass; no bundle size regression

## Deferred Item Traceability

| Deferred ID | Description | Fix Location |
|-------------|-------------|--------------|
| D-002 | `commands.rs` validation tests call real command paths | `src-tauri/src/` test modules |
| D-003 | `MasterStrip` wrapped in `React.memo` | `src/components/mixer/MasterStrip.tsx` |
| D-006 | EQ biquad WASM extraction | `src/components/effects/EqPanel.tsx` + WASM crate |
| D-007 | `useKnobDrag` hook extraction | `src/hooks/useKnobDrag.ts` |
| Sprint 28 debt | `ipc.ts` split into domain modules | `src/lib/ipc/` |
| Sprint 13 debt | Shared store mock factory | `src/test/storeMocks.ts` |

## Notes

Created: 2026-04-07
D-002, D-003, D-006, D-007 are tracked in DEFERRED.md.
