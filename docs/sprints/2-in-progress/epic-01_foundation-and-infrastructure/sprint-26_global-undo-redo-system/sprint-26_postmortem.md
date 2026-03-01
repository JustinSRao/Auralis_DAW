# Sprint 26 Postmortem: Global Undo/Redo System

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 26 |
| Started | 2026-02-28 |
| Completed | 2026-02-28 |
| Duration | 1 session |
| Steps Completed | 14 |
| Files Changed | 23 (13 new src files, 4 sprint planning docs, registry, packages) |
| Source Lines Added | ~1,200 (implementation + tests, excluding package-lock) |
| Tests Added | 67 test cases across 6 test files |
| Coverage | 81.84% statements, 86.68% branch, 80.95% functions (threshold: 80%) |
| Sprint 26 files coverage | 100% statements on all new files; HistoryPanel 95.45% branch |

## What Went Well

- **Parallel agents worked cleanly.** Product-engineer and quality-engineer wrote implementation and tests simultaneously with zero file conflicts — the file ownership map from the Plan agent was correct and watertight.
- **Plan agent caught a key architectural risk upfront.** The decision to keep `HistoryManager` as a module-level singleton outside Zustand state (so Immer never proxies Command objects) was identified during planning, not during debugging.
- **Zero test failures on first run.** 192/192 tests passed immediately after both agents completed — no iteration needed.
- **Implementation agent caught a real jsdom issue.** Switching from `document.activeElement` to `e.target.tagName` for the input guard was the right call for both correctness and testability — would have caused flaky tests if not caught.
- **`hidden` attribute vs conditional render** was another sharp catch — avoids `toBeVisible()` throwing on null in collapse tests.

## What Could Improve

- **`advance-step` requires separate calls.** Steps 2.1/2.2/2.3 could collapse into a single parallel phase advance since they all ran as one parallel block.
- **Quality engineer had one false positive** (flagged a missing TSDoc on `HistoryStoreState` that was already documented). Minor, but indicates the review prompt could be more precise about checking if a TSDoc exists above the declaration.
- **Sprint 40 move required manual file operation** because `sprint_lifecycle.py add-to-epic` only handles standalone sprints, not sprints already in an epic. A `move-epic` command would close this gap. [backlog]

## Blockers Encountered

- None during implementation.
- `sprint_lifecycle.py --help` failed on Windows due to a `cp1252` codec error when printing Unicode arrows (→) in the help text. Worked around with `PYTHONIOENCODING=utf-8`. [backlog]
- `sprint_lifecycle.py add-to-epic` cannot move a sprint between epics — only adds standalone sprints to epics. Required a manual file move + registry update.

## Technical Insights

- **Module-level singleton pattern for mutable external state in Zustand.** When you have a mutable class (like `HistoryManager`) that Immer must not proxy, declare it at module scope outside `create()`. Sync derived state back into the store after each mutation. This is the same pattern used for WebSocket connections and AudioContext instances in Zustand apps.
- **`MacroCommand` composite pattern is zero-cost to add.** Because `Command` is a simple interface with `execute/undo`, the composite pattern is just a class that holds an array and delegates. Future sprints get multi-step undo for free — paste 16 notes = one undo step.
- **Command objects must capture all state at construction time**, not at execute/undo time. `SetBpmCommand` stores `prevBpm` and `nextBpm` in the constructor — if it read from the store at execute/undo time, race conditions or state drift could produce wrong undo behavior.
- **`useHistoryStore.getState().clear()` is the correct singleton reset pattern for tests.** The `manager` singleton persists across test files, so `beforeEach` must call `clear()` through the store (which in turn calls `manager.clear()`). Do NOT try to import and reset the manager directly — it's not exported.

## Process Insights

- **Planning gate questions (Step 1.3) should be 3–4 max.** The Plan agent surfaced 7 questions; only 4 were genuine user decisions. Implementation details (e.g., "should we export `resetHistoryManager`?") should be resolved by the agent, not escalated.
- **Quality review is most useful as a targeted checklist** (specific criteria) rather than an open-ended code review. The structured criteria format (TypeScript / TSDoc / Architecture / Code Quality / Security / Integration) produced a tight, actionable report.
- **Circular dependency bugs in sprint planning files** (Sprints 11/12, 18/19/20/21) were caught during the pre-sprint audit. Worth doing a dependency audit at the start of each epic.

## Patterns Discovered

**Module-level singleton + Zustand sync pattern:**
```typescript
// For mutable external state that Immer must not proxy
const externalManager = new SomeMutableClass();

function syncFromManager(s: StoreState): void {
  s.derivedField1 = externalManager.field1;
  s.derivedField2 = externalManager.field2;
}

export const useStore = create<StoreState>()(
  immer((set) => ({
    derivedField1: initialValue,
    derivedField2: initialValue,
    action: () => { externalManager.mutate(); set(syncFromManager); },
  }))
);
```

**Command pattern for undo-able operations (future sprints):**
```typescript
import { Command } from '@/lib/history';
import { useHistoryStore } from '@/stores/historyStore';

class MyEditCommand implements Command {
  readonly label = `My Edit: ${this.prev} → ${this.next}`;
  constructor(
    private readonly apply: (v: T) => void,
    private readonly prev: T,
    private readonly next: T,
  ) {}
  execute(): void { this.apply(this.next); }
  undo(): void    { this.apply(this.prev); }
}

// Usage at call site:
useHistoryStore.getState().push(
  new MyEditCommand(store.setFoo, currentFoo, newFoo)
);
```

## Action Items for Next Sprint

- [ ] [sprint] Sprint 30 (DAW Shell) should wire `useHistoryStore.getState().undo()` in its global keyboard handler instead of adding a second `keydown` listener — coordinate in Sprint 30 planning.
- [ ] [backlog] `sprint_lifecycle.py`: add `move-epic <sprint> <from-epic> <to-epic>` command to handle inter-epic sprint moves without manual file operations.
- [ ] [backlog] `sprint_lifecycle.py`: fix `cp1252` codec error on Windows when printing help text with Unicode characters — use `sys.stdout.buffer.write(text.encode('utf-8'))` or set `PYTHONIOENCODING` in the script header.
- [ ] [backlog] Future sprints: unify the waveform editor undo stack (Sprint 15) with this global stack once both exist.
- [ ] [done] Circular dependency docs fixed in Sprints 12, 18, 19, 20 before this sprint started.
