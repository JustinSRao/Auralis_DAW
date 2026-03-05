# Sprint 8 Postmortem: Drum Machine

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 8 |
| Started | 2026-03-04 |
| Completed | 2026-03-04 |
| Duration | ~1 session |
| Steps Completed | 13 |
| Files Changed | 15 (9 new, 6 modified) |
| Tests Added | 36 (18 Rust unit tests, 18 TypeScript tests) |
| Coverage Delta | 236 Rust tests total / 444 TypeScript tests total passing |

## What Went Well

- **SamplerVoice reuse** was seamless — Sprint 7's voice abstraction composed cleanly into DrumPad with zero modifications required
- **Fixed-array architecture** worked perfectly: `[DrumPad; 16]`, `[[DrumStep; 32]; 16]`, `[SamplerVoice; 2]` — no heap allocation on audio thread
- **StepClock algorithm** is simple and correct: countdown-based instead of absolute sample position avoids drift on BPM changes mid-pattern
- **Shadow state pattern** (Tauri-side copy of pattern) made `get_drum_state` straightforward without adding lock contention to the audio thread
- **Optimistic UI updates with rollback** in the store follow the same pattern established in Sprint 7 — consistent and predictable
- **Quality review** caught three meaningful issues (modulo-by-zero, missing velocity rollback, 16 vs 32 step shadow init) before commit

## What Could Improve

- **Postmortem timestamps**: The state file `started_at` / `completed_at` weren't populated correctly (showed N/A) — need to ensure sprint lifecycle script records accurate timestamps
- **Swing test fragility**: The `test_swing_delays_odd_steps` test required two iterations to get right due to off-by-one on the `<=` boundary in `advance()` — the test strategy needed rethinking rather than just adjusting the threshold
- **`DrumMachinePanel` test coverage**: Some edge cases (velocity popover interaction, drag-drop file acceptance) are difficult to test in jsdom without more elaborate mocking; these were covered by behavior tests rather than interaction tests

## Blockers Encountered

- `next_step` field initially private — blocked `mod.rs` integration test that needed to inspect clock state. Fixed by making the field `pub`.
- `getByTitle` selector in DrumMachinePanel tests found multiple matching elements (all 16 pad drag targets had same title). Fixed by switching to `getAllByLabelText` with regex.

## Technical Insights

- **`samples_until_next <= remaining` (not `<`)**: The `<=` in the step clock advance loop means a step at exactly the buffer boundary fires in the current buffer, not the next. This is the correct musical behavior but requires care when writing boundary tests.
- **Swing on odd steps only**: Delaying odd-indexed 16th notes (1, 3, 5…) produces the classic triplet-feel shuffle. The swing offset is computed *for the next step* immediately after the current one fires — this means swing changes take effect one step later, which is musically acceptable.
- **`pattern_length.max(1)` guard**: Modulo-by-zero on the audio thread would be a hard crash with no recovery. Always guard division/modulo against zero even when the upstream logic "shouldn't" allow it.
- **Tauri event relay via Tokio task**: Audio thread → bounded channel → 4ms Tokio poller → `app_handle.emit()` is the right pattern for high-frequency events. Direct `emit()` from the audio callback would require async context and could block.
- **`default_for_idx(i, 32)` not 16**: The shadow state must be initialized to MAX_STEPS (32) even when the default pattern_length is 16. Otherwise `set_drum_step` commands for steps 16–31 silently no-op on the shadow while succeeding on the audio thread, causing state divergence.

## Process Insights

- The three-layer architecture (atomics for continuous params, channel for discrete commands, shadow for query) is now a mature pattern — applying it to the drum machine was mechanical once the pattern was understood from Sprint 6/7
- Quality review as a distinct phase (not inline during implementation) caught issues that are hard to see when writing code — especially the shadow-state initialization bug which required stepping back to see the full data flow

## Patterns Discovered

**Drum step clock pattern (countdown-based)**:
```rust
// In process(): advance clock, fire steps, render
let fired = self.clock.advance(buffer_len as u64, bpm, swing, sample_rate);
for step in fired.iter() {
    for (pad_idx, pad) in self.pads.iter_mut().enumerate() {
        let drum_step = self.pattern.steps[pad_idx][step as usize];
        if drum_step.active {
            pad.trigger(drum_step.velocity, sample_rate);
        }
    }
    let _ = self.step_tx.try_send(step);
}
```

**Relay task pattern (audio → UI events)**:
```rust
// In create_drum_machine command:
let app = app_handle.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_millis(4));
    loop {
        interval.tick().await;
        while let Ok(step) = step_rx.try_recv() {
            let _ = app.emit("drum-step-changed", step);
        }
    }
});
```

**Optimistic update with typed rollback**:
```typescript
async setStepVelocity(padIdx, stepIdx, velocity) {
  const prevVelocity = get().snapshot.pads[padIdx]?.steps[stepIdx]?.velocity;
  set(s => { s.snapshot.pads[padIdx].steps[stepIdx].velocity = velocity; });
  try {
    await setDrumStep(padIdx, stepIdx, current.active, velocity);
  } catch (err) {
    set(s => { s.snapshot.pads[padIdx].steps[stepIdx].velocity = prevVelocity; });
  }
}
```

## Action Items for Next Sprint

- [ ] Sprint 9: Drum machine should eventually share the master transport clock (Sprint 25) rather than its own BPM — wire up in a future sprint
- [ ] Sprint 9: Consider MIDI note output per pad step (sends MIDI to external gear when a step fires)
- [ ] Sprint 18+: Per-pad volume/pan/EQ controls
- [ ] Sprint 12: Pattern chaining / song mode to sequence multiple patterns

## Notes

Sprint 8 reused Sprint 7's SamplerVoice and decoder infrastructure almost verbatim — the main new work was the step clock, pattern data structure, and UI grid. The drum machine is self-contained with its own BPM control; future work should wire it to the master transport clock (Sprint 25) for DAW-synchronized playback.
