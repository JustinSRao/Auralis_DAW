# Sprint 6 Postmortem: Subtractive Synthesizer

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 6 |
| Started | 2026-03-02 |
| Completed | 2026-03-02 |
| Duration | ~1 session |
| Steps Completed | 14 |
| Files Changed | 19 production files (2,187 net insertions) |
| Tests Added | 15 Rust + 28 TypeScript = 43 new tests |
| Rust Tests Total | 189 pass, 0 fail, 10 ignored (hardware) |
| TS Tests Total | 379 pass, 0 fail |

## What Went Well

- **Full signal chain working first try** — MIDI note-on → DSP voice → audio output integration
  was architected cleanly enough that there were no integration surprises.
- **Plan agent quality** — the architecture plan was detailed enough to guide implementation
  directly, covering biquad coefficients, ADSR state machine, voice stealing, and MIDI routing
  without needing revision.
- **Audio thread safety held** — zero heap allocations, zero locks in the hot path; the
  `[SynthVoice; 8]` fixed array and `Arc<AtomicF32>` param pattern worked exactly as intended.
- **All 43 tests written and passing in one pass** — DSP unit tests caught edge cases (phase
  wrap, envelope retrigger, filter denormals) before integration.
- **Quality review PASS, no blockers** — both critical rules (no `unwrap`, no alloc on audio
  thread) were satisfied on first submission.

## What Could Improve

- **Voice age semantics bug caught in review** — the per-sample `age++` inside `voice.render()`
  conflicted with the note-on timestamp set by `global_age`. Caught by quality review but should
  have been caught earlier by unit tests (test checked stealing worked, not the exact age value).
- **`Record<string, number>` cast** — the TypeScript store used a type assertion instead of
  direct typed index access. Small issue, caught in review and fixed before commit.
- **SynthPanel click interaction test missing** — the quality review flagged that clicking a
  waveform button and asserting `setParam("waveform", 1)` was not tested. This is the primary
  user interaction path and should have an explicit assertion.
- **AskUserQuestion answers not captured** — the clarification step (1.3) returned empty
  answers; fell back to documented recommended defaults which were correct, but the UX gap
  should be noted.

## Blockers Encountered

- None. All dependencies (Sprint 2 AudioNode trait, Sprint 3 MIDI event types) were in place
  and the implementation proceeded without blocking issues.

## Technical Insights

- **Biquad Direct Form II Transposed is the right choice** for a DAW synth filter — O(1) per
  sample, 5 multiplies + 4 adds, numerically stable in f32, supports resonance via Q parameter.
  State-variable filter would give better self-oscillation but biquad is simpler to implement
  correctly.
- **Lazy coefficient recompute pattern** — caching `last_cutoff` and `last_resonance` on the
  filter struct and only recomputing when they change by more than epsilon avoids `sin`/`cos`
  on every sample while remaining responsive to knob automation.
- **Denormal flushing is required** — IEEE 754 denormals in filter state variables (`s1`, `s2`)
  cause 10–100x slowdown on x86. Flushing below `1e-25` costs nothing audible and prevents
  CPU spikes during silence.
- **`secondary_tx` fan-out on MidiManager** — adding an `Arc<Mutex<Option<Sender<...>>>>` to
  `MidiManager` for instrument MIDI routing was cleaner than a tokio polling task. The fan-out
  happens inside the midir callback itself via `try_send`, keeping latency minimal.
- **`setPointerCapture` is mandatory for knobs** — without it, dragging the cursor quickly off
  the SVG element drops the drag event. This is a common gotcha that must be applied to every
  draggable UI element.
- **Naive waveform aliasing is acceptable for v1** — audible above ~4–6 kHz for saw/square,
  gives the synth a characteristic "digital" sound. PolyBLEP anti-aliasing deferred to a future
  sprint.

## Process Insights

- **Implementation order matters for DSP** — building primitives (oscillator → envelope → filter
  → voice → synth) and testing each layer before integration prevented silent bugs from being
  masked by higher-level code.
- **Quality review as a gate caught two real issues** — both the voice age conflict and the
  type assertion would have been silent at runtime but were code quality problems. The structured
  review checklist paid off.
- **Postmortem generation script needs timestamp wiring** — `started_at` / `completed_at` showed
  as N/A because the state file doesn't populate those fields from the sprint YAML. Minor
  workflow tooling gap.

## Patterns Discovered

**Biquad filter coefficient caching pattern (avoid recompute every sample):**
```rust
pub fn process(&mut self, sample_rate: f32, cutoff: f32, resonance: f32, input: f32) -> f32 {
    if (cutoff - self.last_cutoff).abs() > 0.01 || (resonance - self.last_resonance).abs() > 0.0001 {
        self.compute_coefficients(sample_rate, cutoff, resonance);
    }
    // Direct Form II Transposed per-sample update ...
}
```

**Fixed-size voice pool with LRU stealing (no heap alloc on audio thread):**
```rust
voices: [SynthVoice; 8],  // Stack-allocated, no Vec
global_age: u64,          // Monotonic counter, stamped on note-on

fn steal_voice(&mut self) -> usize {
    self.voices.iter().enumerate()
        .filter(|(_, v)| v.note.is_some())
        .min_by_key(|(_, v)| v.age)
        .map(|(i, _)| i)
        .unwrap_or(0)  // safe: only called when all 8 are active
}
```

**Filter envelope modulation (exponential, 4-octave sweep):**
```rust
let modulated_cutoff = (cutoff * (env_amount * filter_env_level * 4.0).exp2())
    .clamp(20.0, 20_000.0);
```

**MidiManager secondary_tx fan-out for instrument routing:**
```rust
// In midir callback — called from WinMM thread, try_send never blocks
if let Some(tx) = secondary_tx.try_lock().ok().and_then(|g| g.clone()) {
    let _ = tx.try_send(event.clone());
}
```

## Action Items for Next Sprint

- [ ] Add waveform-selector click interaction test to `SynthPanel.test.tsx`
  (`click "SQR" → verify setParam("waveform", 1)`)
- [ ] Consider PolyBLEP anti-aliasing for saw/square oscillators in a future sprint
  (low priority — aliasing is aesthetically acceptable for v1)
- [ ] Note `useTrackStore.getState is not a function` pre-existing mock gap in Sprint 30
  tech debt (add `getState: vi.fn(...)` to TrackList test mock when fixing Sprint 30 debt)
- [ ] Next: Sprint 7 (Sample Player / Sampler) — shares AudioNode trait with Sprint 6,
  MIDI routing already established, filter/envelope patterns reusable

## Notes

Sprint 6 is the first instrument sprint and proves the full signal chain works end-to-end.
The architecture established here (fixed voice pool, AtomicF32 params, secondary_tx MIDI
fan-out) is the template for all subsequent instrument sprints (7, 8, 9, 33).
