# Sprint 25 Postmortem: Transport & Tempo Engine

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 25 |
| Commit | `7896e83` |
| Steps Completed | 14 |
| Files Changed | 17 files (+3039 / -172 lines) |
| Rust Tests Added | 31 (24 transport + 7 metronome) |
| TS Tests Added | 55 (28 TransportBar + 22 transportStore + 5 DAWLayout) |
| Total Tests After | 145 Rust + 122 TypeScript (all passing) |

## What Went Well

- **Audio thread safety held throughout** — TransportClock as a plain stack-allocated
  struct on the audio thread made RT-safety easy to reason about; no unsafe code needed
  beyond the existing `AudioEngine` `Send/Sync` impl.
- **`try_lock` snapshot pattern worked cleanly** — writing the snapshot inside a
  `try_lock` guard (skip-if-contended) prevented any blocking on the audio thread
  while keeping the 60fps poller simple.
- **Event-driven UI sync** — the `transport-state` Tauri event + only-emit-on-change
  pattern gave the UI a clean, low-coupling path to real-time updates without polling.
- **Test isolation via command routing** — routing `mockInvoke` by command name in
  `beforeEach` solved the async `refreshState()` race condition cleanly without needing
  `waitFor` everywhere.

## What Could Improve

- **Missing commands caught late** — `transport_record` and `transport_seek` were
  implemented on the audio thread but their Tauri commands and IPC wrappers were not
  added until the quality review phase. A checklist: "every `AudioCommand` variant needs
  a Tauri command + IPC wrapper" would catch this earlier.
- **`type="number"` BPM input subtlety** — jsdom normalizes "120.0" → "120" in number
  inputs, which broke a test. Switching to `type="text"` with `inputMode="decimal"` is
  the correct DAW pattern anyway (we want exact decimal display, not browser spin
  controls), but this should be the default choice from the start.

## Blockers Encountered

- **`TrySendError` / `PoisonError` don't implement `StdError`** — `.context()` from
  `anyhow` failed at compile time for these types. Fix: use
  `map_err(|e| anyhow::anyhow!("...: {}", e))` instead. Now a known pattern for all
  future command channels.
- **`let mut clock` in audio closure** — the TransportClock needed `let mut` so the
  `move` closure could call `&mut self` methods. Easy fix once the borrow checker
  reported it, but adds a step to the audio callback setup checklist.
- **Stop/pause button tests disabled by `refreshState()`** — tests that set store state
  to "playing" before render had it overwritten by the `useEffect` → `refreshState()`
  → `invoke("get_transport_state")` path returning the `beforeEach` mock's default
  (stopped). Fix: override the mock per-test to return the playing snapshot.

## Technical Insights

- **BPM-preserving position change**: when BPM changes, convert current sample position
  to beats (`beat_pos = pos / old_spb`), then back (`new_pos = beat_pos * new_spb`).
  This keeps the musical position (bar/beat) stable while the sample position shifts.
  Apply the same recalculation to loop region endpoints.
- **Loop wrap logic**: after advancing the clock, check `loop_enabled &&
  loop_end > loop_start && position >= loop_end`, then reset to `loop_start`. This
  must happen after advancing, not before, to avoid double-triggering.
- **Metronome beat detection**: `current_beat_index = position_samples / spb as u64`.
  Trigger the click burst when `current_beat_index != last_beat_index`. Initialize
  `last_beat_index = u64::MAX` so the very first beat always fires. Timing jitter ≤
  one buffer period (≈5.8 ms at 256 frames / 44100 Hz) — acceptable for a metronome,
  but exact-sample triggering would require per-sample loop processing.
- **Tauri event mock**: `@tauri-apps/api/event` must be mocked in `src/test/setup.ts`
  (`vi.mock`) for any component that calls `listen()`. Without it, tests hang or error
  on the unresolved promise.

## Process Insights

- Quality review agent caught `TransportSeek` / `TransportRecord` dead-code gap and the
  loop region invariant violation — worth running on every sprint before commit.
- The "route mockInvoke by command name" pattern should be the standard `beforeEach`
  template for any component that calls `refreshState()` or similar on mount.

## Patterns Discovered

**Routing `mockInvoke` by command name (prevents mount-time mock exhaustion):**
```typescript
mockInvoke.mockImplementation((cmd: string) => {
  if (cmd === "get_transport_state") return Promise.resolve(defaultSnapshot);
  return Promise.resolve(undefined);
});
```

**Per-test playing-state override (for stop/pause button tests):**
```typescript
const playingSnap = { ...defaultSnapshot, state: "playing" } as const;
useTransportStore.setState({ snapshot: playingSnap });
mockInvoke.mockImplementation((cmd: string) => {
  if (cmd === "get_transport_state") return Promise.resolve(playingSnap);
  return Promise.resolve(undefined);
});
```

**`try_lock` non-blocking snapshot write:**
```rust
fn try_write_snapshot(&self) {
    if let Ok(mut snap) = self.snapshot.try_lock() {
        // fill fields — if contended, skip; audio thread never blocks
    }
}
```

**`map_err` for non-`StdError` types in anyhow context:**
```rust
tx.try_send(cmd).map_err(|e| anyhow::anyhow!("Channel full: {}", e))?;
mutex.try_lock().map_err(|e| anyhow::anyhow!("Mutex poisoned: {}", e))?;
```

## Action Items for Next Sprint

- [ ] Sprint 26 (Undo/Redo): depends only on Sprint 1 — can start now
- [ ] Sprint 30 (DAW Shell & Track Management): depends on Sprint 1 — can start now
- [ ] Transport seek UI: `transport_seek` command exists; wire a clickable timeline ruler when the timeline component is built (Sprint 10+)
- [ ] Exact-sample metronome timing: replace beat-boundary detection with per-sample loop if sub-buffer timing accuracy is needed

## Notes

- `transport_record` requires `set_record_armed(true)` first; the audio thread's
  `apply_record()` is a no-op if `!record_armed`. The record arm workflow (track
  selection → arm → record) will be fleshed out in Sprint 15 (Audio Recording).
- Tech debt acknowledged from quality review: `to_string()` on the state enum inside
  `try_lock` is a heap alloc on the audio thread. Low frequency (~60/s, not per-buffer),
  acceptable for now; resolve by storing state as enum and converting only in the poller
  when a future performance pass is warranted.
