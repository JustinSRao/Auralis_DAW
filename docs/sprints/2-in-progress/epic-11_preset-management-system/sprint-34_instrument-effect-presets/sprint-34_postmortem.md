# Sprint 34 Postmortem: Instrument & Effect Presets

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 34 |
| Started | 2026-04-07 |
| Completed | 2026-04-07 |
| Duration | 1 session |
| Steps Completed | 14 |
| Files Changed | 53 files, 2,841 insertions, 194 deletions |
| New Source Files | 12 (4 Rust, 4 TS/TSX components, 4 test files) |
| Factory Presets Shipped | 10 (5 synth, 2 drum kits, 3 EQ templates) |
| Tests Added | 27 new (14 Rust unit tests, 13 frontend component tests) |
| Mocks Added | 8 existing test files updated with usePresets mock |
| Final Test Count | 704 Rust + 1,290 frontend — all passing |

## What Went Well

- **Existing architecture made preset capture trivial** — all instrument params were already `Arc<AtomicF32>` and effects already had `get_params()`/`set_params()` on the `AudioEffect` trait. No new serialization infrastructure needed.
- **Factory presets via `include_str!()`** — zero runtime file I/O for factory presets, no bundle configuration headaches, and no missing-file risk at runtime.
- **Plan agent thoroughly explored the codebase first** — discovered the exact param schemas for every instrument/effect before designing the architecture, which prevented mismatches between JSON schemas and actual Rust structs.
- **Quality review caught a subtle data-corruption bug (C1)** — velocity `as u8` truncation before `.clamp()` would have produced non-monotonic velocity mapping for out-of-range values in user-authored preset files. Caught and fixed before commit.
- **Quality review caught the Mutex architectural smell (M1)** — the original implementation used `Mutex<PresetManager>` but never held the lock during I/O, providing false safety. Replaced with `Arc<PresetManager>` (stateless FS manager needs no mutex).

## What Could Improve

- **TrackData test helpers broke on Rust compile** — Sprint 40 added `frozen`/`freeze_wav_path` fields to `TrackData` but did not update two test struct literals in `format.rs` and `io.rs`. This caused `cargo test` to fail before any preset tests could run. Future sprints should run `cargo check` as a pre-commit step to catch this class of compile error immediately.
- **Global `searchQuery` in the store was a design mistake** — initially put `searchQuery` in the global Zustand store, which caused it to bleed across preset types when the inline browser was toggled without going through `closeBrowser`. Caught in quality review and fixed by moving it to `PresetBrowser` local state. The lesson: UI-ephemeral state belongs in local component state, not in a global store.
- **No factory presets for Sampler, Reverb, Delay, or Compressor** — the sprint plan called for factory presets only for Synth, DrumMachine, and EQ; the other four types ship with an empty browser. This is a known gap (m1 from quality review) and represents a missing starter experience.
- **`apply_drum` initially had a double-lock race** — the first implementation acquired `cmd_tx` once for `SetPatternLength` and again for pad steps, with a window for interleaving commands. Caught in quality review (M2) and fixed with a single lock hold for the full batch.

## Blockers Encountered

- **Python not on PATH as `python3`** — the `sprint_lifecycle.py` script failed on first call because Windows maps `python3` to the Microsoft Store. Had to use `py` with `PYTHONIOENCODING=utf-8` prefix for every lifecycle command. This is an environment quirk that affects every sprint.

## Technical Insights

