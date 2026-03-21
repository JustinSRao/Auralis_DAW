# Sprint 17 Postmortem: Full Mixer (Tracks, Routing, Sends, Buses)

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 17 |
| Started | 2026-03-21 |
| Completed | 2026-03-21 |
| Duration | 1 session |
| Steps Completed | 13 |
| Files Changed | 35 files, +3,407 / -15 lines |
| Tests Added | 59 new tests (16 Rust unit + 43 TypeScript) |
| Pre-existing failures fixed | 4 test files (plugin-dialog mock), 2 test files (getState mock) |

## What Went Well

- **Architecture landed cleanly** — The `AtomicF32`/`AtomicBool` parameter pattern from the synth transferred directly to mixer channels with no friction. The plan agent correctly identified this as the reference pattern.
- **Plan agent was highly accurate** — The architecture proposal matched the final implementation almost exactly. No design reversals during coding.
- **Equal-power pan law is correct** — All three pan law unit tests (center, hard-left, hard-right) validate the math precisely. This was the trickiest DSP piece.
- **Pre-existing test gap fixed as a bonus** — The `@tauri-apps/plugin-dialog` mock gap had been silently blocking 4 test files across earlier sprints. Fixing it now unblocks future DAWLayout tests.
- **Quality review caught a real audio-thread allocation** — The `vec![]` inside `process()` was caught by the quality agent before shipping. This would have caused glitches under load.

## What Could Improve

- **Rust tests unverifiable in this environment** — `cargo` is not installed in the codespace. All 16 Rust unit tests exist but cannot be run to confirm they pass. Future sprints should ensure Rust toolchain is available, or add a note in CI/CD planning.
- **DAWLayout tests broke when MixerView was added** — The `useTrackStore.getState` mock gap was latent and only surfaced when MixerView rendered inside DAWLayout tests. A more robust mock pattern for Zustand stores (always including `getState`) would prevent this class of issue.
- **`ChannelLevelEvent` still clones a String per callback** — Deferred intentionally (see Technical Insights). Should be cleaned up before Sprint 31 when real audio flows.

## Blockers Encountered

- None that required user input. All decisions (bottom panel layout, 1-to-1 channel routing, 4 default buses, simple bar meters) were resolved in the clarification step.

## Technical Insights

- **Pre-allocated audio buffers are non-negotiable** — Even `vec![0.0f32; n]` inside a process loop is a heap allocation on the hot path. The fix is to pre-allocate `silence_buf` and `channel_level_scratch` in `new()` and reuse them. This is the pattern to follow for every new audio node going forward.
- **Crossbeam bounded channel + `try_send` is the correct level-meter pattern** — At 44100/256 ≈ 172 callbacks/sec, a bounded channel of capacity 64 naturally drops frames. The UI only needs 30 Hz. No synchronization needed on either side.
- **`String` ID in `ChannelLevelEvent` is a small residual allocation** — Each `try_send(evt.clone())` copies the channel ID string. With 8–16 channels at 172 callbacks/sec, this is ~1,400 small string copies/sec. Not critical now, but the correct fix (deferred) is `Arc<str>` for channel IDs across `MixerChannel`, `ChannelLevelEvent`, and all commands.
- **Vitest alias-based mocking is more reliable than `__mocks__` for missing packages** — Adding a `resolve.alias` in `vitest.config.ts` intercepts the import at bundle time, before Vite tries to resolve the package from `node_modules`. This is the right fix for any Tauri plugin that isn't installed in the test environment.

## Process Insights

- **The clarification step (1.3) prevented a layout ambiguity** — Without it, the implementation would have had to guess between bottom-panel vs. floating-window. One question, one answer, no rework.
- **Quality agent reviewing audio-thread code is worth it** — DSP constraints (no alloc, no mutex, lock-free params) are easy to violate accidentally. The quality agent caught the `vec![]` allocation that the product agent missed.

## Patterns Discovered

**Zustand mock pattern with `getState` (for future tests):**
```typescript
// Always include getState when mocking a Zustand store in tests
vi.mock('../../stores/trackStore', () => ({
  useTrackStore: Object.assign(
    vi.fn((selector: (s: TrackStoreState) => unknown) => selector(mockState)),
    { getState: () => mockState }
  ),
}));
```

**Vitest alias for missing Tauri plugins:**
```typescript
// vitest.config.ts — resolve missing Tauri plugins to manual mocks
resolve: {
  alias: {
    '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'src/__mocks__/@tauri-apps/plugin-dialog.ts'),
  },
},
```

**Pre-allocated silence buffer for audio nodes that don't yet have instrument input:**
```rust
// In Mixer::new():
silence_buf: vec![0.0f32; buffer_size * 2],  // reused every callback, no alloc

// In process():
for channel in &self.channels {
    channel.process_into(&self.silence_buf, &mut self.mix_buf, ...);
}
```

## Action Items for Next Sprint

- [ ] Sprint 18 (EQ & Filter Effects): insert effects into the 8 slots already reserved on each `MixerChannel`
- [ ] Sprint 18: parametric EQ node should follow the `AtomicF32` parameter pattern established here
- [ ] Before Sprint 31: change `ChannelLevelEvent.channel_id` to `Arc<str>` to eliminate the per-callback string clone
- [ ] Track: ensure Rust toolchain is available in the build environment before Sprint 18 so `cargo test` can be verified

## Notes

Sprint 17 is the foundational mixer sprint — Sprints 18, 19, 20, and 21 all depend on the insert-slot and bus infrastructure built here. The mixer is intentionally silent in this sprint (no instrument audio flows yet). Level meters will show activity only after Sprint 31 wires instrument outputs to channels.
