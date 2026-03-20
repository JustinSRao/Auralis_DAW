# Sprint 10 Postmortem: Step Sequencer

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 10 |
| Started | 2026-03-06 |
| Completed | 2026-03-06 |
| Duration | ~1 session |
| Steps Completed | 12 |
| Files Changed | 12 (1785 insertions, 142 deletions) |
| Tests Added | 22 (12 Rust unit tests, 10 React component tests) |
| Coverage Delta | All new sequencer code covered |

## What Went Well

- Parallel backend/frontend agents completed cleanly with zero overlap issues
- DrumMachine as template made SequencerClock implementation fast and correct
- LCG PRNG reuse from `lfo.rs` — no new deps, proven pattern
- Quality review caught two real bugs before commit (SwapGraph eviction, note-off overwrite)
- 12/12 Rust tests and 10/10 React tests passing on first integration

## What Could Improve

- `create_sequencer` silently skips instrument wiring if synth isn't initialized yet — should log a warning
- `snapToState` uses TypeScript `as` casts for `pattern_length` and `time_div` without runtime validation

## Blockers Encountered

- Quality review identified that `SwapGraph` in `create_sequencer` evicted the instrument from the audio graph — the sequencer would send MIDI but no audio would be produced. Fixed by introducing `AudioCommand::AddNode` to append the sequencer to the existing graph in place (Vec pre-allocated with capacity 8 to avoid audio-thread alloc).
- Windows terminal encoding (charmap codec) blocks `✓` character in lifecycle scripts — harmless, worked around with `PYTHONIOENCODING=utf-8`.

## Technical Insights

- `AudioCommand::AddNode` is a clean extension point: pre-allocate `Vec::with_capacity(8)` in `AudioGraph::new`, then `Vec::push` on the audio thread never reallocates. The `triple_buf.read()` returns `&mut AudioGraph` so the node is appended to the live graph without a full swap.
- Multi-step buffer note-off: when BPM is high or buffer size large, two steps can fire in one `process()` call. The single `pending_note_off` field must flush the previous note before setting a new one — otherwise notes stick. Fixed with `take()` + immediate `send_note_off` before each new `NoteOn`.
- LCG PRNG (`state = state * 1_664_525 + 1_013_904_223`) maps cleanly to 0–100 via `(state as u64 * 100 / u32::MAX as u64) as u8 < probability`. Boundary conditions: 0% always returns false, ≥100% always returns true — no modulo bias at boundaries.
- Time division formula: `step_duration = (60 / bpm / (time_div / 4)) * sample_rate`. Using `time_div / 4` as factor makes quarter note (div=4) = 1 beat exactly, matching musical convention.

## Process Insights

- Plan agent's architectural analysis (reading DrumMachine clock.rs, mod.rs, commands.rs before writing) saved significant time — implementation was straightforward because the template was clear.
- Quality review as a dedicated agent step caught the SwapGraph architectural bug and the note-off overwrite bug, both of which would have been silent runtime failures.
- Clarification questions upfront (UI placement, default route, popover vs sub-rows) prevented back-and-forth during implementation.

## Patterns Discovered

**AudioCommand::AddNode pattern** — append a node to the live graph without full swap:
```rust
// Pre-allocate nodes Vec to avoid audio-thread realloc
nodes: Vec::with_capacity(8),

// Command variant
AddNode(node) => {
    if let Some(graph) = triple_buf.read() {
        graph.add_node(node);  // no alloc if len < capacity
    }
}
```

**Multi-fire note-off flush** — before any NoteOn, flush pending note-off:
```rust
if let Some((prev_note, _)) = self.pending_note_off.take() {
    self.send_note_off(prev_note);
}
self.send_note_on(note, velocity);
self.pending_note_off = Some((note, gate_samples));
```

## Action Items for Next Sprint

- [ ] Sprint 11 (Piano Roll Editor) — next in Epic 4; depends on sequencer patterns established here
- [ ] Consider adding a `log::warn!` in `create_sequencer` when synth_midi_tx is None
- [ ] Runtime validation for `pattern_length` and `time_div` casts in `snapToState` (sequencerStore.ts)

## Notes

The sequencer routes to the synth by default. When the user wants to target the sampler or drum machine, a future sprint should add an instrument selector dropdown to the panel header. For Sprint 10 the default-to-synth behavior is sufficient.
