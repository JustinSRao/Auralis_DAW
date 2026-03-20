# Sprint 16 Postmortem: Time Stretch & Pitch Shift

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 16 |
| Started | 2026-03-20 |
| Completed | 2026-03-20 |
| Duration | ~5 hours |
| Steps Completed | 14 |
| Files Changed | 20 files, 2574 insertions, 25 deletions |
| Tests Added | 37 (16 Rust unit tests, 21 TypeScript tests) |
| Coverage Delta | +37 tests across time_stretch, processed_cache, stretch_commands, StretchPanel, StretchPitchCommands |

## What Went Well

- Double-pass rubato pitch shift was the right call — avoided ~300 lines of STFT phase vocoder code while delivering acceptable quality for ±12 semitone range
- `ProcessedBufferCache` followed the `ClipBufferCache` pattern exactly (same LRU eviction, same type alias) — zero design decisions needed
- BPM match UI only (no detection) kept the sprint focused — user enters original BPM, backend computes ratio — cleaner and more reliable than onset detection
- `compute_bpm_stretch_ratio` as a pure synchronous command was simpler than an async detect operation and easier to test
- `#[serde(default)]` on `ClipData.stretch_ratio` and `pitch_shift_semitones` meant zero migration code — old project files load transparently
- Schema v1.3.0 bump was backwards-compatible: serde handles missing fields as `None` for old project files

## What Could Improve

- The test mocks for `WaveformEditor.test.tsx` and `WaveformToolbar.test.tsx` were missing the new `stretchRatio`, `pitchSemitones`, `isProcessing` state fields added to the store — test mock completeness should be checked whenever the store's shape changes
- The `StretchPanel` used `store.stretchRatio.toFixed(2)` without a null guard — if `stretchRatio` is `undefined` (stale mock), it crashes; using `(store.stretchRatio ?? 1.0).toFixed(2)` would be more defensive

## Blockers Encountered

- Test failures in `WaveformEditor.test.tsx` and `WaveformToolbar.test.tsx` due to incomplete mocks (`stretchRatio` undefined → `toFixed` crash). Fixed by adding `stretchRatio: 1.0`, `pitchSemitones: 0`, `isProcessing: false`, and the three new action mocks to both test files' `buildState()` helpers.

## Technical Insights

- **rubato double-pass pitch shift**: `freq_ratio = 2^(semitones/12)`. Pass 1: `apply_time_stretch(buffer, 1.0 / freq_ratio)` — changes duration but not pitch. Pass 2: resample from `(sample_rate * freq_ratio) → sample_rate` — restores original duration, shifting pitch as a side effect. Output frame count is zero-padded/truncated to exactly match input frame count.
- **ProcessedBufferCache key**: `f32::to_bits()` cast to `u32` as cache key avoids floating-point equality issues. Since the UI exposes controlled increments (0.01 steps), two logically-equal ratios will always produce bitwise-identical f32 values and thus identical keys.
- **Schema default fields**: `Option<f32>` with `#[serde(default)]` deserializes as `None` for any JSON object missing that key. No explicit migration entry is needed — serde handles it silently.

## Process Insights

- Checking for test mock completeness after adding store fields should be part of the implementation checklist — not just "write tests" but "update existing test mocks to match updated store shape"
- The plan agent correctly identified that rubato was already in Cargo.toml, that hound was already available for WAV writing, and that BPM detection was unnecessary complexity — all confirmed during clarification

## Patterns Discovered

```rust
// Double-pass rubato pitch shift (pitch-only, duration preserved)
fn apply_pitch_shift(buffer: &SampleBuffer, semitones: i8) -> Result<SampleBuffer, String> {
    let freq_ratio = 2.0_f32.powf(semitones as f32 / 12.0);
    // Pass 1: stretch duration by 1/freq_ratio (no pitch change)
    let stretched = apply_time_stretch(buffer, 1.0 / freq_ratio)?;
    // Pass 2: resample back, restoring duration (pitch shifts as side effect)
    let resampled = resample_to_frame_count(&stretched, buffer.frame_count)?;
    Ok(resampled)
}
```

```typescript
// Always add new store fields to ALL test mocks when store shape changes
function buildState(overrides = {}) {
  return {
    // ... existing fields ...
    stretchRatio: 1.0,       // Sprint 16 — must be included in all mocks
    pitchSemitones: 0,
    isProcessing: false,
    applyStretch: vi.fn().mockResolvedValue(undefined),
    applyPitch: vi.fn().mockResolvedValue(undefined),
    bakeToFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
```

## Action Items for Next Sprint

- [ ] Epic 5 (Audio Editing) is complete — next is Epic 6 (Mixer & Effects): Sprint 17 (Full Mixer)
- [ ] Consider making the waveform editor's stretch controls visible even when no processed buffer is cached (just showing the metadata values)

## Notes

Epic 5 (Audio Editing) is now complete with both Sprint 15 (Waveform Editor) and Sprint 16 (Time Stretch & Pitch Shift) done. Sprint 16 reused the `audio_editing` module, `ClipBufferCacheState`, and `hound` WAV writing infrastructure established in Sprint 15 — no new dependencies added.
