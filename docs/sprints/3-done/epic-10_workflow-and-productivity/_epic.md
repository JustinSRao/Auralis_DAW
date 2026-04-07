---
epic: 10
title: "Workflow & Productivity"
status: done
created: 2026-02-23
started: null
completed: 2026-04-06T17:39:51Z

total_hours: 0.0
---

# Epic 10: Workflow & Productivity

## Overview

Delivers the workflow-accelerating features that professional DAW users depend on daily: a sample and content browser panel for navigating files and dragging them into the project, a MIDI Learn system for mapping any physical hardware controller knob, fader, or button to any DAW parameter in real time, and a track freeze/bounce system for reclaiming CPU from instrument tracks.

## Success Criteria

- [ ] Sample browser panel navigates the file system, previews audio files, and supports drag-to-track
- [ ] Browser has a Favorites system and remembers recently accessed folders
- [ ] MIDI Learn mode lets users right-click any parameter and map it to an incoming CC message
- [ ] MIDI mappings are saved in the project file and restored on load
- [ ] All active MIDI mappings are visible and deletable in a mapping table
- [ ] Freeze renders an instrument track to a WAV and bypasses DSP to reclaim CPU
- [ ] Bounce in Place converts a MIDI instrument track to a permanent audio clip

## Sprints

| Sprint | Title | Status | Key Dependencies |
|--------|-------|--------|-----------------|
| 28 | Sample & Content Browser | planned | Sprint 7 |
| 29 | MIDI Learn & Hardware Controller Mapping | planned | Sprint 3, 29 |
| 40 | Track Freeze and Bounce in Place | planned | Sprint 17, 21, 22, 37 |

## Backlog

- [ ] VST preset browser integration
- [ ] Cloud sample library browser
- [ ] Macro knobs (one knob controls multiple mapped parameters)

## Notes

Created: 2026-02-23
Updated: Sprint 40 (Track Freeze and Bounce in Place) added — it depends on Sprint 37 (Epic 06) and Sprint 22 (Epic 07), so it runs after those epics are complete.
