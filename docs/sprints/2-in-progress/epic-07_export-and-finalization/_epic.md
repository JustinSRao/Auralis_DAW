---
epic: 07
title: "Export & Finalization"
status: in-progress
created: 2026-02-22
started: 2026-03-31T20:58:02Z
completed: null

---

# Epic 07: Export & Finalization

## Overview

Enables musicians to export their finished projects as audio files for distribution or further processing. The export system renders audio offline at faster-than-realtime speed, supporting full stereo mix export as well as individual stem exports (one file per track). Output formats include WAV, MP3, and FLAC at user-selectable bit depth and sample rate.

## Success Criteria

- [ ] Offline bounce completes faster than realtime for a typical 32-bar project
- [ ] Full stereo mix exports correctly as WAV at 16/24/32-bit and 44100/48000 Hz
- [ ] Individual stems are exported as separate files, one per track, with correct naming
- [ ] MP3 and FLAC export produce valid files playable in standard media players
- [ ] Progress bar in the UI accurately reflects export completion percentage

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| 22 | Audio Export (Stereo Mix & Stems) | planned |

## Backlog

- [ ] Export metadata/tags (artist, title, BPM)
- [ ] Loudness normalization option (LUFS target)

## Notes

Created: 2026-02-22
