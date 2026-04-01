# Sprint 39 Postmortem: Sidechain Compression

## Metrics

| Metric | Value |
|--------|-------|
| Started | 2026-03-31 |
| Completed | 2026-03-31 |
| Duration | ~1.5 hours |
| Steps completed | 12 |
| Files changed | 19 |
| New Rust files | 3 (`sidechain.rs`, `audio/mixer/sidechain.rs`, `sidechain_commands.rs`) |
| New TS files | 5 (`SidechainSourceSelector`, `SidechainHpfControl`, store, 3 test files) |
| Rust tests | 605 passing (12 new: 4 SidechainTap + 8 SidechainRouter) |
| TS tests | 1104 passing (17 new across sidechain store + 2 components) |

## What Went Well

- **Circular import resolved cleanly**: placing `SidechainTap` in `effects/sidechain.rs` (not `audio/mixer/`) broke the potential cycle between `effects/dynamics.rs` and `audio/mixer/channel.rs` with zero coupling change.
- **`AudioEffect` default no-op methods**: adding `set_sidechain` / `set_sidechain_hpf` as trait defaults means zero changes to `BrickwallLimiter`, `NoiseGate`, EQ, reverb, delay — only `Compressor` overrides them.
- **Butterworth HPF biquad**: direct-form II transposed with per-channel state (L/R separately) integrates cleanly into the sidechain path; `SidechainHpf::process_l` / `process_r` are inline and add negligible overhead.
- **Field-level borrow splitting in `mixer.rs`**: borrowing `self.channels`, `self.mix_buf`, `self.send_bufs`, etc. by name lets `iter_mut()` on channels coexist with mutable access to other fields — no unsafe needed.

## What Could Improve

- **`process_into` &self → &mut self**: changing the signature required touching all channel unit tests (adding `mut`). A future `MixerChannel` refactor might hold the tap scratch as an `UnsafeCell` to keep the public API `&self`, but the `&mut self` approach is simpler and more idiomatic.
- **`useMixerStore` selector returning new array**: the `Object.values(...).filter().map()` pattern creates a new reference every render, causing infinite re-renders until `useMemo` was added. Standard pattern to remember.

## Blockers Encountered

- **`dangerous_implicit_autorefs` lint on `SidechainTap::read`**: `&(*self.buffer.get())[..frames * 2]` triggered the lint; fixed by making autoref explicit: `&(&(*self.buffer.get()))[..frames * 2]`.
- **`SidechainTap` missing `Debug` impl**: `unwrap_err()` in `SidechainRouter` tests requires `Debug` on the `Err` type — added `#[derive(Debug)]` once identified.

## Technical Insights

- **`UnsafeCell<Box<[f32]>>`** is the right primitive for a zero-allocation single-writer/single-reader audio tap: `unsafe fn write` (caller guarantees no concurrent read), safe `fn read` — aliasing invariant enforced by processing order.
- **DFS cycle detection**: only needs to check if the proposed source is already reachable from the destination. Tracing backwards through `receives_from` edges is O(n) in route count.
- **Pre-allocated `tap_scratch: Vec<f32>` on `MixerChannel`**: sized at channel creation (control thread), never resized — satisfies the no-allocation-on-audio-thread requirement.

## Process Insights

- Clear dependency chain (SidechainTap → SidechainRouter → Compressor extension → channel wiring → commands → frontend) made incremental implementation with tests at each layer straightforward.
- Dedicated `sidechain_commands.rs` keeps the mixer module well-organized as it grows.

## Action Items for Next Sprint

- [ ] Sprint 42 (Sub-Group Bus Routing): reuse the DFS cycle detection approach from `SidechainRouter` for bus routing graphs.
- [ ] Consider adding `SidechainRouter::removes_channel` cleanup to `Mixer::remove_channel` so dangling routes are auto-removed at the mixer level, not just the command layer.
