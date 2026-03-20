# Sprint 41 Postmortem: Tempo Automation

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 41 |
| Started | 2026-03-19 |
| Completed | 2026-03-19 |
| Duration | ~1 session |
| Steps Completed | 13 |
| Files Changed | 28 (1806 insertions, 27 deletions) |
| Rust files changed | 10 |
| TypeScript files changed | 14 |
| Tests Added | 10 Rust (tempo_map module) + 10 TypeScript (tempoMapStore + TempoTrack) |
| Rust tests | 418 passing, 0 failed |
| TS tests | 838 passing, 0 failed |

## What Went Well

- **Pure-logic core isolation** — `tempo_map.rs` as a pure math module with no I/O made it fully unit-testable and easy to reason about. All 10 tests passed first run.
- **Plan agent thoroughness** — the architecture plan caught the need for the exact logarithmic integral (vs. trapezoid approximation) before implementation began, preventing a subtle discontinuity bug.
- **Quality review caught real blockers** — 4 genuine blockers were identified and fixed: `unwrap()` safety, channel latest-wins semantics, PPQN mismatch, and silent `setBpm` no-op.
- **Backward compatibility preserved** — `set_bpm` IPC command and `apply_set_bpm` shim kept working; project files migrate cleanly from v1.1.0 via `#[serde(default)]`.
- **Node.js PATH issue resolved** — fnm installed and configured for both PowerShell and Git Bash shells during the sprint, unblocking TS test runs going forward.

## What Could Improve

- **PPQN constant divergence was a preventable bug** — `tempo_map.rs` was written with 960 PPQ while the rest of the DAW uses 480 PPQ. A project-wide `TICKS_PER_BEAT` constant (in a shared `constants.rs`) would have caught this at compile time. Consider centralising it in Sprint 43 or a future refactor.
- **Worktree test pollution** — Vitest was picking up tests from `.claude/worktrees/` stale directories, causing false failures. Fixed by adding an `exclude` to `vitest.config.ts`, but this should have been in the config from the start.
- **Cumulative table used trapezoid; queries used exact integral** — the build initially used the trapezoid approximation for cumulative sample offsets while per-segment queries used the exact logarithmic integral, making `tick_to_sample` discontinuous at Linear segment boundaries. Caught in quality review and fixed, but ideally caught in planning.

## Blockers Encountered

- **B-1**: `unwrap()` in production audio-thread code (`bpm_at_tick`, `tick_to_sample`) — replaced with safe index access.
- **B-2**: `bounded(1)` channel with `try_send` silently dropped the latest map when the slot was full — switched to `unbounded()` + drain-all loop on the audio thread (latest-wins semantics).
- **B-3**: `TICKS_PER_BEAT` was 960 in `tempo_map.rs` and `TempoTrack.tsx` but 480 everywhere else in the DAW — unified to 480 PPQ, updated affected tests.
- **B-4**: `setBpm` in `transportStore` silently no-opped when >1 tempo point existed — now always updates the tick-0 anchor point regardless of point count.

## Technical Insights

- **Logarithmic integral for linear BPM ramps**: when BPM varies linearly over ticks, `samples_per_tick(t) = sr*60 / (bpm(t)*TPB)` is not linear — it's `1/bpm(t)`. Integrating this analytically requires `(sr*60/TPB) * (delta_ticks/(bpm_b-bpm_a)) * ln(bpm_b/bpm_a)`. The trapezoid approximation is only valid for Step segments.
- **Cumulative table must use the same formula as per-segment queries** — otherwise `tick_to_sample` is discontinuous at segment boundaries. Consistent use of the exact integral in both `build()` and `tick_to_sample()` ensures continuity.
- **Unbounded channel + audio-thread drain loop** is the correct "latest-wins" pattern for tempo map updates. `bounded(1) + try_send` loses the latest update when the slot is full; `unbounded + drain-all + apply-last` never drops updates and is still safe since maps are small.
- **`samples_per_beat_bits` as the bridge**: writing the instantaneous SPB to `TransportAtomics` on every `advance()` call means MetronomeNode, StepSequencer, AutomationEngine, and LFO all get variable-tempo support for free without any changes to those modules.

## Process Insights

- **Quality review before commit is essential** — the review caught 4 real bugs that would have shipped silently. The PPQN mismatch in particular would have caused subtle timing drift affecting the automation engine.
- **The "drain-then-apply-last" audio pattern** is now established for any future module that needs latest-wins delivery to the audio thread without blocking. Document it for reuse in Sprint 43 (MIDI Export) or other audio-thread integrations.

## Patterns Discovered

**Latest-wins channel delivery to audio thread:**
```rust
// Main thread: unbounded send (never blocks)
let _ = tx.send(Box::new(new_value));

// Audio thread: drain all pending, apply only last
let mut latest: Option<Box<T>> = None;
while let Ok(v) = rx.try_recv() { latest = Some(v); }
if let Some(v) = latest { apply(*v); }
```

**Tick-safe last-point access (no unwrap):**
```rust
// Instead of points.last().unwrap()
let last = &points[points.len() - 1]; // safe: build() guarantees non-empty
```

**Cumulative table consistency rule:**
> The `build()` method must use the same per-segment formula as the query methods. Any divergence (e.g. trapezoid in build, exact integral in query) produces discontinuities at segment boundaries.

## Action Items for Next Sprint

- [ ] Add a shared `constants.rs` or re-export `TICKS_PER_BEAT` from `transport.rs` so all modules reference one definition — prevents future PPQN divergence
- [ ] Fix W-3: loop/punch boundary recomputation should use `tempo_map.tick_to_sample(beats * TICKS_PER_BEAT)` not instantaneous SPB — affects loop playback accuracy with variable tempo
- [ ] Fix W-5: add try/catch + error field to `tempoMapStore` mutations so drag failures surface in the UI
- [ ] Add `.claude/worktrees/**` to `vitest.config.ts` exclude list in the project template so future sprints don't hit the same pollution issue (already fixed here)
- [ ] Sprint 43 (MIDI Export): export tempo map as SMF tempo change events — `TempoMapSnapshotState` is the source of truth

## Notes

- `effects/delay.rs` stub created with `tempo_sync_delay_samples` API surface — Sprint 19 will implement the full DSP.
- Project schema bumped to v1.2.0; migration tested for v1.0.0 → v1.1.0 → v1.2.0 chain.
- The `set_bpm` Tauri command is kept as a backward-compat shim but is now effectively dead code from the UI path — `setBpm` in `transportStore` routes through `tempoMapStore.setPoint(0, bpm, 'Step')` instead.
- `TransportBar` BPM input becomes read-only when >1 tempo point exists, directing users to the TempoTrack canvas for editing.
