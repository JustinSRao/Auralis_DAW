# Sprint 12 Postmortem: Pattern System

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 12 |
| Started | 2026-03-06 |
| Completed | 2026-03-07 |
| Duration | ~1 day (interrupted mid-sprint by credit expiry) |
| Steps Completed | 11 (all phases 1-4) |
| Files Changed | 19 files (6 new, 13 modified) |
| Rust Tests Added | 28 (pattern.rs: 6, pattern_commands.rs: 22, version.rs: 4 new) |
| TypeScript Tests Added | 35 (patternStore.test.ts: 23, PatternBrowser.test.tsx: 12) |
| Total Tests After Sprint | 305 Rust / 976 TypeScript — all passing |

## What Went Well

- **Stateless backend design** worked cleanly: Rust acts as pure validator/UUID generator; TypeScript `patternStore` is single source of truth. This eliminated the need for any Tauri managed state for patterns and kept the code simple.
- **Schema migration** was straightforward — bumping to v1.1.0 and injecting `patterns: []` for old projects required minimal code.
- **Piano Roll integration** was smooth — `openForPattern` / `updatePatternNotes` wired up without touching core Piano Roll canvas logic.
- **PatternBrowser** component came out clean: collapsible track groups, context menu, drag dataTransfer, toast for audio patterns — all in one self-contained file.
- **Test coverage** was comprehensive from the start; fixing the 5 test failures after resuming mid-sprint took ~30 mins total.

## What Could Improve

- **Mid-sprint interruption** (credit expiry) required a full context re-read at resume time. Sprint state file was stuck at step 2.1 even though all implementation was complete — state file was manually updated to reflect reality.
- **`vi.mock` hoisting pitfall**: Refactoring the `pianoRollStore` mock to use a top-level `const storeState = {}` broke tests because hoisted factories can't reference TDZ variables. Should always build state lazily inside inner functions.
- **`queryByText` vs `queryAllByText`**: Adding PatternBrowser to DAWLayout caused "multiple elements" errors in DAWLayout tests that used `queryByText(/no tracks/i)` — both TrackList and PatternBrowser rendered that text. Use `queryAllByText(...)[0]` when multiple matches are possible.

## Blockers Encountered

- **Credit expiry mid-sprint**: Implementation was ~90% done when credits ran out. Resuming required re-reading all modified files to reconstruct the context. No code was lost.
- **Windows charmap encoding**: `sprint_lifecycle.py generate-postmortem` fails with `charmap` codec error on Windows when printing Unicode checkmark characters. Postmortem was written manually as a workaround.

## Technical Insights

- **`vi.mock` factory hoisting rule**: Top-level `const` references inside `vi.mock(() => { const x = { val: topLevelSpy } })` are TDZ-unsafe. Always put spy references inside nested functions that are called lazily, not at the factory's outer scope.
- **`queryByText` throws on multiple matches**: In React Testing Library, both `getByText` and `queryByText` throw when multiple elements match — use `queryAllByText(...)[0]` to safely get the first match.
- **Zustand `Object.assign(vi.fn(), { getState: vi.fn() })`**: The correct pattern for mocking a Zustand store that has both selector call syntax AND `.getState()` static calls. Works because JS functions are objects.
- **PatternContent enum**: Using `#[serde(tag = "type")]` on the Rust enum maps cleanly to TypeScript's discriminated union `{ type: 'Midi' | 'Audio' }`. Zero-transform round-trip across the IPC boundary.
- **`camelCase` on `PatternMidiNote`**: Adding `#[serde(rename_all = "camelCase")]` to the Rust struct means the JSON fields match the TypeScript `MidiNote` type exactly — no transform needed when passing notes into the Piano Roll.

## Process Insights

- Sprint state file must be manually updated when implementation was done outside the normal sprint-next flow (e.g., after mid-sprint interruption and resume). The state file is authoritative for the workflow tooling.
- The "stateless backend, frontend is source of truth" pattern chosen for patterns is the right call for this project — it avoids duplicate state management and keeps Rust code simple and testable.

## Patterns Discovered

```rust
// Stateless Tauri command pattern: validate → return new entity or Ok(())
// Rust owns validation logic; TypeScript store owns in-memory state.
#[command]
pub fn create_pattern(track_id: String, name: String) -> Result<Pattern, String> {
    let name = name.trim().to_string();
    if name.is_empty() { return Err("Pattern name cannot be empty".to_string()); }
    Ok(Pattern::new_midi(name, track_id.trim().to_string()))
}
```

```typescript
// Zustand store mock with both selector and .getState() support
const storeFn = Object.assign(
  vi.fn((selector?) => {
    const state = buildState(); // lazy — spies resolved at call time, not hoist time
    return typeof selector === 'function' ? selector(state) : state;
  }),
  { getState: vi.fn(() => buildState()) },
);
```

## Action Items for Next Sprint

- [ ] Sprint 13 (Arrangement / Timeline): consume pattern drag events (`application/pattern-id` dataTransfer set in PatternBrowser)
- [ ] Wire `openForPattern` double-click to also update Piano Roll `notes` from `patternStore` on every open (currently loads once on double-click; re-opening same pattern should reload latest notes)
- [ ] Fix Windows charmap encoding in `sprint_lifecycle.py` (replace `print` calls using Unicode symbols with ASCII equivalents or set `sys.stdout` encoding)

## Notes

- `get_patterns_for_track` was specified as a Tauri command in the sprint spec but implemented as a pure frontend store selector (`getPatternsForTrack` in `patternStore`). This is correct given the stateless backend design — no behaviour was lost.
- The worktree at `.claude/worktrees/agent-a183415b/` contains stale test files from Sprint 30 that have a pre-existing `useTrackStore.getState is not a function` failure. This is Sprint 30 debt, not introduced by Sprint 12.
