---
sprint: 37
title: "Audio Clip Playback Engine"
type: fullstack
epic: 4
status: planning
created: 2026-02-23T12:32:34Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 37: Audio Clip Playback Engine

## Overview

| Field | Value |
|-------|-------|
| Sprint | 37 |
| Title | Audio Clip Playback Engine |
| Type | fullstack |
| Epic | 4 |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Read recorded and imported WAV/audio files from disk and play them back through the mixer at the correct bar position during arrangement playback, completing the audio track pipeline that Sprint 9 (recording) and Sprint 13 (timeline display) started.

## Background

Sprint 9 records audio to WAV files and creates `AudioClip` entries in the project state. Sprint 13 displays clip blocks on the song timeline. Sprint 31 (Arrangement Playback Engine) schedules playback, but only handles MIDI patterns — it dispatches `StartPattern` commands to instrument `AudioNode`s and has no concept of reading WAV files from disk. The result is a complete gap: users can record audio, see it on the timeline, but hear nothing when they press play. This sprint builds the engine that reads audio files off disk, sample-rate converts if necessary, and feeds the audio into the mixer at the correct transport position.

## Requirements

### Functional Requirements

- [ ] `AudioClipPlayer` node reads WAV/FLAC/MP3 audio files from disk using `symphonia` for decoding
- [ ] Audio clips are scheduled by bar position: when the transport reaches a clip's start bar, playback begins from the clip's start offset
- [ ] Sample rate conversion via `rubato` when the clip sample rate differs from the engine sample rate
- [ ] Audio clips feed into their track's mixer channel (Sprint 17) just like instrument outputs
- [ ] Multiple audio clips can play simultaneously on different tracks
- [ ] Audio clips on the same track do not overlap (later clip takes priority, or crossfade — TBD in planning)
- [ ] Clip gain: per-clip volume adjustment (0.0–2.0, default 1.0)
- [ ] Clip offset: ability to start playback from a point other than the beginning of the file (trim start)
- [ ] Waveform data extraction: compute and cache waveform peaks for timeline display (Sprint 13 integration)
- [ ] Tauri commands: `load_audio_clip`, `set_clip_gain`, `set_clip_offset`, `get_waveform_peaks`

### Non-Functional Requirements

- [ ] Audio file reading uses a dedicated I/O thread — never read from disk on the audio callback thread
- [ ] Pre-buffer: read ahead at least 2x the buffer size to avoid underruns during playback
- [ ] Stream large files: do not load entire WAV into memory; use streaming decode with a ring buffer
- [ ] Support files up to 1 hour in length (stereo 44.1 kHz = ~635 MB WAV)
- [ ] Waveform peak cache stored alongside the project file for instant timeline rendering

## Dependencies

- **Sprints**: Sprint 2 (Audio Engine — `AudioNode` trait, output buffer), Sprint 9 (Audio Recording — produces WAV files and `AudioClip` entries), Sprint 13 (Song Timeline — displays clips, needs waveform peaks), Sprint 17 (Mixer — audio clips feed into mixer channels), Sprint 25 (Transport — provides bar/beat position for scheduling), Sprint 31 (Arrangement Playback — extends scheduler to handle audio clips alongside MIDI patterns)
- **External**: `symphonia` (audio decoding), `rubato` (sample rate conversion) — both already in Cargo.toml from Sprint 2

## Scope

### In Scope

- `src-tauri/src/audio/clip_player.rs` — `AudioClipPlayer` struct: streaming decode, ring buffer, sample rate conversion, scheduled playback
- `src-tauri/src/audio/clip_scheduler.rs` — integrates with Sprint 31's arrangement scheduler to dispatch audio clip start/stop alongside MIDI patterns
- `src-tauri/src/audio/waveform.rs` — waveform peak extraction and caching (min/max peaks per N samples for zoom levels)
- Tauri commands for clip loading, gain, offset, and waveform data
- Integration with Sprint 17 mixer: `AudioClipPlayer` output feeds into the track's `MixerChannel`
- Integration with Sprint 31 scheduler: extend `ScheduledClip` to support audio clip type in addition to pattern type
- React: waveform rendering in Sprint 13's timeline clip blocks (provide peak data, Sprint 13 renders)

### Out of Scope

