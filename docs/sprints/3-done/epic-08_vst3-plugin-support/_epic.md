---
epic: 08
title: "VST3 Plugin Support"
status: done
created: 2026-02-22
started: null
completed: 2026-04-01T16:32:57Z

total_hours: 0.0
---

# Epic 08: VST3 Plugin Support

## Overview

Adds the ability to load and run third-party VST3 plugins — both instruments and effects — directly within the DAW. The Rust backend scans VST3 plugin directories, loads .vst3 bundles via vst3-sys, and routes audio and MIDI through them. A UI bridge opens the plugin's native Windows GUI as a child window attached to the Tauri window, and a plugin browser panel allows discovering and loading plugins from the project.

## Success Criteria

- [ ] VST3 plugin directories are scanned and all discovered plugins are listed in the browser
- [ ] A VST3 instrument plugin receives MIDI and produces audio routed through the mixer
- [ ] A VST3 effect plugin inserts into an effect chain and processes audio correctly
- [ ] Plugin native GUI opens in a child window attached to the main Tauri window
- [ ] Plugin state (parameter values) is saved in the project file and restored on load

## Sprints

| Sprint | Title | Status |
|--------|-------|--------|
| 23 | VST3 Plugin Host (Rust) | planned |
| 24 | VST3 UI Bridge & Plugin Management | planned |

## Backlog

- [ ] Plugin sandboxing / crash isolation
- [ ] Plugin preset (.vstpreset) file browser

## Notes

Created: 2026-02-22
