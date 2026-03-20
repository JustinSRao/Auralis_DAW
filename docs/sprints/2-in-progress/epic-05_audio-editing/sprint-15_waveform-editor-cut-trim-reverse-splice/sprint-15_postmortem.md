# Sprint 15 Postmortem: Waveform Editor (Cut, Trim, Reverse, Splice)

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 15 |
| Started | 2026-03-20 |
| Completed | 2026-03-20 |
| Duration | ~5 hours |
| Steps Completed | 14 |
| Files Changed | 20 files, 3309 insertions, 2 deletions |
| Tests Added | 28 (14 Rust unit tests, 14 TypeScript tests) |
| Coverage Delta | +28 tests across peak_cache, waveform_editor, WaveformEditor, WaveformToolbar, WaveformEditCommands, waveformEditorStore |

## What Went Well

- `compute_peaks()` pure function design paid off: easy to test, no side effects, called from cache layer only
- Reusing `decode_audio_file()` and `SampleBuffer` from Sprint 7's sampler kept Rust code DRY — no re-implementing WAV decode
- `hound` was already in `Cargo.toml` (from Sprint 9 audio recorder), so `write_reversed_region()` used it directly with no new deps
- `ClipBufferCache` with LRU eviction (max 8 entries) keeps memory bounded for large projects
- `drawFnRef` pattern from Timeline carried over perfectly to WaveformEditor canvas — no stale closure issues
- Global history stack integration (Sprint 26) worked cleanly: `CutClipCommand`, `TrimClipCommand`, `ReverseClipCommand` all implement `Command` with synchronous execute/undo
- Double-click on audio clip opening pattern is consistent with PianoRoll (double-click MIDI clip)

## What Could Improve

- `WaveformEditCommands` operate directly on `fileStore.currentProject` — this is tighter coupling than ideal; a dedicated `clipStore` would be cleaner
- Peak data re-request on zoom change is debounced at 150ms but still triggers a Rust round-trip; a purely client-side zoom (rescaling existing peaks) could feel more responsive for coarse zoom changes
- Reverse operation currently replaces the entire clip with a new file; partial-region reverse that keeps the original file is architecturally cleaner but deferred (would require non-contiguous segment metadata)

## Blockers Encountered

- None significant. `hound` availability confirmed before deciding on WAV write strategy (would have needed a minimal manual WAV writer otherwise).

## Technical Insights

- Peak cache key pattern: `"{file_path}::{frames_per_pixel}"` — when invalidating, remove all entries with matching `file_path` prefix using `retain(|k, _| !k.starts_with(path))`
- LRU eviction by `Instant`: store `(Arc<SampleBuffer>, Instant)` tuples; on insert when full, find entry with minimum `Instant` and remove. Simple O(n) scan is fine for max 8 entries.
- `write_reversed_region` output: assemble full clip (pre-region unchanged, region reversed, post-region unchanged) into one WAV — makes the reversed clip self-contained and independent of the original file
- Reverse operation splices the reversed region into a full standalone file, so `start_offset_samples = 0` and `duration_beats` are unchanged — clean metadata model

## Process Insights

- Plan agent correctly identified that `hound` was already available before implementation started — checking Cargo.toml for available crates upfront prevents late surprises
- Full-screen modal overlay (same as PianoRoll) was the right UX decision — consistent, no timeline layout changes needed

## Patterns Discovered

```rust
// Peak cache prefix invalidation pattern
pub fn invalidate(&mut self, file_path: &str) {
    self.entries.retain(|k, _| !k.starts_with(file_path));
}
```

```typescript
// Command pre-compute pattern: expensive IPC before Command construction,
// Command itself is synchronous execute/undo
const result = await ipcComputeCutClip(clipData, cutFrame, samplesPerBeat);
const cmd = new CutClipCommand(trackId, result.removedClipId, result.clipA, result.clipB);
historyStore.getState().push(cmd);  // calls cmd.execute() synchronously
```

## Action Items for Next Sprint

- [ ] Sprint 16: Time Stretch & Pitch Shift — builds on the `ClipBufferCache` and `audio_editing/` module from this sprint
- [ ] Consider a dedicated `clipStore` to decouple waveform edit commands from `fileStore.currentProject` access

## Notes

`hound` was confirmed available (already a dependency from Sprint 9 Audio Recording). The waveform editor is the first component in Epic 5 (Audio Editing); Sprint 16 (Time Stretch & Pitch Shift) is the second and final sprint in this epic.
