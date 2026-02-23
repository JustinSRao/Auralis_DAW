# Sprint 3 Postmortem: MIDI I/O System

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 3 |
| Started | 2026-02-23 12:12 |
| Completed | 2026-02-23 12:30 |
| Duration | ~0.3 hours |
| Steps Completed | 13 |
| Files Changed | 14 (1,572 insertions, 9 deletions) |
| Rust Tests Added | 37 (30 parser + 7 manager) |
| TypeScript Tests Added | 15 (9 store + 6 component) |
| Total Tests | 70 Rust / 45 TypeScript (all passing) |

## What Went Well

- **Clean pattern reuse**: The MidiManager followed the same `Arc<Mutex<>>` + crossbeam + Tauri command pattern as AudioEngine from Sprint 2. No new architectural decisions needed for thread communication.
- **midir was already in Cargo.toml**: Added during Sprint 1 scaffold, so no dependency management overhead.
- **MIDI byte parser was trivial to test**: Pure function, no hardware needed, 100% coverage of message types with roundtrip verification.
- **Hot-plug scanner worked first try**: Simple 2-second poll with `AtomicBool` stop flag. No OS-level notification complexity.
- **Quality review caught real bugs**: `expect()` in setup (should be `?`), silent error swallowing in `enumerate_all()`, and stale persistence of connection state.

## What Could Improve

- **Linker lock on Windows**: `cargo test` fails when the app's `.exe` is locked by another process. Had to use `cargo test --lib` as a workaround. Should investigate killing stale processes or using a different test target.
- **act() warnings in React tests**: Both AudioSettingsPanel (pre-existing) and MidiSettingsPanel tests emit React `act()` warnings due to async `useEffect` calls. Should establish a pattern for mocking stores in component tests to prevent this debt from growing.

## Blockers Encountered

- **None**: Sprint 3 had zero blockers. All dependencies (Sprint 1/2) were complete, midir and crossbeam were already available, and loopMIDI was installed before starting.

## Technical Insights

- **Tauri 2 requires `use tauri::Emitter;`** to call `.emit()` on `AppHandle`. This is a Tauri 2 breaking change from Tauri 1 where `emit` was a method directly on `AppHandle`.
- **midir connections are `!Send`**: Same as cpal::Stream. The `unsafe impl Send/Sync` pattern from Sprint 2 applies here too. Windows WinMM backend is safe to move between threads.
- **NoteOn velocity 0 = NoteOff**: MIDI convention that many controllers use instead of sending explicit 0x80 NoteOff messages. Parser handles this correctly.
- **Pitch bend is 14-bit signed**: Two 7-bit bytes combined, center at 8192, range -8192..+8191. Easy to get the byte ordering wrong (LSB first).

## Process Insights

- **Fullstack sprint completed in one pass**: Planning, implementation, tests, quality review, and commit all in a single session with no context switches.
- **Parallel test runs saved time**: TypeScript and Rust tests ran simultaneously.
- **Quality review agent is valuable**: Caught the `expect()` vs `?` issue and the stale persistence bug that would have been annoying to debug later.

## Patterns Discovered

```rust
// Pattern: Lock-free MIDI event pipeline (midir callback -> audio engine)
// 1. Bounded crossbeam channel (256 slots)
// 2. try_send() in midir callback (never blocks MIDI thread)
// 3. try_recv() drain loop in audio callback (never blocks audio thread)
// 4. Events silently dropped if channel full (engine stopped = no consumer)

let tx = event_tx.clone();
midi_in.connect(&port, "app", move |timestamp_us, data, _| {
    if let Some(event) = MidiEvent::from_bytes(data) {
        let _ = tx.try_send(TimestampedMidiEvent { event, timestamp_us });
    }
}, ())?;
```

## Action Items for Next Sprint

- [ ] Fix `act()` test warnings across all component tests (tech debt)
- [ ] Investigate `cargo test` linker lock workaround on Windows
- [ ] Add `Serialize/Deserialize` to `MidiEvent` when frontend needs MIDI activity display (Sprint 6+)
- [ ] Consider auto-reconnect on startup for previously used MIDI ports (deferred — no persistence needed yet)

## Notes

- loopMIDI (virtual MIDI cable for Windows) was installed before sprint start and confirmed working
- 10 Rust tests marked `#[ignore]` — 8 from Sprint 2 (ASIO hardware) + 2 from Sprint 3 (MIDI hardware). These require physical devices or loopMIDI to run.
- The MIDI event pipeline is complete but events are currently consumed and discarded in the audio callback. Instrument routing will be added in Sprints 6-9.
