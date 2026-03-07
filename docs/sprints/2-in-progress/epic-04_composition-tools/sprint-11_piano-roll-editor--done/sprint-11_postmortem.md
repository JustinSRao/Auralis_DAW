# Sprint 11 Postmortem: Piano Roll Editor

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 11 |
| Started | 2026-03-06 |
| Completed | 2026-03-06 |
| Duration | 1 session |
| Steps Completed | 14 |
| Files Changed | 22 (3,264 insertions, 3 deletions) |
| Tests Added | 135 (58 utils, 52 hook/command, 25 component) |
| Rust Tests | 273 passing (0 new failures) |
| TS Tests Total | 941 passing |

## What Went Well

- Plan agent produced an exceptionally thorough design: coordinate system math, mouse state machine, virtualization strategy, undo/redo integration, and Rust command design all spec'd before a single line was written
- Two-canvas architecture (static grid + dynamic note layer) correctly identified up-front — avoids expensive full redraws on every note drag
- Test coverage for pure functions (`pianoRollUtils`) was comprehensive (58 tests) and caught edge cases like `getVisibleNotes` pitch-range math early
- `drawNoteCanvasRef` pattern (ref to current draw function) correctly solved the stale-closure bug that would have caused drag redraws to show blank canvases — caught in quality review before shipping
- Rust `preview_note` command cleanly reuses the existing `SynthMidiTxState` channel with silent no-op if no instrument loaded

## What Could Improve

- Implementation agent did not write test files on first pass — required a separate agent invocation. Tests should be written in the same pass as source files
- Canvas null-check pattern (`getContext('2d') === null`) needs to be documented as a project standard for all future canvas components — jsdom will throw without it in tests

## Blockers Encountered

- Agent hit usage limit mid-implementation and required resume — no code loss, resume worked cleanly

## Technical Insights

- **Stale closure bug pattern**: `useCallback` with `[]` deps capturing a function that itself changes identity (because it has its own deps) creates a silent stale-closure bug. Fix: store the inner function in a `useRef` and update it via `useEffect`; outer callback always calls `ref.current()`.
- **Canvas testing in jsdom**: `HTMLCanvasElement.prototype.getContext` throws "not implemented" in jsdom. Override with `() => null` in `beforeAll` to prevent test crashes; source code already null-checks `ctx`.
- **`setPointerCapture` for drag**: All future canvas drag interactions must use `onPointerDown` + `canvas.setPointerCapture(e.pointerId)` — not mouse events. Pointer events are captured even when the pointer leaves the element.
- **Virtualized rendering formula**: `n.startBeats + n.durationBeats >= minBeat && n.startBeats <= maxBeat` — the first clause is crucial; notes that start before the viewport but extend into it must still render.
- **`try_send().ok()` in audio-adjacent commands**: For Rust commands that send to bounded channels, `try_send().ok()` is the correct pattern — silently drops if channel is full rather than blocking or panicking.

## Process Insights

- Quality review agent caught the stale-closure blocker that would have been a confusing runtime bug — the QA pass is non-negotiable even on "frontend-only" sprints
- Separating tests into 3 focused files (utils / hook+commands / component) made failures much easier to diagnose than a single large test file

## Patterns Discovered

**`drawNoteCanvasRef` pattern for stable canvas callbacks:**
```typescript
const drawNoteCanvasRef = useRef<() => void>(() => {});
useEffect(() => { drawNoteCanvasRef.current = drawNoteCanvas; }, [drawNoteCanvas]);
const requestRedraw = useCallback(() => {
  requestAnimationFrame(() => drawNoteCanvasRef.current());
}, []); // stable identity — no deps
```

**Canvas component null-check template:**
```typescript
const ctx = canvasRef.current?.getContext('2d');
if (!ctx) return;
// ... draw
```

**Piano roll coordinate system (960 PPQ, beat-based):**
```typescript
// All time stored in beats (not ticks) — simpler math, tick = beat * 960
beatToX(beat, vp) = beat * vp.pixelsPerBeat - vp.scrollX
pitchToY(pitch, vp) = (127 - pitch) * vp.pixelsPerSemitone - vp.scrollY
snapBeat(beat, quantDiv) = Math.round(beat / (4/quantDiv)) * (4/quantDiv)
```

## Action Items for Next Sprint

- [ ] Sprint 12 (Pattern System): wire `pianoRollStore.setNotes()` / `getNotes()` to pattern clip data when a pattern is double-clicked
- [ ] Fix Sprint 30 tech debt: `useTrackStore.getState is not a function` in `TrackList.test.tsx` — add `getState: vi.fn(...)` to the mock
- [ ] Add `HTMLCanvasElement.prototype.getContext = () => null` override to `src/test/setup.ts` globally so future canvas tests don't need it in `beforeAll`

## Notes

Sprint 11 is the primary composition UI — subsequent sprints (12 Pattern System, 13 Timeline, 14 Automation) all build on or around the piano roll. The decoupling from Sprint 12 (notes stored ephemerally in `pianoRollStore`, not in clip data yet) was the right call — it let the UI ship and be tested independently.
