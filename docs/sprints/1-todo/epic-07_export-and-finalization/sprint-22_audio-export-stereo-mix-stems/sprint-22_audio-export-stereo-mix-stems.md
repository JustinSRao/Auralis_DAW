---
sprint: 22
title: "Audio Export (Stereo Mix & Stems)"
type: fullstack
epic: 7
status: planning
created: 2026-02-22T22:10:13Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 22: Audio Export (Stereo Mix & Stems)

## Overview

| Field | Value |
|-------|-------|
| Sprint | 22 |
| Title | Audio Export (Stereo Mix & Stems) |
| Type | fullstack |
| Epic | 7 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement an offline bounce export system that renders the entire project arrangement to audio faster than realtime, supporting stereo mix and individual stem exports as WAV, MP3, or FLAC at configurable bit depth and sample rate.

## Background

Exporting finished audio is the final step of every music production workflow. Without export, users cannot share, distribute, or master their music outside the DAW. Offline bouncing (faster-than-realtime rendering) is critical for usability — a 3-minute song should not take 3 minutes to export. This sprint completes the full production lifecycle of the DAW.

## Requirements

### Functional Requirements

- [ ] Export full stereo mix: renders the entire arrangement (all tracks, full mixer, all effects) to a single stereo audio file
- [ ] Export stems: renders each track/channel independently to a separate file (one file per track, labeled with track name)
- [ ] Output formats: WAV (16-bit or 24-bit or 32-bit float), MP3 (128/192/320 kbps via LAME-compatible encoder), FLAC (lossless)
- [ ] Sample rate selection: 44100 Hz or 48000 Hz
- [ ] Configurable export range: full song, loop region, or custom bar range
- [ ] Progress bar in React UI showing export percentage completion
- [ ] Open exported file in Explorer on completion (optional)
- [ ] Tauri commands: `start_export`, `cancel_export`, `get_export_progress`

### Non-Functional Requirements

- [ ] Offline export renders at minimum 5× realtime speed on a modern PC (5 minutes of audio exported in under 1 minute)
- [ ] Stem export processes tracks independently — stems sum to the same output as the stereo mix (pre-fader stems)
- [ ] Export runs on a Tokio background task; main thread and UI remain responsive during export
- [ ] WAV writing uses `hound` crate; FLAC encoding uses `claxon` or `symphonia` encoder; MP3 uses `mp3lame-encoder` or equivalent Rust binding

## Dependencies

- **Sprints**: Sprint 2 (AudioEngine — offline render reuses the DSP graph), Sprint 17 (Mixer — full signal chain), Sprint 18/19/20/21 (effects — included in render), Sprint 13 (song timeline arrangement — defines what to render)
- **External**: `hound` (WAV), `claxon` or `symphonia` (FLAC), MP3 encoder crate

## Scope

### In Scope

- `src-tauri/src/export/offline_renderer.rs` — `OfflineRenderer` that drives the audio graph without a real-time stream
- `src-tauri/src/export/writer.rs` — format-specific file writing (WAV via hound, FLAC, MP3)
- `src-tauri/src/export/stem_splitter.rs` — runs render once per track with other tracks muted
- Tauri commands: `start_export`, `cancel_export`, `get_export_progress`
- Tauri event: `export_progress_changed` (0.0–1.0 fraction for progress bar)
- React `ExportDialog`: format selector (WAV/MP3/FLAC), bit depth dropdown, sample rate dropdown, range selector (full song/loop/custom), stem toggle, file path picker, export button, progress bar

### Out of Scope

- Video export
- Cloud upload / distribution integration
- Mastering loudness normalization (backlog feature)
- Batch export of multiple projects

## Technical Approach

`OfflineRenderer` creates an audio graph instance identical to the realtime one but not connected to a cpal stream. It has a method `render_block(buffer: &mut [f32])` that runs the full graph (instruments, sequencer, mixer, effects) for `block_size` samples per call. The renderer iterates in a loop, advancing the transport position, calling `render_block`, and passing the output to the `FileWriter`. The transport position advances discretely — no timer, no sleep — making it as fast as the CPU allows. Progress is computed as `current_sample / total_samples` and emitted as a Tauri event every 100 blocks. For stem export, the render loop runs once per track: all other tracks are muted at the mixer level before rendering, and the track's channel output is captured pre-master-bus. Cancellation is handled via an `Arc<AtomicBool>` checked at the start of each render block loop iteration.

## Tasks

### Phase 1: Planning
- [ ] Design `OfflineRenderer` interface — how does it reuse the same AudioGraph without code duplication?
- [ ] Research MP3 encoding crate options for Rust (mp3lame-sys or native Rust implementation)
- [ ] Plan stem isolation strategy — mute all but one channel per stem render pass

### Phase 2: Implementation
- [ ] Implement `OfflineRenderer` that runs the full audio graph in offline mode
- [ ] Implement `FileWriter` for WAV (hound, 16/24/32-bit integer and float formats)
- [ ] Implement `FileWriter` for FLAC
- [ ] Implement `FileWriter` for MP3
- [ ] Implement `StemSplitter` — iterates tracks, mutes others, runs `OfflineRenderer` per track
- [ ] Implement `start_export` Tauri command (spawns Tokio task)
- [ ] Implement `cancel_export` command (sets cancellation AtomicBool)
- [ ] Emit `export_progress_changed` event every 100 blocks
- [ ] Build React `ExportDialog` with all format/quality options and progress bar
- [ ] Add "Export" menu item or button in DAW toolbar

### Phase 3: Validation
- [ ] Export a 2-minute stereo mix as WAV 24-bit — file is valid, playback matches realtime playback
- [ ] Same export at 5× or greater speed (2 min → export finishes in < 24 s)
- [ ] Export stems for a 4-track project — 4 separate WAV files, each containing only that track
- [ ] Cancel mid-export — task stops cleanly, partial file deleted
- [ ] Export as FLAC — file opens in VLC and sounds correct
- [ ] Export as MP3 320 kbps — file opens in any media player

### Phase 4: Documentation
- [ ] Rustdoc on `OfflineRenderer`, `FileWriter`, `StemSplitter`
- [ ] Document export speed bottlenecks (effects with large delay lines, etc.)

## Acceptance Criteria

- [ ] Stereo mix export produces a WAV file that sounds identical to real-time playback
- [ ] Export completes faster than realtime (benchmark logged to console)
- [ ] Stem export produces one file per track with correct content
- [ ] WAV, MP3, and FLAC formats all produce valid, playable files
- [ ] Progress bar in UI updates during export and reaches 100% on completion
- [ ] Cancel button stops the export without crashing
- [ ] Exported file uses the configured sample rate and bit depth

## Notes

Created: 2026-02-22
