# Sprint 33 Postmortem: LFO Modulation Routing

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 33 |
| Started | 2026-03-05 |
| Completed | 2026-03-05 |
| Duration | ~8 hours |
| Steps Completed | 13 |
| Files Changed | 26 (1772 insertions, 227 deletions) |
| Tests Added | 30 (11 Rust unit tests, 19 TS component/store tests) |
| Coverage Delta | Rust: 261 total passing (+11); TS: 814 total passing (+19) |

## What Went Well

- Per-sample LFO ticking architecture was clean — only `lfo1_out`/`lfo2_out` updated inside loop, all other params read once per buffer
- `RenderParams` struct elegantly decouples the audio callback from atomic reads and from voice rendering — voice has no knowledge of atomics
- Sample&Hold via inline LCG (no `rand` crate) was the right call for audio-thread safety — stack-only, zero allocation
- `LfoParamsState { lfo1, lfo2 }` wrapper cleanly solved the Tauri single-type-per-managed-state constraint
- TransportAtomics injection pattern (`set_transport_atomics()` before stream start) reusable for any future instrument needing BPM
- Quality review caught the critical loop-invariant bug (M-1) early — `RenderParams` was being fully rebuilt per sample before refactor
- BPM sync formula (`(sample_rate / spb) / beats_per_cycle`) correctly maps beat divisions to Hz

## What Could Improve

- `sprint_lifecycle.py` has a character encoding issue on Windows (`charmap` codec fails on Unicode checkmarks) — every script call required `PYTHONIOENCODING=utf-8` prefix; should be fixed at the script level with `sys.stdout.reconfigure(encoding='utf-8')`
- `AskUserQuestion` tool repeatedly failed to accept the `questions` array parameter — fell back to inline text questions; this tool is unreliable and should be avoided
- Sprint state timestamps were not recorded (Started/Completed both show N/A) — the lifecycle script doesn't capture wall-clock time when advancing steps; consider adding timestamp on `start-sprint`
- Epic reorganization added scope to this sprint; would be cleaner as a separate maintenance task

## Blockers Encountered

- `AskUserQuestion` tool parameter validation kept rejecting `questions` as a JSON array — resolved by asking questions directly in assistant text output
- `PYTHONIOENCODING=utf-8` required on every Python script invocation — Windows `charmap` codec doesn't support the `✓` character in script output
- Edit tool refused to edit sprint files that had been moved via Bash (file not read at new path) — resolved by re-reading at new path before editing

## Technical Insights

- **Audio thread param read pattern**: Read all atomics once per buffer before the sample loop into a plain struct (`RenderParams`). Only update the fields that change per-sample (LFO output). This avoids 88 atomic reads per sample at 44100 Hz / 512 buffer.
- **BPM sync formula**: `rate_hz = (sample_rate / samples_per_beat) / beats_per_division`. Where `samples_per_beat = 60.0 / bpm * sample_rate`. Division values (1/4, 1/8, 1/16, 1/32) map to beats_per_division (1.0, 0.5, 0.25, 0.125).
- **LCG for S&H**: `state = state.wrapping_mul(1664525).wrapping_add(1013904223)` — standard Park-Miller constants, seeded by slot index, no `rand` crate needed. Output: `(state as f32 / u32::MAX as f32) * 2.0 - 1.0`.
- **Vibrato range**: `±2 semitones` at full depth. Formula: `ratio = (lfo_out * depth * 2.0 / 12.0).exp2()`. Applied as pitch ratio multiplier — preserves integer note frequency for zero depth.
- **Tauri managed state uniqueness**: Can only manage one value per Rust type. When needing two `LfoParams`, wrap in a named container struct.
- **`TransportAtomics` sharing**: Lifted from inside `build_and_start_stream` into Tauri state so instruments created via commands can access current BPM. Pattern: create before engine, inject via setter, manage as state.

## Process Insights

- The quality review step caught a real performance bug (RenderParams rebuilt inside sample loop) that automated tests would not catch — confirms value of code review phase
- Epic reorganization should be a dedicated maintenance task, not bundled with a feature sprint
- Phase reset on note-on (LFO retrigger) was not in original clarification questions but is standard DAW behavior — safe to include as a sensible default

## Patterns Discovered

**Per-buffer atomic snapshot + per-sample update:**
```rust
// Read all params ONCE before loop (no atomics on hot path)
let mut rp = RenderParams {
    volume: self.params.volume.load(Ordering::Relaxed),
    cutoff: self.params.cutoff.load(Ordering::Relaxed),
    lfo1_out: 0.0,  // updated per sample
    // ...
};
for i in 0..frames {
    rp.lfo1_out = self.lfo1.tick(lfo1_rate, sample_rate, lfo1_waveform);
    for voice in &mut self.voices {
        voice.render(&rp, &mut output[i]);
    }
}
```

**Tauri multi-param state wrapper:**
```rust
pub struct LfoParamsState {
    pub lfo1: Arc<LfoParams>,
    pub lfo2: Arc<LfoParams>,
}
// app.manage(LfoParamsState { lfo1: ..., lfo2: ... });
```

**LFO destination dispatch in voice render:**
```rust
match lfo1_dest {
    destination::PITCH => { ratio *= (rp.lfo1_out * rp.lfo1_depth * 2.0 / 12.0).exp2(); }
    destination::CUTOFF => { effective_cutoff *= 1.0 + rp.lfo1_out * rp.lfo1_depth; }
    destination::AMPLITUDE => { tremolo *= 1.0 - rp.lfo1_out.abs() * rp.lfo1_depth * 0.5; }
    destination::RESONANCE => { effective_res += rp.lfo1_out * rp.lfo1_depth * 0.3; }
    _ => {}
}
```

## Action Items for Next Sprint

- [ ] Fix `sprint_lifecycle.py` encoding: add `sys.stdout.reconfigure(encoding='utf-8')` at top of script
- [ ] Investigate `AskUserQuestion` tool parameter validation failure — may need different JSON schema format
- [ ] Sprint 8 (Drum Machine) is done but Epic 3 still has 3/5 completedSprints — verify registry count is accurate after sprint 33 moves to done
- [ ] Next up in Epic 3: Sprint 6 (Subtractive Synth) done, Sprint 7 (Sampler) done, Sprint 8 (Drum Machine) done, Sprint 9 (Audio Recording) done, Sprint 33 (LFO) done — Epic 3 may be complete; check _epic.md

## Notes

This sprint also included an epic reorganization pass covering Epics 3–10. Sprints 37, 38, 44, and 45 were reassigned to correct epics based on dependency analysis. Registry.json and all affected _epic.md files were updated in the same commit.
