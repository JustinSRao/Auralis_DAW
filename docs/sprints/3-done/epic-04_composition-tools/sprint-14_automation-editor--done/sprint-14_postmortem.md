# Sprint 14 Postmortem: Automation Editor

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 14 |
| Started | 2026-03-15 |
| Completed | 2026-03-15 |
| Duration | ~1 session |
| Steps Completed | 14 |
| Files Changed | 23 (5 Rust new, 7 Rust modified, 5 TS new, 6 TS modified) |
| Tests Added | 27 frontend (18 store, 7 header, 2 row) + Rust tests within existing suite |
| Coverage Delta | +27 TS tests, 348 Rust tests still passing |

## What Went Well

- Rust backend was clean and well-structured: `AutomationLane`, `AutomationEngine`, `record.rs` all came together without major issues
- The `#[serde(rename_all = "camelCase")]` pattern for IPC types worked perfectly as established in prior sprints
- Binary-search sorted `Vec<ControlPoint>` is O(log n) for evaluation as required
- AutomationEngine as first AudioNode works exactly as designed — parameters written before instruments read them
- 348 Rust tests all pass cleanly; all 27 new TS tests pass
- Pattern for persisting automation via `pattern.automation: HashMap<String, AutomationLane>` integrates naturally with existing fileStore save/open

## What Could Improve

- Sub-agents (product-engineer) couldn't write files in this environment — had to implement everything directly in the main conversation. Need to investigate whether this is a permissions setting or environment issue.
- Record mode sync: when recording, the audio thread inserts points into its in-memory lanes, but these changes aren't automatically pushed back to the frontend store. The current implementation handles this by having the frontend apply events locally AND flush to backend. However, if the app is reloaded mid-session, those audio-thread-only changes are lost. Fix: emit a `record-events-applied` Tauri event so frontend can sync.
- The Timeline automation expand buttons are 12×12px — quite small. Could use the TrackList sidebar for expand toggles instead.

## Blockers Encountered

- **Compile error: missing `automation` field** in `pattern_commands.rs::duplicate_pattern`. The new `Pattern.automation` field was not included in the struct literal. Fixed by adding `automation: std::collections::HashMap::new()`.
- **Compile error: missing `automation` field** in `pattern.rs` test struct literal for audio content roundtrip test. Fixed same way.
- **SynthPanel `TransportPlaybackState` comparison**: used `'Playing'` (capitalized) instead of `'playing'` (lowercase). Fixed by checking the type definition.
- **AutomationLaneCanvas unused params**: `totalTicks` and `width` were passed to helper functions that didn't need them. Removed the dead parameters.

## Technical Insights

- `AutomationEngine::process()` does NOT write to the output buffer — it only performs atomic writes to parameter targets. The `_output` param is intentionally unused. This is correct behavior for a pure parameter-modulation node.
- `TransportAtomics.samples_per_beat_bits` stores an `f64` as `u64` bits (`f64::to_bits()`) for lock-free atomic transport. To convert: `f64::from_bits(load(Relaxed))`.
- The `SwapGraph` pattern means every `create_synth_instrument` call replaces the entire AudioGraph. AutomationEngine must be re-created fresh each time with a new channel — the old sender becomes invalid.
- Automation tick calculation: `tick = (position_samples / samples_per_beat) * 480.0`. Frontend uses `(position_samples / ((60 / bpm) * 44100)) * 480`.
- `immer` middleware in Zustand allows direct `splice()` mutations inside `set()` callbacks for sorted insert/delete into arrays.

## Process Insights

- The "stateless Rust backend" pattern (Rust validates, TS is source of truth) established in Sprint 12 scales cleanly to automation: `AutomationLaneStore` in Rust is just for forwarding commands to audio thread; the real state lives in `automationStore.ts`.
- Reading the full sprint spec and all dependency files before starting saved time by clarifying the `pattern.automation` persistence approach early.

## Patterns Discovered

**Sorted array insert in immer store:**
```typescript
set((s) => {
  let i = 0;
  while (i < arr.length && arr[i].key < newItem.key) i++;
  arr.splice(i, 0, newItem); // immer allows this
});
```

**Flush interval with cleanup:**
```typescript
useEffect(() => {
  if (enabled) {
    const id = setInterval(() => void flushBatch(), 100);
    return () => clearInterval(id);
  }
}, [enabled]);
```

**AutomationEngine lane key convention:** `"patternId::parameterId"` (double colon separator to avoid collisions with UUIDs that contain single hyphens).

## Action Items for Next Sprint

- [ ] Fix record sync: emit `record-events-applied` Tauri event so frontend store stays in sync with audio-thread lane mutations during recording
- [ ] Add automation lane creation UI: when a track is expanded and has no lanes, provide a "+" button with a parameter picker dropdown
- [ ] Consider moving expand toggles to the TrackList sidebar (Sprint 31 will add proper track sidebar)
- [ ] Sprint 31 (Arrangement Playback Engine) will need to set `AutomationEngine`'s current pattern context so it evaluates the right lanes during playback

## Notes

Sprint 14 completes Epic 4's composition toolset (Sprints 10–14). The full pipeline works end-to-end: draw breakpoints in the automation canvas → stored in `automationStore` → IPC to Rust `AutomationLaneStore` → forwarded to `AutomationEngine` → evaluated each audio callback → written to `AtomicF32` targets → instrument parameter changes in real-time.
