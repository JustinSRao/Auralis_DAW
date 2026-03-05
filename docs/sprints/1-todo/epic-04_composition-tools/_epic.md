---
epic: 04
title: "Composition Tools"
status: planning
created: 2026-02-22
started: null
completed: null
---

# Epic 04: Composition Tools

## Overview

Delivers all sequencing, arrangement, and recording tools that allow a musician to compose full songs in the DAW. This epic covers a step sequencer, a MIDI piano roll editor, a pattern management system, a song timeline/playlist view, an automation editor, MIDI recording from hardware controllers, arrangement playback, MIDI file import/export, punch in/out recording, and loop recording with take lanes.

## Success Criteria

- [ ] Step sequencer plays 16/32/64-step patterns per-step with note, velocity, gate, and probability
- [ ] Piano roll editor supports placing, resizing, and deleting MIDI notes with velocity editing and quantization
- [ ] Patterns can be created, named, duplicated, and browsed via a pattern panel
- [ ] Song timeline arranges patterns across all tracks with drag-and-drop and loop region support
- [ ] Automation lanes record and play back any parameter change with linear, exponential, and step curve types
- [ ] Live MIDI keyboard performances are recorded as editable notes in the piano roll
- [ ] Arrangement clips play back in sequence from the audio engine when transport is running
- [ ] Standard MIDI (.mid) files can be imported and exported as patterns
- [ ] Punch in/out recording allows overdubbing a specific section without re-recording the whole take
- [ ] Loop recording captures multiple takes per loop pass and supports comping in take lanes
- [ ] Tempo automation allows BPM changes over the course of a song via a tempo track

## Sprints

| Sprint | Title | Status | Key Dependencies |
|--------|-------|--------|-----------------|
| 10 | Step Sequencer | planned | Sprint 2, 3, 25, 30 |
| 11 | Piano Roll Editor | planned | Sprint 3, 12 |
| 12 | Pattern System | planned | Sprint 3, 30 |
| 13 | Song Timeline & Playlist | planned | Sprint 3, 6-8, 25, 30 |
| 14 | Automation Editor | planned | Sprint 13 |
| 36 | MIDI Recording | planned | Sprint 3, 11, 12, 25 |
| 31 | Arrangement Playback Engine | planned | Sprint 2, 12, 13, 25 |
| 32 | MIDI File Import | planned | Sprint 11, 12 |
| 38 | Punch In/Out Recording | planned | Sprint 9, 13, 25, 36 |
| 44 | Loop Recording and Take Lanes | planned | Sprint 9, 12, 13, 25, 30, 36 |
| 41 | Tempo Automation | planned | Sprint 14, 25, 31 |
| 43 | MIDI Export | planned | Sprint 11, 12, 13, 25, 32 |

## Backlog

- [ ] Chord mode for step sequencer
- [ ] MIDI CC automation recording

## Notes

Created: 2026-02-22
Updated: Sprint 36 (MIDI Recording), Sprint 38 (Punch In/Out), Sprint 41 (Tempo Automation), Sprint 43 (MIDI Export), Sprint 44 (Loop Recording) added. Sprint 37 (Audio Clip Playback Engine) moved to Epic 06 — it has a hard dependency on Sprint 17 (Mixer).
