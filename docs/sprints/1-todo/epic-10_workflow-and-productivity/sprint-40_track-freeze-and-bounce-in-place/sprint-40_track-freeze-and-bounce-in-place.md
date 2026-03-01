---
sprint: 40
title: "Track Freeze and Bounce in Place"
type: fullstack
epic: 10
status: planning
created: 2026-02-23T17:05:53Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
coverage_threshold: 75
---

# Sprint 40: Track Freeze and Bounce in Place

## Overview

| Field | Value |
|-------|-------|
| Sprint | 40 |
| Title | Track Freeze and Bounce in Place |
| Type | fullstack |
| Epic | 1 - Foundation & Infrastructure |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Enable users to freeze a track (offline-render its instrument and effect chain to a temporary WAV file, then bypass all plugins to reclaim CPU) and bounce a track in place (render to a permanent audio clip that replaces the original MIDI or instrument content, converting the track to an Audio track).

## Background

CPU management is one of the most critical usability concerns in any DAW. A project that stacks a polyphonic synthesizer (Sprint 6) with an effect chain (Sprint 21) of EQ, compressor, and reverb across eight instrument tracks can easily overload the audio thread on a mid-range PC. Professional DAWs solve this with two tools: Freeze and Bounce in Place.

**Freeze** is a reversible CPU optimization. The engine renders the track's instrument + effect chain to a temporary WAV file using offline rendering, then bypasses all plugins and replaces the instrument's `AudioNode` with a lightweight `AudioClipPlayer` (Sprint 37) reading from that file. The frozen track still responds to fader, pan, sends, and automation — only the DSP-heavy plugin processing is removed from the real-time callback. The user can unfreeze at any time to restore the original instrument and effects for editing.

**Bounce in Place** is a destructive operation that makes the rendered audio permanent: the temporary WAV is promoted to a proper `SampleReference` in the project, a `ClipContent::Audio` clip replaces the original MIDI clip(s), and the `TrackType` is changed from `Midi` to `Audio`. This is ideal when a musical part is finalized and the user wants to free CPU permanently without keeping the instrument loaded.

Both operations reuse the `OfflineRenderer` architecture from Sprint 22, scoped to a single track rather than the full mix.

## Requirements

### Functional Requirements

