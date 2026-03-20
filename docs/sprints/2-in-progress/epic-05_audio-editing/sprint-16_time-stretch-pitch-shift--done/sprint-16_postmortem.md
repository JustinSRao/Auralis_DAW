# Sprint 16 Postmortem: Time Stretch & Pitch Shift

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 16 |
| Started | 2026-03-20 |
| Completed | 2026-03-20 |
| Duration | ~6 hours |
| Steps Completed | 14 |
| Files Changed | 19 files, ~2100 insertions |
| Tests Added | 37 (16 Rust unit tests, 21 TypeScript tests) |
| Coverage Delta | +16 Rust tests across time_stretch, processed_cache, stretch_commands; +21 TS tests across StretchPitchCommands, StretchPanel |

## What Went Well

- rubato `FftFixedIn` resampling worked cleanly as the stretch engine — no external phase vocoder needed, rubato was already in `Cargo.toml` from Sprint 7
- Double-pass pitch shift (stretch by 1/freq_ratio, resample back to original length) gave clean transposition without duration change — elegant use of the same time-stretch primitive
- Separating `ProcessedBufferCache` from `ClipBufferCache` (Sprint 15) kept concerns clean: raw decode vs. processed results are distinct cache layers
- `StretchPanel` rendered entirely from `waveformEditorStore` — no prop drilling, consistent with how WaveformToolbar works
- `BakeStretchCommand` undo correctly restores both the clip AND removes the added sample reference — full round-trip correctness
- Schema migration for v1.2.0 → v1.3.0 (inject `stretch_ratio: null`, `pitch_shift_semitones: null`) followed the established migration table pattern exactly

## What Could Improve

- The double-pass pitch shift approach compounds latency from two rubato instances. A dedicated pitch-domain algorithm (phase vocoder or PSOLA) would give higher quality for large semitone shifts
- `ProcessedBufferCache` uses `Instant`-based LRU eviction with O(n) scan — fine for max 16 entries, but a proper LRU doubly-linked list would be better if the cache grows
- `bakeToFile` in `waveformEditorStore` uses a dynamic `import('./fileStore')` to avoid circular dependency — this is a code smell; a cleaner solution would be a dedicated project-query utility

## Blockers Encountered

- **rubato `process_partial` buffer-size panic**: Passing `Some(&[vec![], vec![]])` when there were zero remaining frames triggered rubato's internal `ch_padded.clear()` path producing a 0-size buffer, which caused a "Insufficient buffer size 0" error in `process_into_buffer`. Fixed by checking `remaining_len > 0` and using `None::<&[Vec<f32>]>` in the else branch.
- **Wrong resampling direction**: Initial implementation had `input_rate = sample_rate * ratio` and `output_rate = sample_rate`, which was reversed — `FftFixedIn(88200, 44100, ...)` halves frames instead of doubling them. Fixed to `input_rate = sample_rate`, `output_rate = sample_rate * ratio`.
- **Test buffer too small (one chunk)**: With exactly 4096 input frames (one chunk), the flush `process_partial(None)` produced a full latency-compensation chunk equal in size to the expected output, inflating the result 2× for ratio=2.0. Fixed by using 44100-frame test buffers (~10 chunks) so flush overhead is under 5%.
- **TypeScript `vi.mocked(setState).mockImplementation` type error**: Zustand's `setState` overload union type was incompatible with `(fn: s => void) => void`. Fixed by removing the redundant `beforeEach` reimplementations — the `vi.mock` factory already set up `setState` correctly.

## Technical Insights

- rubato direction rule: `FftFixedIn(input_rate, output_rate, chunk_size, sub_chunks, channels)` — to produce MORE frames (stretch), `output_rate > input_rate`. For ratio=2.0: `FftFixedIn(44100, 88200, ...)` produces 2× output frames.
- rubato flush pattern: always check `remaining_len > 0` before calling `process_partial(Some(...))`. When no remaining frames, use `process_partial(None::<&[Vec<f32>]>, None)` to get latency compensation samples only.
- rubato test buffer size: use at least 10× `chunk_size` frames in unit tests so flush overhead (one extra chunk) is diluted to under 10% of total output.
- Cache key float encoding: `f32::to_bits()` gives a deterministic integer representation of the float for use in HashMap keys — avoids floating-point comparison issues.
- `_bakedFilePath` convention: TypeScript `noUnusedLocals` is satisfied by the `_` prefix on private constructor params — cleaner than `void param` suppression.

## Process Insights

- Checking the rubato source (`process_partial_into_buffer`) to understand the `None` vs empty-vec distinction was essential — the API documentation alone wasn't enough to predict the buffer-size panic.
- The "one chunk" test failure was not obvious from the test failure message alone; reasoning about rubato's latency compensation mechanism was required to understand why 2× frames appeared.

## Patterns Discovered

```rust
// rubato flush: always pass None when remaining_len == 0 to avoid buffer-size panic
if remaining_len > 0 {
    let partial_input = vec![remaining_l, remaining_r];
    resampler.process_partial(Some(&partial_input), None)?;
} else {
    resampler.process_partial(None::<&[Vec<f32>]>, None)?;
}
```

```rust
// ProcessedBufferCache key with deterministic float encoding
pub fn cache_key(clip_id: &str, stretch_ratio: f32, pitch_semitones: i8) -> String {
    format!("{}::{}::{}", clip_id, stretch_ratio.to_bits(), pitch_semitones)
}
```

```typescript
// Zustand setState mock: set it once in vi.mock factory, don't re-mock in beforeEach
vi.mock('../../stores/fileStore', () => ({
  useFileStore: Object.assign(vi.fn(...), {
    setState: vi.fn((fn) => fn(mockFileStoreState)),
  }),
}))
```

## Action Items for Next Sprint

- [ ] Epic 5 complete — both sprints done. Move to Epic 6 (Mixer & Effects, Sprints 17–21)
- [ ] Consider upgrading double-pass pitch shift to a phase vocoder for higher quality large-interval transposition
- [ ] Address the `import('./fileStore')` dynamic import in `waveformEditorStore.bakeToFile` with a proper utility function

## Notes

Sprint 16 completes Epic 5 (Audio Editing). The two sprints in this epic (Sprint 15: Waveform Editor, Sprint 16: Time Stretch & Pitch Shift) together deliver a complete in-DAW audio editing workflow. Next focus is Epic 6: Mixer & Effects (Sprints 17–21, 37, 39, 42, 45).
