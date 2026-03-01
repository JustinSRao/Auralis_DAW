# Sprint 30 Postmortem: Main DAW Shell & Track Management

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 30 |
| Started | 2026-03-01 |
| Completed | 2026-03-01 |
| Duration | ~4 hours |
| Steps Completed | 14 |
| Files Changed | 18 (11 new, 7 modified) |
| Tests Added | ~130 (304 TS total, 170 Rust total) |
| Coverage | 76.69% functions (75% threshold — PASS) |

## What Went Well

- 3-agent parallelism (Rust backend, React frontend, test agent) cut wall-clock time significantly — all three completed independently without blocking each other
- Plan agent caught the `TrackKind` vs `TrackType` naming conflict before implementation started, saving a refactor mid-sprint; stateless Rust command pattern was well-designed upfront
- Sprint 26 undo/redo integration was seamless — `CreateTrackCommand`, `RenameTrackCommand`, etc. followed the exact `RenamePatternCommand` template with no surprises
- HTML5 drag API was sufficient for track reordering at the ≤32 track scale; no third-party drag library needed

## What Could Improve

- Initial function coverage was 73.07% — below the 75% threshold — requiring a second quality-engineer pass to close the gap; three files (`useGlobalKeyboard.ts`, `TrackList.tsx`, `MenuBar.tsx`) had very low function coverage from the first pass
- MenuBar uses plain HTML buttons instead of Radix `DropdownMenu` because Radix Portals are unreachable via `fireEvent.click` in jsdom; this leaves the MenuBar without proper keyboard navigation and accessibility attributes until a real testing approach is in place
- `TrackHeader.tsx` uses `e.target as unknown as HTMLInputElement` to access the inline-rename input value — the double cast is a smell that should be cleaned up

## Blockers Encountered

- Quality engineer agent hit a rate limit during the quality review phase; resolved by doing an inline grep-based review instead (no unwrap() in non-test Rust, no `any` in TypeScript, hooks mounted correctly in DAWLayout, `TrackType` in ipc.ts unchanged)

## Technical Insights

- **Stateless Rust command pattern**: Rust commands act as pure validators + UUID generators, returning a `Track` struct on success or a `String` error. TypeScript `trackStore` is the single source of truth for the track list. This avoids a shared Rust state mutex on the main thread and keeps command testing trivially easy.
- **TrackKind vs TrackType**: The project-file format's `TrackType {Audio, Midi, Bus}` and the runtime `TrackKind {Midi, Audio, Instrument}` deliberately diverge. Keeping them separate avoids schema migration and lets both evolve independently.
- **`getState()` in keyboard handlers**: Keyboard event handlers that close over Zustand stores must use `store.getState()` inside the handler, not close over the reactive value at mount time — otherwise the handler always sees the initial state.
- **HTML5 drag at 32-track scale**: `dragstart`/`dragover`/`drop` events with `dataTransfer.setData("text/plain", id)` is sufficient and requires zero dependencies. At >100 tracks a virtualized list would need a different approach.

## Process Insights

- The 3-agent parallel pattern works well when the interface contract (IPC types in `ipc.ts`) is locked before agents start — the Rust backend, React frontend, and test agents all used `DawTrack`/`DawTrackKind` from `ipc.ts` without conflicts
- Coverage thresholds should be checked per-file during implementation, not just aggregate at the end; three files dragged the aggregate below threshold

## Patterns Discovered

**Stateless Rust Tauri command returning a new entity:**
```rust
#[command]
pub fn create_track(kind: TrackKind, name: String) -> Result<Track, String> {
    if name.trim().is_empty() { return Err("Track name cannot be empty".to_string()); }
    if name.len() > 64 { return Err("Track name cannot exceed 64 characters".to_string()); }
    Ok(Track::new(name.trim(), kind))
}
```

**Optimistic update + rollback in Zustand:**
```typescript
createTrack: async (kind, name) => {
    try {
        const track = await ipcCreateTrack(kind, name);
        set(draft => { draft.tracks.push(track); });
    } catch (err) {
        // rollback is implicit — state never changed on failure
    }
}
```

**Keyboard store reads via `.getState()` inside handler:**
```typescript
function handleKeyDown(e: KeyboardEvent): void {
    // Read current value at event time, not at hook mount time
    const { isPlaying } = useTransportStore.getState();
}
```

## Action Items for Next Sprint

- [ ] [backlog] Replace `MenuBar` plain HTML buttons with properly tested Radix `DropdownMenu` once jsdom Portal testing approach is established
- [ ] [backlog] Clean up `TrackHeader` double cast (`e.target as unknown as HTMLInputElement`)
- [ ] [sprint] Run `/epic-complete 1` — all 13 Epic 1 foundation sprints are now complete (1, 2, 3, 4, 5, 25, 26, 27, 28, 29, 30, 32, 40... verify count)
- [ ] [next] Sprint 31 (Arrangement Playback Engine) — depends on Sprints 2, 12, 13, 25 ✓ (2, 25, 26, 30 done; 12, 13 still todo)

## Notes

Sprint 30 establishes the main DAW shell that all future composition and mixer sprints will build on. The `trackStore` / stateless Rust pattern is the template to follow for all future entity management (patterns, clips, automation lanes).
