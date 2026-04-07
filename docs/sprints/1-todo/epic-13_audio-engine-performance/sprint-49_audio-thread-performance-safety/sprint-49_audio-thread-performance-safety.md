---
sprint: 49
title: "Audio Thread Performance & Safety"
type: fullstack
epic: 13
status: planning
created: 2026-04-07T15:37:28Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 49: Audio Thread Performance & Safety

## Overview

| Field | Value |
|-------|-------|
| Sprint | 49 |
| Title | Audio Thread Performance & Safety |
| Type | fullstack |
| Epic | 13 |
| Status | Planning |
| Created | 2026-04-07 |
| Started | - |
| Completed | - |

## Goal

Eliminate four specific deferred performance and safety issues on the audio thread: the `ChannelLevelEvent` string allocation, the busy-wait sleep loop in the disk write task, a heap allocation in audio engine state logging, and a zero-allocation audit of the full audio callback process path.

## Background

These items were deferred from Sprints 2, 9, and 25 postmortems and tracked in DEFERRED.md and sprint retrospectives. The audio thread runs at real-time priority and must never block or allocate memory — each violation risks audio glitches, dropouts, or priority inversion:

- **D-001 (`ChannelLevelEvent` channel_id)**: `ChannelLevelEvent` carries `channel_id: String`. With 8 mixer channels, the audio callback clones this `String` roughly 175 times per second (one per channel per buffer at 44100/256 Hz). That is approximately 1,400 small heap allocations per second on the real-time audio thread. Changing to `Arc<str>` makes clones cheap reference-count increments with zero heap allocation.
- **Sprint 9 debt (disk write sleep loop)**: The disk write task in `audio/recording.rs` (or similar) polls for new audio data using a 10ms `thread::sleep` loop. This wastes CPU cycles with constant polling and introduces up to 10ms of recording latency. Replacing with `tokio::sync::Notify` (or `crossbeam_channel::recv`) makes the task sleep until data is actually available and wake up immediately when it arrives.
- **Sprint 25 debt (`to_string()` on state enum)**: Inside a `try_lock` arm in the audio engine, the state enum is converted to a log string via `to_string()`. This `to_string()` call allocates a `String` on the heap, which violates the zero-allocation rule for the audio thread's hot path. The fix is to replace with a `&'static str` match arm (no allocation) or to move the logging call outside the lock scope entirely.
- **Sprint 2 debt (zero-allocation audit)**: No systematic verification has been done that the audio callback's `process()` path is truly allocation-free. The `unsafe impl Send` for `cpal::Stream` was noted as a safety concern but was not formally audited. This task performs an inspection-based audit of the entire `process()` call chain, verifying no `Vec`, `String`, `Box`, or `Arc::new` calls occur, and documents the findings.

## Requirements

### Functional Requirements

- [ ] `ChannelLevelEvent.channel_id` type changed from `String` to `Arc<str>` in `src-tauri/src/audio/`; all clone sites updated to cheap reference-count clone
- [ ] Disk write task in `audio/recording.rs` (or equivalent) uses `tokio::sync::Notify` or a blocking `crossbeam_channel::recv()` instead of a `thread::sleep` poll loop
- [ ] The `to_string()` call on the audio engine state enum inside a lock/hot path is replaced with a `&'static str` match or moved outside the lock scope
- [ ] A written audit report (as inline code comments or a doc comment on the `process()` function) confirms the audio callback `process()` path contains no heap allocations

### Non-Functional Requirements

- [ ] After the `ChannelLevelEvent` fix, zero `String` allocations occur per audio callback buffer for level metering
- [ ] After the disk write fix, recording latency from audio callback to disk does not exceed 2x the buffer duration (512 samples at 44100 Hz ≈ 11.6 ms)
- [ ] All existing audio engine tests continue to pass

## Dependencies

- **Sprints**: Sprint 2 (Audio Engine — process() and stream setup), Sprint 9 (Audio Recording — disk write task), Sprint 25 (Transport & Tempo — audio engine state machine)
- **External**: `tokio::sync::Notify` (already in Cargo.toml via Tauri); `Arc` from std

## Scope

### In Scope

- `ChannelLevelEvent.channel_id` type change from `String` to `Arc<str>` and all clone site updates
- Disk write task refactor from sleep-loop to notify/channel-based blocking
- `to_string()` hot-path allocation fix on state enum in audio engine
- Inspection-based zero-allocation audit of the `process()` call chain with inline documentation

### Out of Scope

- New audio features or new metering types
- ASIO driver changes or buffer size configuration
- Profiling-based benchmarks (inspection-based audit is sufficient for this sprint)
- The `unsafe impl Send` safety investigation (noted as Sprint 50 scope)

## Technical Approach

### D-001: `ChannelLevelEvent.channel_id` → `Arc<str>`

In the struct definition, change `channel_id: String` to `channel_id: Arc<str>`. At all sites where a `ChannelLevelEvent` is constructed with a channel ID, change `String::from("...")` or `format!(...)` to `Arc::from("...")` or `Arc::clone(&existing_arc)`. Verify with `grep` that no `String::clone()` on `channel_id` remains. The struct `Clone` derive will automatically use `Arc::clone`, which is a single atomic increment with no heap allocation.

