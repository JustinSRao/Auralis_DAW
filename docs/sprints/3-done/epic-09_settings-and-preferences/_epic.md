---
epic: 09
title: "Settings & Preferences"
status: done
created: 2026-02-23
started: null
completed: 2026-04-03T19:08:56Z

total_hours: 0.0
---

# Epic 09: Settings & Preferences

## Overview

Provides a unified Settings panel where users can configure every aspect of the DAW environment: audio interface selection, buffer size and sample rate, MIDI device routing, default project directory, keyboard shortcuts, and UI preferences. Without this epic, the IPC commands built in Sprints 2 and 3 have no user-facing entry point.

## Success Criteria

- [ ] Users can select audio output/input device, buffer size, and sample rate from a settings panel
- [ ] MIDI input and output device routing is configurable per device
- [ ] Settings persist across app restarts (stored in SQLite or app config file)
- [ ] Default project folder is configurable
- [ ] UI preferences (theme, zoom level) are persisted
- [ ] Users can remap any keyboard shortcut to a custom key combination with conflict detection

## Sprints

| Sprint | Title | Status | Key Dependencies |
|--------|-------|--------|-----------------|
| 27 | Settings & Preferences UI | planned | Sprint 2, 3 |
| 46 | Keyboard Shortcut Remapping UI | planned | Sprint 27, 30 |

## Backlog

- [ ] Export format defaults
- [ ] Auto-save interval setting

## Notes

Created: 2026-02-23
Updated: Sprint 46 (Keyboard Shortcut Remapping UI) added — it was deferred from Sprint 27 and Sprint 30 and belongs in this epic.
