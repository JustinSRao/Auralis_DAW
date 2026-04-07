# Sprint 28 Postmortem: Sample & Content Browser

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 28 |
| Started | 2026-04-05 |
| Completed | 2026-04-05 |
| Duration | ~1 hour |
| Steps Completed | 12 |
| Files Changed | 13 (1298 insertions, 2 deletions) |
| Tests Added | 26 (FileList: 8, FolderTree: 6, browserStore: 12) |
| Rust Tests Added | 6 (is_audio_extension: 2, list_directory: 2, browser_config: 2) |

## What Went Well

- `cpal::Stream !Send` issue resolved cleanly by keeping stream on dedicated OS thread and only storing a `crossbeam_channel::Sender<()>` in managed state — exactly the right pattern
- Reused existing `decode_audio_file` from sampler decoder without any modification — zero code duplication
- WASAPI vs ASIO split handled elegantly with `#[cfg(target_os = "windows")]`
- Tab switcher approach for BROWSER/PATTERNS in left panel preserved PatternBrowser without layout disruption
- All 1247 TypeScript tests and 674 Rust tests passed after fixes

## What Could Improve

- `FileList` initially crashed with `filtered.map` TypeError when `entries` was undefined — defensive `?? []` guard should be default practice for array props
- "FILES" tab label conflicted with MenuBar's "File" button in `queryByRole("button", { name: /file/i })` test — choose non-conflicting tab labels from the start
- Tab label renamed to "BROWSE" to avoid test collision; consider keeping label names clearly distinct from existing UI text

## Blockers Encountered

- `BrowserPanel.useEffect` called `cfg.browser` without optional chaining — `cfg` was `undefined` in tests where `invoke` returns `undefined`. Fixed with `cfg?.browser ?? { favorites: [], recentFolders: [] }`

## Technical Insights

- `cpal::Stream` is `!Send` — cannot store in `Arc<Mutex<T>>` managed state. Solution: store `crossbeam_channel::Sender<()>` as the handle; actual stream lives on a `std::thread::spawn` thread
- Windows drive enumeration via `std::fs::metadata("A:\\")` through `"Z:\\"` is synchronous but fast — acceptable in async context
- `#[serde(default)]` on every new `AppConfig` field is mandatory for backward-compatible TOML deserialization — must test this explicitly with a TOML literal missing the new section

## Process Insights

- Planning agent's architecture decision on `!Send` stream was correct and saved debugging time
- Clarification questions at step 1.3 were valuable — user confirmed WASAPI-for-preview, which avoids a hard-to-diagnose ASIO contention bug at runtime

## Patterns Discovered

```rust
// Pattern: Store only the stop signal in managed state when the resource is !Send
pub struct PreviewHandle {
    pub stop_tx: crossbeam_channel::Sender<()>,
}
pub type PreviewPlayerState = Arc<Mutex<Option<PreviewHandle>>>;

// Playback thread owns the cpal::Stream and listens for stop signal
std::thread::spawn(move || {
    let stream = device.build_output_stream(...)?;
    stream.play()?;
    loop {
        if stop_rx.try_recv().is_ok() { break; }
        if position >= total_frames { break; }
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(stream); // explicit drop to stop playback
});
```

```typescript
// Pattern: Defensive array fallback in useMemo to prevent .map() crash
const filtered = useMemo(() => {
  const safe = entries ?? [];
  if (!searchQuery) return safe;
  return safe.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()));
}, [entries, searchQuery]);
```

## Action Items for Next Sprint

- [ ] Consider splitting `ipc.ts` into domain-specific modules (`ipc/browser.ts`, `ipc/audio.ts`, etc.) — file is now ~2580 lines
- [ ] Add waveform thumbnail rendering in browser file list (backlog)
- [ ] Consider making panel width persistent via AppConfig (currently resets on restart)

## Notes

- Preview player uses WASAPI explicitly on Windows to avoid ASIO device contention with the main audio engine — this is intentional and documented in `preview.rs`
- The resize handle in `BrowserPanel` uses manual mouse tracking (not a library) for consistency with the project's no-extra-deps policy
- `BrowserPanel` is hydrated from AppConfig on mount via `ipcGetAppConfig()`, same pattern as shortcuts hydration in `DAWLayout`
