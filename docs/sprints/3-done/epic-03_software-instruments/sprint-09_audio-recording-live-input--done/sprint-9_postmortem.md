# Sprint 9 Postmortem: Audio Recording (Live Input)

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 9 |
| Started | 2026-03-04 |
| Completed | 2026-03-04 |
| Duration | ~1 session |
| Steps Completed | 13 |
| Files Changed | 16 (6 new, 10 modified) |
| Tests Added | 28 (10 Rust unit tests, 18 TypeScript tests) |
| Coverage | 248 Rust tests / 782 TypeScript tests passing |

## What Went Well

- **Ring buffer architecture** translated cleanly from design to code: `HeapRb::split()` gave `(HeapProducer, HeapConsumer)` that moved naturally into their respective thread owners (input callback → producer, Tokio disk task → consumer, output callback → monitoring consumer)
- **WASAPI-only input decision** was correct and caught a real edge case during quality review (M-1) — `find_input_device` was using `default_host()` which would return ASIO on affected systems
- **Quality review caught 6 meaningful issues**: monitoring per-sample loop, silent final-drain write errors, stale monitoring channel, store state rollback bug, listener leak, and ASIO host bug — all fixed before commit
- **Pattern reuse**: `disk_write_task` followed the same relay pattern as the drum machine's step event relay; RMS poller followed the transport state poller pattern

## What Could Improve

- **Plan agent worktree**: The worktree agent wrote files to disk but they already existed in main (from a previous session). Worktree usage was redundant here.
- **`disk_write_task` polling**: 10ms sleep loop uses a Tokio worker thread for the entire recording duration. A `tokio::sync::Notify`-based design would be more efficient (deferred M-2).
- **AudioRecorder sample rate**: Hardcoded to 44100 at construction time in `lib.rs` — should read from engine config.

## Blockers Encountered

- `DAWLayout.test.tsx` crashed after `RecordPanel` was added to the layout because `inputDevices` resolved to `undefined` via the unmocked `invoke`. Fixed with `(inputDevices ?? [])` defensive guard in `RecordPanel`.

## Technical Insights

- **WASAPI-explicit input**: On ASIO-installed systems, `cpal::default_host()` returns ASIO which doesn't enumerate input devices. Always call `wasapi_host()` for recording input stream.
- **Ring buffer producer in audio callback**: `HeapProducer<f32>` is moved into the cpal input callback closure. Once inside, it's owned by the cpal audio thread — no sharing needed.
- **Monitoring ring capacity**: 4096 samples (~46ms at 44100Hz) — small enough for low latency, large enough to absorb output callback timing variation.
- **`hound::WavWriter::finalize()`**: Writes the RIFF chunk sizes. Without calling it, the file is unplayable. Must be called even if write errors occurred (to get a diagnostic).
- **`cancelled` flag pattern**: Solves the async listener cleanup race — `Promise.all().then()` runs after component unmount if promises resolve late.

## Process Insights

- Quality review as a distinct phase remains the most effective defect-finding step — the per-sample loop (C-1) and store rollback bug (H-3) would be very hard to catch in code review.
- Two-mutex sequential locking in `start_recording` command (recorder lock → engine lock) creates a latent deadlock risk. Documented as M-4; enforce lock ordering by convention.

## Patterns Discovered

**WASAPI-explicit input enumeration**:
```rust
pub fn find_input_device(name: &str) -> Result<cpal::Device> {
    let host = wasapi_host()?; // never default_host() — may return ASIO
    let devices = host.input_devices()?;
    // ...
}
```

**Stack-buffer bulk-push for gain scaling in audio callback**:
```rust
let mut tmp = [0.0f32; 2048]; // stack-allocated, no heap alloc
let len = data.len().min(tmp.len());
for (dst, &src) in tmp[..len].iter_mut().zip(data.iter()) {
    *dst = src * gain;
}
let _ = mon_prod.push_slice(&tmp[..len]);
```

**Stale one-shot channel drain before re-use**:
```rust
let _ = self.monitoring_cons_rx.try_recv(); // drain stale from previous session
let _ = self.monitoring_cons_tx.try_send(mon_cons);
```

**React Tauri listener cleanup with cancelled flag**:
```typescript
useEffect(() => {
    let cancelled = false;
    listen("event", handler).then(unlisten => {
        if (cancelled) { unlisten(); return; }
        unlistenRef.current = unlisten;
    });
    return () => { cancelled = true; unlistenRef.current?.(); };
}, []);
```

## Action Items for Next Sprint

- [ ] Wire `AudioRecorder` sample rate to match the engine's configured rate (not hardcoded 44100)
- [ ] Sprint 15 (Audio Editing): move recorded WAV from temp dir into project's `audio/` folder on save
- [ ] Sprint 38 (Punch In/Out): add armed state to `AudioRecorder` that waits for transport play
- [ ] Consider `tokio::sync::Notify` instead of 10ms sleep loop in `disk_write_task`

## Notes

No new Cargo crates beyond `hound` and `ringbuf` — both were already in the plan. `uuid` was already a project dependency. The monitoring design (two ring buffers, `SetMonitoringConsumer` AudioCommand) is extensible to multi-channel monitoring in future sprints.
