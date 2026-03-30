# Sprint 19 Postmortem: Reverb & Delay Effects

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 19 |
| Started | 2026-03-30 |
| Completed | 2026-03-30 |
| Duration | 1 session |
| Steps Completed | 12 |
| Files Changed | 14 (9 created, 5 modified) |
| Tests Added | 57 Rust unit tests + 30 TypeScript tests |
| Coverage | All new DSP code covered; 1017/1017 TS tests passing |

## What Went Well

- Freeverb architecture mapped cleanly to Rust structs — `CombFilter`, `AllpassFilter`, `DelayLine` primitives were simple and composable
- `AudioEffect` trait promotion from `eq/mod.rs` to `effects/mod.rs` was clean with zero regressions on existing EQ tests
- Pre-planned architecture (from Plan agent) eliminated all back-and-forth during implementation
- BPM infrastructure from Sprint 2 (`TempoMapSnapshotState`) was exactly what was needed for delay tempo sync — no new plumbing required
- Buffer allocation pattern (allocate in `new()`, never in audio callback) enforced correctly throughout

## What Could Improve

- Ping-pong test had an off-by-one error on the expected echo window (checked 1×delay_samples instead of 2×) — the two-hop nature of ping-pong feedback should be documented more clearly in the struct
- vitest `node_modules` were corrupted (missing JS files, only .d.ts present) — required full `rm -rf node_modules && npm install` to fix; unrelated to sprint but cost time

## Blockers Encountered

- None sprint-related. Node modules corruption required a clean reinstall before TS tests could run.

## Technical Insights

- Freeverb's per-sample loop reads `room_size` and `damping` atomics once per **buffer** (not per sample), then uses scalar locals inside the loop — this is the correct pattern for lock-free parameter reads on the audio thread
- `DelayTimeMode` tagged-union serde: `#[serde(tag = "mode")]` + `rename_all = "snake_case"` produces `{"mode":"ms","ms":250}` which matches the TypeScript discriminated union perfectly — verified with round-trip tests
- The ping-pong feedback crosses channels at the **write** stage, not the read stage — the wet output at any given frame reflects the **previous** delay period's crossed content, so echo appears at 2×delay_samples in the right channel when only the left has input

## Process Insights

- Pre-start requirement review (checking Sprint 17 insert slots, BPM access) saved significant implementation time — no surprises during coding
- Plan agent's Freeverb delay line lengths (with stereo spread) were accurate and required zero correction

## Patterns Discovered

```rust
// Buffer-boundary atomic read pattern — prevents per-sample atomic overhead
fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
    // Read params once per buffer, not per sample
    let room_size = self.atomics.room_size.load(Ordering::Relaxed);
    let wet = self.atomics.wet.load(Ordering::Relaxed);
    for i in 0..n {
        // Use the scalar locals, not atomics, in the hot path
    }
}
```

```rust
// Lifetime annotation for HashMap get_or_create pattern
fn get_or_create<'a>(store: &'a mut StoreInner, id: &str, sr: f32) -> &'a mut Effect {
    store.entry(id.to_owned()).or_insert_with(|| Effect::new(sr))
}
```

## Action Items for Next Sprint

- [ ] Sprint 20 (Compression & Dynamics): follow same `AudioEffect` trait pattern; Compressor will need `AtomicF32` for threshold, ratio, attack, release — same atomic bundle approach as reverb
- [ ] Sprint 21 (Effect Chain): `AlgorithmicReverb` and `StereoDelay` are ready to drop into `Vec<Box<dyn AudioEffect>>` — both implement the trait correctly

## Notes

Sprint 19 had zero dependency issues — Sprint 17 (mixer), Sprint 18 (EQ/AudioEffect trait), and Sprint 2 (BPM) all provided exactly the surfaces needed. The `AudioEffect` trait relocation was the only structural change to existing code and it compiled cleanly.
