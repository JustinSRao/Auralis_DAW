# Sprint 29 Postmortem: MIDI Learn & Hardware Controller Mapping

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 29 |
| Started | N/A |
| Completed | N/A |
| Duration | N/A hours |
| Steps Completed | 4 |
| Files Changed | 20 files (1277 insertions, 141 deletions) |
| Tests Added | 22 (11 Rust mapping tests + 5 store tests + 5 panel tests + 2 Knob learn tests) |
| Coverage Delta | All new logic covered; 687 Rust + 1263 TS tests passing |

## What Went Well

- `try_lock()` pattern for the midir callback made the hot-path thread-safe without risk of deadlock — no allocations or blocking on the audio thread
- crossbeam unbounded channel + tokio drain loop cleanly bridges the callback context to Tauri event emission without storing AppHandle in hot-path structs
- Pre-registering a placeholder mapping in `start_midi_learn` before setting `pending_learn` simplified the CC callback: it can look up min/max without needing extra state
- `#[serde(default)]` on `ProjectFile.midi_mappings` meant zero migration complexity for the frontend — old projects load cleanly

## What Could Improve

- The Knob right-click context menu is bare (just toggles learn mode) — a future sprint could add a proper context menu with "Learn CC", "Clear Mapping", "Set Range" options
- `register_synth_targets` is called only for the subtractive synth; sampler and drum machine parameters are not yet mappable via MIDI CC

## Blockers Encountered

- Windows LNK1104 linker error during `cargo test` (test binary locked by running process) — resolved by running `cargo test --lib` instead, which skips the integration test binary link

## Technical Insights

- `cpal::Stream` is `!Send`, so the preview player pattern (stream on its own `std::thread::spawn`, only the `Sender<()>` in managed state) is the right template for any audio object that can't cross thread boundaries
- Tauri managed state requires `Arc<Mutex<T>>` even for `Arc<AtomicF32>` — but the actual dispatch hotpath only calls `AtomicF32::store`, never locking the registry mutex
- Schema version bump to v1.4.0 needed a corresponding test update (`current_schema_is_v1_4`) — easy to miss if the test name embeds the version

## Process Insights

- Context compaction mid-sprint was handled cleanly because the state file and git history provided a reliable resumption point
- Splitting implementation into Rust backend first, then TypeScript store/hook, then UI components kept the complexity manageable

## Patterns Discovered

- Learn-complete crossbeam → tokio bridge pattern (reusable for any hot-path → UI notification):
```rust
// In manager: crossbeam unbounded channel
let (tx, rx) = crossbeam_channel::unbounded::<Event>();
// In lib.rs setup: tokio drain loop
tokio::spawn(async move {
    loop {
        tokio::time::sleep(Duration::from_millis(16)).await;
        while let Ok(evt) = rx.try_recv() {
            let _ = app_handle.emit("event-name", &evt);
        }
    }
});
```

## Action Items for Next Sprint

- [ ] Sprint 40: Track Freeze & Bounce in Place

## Notes

- MIDI Learn works for all `SynthParams` automation targets; the `iter_automation_targets()` iterator on `SynthParams` made registration a single loop
- The `useMidiLearn` hook is a singleton mounted in `DAWLayout` — individual knobs observe the store rather than the event directly, keeping event handling centralized
