# Sprint 43 Postmortem: MIDI Export

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 43 |
| Started | 2026-03-19 |
| Completed | 2026-03-19 |
| Duration | ~1 session |
| Steps Completed | 13 |
| Files Changed | 10 files, +1423 insertions, -2 deletions |
| Tests Added | 16 Rust unit tests + 15 TypeScript component tests = 31 |
| Coverage | export.rs: 16 unit tests covering all public paths |

## What Went Well

- `midly 0.5` write path worked cleanly — no new crate dependency needed (Sprint 32 already added it)
- Stateless Rust pattern (frontend sends all data as IPC args) made the commands trivial and fully testable without Tauri managed state
- Sprint 41 (Tempo Automation) was complete, so the full tempo map integration was straightforward — no fallback path needed
- All 16 Rust tests passed first compile; all 853 TypeScript tests passed with no regressions
- `u28::max_value()` isn't a method in midly 0.5 — resolved by using `(1u64 << 28) - 1` literal

## What Could Improve

- Track display names are not available in `arrangementStore` (only trackId), so exported Type 1 files use trackId as the MIDI track name meta-event — a future sprint adding track name lookup could improve this
- The `ExportMidiDialog` pattern selector shows pattern IDs as fallback names when patterns have no display name in the content type

## Blockers Encountered

- None — all dependencies (Sprint 32 midly crate, Sprint 41 tempo map, Sprint 12 pattern notes in beat format) were already in place

## Technical Insights

- `Smf<'static>` works for all our MIDI events because `Tempo(u24)`, `TimeSignature(u8,u8,u8,u8)`, `EndOfTrack`, and `MidiMessage::NoteOn` contain no borrowed data — only variants like `TrackName(&[u8])` require a lifetime
- NoteOff is correctly encoded as `NoteOn { vel: 0 }` (universal MIDI convention), same as the import path uses
- At the same tick, NoteOff (vel=0) must sort before NoteOn (vel>0) to prevent stuck notes — achieved by secondary sort on velocity
- `beats_to_tick(duration, ppq).max(1)` correctly guards zero-duration notes without logging (clamping is silent, consistent with how import handles truncated notes)
- For Type 0 export: meta events (time sig, tempo points) and note events are merged into one absolute-tick list then sorted with meta-before-MIDI at the same tick, then converted to delta ticks in one pass

## Process Insights

- Clarification at step 1.3 resolved four ambiguities efficiently: dialog location, PPQ default, tempo map always vs optional, pattern trigger location
- The stateless IPC design (frontend passes all data) meant zero managed state for this feature — nothing to initialize in `lib.rs::setup()` beyond registering two commands

## Patterns Discovered

```rust
// Pure tick rescaling with rounding — enables isolated unit testing
pub fn rescale_tick(tick: u64, src_ppq: u16, dst_ppq: u16) -> u64 {
    if src_ppq == dst_ppq { return tick; }
    (tick * dst_ppq as u64 + src_ppq as u64 / 2) / src_ppq as u64
}

// Merging meta + MIDI events into one sorted list for Type 0 export:
// sort by tick, then meta before MIDI at same tick
abs.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| {
    let a_meta = matches!(a.1, TrackEventKind::Meta(_));
    let b_meta = matches!(b.1, TrackEventKind::Meta(_));
    b_meta.cmp(&a_meta) // meta (true) first
}));
```

## Action Items for Next Sprint

- [ ] Consider adding track name lookup in arrangement export (requires passing track names from DAW shell)
- [ ] Manual validation: export a pattern and re-import via Sprint 32 to verify round-trip

## Notes

Sprint 43 completes the MIDI round-trip: Sprint 32 handles inbound (import), Sprint 43 handles outbound (export). The `midly` crate now serves both directions. Epic 4 (Composition Tools) is now 11/12 sprints complete — only Sprint 44 (Loop Recording and Take Lanes) remains.