- Audio clip editing / destructive processing (Sprint 15 Waveform Editor)
- Time stretch / pitch shift of audio clips (Sprint 16)
- Audio clip recording (Sprint 9 owns this)
- Crossfade between overlapping clips (backlog — v2 feature)
- Real-time effects on audio clips (Sprint 21 Effect Chain handles insert effects on the mixer channel)

## Technical Approach

`AudioClipPlayer` implements the `AudioNode` trait. It owns a `symphonia` `FormatReader` and `Decoder` for streaming decode. A dedicated I/O thread reads ahead into a `ringbuf` lock-free ring buffer (capacity = 4x audio buffer size). The audio callback drains the ring buffer into its output buffer. If the clip's sample rate differs from the engine rate, a `rubato` resampler is inserted between the decoder output and the ring buffer. The clip scheduler (extending Sprint 31) maintains a list of `ScheduledAudioClip { clip_id, track_id, start_bar, duration_bars, file_path, gain, start_offset_samples }`. When the transport reaches `start_bar`, it sends a `StartAudioClip` command to the appropriate `AudioClipPlayer` node. The player seeks the decoder to `start_offset_samples` and begins filling the ring buffer. At `start_bar + duration_bars`, a `StopAudioClip` command stops playback. Waveform peaks are computed on load (background task) and cached as a binary file (`.peaks`) alongside the audio file for instant timeline rendering.

## Tasks

### Phase 1: Planning
- [ ] Design `AudioClipPlayer` node lifecycle: created per audio track, receives clip start/stop commands
- [ ] Design streaming decode architecture: I/O thread → ring buffer → audio callback
- [ ] Plan waveform peak format: number of zoom levels, samples per peak, binary cache format
- [ ] Decide overlap behavior: last-clip-wins vs. error vs. crossfade

### Phase 2: Implementation
- [ ] Implement `AudioClipPlayer` with `symphonia` streaming decode and `ringbuf` ring buffer
- [ ] Implement dedicated I/O reader thread with pre-buffering (read-ahead 2x buffer)
- [ ] Implement `rubato` sample rate conversion for mismatched clip/engine rates
- [ ] Implement clip gain and start offset (seek to offset on clip start)
- [ ] Implement `AudioClipScheduler` extending Sprint 31's arrangement scheduler
- [ ] Add `ScheduledAudioClip` type alongside existing `ScheduledClip` (MIDI patterns)
- [ ] Wire `AudioClipPlayer` output into Sprint 17 mixer channel for the track
- [ ] Implement waveform peak extraction (background Tokio task on clip load)
- [ ] Implement `.peaks` binary cache file read/write
- [ ] Add Tauri commands: `load_audio_clip`, `set_clip_gain`, `set_clip_offset`, `get_waveform_peaks`
- [ ] Provide waveform peak data to Sprint 13 timeline for clip block rendering

### Phase 3: Validation
- [ ] Record a 4-bar audio clip (Sprint 9), place on timeline (Sprint 13), press play — audio is heard at the correct position
- [ ] Play two audio clips on different tracks simultaneously — both audible, mixed correctly
- [ ] Load a WAV at 48 kHz into a 44.1 kHz session — sample rate conversion produces correct pitch
- [ ] Set clip gain to 0.5 — audio plays back at half volume
- [ ] Set clip start offset — playback starts from the trimmed position
- [ ] Waveform peaks render in the timeline clip block
- [ ] Play a 5-minute audio file — no memory spike (streaming decode confirmed)
- [ ] No audio glitches during clip playback (ring buffer does not underrun)

### Phase 4: Documentation
- [ ] Rustdoc on `AudioClipPlayer`, `AudioClipScheduler`, waveform peak format
- [ ] Document the streaming decode pipeline: file → symphonia → resampler → ring buffer → audio callback
- [ ] Document `.peaks` cache format for future compatibility

## Acceptance Criteria

- [ ] Recorded WAV files play back through the mixer at the correct bar position when the transport plays
- [ ] Audio clips on the timeline produce audible output synchronized to the transport
- [ ] Multiple simultaneous audio clips play without glitches
- [ ] Sample rate conversion works transparently for mismatched files
- [ ] Clip gain and start offset controls function correctly
- [ ] Waveform peak data is available for timeline rendering
- [ ] Large files stream from disk without excessive memory usage
- [ ] All tests pass

## Notes

Created: 2026-02-23
This sprint closes the critical gap where audio can be recorded (Sprint 9) and displayed (Sprint 13) but never heard during playback. It extends Sprint 31's arrangement scheduler to handle audio clips alongside MIDI patterns.
