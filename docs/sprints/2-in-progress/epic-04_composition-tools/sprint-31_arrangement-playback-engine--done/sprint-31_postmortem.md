# Sprint 31 Postmortem: Arrangement Playback Engine

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 31 |
| Started | 2026-03-15 |
| Completed | 2026-03-15 |
| Duration | ~2 hours |
| Steps Completed | 13 |
| Files Changed | 7 (2 new, 5 modified) |
| Tests Added | 11 Rust unit tests (scheduler) |
| Coverage Delta | +11 tests; all 359 Rust + 1065 TS passing |

## What Went Well

- Clean separation: `ArrangementScheduler` is fully self-contained with no Mutex or alloc on hot path
- `partition_point` for note cursor reset is O(log n) — elegant and allocation-free
- Immediate NoteOff for same-buffer notes avoids one-buffer latency for very short notes
- Frontend `syncScheduler()` pattern (fire-and-forget, catches errors in console) integrates cleanly with existing store actions
- 11 unit tests cover all meaningful scheduling paths without any audio hardware

## What Could Improve

- Loop-wrap detection relies on position decreasing, which works for transport loops but could false-trigger if seek is called mid-buffer by something other than the transport — could add an explicit `handle_loop_wrap()` API
- `register_scheduler_sender` is synth-only; multi-instrument routing (sampler, drum machine) would need separate commands
- `syncScheduler()` recomputes all notes on every single clip change — could diff and send only deltas for large arrangements

## Blockers Encountered

- `prev_position` was initialized to `0` and tracked buffer start rather than buffer end, causing the loop-wrap detection to fail when the loop point was also position `0`; fixed by tracking `buffer_end` instead
- NoteOff for notes entirely within one buffer wasn't firing in the same tick because the NoteOff scan (step 3) ran before NoteOn (step 4); fixed with an immediate NoteOff branch inside the NoteOn loop

## Technical Insights

- `swap_remove` is the right tool for `active_notes` removal — O(1) and order doesn't matter for NoteOff firing
- Loop-wrap detection by comparing `position < prev_position` is robust: the transport clock already performs loop-wrap internally, so the scheduler just observes the backward jump
- Pre-allocating `Vec::with_capacity(8192)` for notes means the SetNotes path allocates only once (the new vec), and the old vec drop is bounded
- `partition_point` on a sorted vec is the idiomatic no-alloc cursor reset

## Process Insights

- The Plan agent's recommendation to flatten notes into a single sorted `Vec<ScheduledNote>` (rather than per-clip `Vec`) was the right call — the global cursor + swap_remove approach is simpler and faster than per-clip iterators
- Frontend-side bar→sample conversion keeps the Rust command simple (just a channel send) and avoids needing to expose the project manager to scheduler commands

## Patterns Discovered

```rust
// Loop-wrap detection without an extra atomic: compare buffer start to previous buffer end
if is_playing && position < self.prev_position {
    self.stop_all_active();
    self.note_cursor = self.notes.partition_point(|n| n.on_sample < position);
}
self.prev_position = buffer_end; // track END, not start

// Avoiding borrow conflicts when firing NoteOn and pushing to active_notes:
let off_sample = self.notes[self.note_cursor].off_sample;
let pitch = self.notes[self.note_cursor].pitch;
// ... copy all fields ...
// now drop the notes borrow before mutable push to active_notes
if let Some(sidx) = sender_idx {
    self.send_note_on(sidx, pitch, velocity, channel);
    self.active_notes.push(ActiveNote { off_sample, sender_idx: sidx, pitch, channel });
}
```

## Action Items for Next Sprint

- [ ] Sprint 32 (MIDI File Import) — needs Sprint 11 piano roll + Sprint 12 patterns
- [ ] Multi-instrument arrangement routing: extend `register_scheduler_sender` or add `register_sampler_sender` / `register_drum_sender` commands when those instruments are used in tracks
- [ ] Wire `syncScheduler()` to BPM/time-signature changes in `transportStore` so sample positions stay accurate when tempo changes during arrangement playback
- [ ] Consider adding a `set_arrangement_clips` call on engine start so existing clips are scheduled if the engine restarts mid-session

## Notes

The hardest part was the two-level testing challenge: the scheduler itself is fully unit-testable (pure logic, channel-based), but the engine integration (callback closure) cannot be tested without audio hardware. The unit tests cover all scheduling edge cases; the integration relies on the existing ignored smoke tests pattern established in Sprint 2.