### Disk Write Task Fix

In `audio/recording.rs` (or wherever the disk writer runs), locate the pattern:
```rust
loop {
    thread::sleep(Duration::from_millis(10));
    // check for new data
}
```
Replace with a `tokio::sync::Notify` pattern:
```rust
let notify = Arc::new(Notify::new());
// audio callback calls notify.notify_one() after writing to the ring buffer
// disk writer does:
loop {
    notify.notified().await;
    // drain ring buffer to disk
}
```
Alternatively, if the task is synchronous, replace with `crossbeam_channel::recv()` which blocks the thread until data arrives with no polling overhead.

### State Enum `to_string()` Fix

Locate the `to_string()` call in the audio engine state machine (likely in `audio/engine.rs` or `audio/mod.rs`). Replace:
```rust
log::info!("State: {}", state.to_string()); // allocates String
```
With:
```rust
let state_str: &'static str = match state {
    AudioEngineState::Stopped => "Stopped",
    AudioEngineState::Starting => "Starting",
    AudioEngineState::Running => "Running",
    AudioEngineState::Stopping => "Stopping",
};
log::info!("State: {state_str}"); // no allocation
```
Or, better: move the log call outside the `try_lock` scope entirely so it does not execute in the audio callback at all.

### Zero-Allocation Audit

Walk the entire `process()` call chain in `audio/`. For each function called from `process()`, verify by inspection that it does not call `Vec::new`, `Vec::push` (that reallocates), `String::new`, `format!`, `Box::new`, `Arc::new`, or any other heap-allocating operation. Document findings as a doc comment on the `process()` function:
```rust
/// # Allocation-Free Guarantee
/// This function and all functions it calls on the hot path have been audited
/// (Sprint 49, 2026-04-07) to contain no heap allocations. Verified:
/// - [list of functions checked]
/// Any future modification to this path must maintain this guarantee.
```

## Tasks

### Phase 1: Planning
- [ ] Locate all construction sites of `ChannelLevelEvent` and all `.clone()` on `channel_id`
- [ ] Locate the disk write task and confirm which synchronization primitive (sleep, channel, or condvar) it currently uses
- [ ] Locate the `to_string()` call on state enum — identify if it is inside a lock or in the audio callback
- [ ] Walk the `process()` call chain and list all called functions for the audit

### Phase 2: Backend Implementation
- [ ] Change `ChannelLevelEvent.channel_id` from `String` to `Arc<str>`
- [ ] Update all `ChannelLevelEvent` construction sites to use `Arc::from(...)` or `Arc::clone(...)`
- [ ] Replace the disk write sleep loop with `tokio::sync::Notify` or `crossbeam_channel::recv()`
- [ ] Add `notify.notify_one()` call in the audio callback after writing to the ring buffer
- [ ] Replace state enum `to_string()` hot-path call with `&'static str` match
- [ ] Perform inspection audit of `process()` call chain
- [ ] Add audit doc comment to `process()` listing checked functions

### Phase 3: Tests
- [ ] Add test: construct `ChannelLevelEvent` with `Arc<str>` channel_id — verify clone is cheap (type-check level)
- [ ] Add test: disk writer receives data via notify and processes it without polling delay
- [ ] Verify all existing audio engine unit tests pass with no changes to behavior

### Phase 4: Validation
- [ ] Run full test suite — all tests green
- [ ] Manual smoke test: start the audio engine with all instruments, play for 30 seconds — verify no xruns in the log
- [ ] Manual smoke test: start recording, play for 10 seconds, stop — verify recorded audio is complete with no gaps

## Acceptance Criteria

- [ ] `ChannelLevelEvent.channel_id` is `Arc<str>` — no `String` clones at audio thread metering sites
- [ ] Disk write task uses `Notify` or blocking channel — no `thread::sleep` poll loop in the recording path
- [ ] No `to_string()` or `format!()` call occurs on the state enum inside the audio callback or a held lock
- [ ] `process()` function has an audit doc comment listing all hot-path functions verified allocation-free
- [ ] All existing tests pass

## Deferred Item Traceability

| Deferred ID | Description | Fix Location |
|-------------|-------------|--------------|
| D-001 | `ChannelLevelEvent.channel_id` String → Arc<str> | `src-tauri/src/audio/` (event types) |
| Sprint 9 debt | 10ms sleep loop in disk write task | `src-tauri/src/audio/recording.rs` |
| Sprint 25 debt | `to_string()` on state enum in hot path | `src-tauri/src/audio/engine.rs` |
| Sprint 2 debt | Zero-allocation audit of `process()` | `src-tauri/src/audio/` (process fn) |

## Notes

Created: 2026-04-07
D-001 is tracked in DEFERRED.md. The zero-allocation audit is a verification task — no new architecture is expected to be needed if the prior sprints followed the audio architecture rules in CLAUDE.md.
