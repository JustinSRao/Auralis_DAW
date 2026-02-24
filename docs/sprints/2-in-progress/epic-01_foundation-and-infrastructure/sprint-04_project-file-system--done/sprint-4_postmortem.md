# Sprint 4 Postmortem: Project File System

## Metrics

| Metric | Value |
|--------|-------|
| Sprint Number | 4 |
| Started | 2026-02-23 |
| Completed | 2026-02-24 |
| Duration | ~2 hours |
| Steps Completed | 13 |
| Files Changed | 16 (2798 insertions, 5 deletions) |
| Tests Added | 67 (41 Rust + 26 TypeScript) |
| Total Tests Passing | 112 (41 Rust project + 71 frontend) |

## What Went Well

- **Clean architecture**: The `ProjectFile` struct hierarchy maps naturally to the DAW's domain model — tracks, clips, instruments, effects, automation, samples
- **Atomic saves**: Writing to `.tmp` then renaming prevents file corruption on crash
- **Forward compatibility**: Using `serde_json::Value` for instrument/effect params means future sprints can fill in concrete types without breaking existing project files
- **Schema migration system**: Ready for versioned upgrades with the `MIGRATIONS` registry pattern
- **Test coverage**: 41 Rust tests covering serialization round-trips, ZIP structure, error handling, and recent projects list — all passing immediately
- **ZIP crate integration**: `zip = "2"` worked seamlessly for creating and reading archives with Deflated compression

## What Could Improve

- **Agent token limit**: The product-engineer agent hit a token/rate limit during backend implementation but had completed all 6 files — had to manually verify and run compilation
- **Linker lock issue**: `cargo test --lib` (without `--lib` flag initially) fails when another process holds the exe — known issue, workaround documented in memory

## Blockers Encountered

- **LNK1104 linker error**: Windows locks the test executable when another process is running. Workaround: always use `cargo test --lib` instead of `cargo test`
- **Python encoding**: `sprint_lifecycle.py` needs `PYTHONIOENCODING=utf-8` on Windows to handle checkmark characters

## Technical Insights

- **`#[serde(tag = "type")]` for enums**: Produces readable JSON like `{"type": "Audio", "sample_id": "..."}` — ideal for a human-debuggable file format
- **`DateTime<Utc>` from chrono**: Serializes cleanly to RFC 3339 strings, better than raw String timestamps
- **`Option<String>` for output_bus**: Changed from `String` (plan) to `Option<String>` for cleaner null representation when routing to master
- **Zustand `immer` pattern**: Consistent with existing stores — `set((state) => { state.field = value; })` for immutable updates

## Process Insights

- Parallel agent execution (backend + frontend) works well when the interface contract (IPC types) is defined upfront
- Reading existing code patterns (authStore, midiStore tests) before writing new code ensures consistency
- The TDD approach (tests alongside implementation) caught no bugs but validates the design is correct

## Patterns Discovered

```rust
// Atomic file write pattern (used in io.rs and recent.rs)
let tmp_path = path.with_extension("tmp");
fs::write(&tmp_path, &data)?;
fs::rename(&tmp_path, &path)?;

// Auto-save with dirty snapshot (lock → clone → unlock → save)
let save_data = {
    let mut mgr = pm_clone.lock()?;
    mgr.take_dirty_snapshot()  // Returns Option<(ProjectFile, PathBuf)>
};
if let Some((project, path)) = save_data {
    save_project(&project, &autosave_path, None)?;
}
```

## Action Items for Next Sprint

- [ ] Integrate ProjectFile with actual audio engine state (when transport control sprint lands)
- [ ] Add `@tauri-apps/plugin-dialog` native file dialogs for Save As / Open in frontend
- [ ] Consider adding `toSerializable()` / `fromSerializable()` to projectStore for bidirectional sync
- [ ] Monitor auto-save performance with large projects (many samples)

## Notes

- The `zip` crate locked to v2.4.2 — v8.x is available but v2 is sufficient and stable
- `serde_json::Value` for instrument/effect params is intentional tech debt — will be replaced with typed structs in Sprints 6-9 and 17-21
- Sample embedding was chosen over path references per user decision — projects are self-contained and portable
