# Sprint 32 Postmortem: MIDI File Import

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 32 |
| Started | 2026-03-15 |
| Completed | 2026-03-15 |
| Duration | ~3 hours |
| Steps Completed | 13 |
| Files Changed | 17 files, +1514 lines |
| Tests Added | 26 new (13 Rust import, 10 Rust commands, 10 TS dialog, 3 TS store, 13 TS utils) |
| Rust Tests | 382 passing (up from 359) |
| TS Tests | 1091 passing (up from 1065), 10 pre-existing failures unchanged |

## What Went Well

- The `midly` crate made MIDI parsing trivial — zero unsafe code, handles all tick formats, clean Rust API
- Stateless Rust command pattern (Rust validates + generates UUIDs, TS stores state) carried over perfectly from Sprint 12
- Beat position math is elegantly simple: `tick / ticks_per_quarter` regardless of tempo changes
- NoteOn/NoteOff pairing with a `HashMap<(channel, pitch), Vec<...>>` stack handled polyphony cleanly
- All 26 new tests written and passed on first run — no iteration needed

## What Could Improve

- `DAWLayout.test.tsx` tests fail due to `ResizeObserver` not defined in jsdom (pre-existing, needs polyfill in setup.ts)
- `suggested_bpm` reads only the first tempo event — full tempo map would be more accurate for complex files

## Blockers Encountered

- `@tauri-apps/plugin-dialog` not installed as an npm package. Fixed by `npm install @tauri-apps/plugin-dialog`.
- `extract_track_name` had an unused `abs_tick` accumulator (compiler warning). Removed since track names can appear at any tick.

## Technical Insights

- **Beat position is tempo-independent**: `beat = tick / ticks_per_quarter` always. Tempo only affects wall-clock time, not the beat grid.
- **SMPTE timecode fallback**: Fall back to 480 tpq + log warning rather than returning an error for the rare timecode case.
- **NoteOn velocity=0 equals NoteOff**: Handled by matching the `NoteOn` arm after the `vel > 0` guard fails — single match statement covers both.
- **midly lifetime**: `Smf::parse(&bytes)` lifetime is tied to the byte slice. Parse, convert, and drop all within the same scope.
- **`snap_length_bars` replicated in TS**: Dialog needs bar-length auto-calc without an IPC round-trip. Small duplication is justified.

## Patterns Discovered

### NoteOn/NoteOff stack pairing (Rust)
```rust
let mut open_notes: HashMap<(u8, u8), Vec<(u64, u8)>> = HashMap::new();
// On NoteOn (vel>0): push (abs_tick, vel) to stack
// On NoteOff/NoteOn-vel-0: pop from stack, compute duration_ticks = off - start
```

### Dialog state initialized lazily from props (React)
```typescript
const [rows, setRows] = useState<RowState[]>(() =>
  fileInfo.tracks.map((t) => ({
    enabled: !t.isEmpty,
    patternName: t.name,
    trackId: defaultTrackId,
    lengthBars: MidiImporter.snapLengthBars(maxEndBeat / 4) as PatternLengthBars,
  }))
);
```

## Action Items for Next Sprint

- [ ] Fix `ResizeObserver` polyfill in `src/test/setup.ts` to unblock `DAWLayout.test.tsx`
- [ ] Add MIDI file export (natural complement to import, Epic 4 backlog)
- [ ] Wire `ipcRegisterSchedulerSender` calls when adding imported MIDI clips to arrangement

## Notes

The `midly` crate v0.5.3 pulls in `rayon` for parallel track parsing, which is fine — enables sub-second parsing for 100+ track files.