- [ ] **Freeze track**: offline-render the track's instrument + full effect chain to a WAV file stored in the project's `.mapp-temp/freeze/` directory. Set `TrackData.frozen = true`. Bypass all insert effects on the `MixerChannel`. Swap the instrument `AudioNode` in the `AudioGraph` with an `AudioClipPlayer` pointing at the freeze WAV. The frozen waveform renders in the track's timeline clip area.
- [ ] **Unfreeze track**: reverse the freeze — restore the original instrument `AudioNode` and re-enable all insert effects. Delete the temporary freeze WAV. Set `TrackData.frozen = false`.
- [ ] **Bounce in place**: same offline render as freeze, but the WAV is saved to the project's `samples/` directory as a permanent `SampleReference`. Replace all clips on the track with a single `ClipContent::Audio` clip spanning the same range that was rendered. Change `TrackData.track_type` from `Midi` to `Audio`. Remove the `InstrumentData` from the track. The operation is not reversible via this command (undo via Sprint 26 undo system).
- [ ] Freeze and bounce operate on the track's arrangement range: by default the full arrangement length (beat 0 to the last clip end); optionally the user can specify a custom range in the dialog.
- [ ] Progress indicator: a modal progress bar dialog emits `freeze_progress` Tauri events (0.0–1.0) during the offline render, updated every 100 render blocks.
- [ ] Frozen tracks continue to respond to mixer fader, pan, mute, solo, send levels, and automation lane playback — only the instrument DSP and insert effects are bypassed.
- [ ] Frozen track header in the React UI displays a snowflake icon and a teal "FROZEN" badge. The freeze button toggles to "Unfreeze".
- [ ] Frozen track clips display the rendered waveform using waveform peak data (same pipeline as Sprint 37's `AudioClipPlayer` waveform cache).
- [ ] Tauri commands: `freeze_track`, `unfreeze_track`, `bounce_track_in_place`, `get_freeze_progress`, `cancel_freeze`.
- [ ] Project save/load correctly persists `frozen` state and `freeze_wav_path` in `TrackData`. On project open, if a frozen track's temp WAV is present, the freeze state is restored automatically. If the temp WAV is missing (cleaned up), the track is silently unfrozen on load with a logged warning.

### Non-Functional Requirements

- [ ] Offline render runs faster than realtime — a 32-bar track at 120 BPM (approximately 64 seconds of audio) must complete in under 10 seconds on a modern PC.
- [ ] Freeze render executes on a Tokio background task — the audio engine continues playback and the UI remains responsive during the render.
- [ ] No allocations or mutex locking on the audio callback thread during the freeze swap. The `AudioGraph` swap uses the existing `TripleBuffer` mechanism from Sprint 2.
- [ ] Temp freeze files are stored in `<project_dir>/.mapp-temp/freeze/<track_id>_freeze.wav`. This directory is excluded from project ZIP archives but persists alongside the `.mapp` file between sessions.
- [ ] Bounce in place adds the rendered WAV inside the project ZIP archive at `samples/<uuid>_bounce.wav` using the Sprint 4 project file I/O system.
- [ ] Cancellation via `cancel_freeze` is checked at the start of every render block loop. Partial freeze WAV is deleted on cancel. The track state is left unmodified.
- [ ] Maximum render range: 60 minutes of audio (same limit as Sprint 37's streaming player). Attempts to freeze tracks longer than this emit a user-facing error.

## Dependencies

- **Sprint 2** — `AudioNode` trait, `AudioGraph`, `TripleBuffer` for lock-free graph swapping. The freeze swap replaces one node in the graph using `TripleBuffer::publish()`.
- **Sprint 17** — `MixerChannel` with insert effects slots and `AtomicBool` bypass flags. Freeze sets all bypass flags on the frozen track's `MixerChannel` without removing the effects from the chain.
- **Sprint 21** — `EffectChain` and `EffectSlot` with per-slot `bypass: AtomicBool`. Freeze calls a new `EffectChain::freeze_all()` method that stores each slot's previous bypass state and forces all slots bypassed. Unfreeze calls `EffectChain::unfreeze_all()` to restore saved bypass states.
- **Sprint 22** — `OfflineRenderer` and `FileWriter` (WAV via `hound`). The freeze engine re-uses `OfflineRenderer::render_single_track(track_id, range, output_path)` rather than duplicating render logic.
- **Sprint 30** — `TrackData` struct in `src-tauri/src/project/format.rs`. This sprint adds `frozen: bool` and `freeze_wav_path: Option<String>` fields to `TrackData`.
- **Sprint 37** — `AudioClipPlayer` (`src-tauri/src/audio/clip_player.rs`). The freeze swap inserts an `AudioClipPlayer` node into the `AudioGraph` in place of the instrument node. Waveform peak extraction from Sprint 37's `waveform.rs` is reused for the frozen clip display.

## Scope

### In Scope

- `src-tauri/src/audio/freeze.rs` — `FreezeEngine`: orchestrates the offline render for a single track, manages temp file paths, executes the `AudioGraph` swap via `TripleBuffer`, emits `freeze_progress` Tauri events, handles cancellation via `Arc<AtomicBool>`.
- `src-tauri/src/audio/freeze.rs` — `FreezeCommand` enum: `Freeze { track_id, range }`, `Unfreeze { track_id }`, `Bounce { track_id, range }`.
- `src-tauri/src/audio/freeze.rs` — `FreezeState` struct tracking in-progress freeze tasks by `track_id`, stored in Tauri managed state as `Arc<Mutex<FreezeState>>`.
- `src-tauri/src/project/format.rs` — extend `TrackData` with `frozen: bool` (default `false`) and `freeze_wav_path: Option<String>` (default `None`).
- `src-tauri/src/project/format.rs` — extend `TrackType` with the existing `Audio`, `Midi`, `Bus` variants (no new variants needed — bounce changes `Midi` to `Audio`).
- `src-tauri/src/audio/effect_chain.rs` — add `freeze_all() -> Vec<bool>` (saves and force-bypasses all slots) and `unfreeze_all(saved_states: Vec<bool>)` (restores bypass states) to `EffectChain`.
- Tauri commands in `src-tauri/src/audio/commands.rs`: `freeze_track`, `unfreeze_track`, `bounce_track_in_place`, `get_freeze_progress`, `cancel_freeze`.
- `src/components/daw/TrackHeader.tsx` — add Freeze/Unfreeze button, frozen badge, and frozen waveform display integration.
- `src/components/daw/FreezeProgressDialog.tsx` — modal dialog with progress bar, track name, and Cancel button. Subscribes to the `freeze_progress` Tauri event.
- `src/stores/trackStore.ts` — add `frozen` and `freezeWavPath` fields to the frontend `Track` type; add `freezeTrack()`, `unfreezeTrack()`, `bounceTrack()` actions that invoke IPC.
- `src/lib/ipc.ts` — typed wrappers: `freezeTrack(trackId, range?)`, `unfreezeTrack(trackId)`, `bounceTrackInPlace(trackId, range?)`, `getFreezeProgress(trackId)`, `cancelFreeze(trackId)`.

### Out of Scope

- Freezing bus tracks or the master bus (instrument tracks only in this sprint).
- Automation rendering into the freeze WAV (automation continues to apply via the mixer post-freeze; pre-fader automation on instrument parameters is lost on bounce — document as known limitation).
- Freeze of VST3 plugin tracks (Sprint 23/24 adds VST3; freeze support for VST3 is a follow-up).
- Partial track freeze (freezing only a selected clip range within a track that has clips outside that range).
- Auto-freeze on project load (manual action only in this sprint).
- Cloud or shared project sync of freeze temp files.

## Technical Approach

### Offline Render for a Single Track

`FreezeEngine` reuses `OfflineRenderer` from Sprint 22 but scopes it to a single track. The key method is:

```rust
pub async fn render_track_to_wav(
    &self,
    track_id: &str,
    range_beats: RangeBeats,
    output_path: &Path,
    cancel: Arc<AtomicBool>,
    progress_tx: Sender<f32>,
) -> Result<(), FreezeError>
```

Internally this creates a minimal `AudioGraph` containing only the target track's instrument `AudioNode` and its `EffectChain` (without the mixer fader/pan/sends — those remain active in the realtime graph post-freeze). The renderer iterates in a tight loop: advance transport, call `graph.process(&mut render_buffer, sample_rate, 2)`, pass samples to a `hound::WavWriter`, check `cancel.load(Ordering::Relaxed)`, and emit progress every 100 blocks. No `sleep()`, no timer — the render is as fast as the CPU allows.

### AudioGraph Swap (Freeze)

After the WAV is written, `FreezeEngine` constructs a new `AudioGraph` that is identical to the current one except the frozen track's instrument node is replaced with an `AudioClipPlayer` initialized with the freeze WAV path. The swap is published via `TripleBuffer::publish(new_graph)`. This is lock-free and zero-allocation on the audio thread — the audio thread picks up the new graph at the boundary of the next audio buffer.

### Effect Chain Bypass (Freeze)

Freeze does not remove effects from the `EffectChain` — this preserves the user's configuration for unfreeze. Instead, `EffectChain::freeze_all()` iterates all `EffectSlot`s, saves their current `bypass` `AtomicBool` value, and stores the vector of saved states on the `FreezeEngine`. It then sets all slots to `bypass = true`. Because `EffectSlot::bypass` is an `AtomicBool` (per Sprint 21), this is safe to do from the main thread while the audio thread is running. The audio thread's bypass check happens at the top of each slot's `process` call, so the change takes effect at the next audio buffer boundary.

### Unfreeze

`unfreeze_track` reverses all steps in LIFO order:
1. Call `EffectChain::unfreeze_all(saved_states)` — restores each slot's original bypass value.
2. Construct a new `AudioGraph` replacing the `AudioClipPlayer` node back with the original instrument node (retrieved from the `FreezeState` where it was stored before the freeze swap).
3. Publish via `TripleBuffer::publish(restored_graph)`.
4. Delete the temp WAV at `.mapp-temp/freeze/<track_id>_freeze.wav`.
5. Update `TrackData.frozen = false` and `TrackData.freeze_wav_path = None` in the `ProjectFile` and propagate to `trackStore`.

### Bounce in Place

Bounce follows the same offline render as freeze but writes to the project's `samples/` directory with a UUID filename. After render completes:
1. Register a new `SampleReference` in `ProjectFile.samples`.
2. Compute the beat range of all clips on the track (union of all `ClipData.start_beats` to `start_beats + duration_beats`).
3. Replace `TrackData.clips` with a single `ClipData` whose `content` is `ClipContent::Audio { sample_id: new_id, start_offset_samples: 0, gain: 1.0 }`.
4. Set `TrackData.track_type = TrackType::Audio`.
5. Set `TrackData.instrument = None`.
6. Publish an `AudioGraph` with the bounce `AudioClipPlayer` node (no instrument node, same effect chain).
7. Trigger a project save (or mark the project dirty for the user to save).

Bounce does not touch the `EffectChain` — effects remain active on the now-Audio track, processing the bounced clip during real-time playback.

### Frontend State Model

`trackStore` gains:

```typescript
interface Track {
  // ... existing fields from Sprint 30 ...
  frozen: boolean;
  freezeWavPath: string | null;
}
```

The `FreezeProgressDialog` is mounted at the `DawLayout` level (not inside `TrackHeader`) so it survives any track list re-renders during the freeze operation. It listens for the `freeze_progress` event from `@tauri-apps/api/event` and renders a Radix UI `Dialog` with a progress bar (`value = progress * 100`). The dialog auto-dismisses when `progress === 1.0` or when the user clicks Cancel (which calls `cancelFreeze(trackId)`).

### Temp Directory Lifecycle

`.mapp-temp/freeze/` is created by `FreezeEngine` on first use (using `std::fs::create_dir_all`). It is deliberately excluded from the project ZIP archive produced by Sprint 4's `io.rs` — the exclusion pattern is added to the archive builder's skip list. Freeze WAVs are deleted by Unfreeze. A project-close cleanup pass in `io.rs` optionally purges stale freeze WAVs (files in `.mapp-temp/freeze/` whose `track_id` is no longer in the project).

## Data Model Changes

### `TrackData` Extension (src-tauri/src/project/format.rs)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrackData {
    // ... all existing fields unchanged ...

    /// Whether this track is currently frozen.
    ///
    /// When `true`, the instrument DSP and insert effects are bypassed and
    /// playback is driven by the freeze WAV at `freeze_wav_path`.
    #[serde(default)]
    pub frozen: bool,

    /// Path to the temporary freeze WAV file, relative to the project directory.
    ///
    /// `None` when the track is not frozen. Set to `Some(".mapp-temp/freeze/<id>_freeze.wav")`
    /// during freeze. Cleared to `None` on unfreeze.
    #[serde(default)]
    pub freeze_wav_path: Option<String>,
}
```

The `#[serde(default)]` attributes ensure backward compatibility — existing project files without these fields deserialize correctly (both fields default to their Rust defaults: `false` and `None`).

### New File: src-tauri/src/audio/freeze.rs

```rust
/// Render range expressed in beats (project timeline coordinates).
pub struct RangeBeats {
    pub start: f64,
    pub end: f64,
}

/// Tracks the state of an in-progress or completed freeze operation per track.
pub struct TrackFreezeRecord {
    pub track_id: String,
    /// The original instrument AudioNode, stored here while the track is frozen
    /// so it can be restored on unfreeze without re-instantiating the instrument.
    pub original_node: Box<dyn AudioNode>,
    /// Saved per-slot bypass states from EffectChain::freeze_all().
    pub saved_bypass_states: Vec<bool>,
    /// Absolute path to the freeze WAV on disk.
    pub wav_path: PathBuf,
}

/// Manages all freeze and bounce operations.
///
/// Stored in Tauri managed state as `Arc<Mutex<FreezeEngine>>`.
pub struct FreezeEngine {
    /// Currently frozen tracks, keyed by track_id.
    frozen_tracks: HashMap<String, TrackFreezeRecord>,
    /// Cancellation flags for in-progress renders, keyed by track_id.
    cancel_flags: HashMap<String, Arc<AtomicBool>>,
    /// In-progress render progress (0.0–1.0), keyed by track_id.
    progress: HashMap<String, Arc<AtomicF32>>,
}
```

## Key Files

| File | Change Type | Description |
|------|-------------|-------------|
| `src-tauri/src/audio/freeze.rs` | New | `FreezeEngine`, `TrackFreezeRecord`, `RangeBeats`, render loop, AudioGraph swap |
| `src-tauri/src/project/format.rs` | Extend | Add `frozen: bool` and `freeze_wav_path: Option<String>` to `TrackData` |
| `src-tauri/src/audio/effect_chain.rs` | Extend | Add `freeze_all()` and `unfreeze_all()` to `EffectChain` |
| `src-tauri/src/audio/commands.rs` | Extend | Add `freeze_track`, `unfreeze_track`, `bounce_track_in_place`, `get_freeze_progress`, `cancel_freeze` Tauri commands |
| `src-tauri/src/audio/mod.rs` | Extend | Re-export `freeze` module |
| `src-tauri/src/lib.rs` | Extend | Register `FreezeEngine` in Tauri managed state; register new commands in `tauri::Builder` |
| `src/components/daw/TrackHeader.tsx` | Extend | Freeze/Unfreeze button, frozen badge, waveform display for frozen clip |
| `src/components/daw/FreezeProgressDialog.tsx` | New | Modal progress bar dialog, cancel button, Tauri event listener |
| `src/stores/trackStore.ts` | Extend | `frozen`, `freezeWavPath` fields; `freezeTrack()`, `unfreezeTrack()`, `bounceTrack()` actions |
| `src/lib/ipc.ts` | Extend | `freezeTrack()`, `unfreezeTrack()`, `bounceTrackInPlace()`, `getFreezeProgress()`, `cancelFreeze()` typed wrappers |

## Tasks

### Phase 1: Planning

- [ ] Review how Sprint 22's `OfflineRenderer` is structured — confirm its `render_single_track` extension point or whether a new narrower renderer needs to be written from scratch.
- [ ] Confirm that `EffectChain::freeze_all()` / `unfreeze_all()` accessing `AtomicBool` bypass flags from the main thread while the audio thread runs is safe under Rust's memory model (it is — `Ordering::SeqCst` on the set, `Ordering::Relaxed` on the read in the audio callback is sufficient).
- [ ] Design the `TrackFreezeRecord` storage strategy: confirm that `Box<dyn AudioNode>` can be held in `FreezeEngine`'s `HashMap` while the audio thread runs a different graph (it can — the frozen node is owned by `FreezeEngine` on the main thread; the audio thread owns its `AudioGraph` independently via `TripleBuffer`).
- [ ] Clarify temp directory location: use `<project_dir>/.mapp-temp/freeze/` rather than a system temp dir to ensure freeze WAVs survive application restarts and map correctly on project re-open.
- [ ] Confirm that the `TripleBuffer` swap mechanism in Sprint 2 supports replacing a single node (it does not natively — a full new `AudioGraph` must be constructed). Document that freeze reconstruction must clone all non-frozen nodes' state, which means all `AudioNode` implementations need a `clone_node()` or similar method. Flag this as a planning risk and propose either `AudioNode: Clone` bound or a `NodeSnapshot` serialization approach.
- [ ] Decide bounce behavior for automation lanes on the source track: automation targeting instrument parameters (e.g. `instrument.synth.filter_cutoff`) becomes meaningless after bounce. Document that bounce logs a warning and preserves automation data as inert lanes on the converted Audio track (they do not apply but are not deleted, allowing recovery via undo).

### Phase 2: Backend Implementation

- [ ] Extend `TrackData` in `src-tauri/src/project/format.rs` with `frozen` and `freeze_wav_path` fields, both with `#[serde(default)]` for backward compatibility.
- [ ] Add schema migration in `src-tauri/src/project/version.rs` to handle old project files missing these fields (handled by `#[serde(default)]` but document the migration version bump).
- [ ] Implement `EffectChain::freeze_all() -> Vec<bool>` — iterates `EffectSlot`s, stores each `bypass.load(SeqCst)`, sets `bypass.store(true, SeqCst)`, returns saved states.
- [ ] Implement `EffectChain::unfreeze_all(saved_states: &[bool])` — iterates slots, calls `bypass.store(saved_states[i], SeqCst)` for each.
- [ ] Implement `freeze.rs` module: `FreezeEngine`, `TrackFreezeRecord`, `RangeBeats`, `FreezeError` (using `thiserror`).
- [ ] Implement `FreezeEngine::render_track_to_wav()` — builds a minimal `AudioGraph` with only the target track's instrument + effect chain, runs the offline render loop (same pattern as Sprint 22 `OfflineRenderer`), writes WAV using `hound::WavWriter`, emits `freeze_progress` Tauri events every 100 blocks, respects `cancel` `AtomicBool`.
- [ ] Implement `FreezeEngine::freeze_track()` — calls `render_track_to_wav`, stores the original instrument node in `TrackFreezeRecord`, calls `EffectChain::freeze_all()`, constructs a new `AudioGraph` with `AudioClipPlayer` replacing the instrument node, publishes via `TripleBuffer::publish()`, updates `TrackData.frozen` and `TrackData.freeze_wav_path`.
- [ ] Implement `FreezeEngine::unfreeze_track()` — calls `EffectChain::unfreeze_all()`, constructs a new `AudioGraph` restoring the original instrument node, publishes via `TripleBuffer::publish()`, deletes temp WAV, clears `TrackData.frozen` and `TrackData.freeze_wav_path`.
- [ ] Implement `FreezeEngine::bounce_track_in_place()` — calls `render_track_to_wav()` with the project's `samples/` directory as output, registers `SampleReference`, replaces clips with `ClipContent::Audio`, sets `TrackType::Audio`, clears `InstrumentData`, publishes updated `AudioGraph`.
- [ ] Implement Tauri commands in `commands.rs`: `freeze_track`, `unfreeze_track`, `bounce_track_in_place`, `get_freeze_progress`, `cancel_freeze`. All commands receive `track_id: String` and optional `range_beats: Option<[f64; 2]>`. Spawn Tokio tasks for the render operations.
- [ ] Register `FreezeEngine` in Tauri managed state in `lib.rs` alongside `AudioEngine` and `MidiManager`.
- [ ] Register new commands in `tauri::Builder::invoke_handler()` in `lib.rs`.
- [ ] Add `.mapp-temp/freeze/` to the skip list in Sprint 4's archive builder (`io.rs`) so freeze WAVs are not included in project ZIP exports.

### Phase 2: Frontend Implementation

- [ ] Add `frozen: boolean` and `freezeWavPath: string | null` to the `Track` interface in `trackStore.ts`.
- [ ] Add `freezeTrack(trackId: string, range?: [number, number])`, `unfreezeTrack(trackId: string)`, and `bounceTrack(trackId: string, range?: [number, number])` Zustand actions that call the corresponding `ipc.ts` wrappers and update local state optimistically.
- [ ] Add typed IPC wrappers in `ipc.ts`: `freezeTrack`, `unfreezeTrack`, `bounceTrackInPlace`, `getFreezeProgress`, `cancelFreeze`.
- [ ] Build `FreezeProgressDialog.tsx` — uses Radix UI `Dialog` (same pattern as other dialogs in the project). Subscribes to the `freeze_progress` Tauri event via `listen()` from `@tauri-apps/api/event`. Displays the track name, a `<progress>` element, and a Cancel button that calls `cancelFreeze(trackId)`. Auto-dismisses at `progress === 1.0`.
- [ ] Extend `TrackHeader.tsx` — add a Freeze button that shows "Freeze" when `track.frozen === false` and "Unfreeze" when `track.frozen === true`. On click, open a `FreezeOptionsPopover` (range: full song or custom bar range) then open `FreezeProgressDialog`. Add a teal "FROZEN" badge visible when `track.frozen === true`.
- [ ] Add right-click context menu item "Bounce in Place..." on `TrackHeader` for Midi tracks. Opens the same range-selector popover, then invokes `bounceTrack()`. Bounce is not available on already-frozen tracks (greyed out) or Audio tracks.
- [ ] Update `TrackHeader.tsx` to render the frozen clip's waveform (from `freezeWavPath` waveform peaks, loaded via `get_waveform_peaks` from Sprint 37) in the clip area when `track.frozen === true`.
- [ ] Disable the instrument editor open button and the effect chain edit button on frozen tracks (both are greyed out with a tooltip: "Unfreeze to edit").

### Phase 3: Validation

- [ ] Unit test (`freeze.rs`): `render_track_to_wav` with a `SineTestNode` as the instrument produces a valid WAV file with non-zero audio content.
- [ ] Unit test (`freeze.rs`): cancel via `AtomicBool` during render stops the loop after the current block; partial WAV is deleted; the function returns `FreezeError::Cancelled`.
- [ ] Unit test (`effect_chain.rs`): `freeze_all()` sets all slots to bypassed and returns the correct previous states; `unfreeze_all()` restores them exactly.
- [ ] Unit test (`format.rs`): `TrackData` with missing `frozen` and `freeze_wav_path` fields deserializes from old JSON without error (backward compatibility via `#[serde(default)]`).
- [ ] Unit test (`format.rs`): `TrackData` with `frozen: true` and a `freeze_wav_path` round-trips through JSON serialization correctly.
- [ ] Component test (`FreezeProgressDialog.tsx`): renders with `progress = 0.5` and shows a progress bar at 50%. Cancel button calls the `cancelFreeze` IPC wrapper.
- [ ] Component test (`TrackHeader.tsx`): shows "Freeze" button when `track.frozen === false`; shows "Unfreeze" button and "FROZEN" badge when `track.frozen === true`.
- [ ] Integration smoke test: create a Midi track with a `SineTestNode` instrument, freeze it — confirm the AudioGraph now contains an `AudioClipPlayer` for that track, the temp WAV exists on disk, and audio output is unchanged.
- [ ] Integration smoke test: unfreeze — confirm the AudioGraph restores the original instrument node, temp WAV is deleted, effect chain bypass states are restored.
- [ ] Integration smoke test: bounce in place on a Midi track — confirm `TrackType` is `Audio`, `InstrumentData` is `None`, clips are replaced with a single `ClipContent::Audio`, and the sample file exists in the project's `samples/` directory.
- [ ] Manual: freeze an 8-bar instrument track at 120 BPM (~16 seconds) — confirm render completes in under 5 seconds.
- [ ] Manual: open a project with a frozen track — confirm frozen state is restored, AudioGraph uses `AudioClipPlayer`, FROZEN badge visible.
- [ ] Manual: open a project where the freeze WAV is missing — confirm the track silently unfreezes on load and a warning is logged to the console.

### Phase 4: Documentation

- [ ] Rustdoc on `FreezeEngine`, `TrackFreezeRecord`, `RangeBeats`, `FreezeError`, and all Tauri commands in `freeze.rs`.
- [ ] Rustdoc on `EffectChain::freeze_all()` and `unfreeze_all()` explaining the thread-safety guarantee (atomic operations only, no mutex).
- [ ] Update rustdoc on `TrackData` to document the `frozen` and `freeze_wav_path` fields and their lifecycle.
- [ ] TSDoc on `FreezeProgressDialog`, the `freezeTrack` / `unfreezeTrack` / `bounceTrack` store actions, and all `ipc.ts` wrappers.
- [ ] Add a comment in `io.rs` documenting why `.mapp-temp/` is excluded from the project ZIP archive.
- [ ] Document the known limitation that automation targeting instrument parameters is rendered silently (no playback effect) on a bounced Audio track, and that the lane data is preserved inert for undo recovery.

## Acceptance Criteria

- [ ] Clicking "Freeze" on a Midi instrument track renders it to a temp WAV, swaps the AudioGraph to use `AudioClipPlayer`, bypasses all insert effects, and displays a FROZEN badge — all without audio dropout during playback.
- [ ] A frozen track plays back identical audio to the original (same fader, pan, sends applied; same audio content).
- [ ] Clicking "Unfreeze" restores the original instrument node and all effect chain bypass states exactly as they were before freeze.
- [ ] Temp WAV is deleted after unfreeze. The `.mapp-temp/freeze/` directory is not included in the project ZIP.
- [ ] Freeze render completes faster than realtime (logged benchmark > 1× speed to the Rust console).
- [ ] The progress dialog updates during the render and reaches 100% on completion.
- [ ] Cancel stops the render cleanly. No partial WAV is left on disk. Track state is unchanged.
- [ ] Bounce in Place converts a Midi track to an Audio track with a single audio clip spanning the rendered range.
- [ ] Bounced audio clip produces the same audio as the original instrument track.
- [ ] Project save/load round-trips frozen state correctly. Frozen badge and `AudioClipPlayer` are restored on project open.
- [ ] Missing freeze WAV on project open silently unfreezes the track with a logged warning (no crash, no error dialog).
- [ ] All Rust unit tests pass. All component tests pass.
- [ ] Frozen tracks in the UI show the waveform of the freeze file in the clip area.
- [ ] Instrument editor and effect chain panel are disabled (greyed out) on frozen tracks.

## Notes

Created: 2026-02-23

**Architecture risk — AudioNode cloning for TripleBuffer swap**: Sprint 2's `TripleBuffer` requires publishing a complete new `AudioGraph`. This means that to freeze one track, the `FreezeEngine` must reconstruct the entire graph with all other nodes intact. This requires either (a) all `AudioNode` impls to be cheaply cloneable, or (b) `FreezeEngine` to hold an `Arc<>` reference to each non-frozen node that is shared between the old and new graph instances. Option (b) is preferred since it avoids deep-copying DSP state. The `AudioNode` trait will need to be extended with `fn as_shared(self: Box<Self>) -> Arc<Mutex<dyn AudioNode>>` or an equivalent mechanism. This design decision must be resolved in Phase 1 planning before implementation begins.

**Dependency note**: Sprint 22 (`OfflineRenderer`) and Sprint 37 (`AudioClipPlayer`) are not yet implemented at the time this sprint is planned. This sprint assumes both will be completed before Sprint 40 executes, in accordance with the dependency order documented in `CLAUDE.md`.
