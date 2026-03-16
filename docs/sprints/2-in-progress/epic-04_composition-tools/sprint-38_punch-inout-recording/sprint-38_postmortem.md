# Sprint 38 Postmortem: Punch In/Out Recording

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 38 |
| Started | 2026-03-16 |
| Completed | 2026-03-16 |
| Duration | ~1 session |
| Steps Completed | 13 |
| Files Changed | 20 (6 new, 14 modified) |
| Insertions | +1430 |
| Tests Added | 20 new (7 Rust unit + 5 TimeRuler + 9 punchStore + 6 TransportBar — plus 9 crossfade helpers within recorder.rs) |
| Coverage | All new logic covered; crossfade + PunchController::tick fully unit tested |

## What Went Well

- **Parallel agents worked cleanly**: Backend and frontend agents ran simultaneously with zero file conflicts — perfect file ownership separation from the plan.
- **Plan agent architecture call was correct**: Keeping `PunchController` off the audio thread (polled at 50 Hz from a Tokio task) avoided all audio-callback complexity. No mutex-across-await issues.
- **Quality review caught real bugs**: Both major issues (project persistence gap and BPM-change stale samples) were found and fixed before committing. The BPM stale-samples fix added only 5 lines to the watcher loop.
- **`#[serde(default)]` pattern worked cleanly**: Punch fields in `TransportSettings` and `TransportSnapshot` required zero schema migration — old projects load cleanly.
- **Existing patterns reused well**: Loop region pattern (beat-authoritative + derived sample values) directly guided the punch region design. Ctrl+drag mirrors Shift+drag for loop.

## What Could Improve

- **`npm run build` (tsc) has pre-existing errors** in test files that fail the production build check — these are not caused by this sprint but make the build gate unreliable. Should be cleaned up in a dedicated sprint or alongside another frontend sprint.
- **Pre-roll not implemented at runtime**: The `pre_roll_bars` field is scaffolded but inert. This was the right call for v1, but it should have been documented in the sprint file as a known gap up-front rather than discovered at quality review.

## Blockers Encountered

- None. All dependencies (Sprint 9 AudioRecorder, Sprint 36 MidiRecorder, Sprint 25 TransportAtomics) had clean public interfaces that composed without signature changes.

## Technical Insights

- **BPM-change detection in a watcher task**: Rather than adding a callback mechanism, the watcher reads `samples_per_beat_bits` from `TransportAtomics` each tick and compares to a cached `last_spb_bits`. When they differ, it calls `recalculate_samples()` on `PunchController`. Zero new synchronisation primitives needed.
- **`PunchController` owns its own sample positions**: The controller intentionally duplicates the punch sample positions from `TransportClock`. This lets the watcher task call `tick()` without taking the engine mutex. The two copies stay in sync via the SPB-change detection above.
- **Crossfade post-processing in the disk task**: Applying the fade ramp after the ring buffer is flushed (rather than in the audio callback) keeps the hot path unchanged and avoids any allocation risk. The 220-sample (~5 ms) ramp is applied by iterating the already-written WAV bytes before `finalize()`.
- **fileStore project load pattern**: All stores that have backend-side state (patterns, arrangement, automation, punch) must hook into `fileStore.open()` to restore their state. The quality review caught that punch was missing from this list — a gap to watch for in future sprints that add backend-persisted state.

## Process Insights

- **Quality review agent is worth every token**: Both major issues it found (persistence gap + BPM stale samples) would have been hard to debug at runtime. Running the review before commit is now clearly the right gate.
- **Sprint 9 arming question resolved instantly by reading TrackHeader.tsx**: Checking the file directly (2 grep hits) was faster than asking the user and waiting for a response. Use file search to answer "does X already exist?" before asking.

## Patterns Discovered

**BPM-change detection in a background polling task:**
```rust
let mut last_spb_bits: u64 = 0;
loop {
    interval.tick().await;
    let current_spb_bits = atomics.samples_per_beat_bits.load(Ordering::Relaxed);
    if let Ok(mut state) = state_mutex.lock() {
        if current_spb_bits != last_spb_bits {
            state.recalculate_from_spb(f64::from_bits(current_spb_bits));
            last_spb_bits = current_spb_bits;
        }
        // ... rest of poll logic
    }
}
```
Reusable any time a background task needs beat-position logic that must stay correct across BPM changes.

**fileStore project-load hook pattern (TypeScript):**
```typescript
// In fileStore.open(), after loading the project:
const myStore = useMyStore.getState();
void myStore.setFromProject(project.transport.my_field);
```
Every sprint that adds backend-persisted state must add a hook here. Check this list on every sprint that touches `TransportSettings` or `ProjectFile`.

## Action Items for Next Sprint

- [ ] Fix pre-existing `npm run build` (tsc) errors in test files — `AutomationRow.test.tsx`, `Timeline.test.tsx`, `RecordPanel.tsx`, `PatternBrowser.tsx`
- [ ] Implement actual pre-roll transport seeking when Sprint 41 (Tempo Automation) is complete — `PunchController.pre_roll_bars` is already scaffolded
- [ ] Wire MIDI punch recording in punch watcher task (currently logs a deferred message) — do this when Sprint 44 (Loop Recording) is underway
- [ ] Fix `TrackList.test.tsx` pre-existing `useTrackStore.getState is not a function` mock issue (10 failures)

## Notes

Sprint 9 (Audio Recording) was confirmed complete — it lives in `epic-03` which is in `3-done`. The track arm button from Sprint 9 was already present in `TrackHeader.tsx`, so no new UI was needed for arming.

MIDI punch recording was intentionally deferred — the punch watcher emits a `log::info!` for MIDI variants to make the deferred path visible in logs.
