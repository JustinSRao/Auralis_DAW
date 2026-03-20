---
epic: 05
title: "Audio Editing"
status: planning
created: 2026-02-22
started: null
completed: null
---

# Epic 05: Audio Editing

## Overview

Provides non-destructive audio clip editing tools for working with recorded or imported audio within the DAW. This epic covers a visual waveform editor with cut, trim, reverse, and splice operations, as well as time stretching and pitch shifting that allows audio clips to be adapted to the project tempo and key without affecting each other.

## Success Criteria

- [ ] Waveform editor renders audio clips with zoom and supports cut, trim, reverse, and splice at zero crossings
- [ ] Undo/redo history works correctly for all waveform editing operations
- [ ] Time stretch adjusts clip duration to match project BPM without changing pitch
- [ ] Pitch shift changes clip pitch in semitones without changing tempo
- [ ] All operations are non-destructive (original audio buffer is preserved; edits are stored as metadata)

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| 15 | Waveform Editor (Cut, Trim, Reverse, Splice) | planned |
| 16 | Time Stretch & Pitch Shift | planned |

## Backlog

- [ ] Spectral editing view

## Notes

Clip fades and crossfades are implemented in Sprint 45 (Audio Clip Fades) which lives in Epic 06 (Mixer & Effects) due to its dependency on Sprint 37 (Audio Clip Playback Engine).

## Notes

Created: 2026-02-22
