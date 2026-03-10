# Sprint 13 Postmortem: Song Timeline & Playlist

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 13 |
| Started | 2026-03-10 |
| Completed | 2026-03-10 |
| Duration | 1 session |
| Steps Completed | 13 |
| Files Changed | 21 (11 new, 10 modified) |
| Lines Added | +2,529 / -10 |
| New TS Tests | 72 (41 coord unit, 20 store, 11 component smoke) |
| New Rust Tests | 23 (5 arrangement.rs + 18 arrangement_commands.rs) |
| Total Tests Passing | 327 Rust + 1,038 TS |

## What Went Well

- **Three-canvas architecture** landed cleanly — ruler / clips / playhead-overlay separation makes each layer independently maintainable and mirrors the Piano Roll pattern from Sprint 11.
- **Stateless Rust command pattern** from Sprint 12 carried over perfectly: Rust assigns UUIDs and validates, TypeScript store is source of truth. Zero managed Rust state.
- **`#[serde(default)]`** on `ProjectFile::arrangement` meant zero migration logic needed — old project files deserialize cleanly with no migration function.
- **Optimistic drag** with `revertClipOptimistic` on IPC error gives smooth drag with crash-safe rollback.
- **`timelineCoords.ts`** kept all coordinate math testable as pure functions — 41 unit tests run in <1ms each.
- **Cross-track drag** (vertical pointer delta → trackIndexDelta) added no meaningful complexity over same-track drag.
- **Clarification gate produced clear decisions**: 4 questions (snap, cross-track, loop UX, layout) each had real architectural impact and prevented rework cycles.

## What Could Improve

- **Subagent Write/Edit tool permissions**: Both Backend and Frontend parallel agents failed to create files — had to implement sequentially in the main agent, losing the parallelism benefit. Need a different dispatch strategy for file-creating agents.
- **`DAWLayout.test.tsx` fragility**: Every new component mounted in DAWLayout requires a new store mock in its test. A shared mock factory file would reduce this recurring per-sprint tax.
- **`TrackList.test.tsx` Sprint 30 debt**: Pre-existing `useTrackStore.getState is not a function` failure surfaces every sprint and will only get louder. Should be fixed in a dedicated cleanup.
- **Hardcoded sample rate**: `samplesToBar` in `Timeline.tsx` hardcodes 44100 Hz. Should be read from `TransportSnapshot` once the engine exposes it.

## Blockers Encountered

- Parallel subagents could not create new files (Write/Edit tools not available in their subprocess permission scope). Resolved by implementing directly in the main conversation agent.

## Technical Insights

- **`drawFnRef` pattern is essential for 30Hz overlays**: Store the draw function in a `useRef` (updated by `useEffect` when viewport changes), call `ref.current()` directly from the transport event listener. Avoids stale closures AND avoids React re-renders. Standard pattern for any real-time canvas overlay.
- **`setPointerCapture` on `onPointerDown` is mandatory for canvas drag**: Without it, fast cursor movement off the canvas loses `pointerMove` events, causing stuck clip positions.
- **`vi.clearAllMocks()` breaks `listen` mock**: The global `setup.ts` mock for `listen` is cleared when `vi.clearAllMocks()` runs in `beforeEach`. Tests mounting components that call `listen` must re-apply `vi.mocked(listen).mockResolvedValue(() => {})` after clearing.
- **`#[serde(default)]` is the correct pattern for additive ProjectFile fields**: Adding `Default` impl + `#[serde(default)]` attribute gives free backward compatibility with zero migration code. Simpler than the explicit migration path used for v1.1.0.

## Process Insights

- **Plan agent output was production-quality**: The type definitions, mouse state machine, file ownership map, and coordinate system spec from the Plan agent were implementable directly with minimal interpretation.
- **Sequential implementation worked fine given constraints**: Rust → TypeScript → Tests in the main agent was ~20% slower than intended parallel execution, but context switching between Rust and TypeScript is fast enough that total wall-clock time was acceptable.
- **Clarification gate 100% hit rate**: All 4 questions had direct impact on implementation (snap grain → `Math.floor` everywhere; cross-track → Y-delta in drag handler; Shift+drag → ruler handler branch; layout → DAWLayout mount point). No question was wasted.

## Patterns Discovered

- **`drawFnRef` + transport event** `[pattern]` — ref-based 30Hz canvas updates without React re-renders. See `PlayheadOverlay.tsx` + `Timeline.tsx`. Candidate for `knowledge/patterns/real-time-canvas.md`.
- **`#[serde(default)]` for additive schema fields** `[pattern]` — add new optional Rust struct fields with `Default` impl and `#[serde(default)]` for free backward compatibility. No migration function needed.
- **Canvas layer separation by update frequency** `[pattern]` — slow/static (ruler, redraws on zoom/scroll) + medium/data (clips, redraws on store changes) + fast/live (playhead, redraws at transport Hz). Three stacked `<canvas>` elements, each sized identically to the container.

## Action Items for Next Sprint

- [ ] `[backlog]` Fix `TrackList.test.tsx` Sprint 30 debt (`useTrackStore.getState is not a function`)
- [ ] `[backlog]` Create shared store mock factory to reduce per-sprint DAWLayout test setup tax
- [ ] `[backlog]` Read sample rate from `TransportSnapshot` instead of hardcoding 44100 in `Timeline.tsx`
- [ ] `[pattern]` Document `drawFnRef` real-time canvas pattern in `knowledge/patterns/`
- [ ] `[sprint]` Sprint 14 (Automation Editor) can begin — depends on Sprint 13; timeline canvas available
- [ ] `[sprint]` Sprint 31 (Arrangement Playback Engine) can begin — `arrangementStore.clips` now available

## Notes

Sprint 13 was the largest single-sprint canvas implementation so far: 2,529 lines across 21 files. The three-layer canvas architecture and coordinate utility module provide a clean foundation for Sprint 14's automation lanes, which will add automation curve lanes below each track row. The `arrangementStore` clip placement data is also immediately consumable by Sprint 31's playback engine.