- **Stateless managers don't need Mutex** — `PresetManager` performs only async filesystem reads/writes with no in-memory mutable state. `Arc<PresetManager>` gives safe concurrent access without locking overhead. The `Mutex<T>` pattern is only appropriate when `T` has mutable state that must be serialized across async boundaries.
- **Zustand `?? []` in selectors causes infinite re-renders** — when `Partial<Record<K, T[]>>` has a missing key, the `?? []` fallback creates a new array literal on every render. React's `useSyncExternalStore` detects this as an unstable snapshot and throws "Maximum update depth exceeded". Fix: initialize all keys with `[]` at store creation so selectors always return a stable reference.
- **Preset loading is inherently atomic with the atomic-param architecture** — because all params are `Arc<AtomicF32>` read once per audio buffer at the top of `process()`, writing all params synchronously on the control thread guarantees the audio thread picks them all up on the next buffer boundary. No additional synchronization needed.
- **`include_str!()` for embedded assets requires paths relative to the source file** — `include_str!("../../resources/presets/synth/bass_sub.mapreset")` resolves relative to the `.rs` file, not the crate root. This is easy to get wrong when the file is in a subdirectory.

## Process Insights

- **Quality review step (3.3) caught 1 critical + 7 major findings** — all were fixed before commit. The review pays for itself: the velocity truncation bug (C1) would have been a silent data-corruption issue in production that would have been very hard to reproduce and debug from user reports.
- **The 4-phase plan→implement→test→review cycle worked well** — having the Plan agent explore the codebase before writing a single line of code meant the implementation matched the actual Rust structs (no guessing at param names or types).

## Patterns Discovered

**Stateless Arc manager pattern** — for services that are pure I/O with no mutable state, use `Arc<T>` as Tauri managed state instead of `Arc<Mutex<T>>`:

```rust
// In mod.rs
pub type PresetManagerState = Arc<PresetManager>;

// In lib.rs setup
let preset_manager = Arc::new(PresetManager::new(presets_dir));
app.manage(preset_manager);

// In Tauri commands — no locking needed
#[tauri::command]
pub async fn list_presets(
    preset_type: PresetType,
    manager: State<'_, PresetManagerState>,
) -> Result<Vec<PresetMeta>, String> {
    manager.list(preset_type).await.map_err(|e| e.to_string())
}
```

**Local search state pattern for browser components** — search query belongs in local component state, not in a global store, when the browser can be opened for different categories:

```tsx
function PresetBrowser({ presetType, onLoad, onClose }: Props) {
  const [searchQuery, setSearchQuery] = useState('');  // local — resets on each open
  const { filteredPresets } = usePresets(presetType, searchQuery);
  // ...
}
```

**Velocity clamp-before-cast pattern** — always clamp integer values on the wider type before narrowing:

```rust
// WRONG — silent truncation: 256 as u8 = 0, then clamp gives 1
let velocity = value.as_u64().unwrap_or(100) as u8;
let velocity = velocity.clamp(1, 127);

// CORRECT — monotonic mapping
let raw = value.as_u64().unwrap_or(100);
let velocity = raw.clamp(1, 127) as u8;
```

## Action Items for Next Sprint

- [ ] Add factory presets for Sampler (ADSR templates), Reverb (room, hall, plate), Delay (quarter note, dotted eighth, ping-pong), and Compressor (gentle glue, hard limit, vocal rider) — currently those browsers open empty
- [ ] Fix the pre-existing doctest failure in `delay.rs` (references stale crate name `music_application_lib`) — predates Sprint 34, unrelated to presets
- [ ] Consider adding popup position awareness to `PresetBrowser` so it doesn't clip at viewport bottom (currently uses fixed `mt-8` offset)
- [ ] Mark completed epics (2, 3, 4, 6, 7, 8, 9, 10) with `/epic-complete` — all have 100% of sprints done but registry still shows them as "planning"
- [ ] Push to GitHub: `git push origin main`

## Notes

Sprint 34 is the **last planned sprint** in the backlog. The DAW now has all features from the original design: foundation, auth, 4 instruments, full composition suite, audio editing, mixer with effects chain, export, VST3 hosting, settings UI, sample browser, MIDI learn, track freeze, and now preset management.

The `DEFERRED.md` tracker (last updated Sprint 18) still has 7 open items — notably D-004 (Rust CI toolchain, High priority) and D-005 (EQ param persistence, now addressable since Sprint 21 is complete).
