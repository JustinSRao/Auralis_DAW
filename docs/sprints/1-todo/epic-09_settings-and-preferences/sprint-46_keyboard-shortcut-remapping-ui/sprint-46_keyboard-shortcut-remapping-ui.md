---
sprint: 46
title: "Keyboard Shortcut Remapping UI"
type: fullstack
epic: 9
status: planning
created: 2026-02-23T17:06:08Z
started: null
completed: null
hours: null
workflow_version: "3.1.0"
---

# Sprint 46: Keyboard Shortcut Remapping UI

## Overview

| Field | Value |
|-------|-------|
| Sprint | 46 |
| Title | Keyboard Shortcut Remapping UI |
| Type | fullstack |
| Epic | 9 |
| Status | Planning |
| Created | 2026-02-23 |
| Started | - |
| Completed | - |

## Goal

Add a keyboard shortcuts settings tab where users can view all available actions, see their current key bindings, remap any shortcut to a custom key combination, detect conflicts, and reset to defaults — enabling power users to match their muscle memory from other DAWs.

## Background

Sprint 30 (DAW Shell) hardcodes default keyboard shortcuts in `useGlobalKeyboard.ts` and `keyboardStore.ts`: Space=play/stop, R=record, Ctrl+S=save, Delete=delete, etc. Sprint 27 (Settings UI) explicitly deferred keyboard shortcut remapping. Power users migrating from Ableton, FL Studio, Logic, or Pro Tools have deeply ingrained muscle memory for different shortcut layouts. Without remapping, every session starts with frustration as users reach for shortcuts that don't work as expected.

## Requirements

### Functional Requirements

- [ ] New "Shortcuts" tab added to the Settings panel (Sprint 27)
- [ ] Searchable list of all registered actions, grouped by category: Transport (play, stop, record, loop), Editing (delete, duplicate, cut, copy, paste, undo, redo), Track (mute, solo, arm, rename), View (follow playhead, toggle browser, toggle mixer), Project (new, open, save, save as)
- [ ] Each action row shows: action name, category, current key binding displayed as a formatted badge (e.g., "Ctrl+S")
- [ ] Click "Remap" button on an action to enter capture mode: a modal overlay says "Press new key combination..." and captures the next keydown event
- [ ] Escape cancels capture mode without changing the binding
- [ ] Conflict detection: if the captured key combo is already assigned to another action, show a warning dialog with options: "Swap" (swap bindings between the two actions), "Replace" (unbind the other action), or "Cancel"
- [ ] "Reset" button per action: restores that action's binding to the default
- [ ] "Reset All to Defaults" button: restores all shortcuts to Sprint 30's defaults
- [ ] Search/filter bar at the top of the shortcuts list: filters by action name or current key combo
- [ ] Custom shortcuts persisted in Sprint 27's AppConfig TOML under a `[shortcuts]` section
- [ ] Shortcut changes take effect immediately without app restart
- [ ] Support modifier combos: Ctrl, Shift, Alt, Ctrl+Shift, Ctrl+Alt, Ctrl+Shift+Alt

### Non-Functional Requirements

- [ ] Shortcut lookup is O(1) via `HashMap<KeyCombo, ActionId>` in `keyboardStore`
- [ ] Settings panel loads instantly even with 50+ registered shortcuts
- [ ] Shortcut list uses virtualized rendering for performance with many actions
- [ ] Key combo display is platform-aware (shows "Ctrl" on Windows)

## Dependencies

- **Sprints**: Sprint 27 (Settings & Preferences UI — provides SettingsPanel modal with tabs, AppConfig TOML persistence, settingsStore), Sprint 30 (Main DAW Shell — defines default shortcuts in `keyboardStore.ts` and `useGlobalKeyboard.ts`, registers all action names)
- **External**: None

## Scope

### In Scope

- Extension to `src/stores/keyboardStore.ts` — load custom mappings from AppConfig on startup, maintain reverse map (key combo -> action) for conflict detection, `remapShortcut()`, `resetShortcut()`, `resetAllShortcuts()` actions
- Extension to Sprint 27's `AppConfig` — `[shortcuts]` TOML section mapping action IDs to key combo strings
- Extension to Sprint 27's Tauri `save_config` / `get_config` to include shortcuts
- `src/components/settings/ShortcutsTab.tsx` — the main shortcuts settings tab
- `src/components/settings/ShortcutRow.tsx` — individual action row with name, category, key badge, remap button, reset button
- `src/components/settings/KeyCaptureModal.tsx` — modal overlay for capturing a new key combination
- `src/components/settings/ConflictDialog.tsx` — warning dialog when a key combo is already in use
- `src/components/settings/KeyBadge.tsx` — styled badge displaying a key combo (e.g., "Ctrl + S")
- Search/filter functionality on the shortcuts list
- Category grouping with collapsible sections

### Out of Scope

- Chord shortcuts (two sequential key presses — backlog)
- Per-context shortcuts (different shortcuts when piano roll is focused vs. timeline — backlog)
- Import/export shortcut profiles (backlog)
- Shortcut cheat sheet overlay (backlog)
- macOS key display (Cmd instead of Ctrl — Windows-only for now)

## Technical Approach

`keyboardStore` is extended with three maps:
1. `defaultBindings: Map<ActionId, KeyCombo>` — Sprint 30's hardcoded defaults, immutable
2. `currentBindings: Map<ActionId, KeyCombo>` — active bindings (custom overrides merged on top of defaults)
3. `reverseMap: Map<string, ActionId>` — key combo string -> action, for O(1) conflict detection

On startup, `keyboardStore` calls `get_config` to load the `[shortcuts]` section. Any custom bindings override the defaults in `currentBindings`. The `reverseMap` is rebuilt from `currentBindings`.

`useGlobalKeyboard` (Sprint 30) is refactored to read from `currentBindings` instead of hardcoded values. On each `keydown`, it serializes the event to a key combo string (e.g., `"ctrl+shift+d"`) and looks up the `reverseMap` for the action to dispatch.

The `KeyCaptureModal` listens for a single `keydown` event, serializes it to a key combo string, checks `reverseMap` for conflicts, and either applies the remap or shows `ConflictDialog`. The TOML persistence format is:

```toml
[shortcuts]
play_stop = "Space"
record_arm = "R"
save_project = "Ctrl+S"
delete_selection = "Delete"
```

Only non-default bindings are persisted (sparse storage). On "Reset to Defaults", the `[shortcuts]` section is cleared.

## Tasks

### Phase 1: Planning
- [ ] Catalog all actions registered in Sprint 30's `keyboardStore` with their default bindings and categories
- [ ] Design the `KeyCombo` serialization format (string representation of modifier + key)
- [ ] Plan the TOML `[shortcuts]` section schema
- [ ] Design the capture modal UX flow (enter capture -> press key -> conflict check -> apply/cancel)

### Phase 2: Implementation
- [ ] Refactor `keyboardStore.ts` to separate `defaultBindings` from `currentBindings` with reverse map
- [ ] Implement `remapShortcut(actionId, newCombo)`, `resetShortcut(actionId)`, `resetAllShortcuts()` store actions
- [ ] Implement key combo serializer: `KeyboardEvent -> "ctrl+shift+d"` string format
- [ ] Refactor `useGlobalKeyboard.ts` to read from `currentBindings` via reverse map lookup
- [ ] Extend Sprint 27 AppConfig with `[shortcuts]` TOML section and Tauri command updates
- [ ] Load custom shortcuts from AppConfig on app startup, merge with defaults
- [ ] Build `ShortcutsTab.tsx` — category-grouped, searchable action list
- [ ] Build `ShortcutRow.tsx` — action name, category tag, `KeyBadge`, remap/reset buttons
- [ ] Build `KeyCaptureModal.tsx` — overlay with "Press new key combination..." prompt
- [ ] Build `ConflictDialog.tsx` — swap/replace/cancel options when key combo conflicts
- [ ] Build `KeyBadge.tsx` — styled modifier+key display component
- [ ] Implement search/filter bar filtering by action name or key combo string
- [ ] Persist only non-default bindings (sparse storage) on save

### Phase 3: Validation
- [ ] Open Settings -> Shortcuts tab — all default shortcuts listed with correct bindings
- [ ] Remap "Play/Stop" from Space to Enter — Enter now toggles play, Space does nothing
- [ ] Remap to a conflicting combo — conflict dialog appears with swap/replace/cancel options
- [ ] Choose "Swap" — both actions swap their key bindings correctly
- [ ] Reset a single shortcut — returns to Sprint 30's default
- [ ] Reset All — all shortcuts return to defaults, `[shortcuts]` section cleared from TOML
- [ ] Search "ctrl" — only actions with Ctrl modifier shown
- [ ] Close and reopen app — custom shortcuts persist and work correctly
- [ ] Modifier combos (Ctrl+Shift+D) capture and display correctly

### Phase 4: Documentation
- [ ] TSDoc on `keyboardStore` extension: `defaultBindings`, `currentBindings`, `reverseMap`, `remapShortcut()`
- [ ] Document the key combo serialization format
- [ ] Document the TOML `[shortcuts]` schema

## Acceptance Criteria

- [ ] All registered actions are visible in the Shortcuts settings tab with their current bindings
- [ ] Users can remap any shortcut by clicking "Remap" and pressing a new key combination
- [ ] Conflict detection warns when a key combo is already assigned and offers swap/replace/cancel
- [ ] Reset per-action and Reset All restore default bindings
- [ ] Custom shortcuts persist across app restarts via AppConfig TOML
- [ ] Shortcut changes take effect immediately without restart
- [ ] Search/filter works by action name and key combo
- [ ] All tests pass

## Notes

Created: 2026-02-23
Sprint 27 explicitly deferred this: "Keyboard shortcut remapping UI (backlog in Epic 9)." Sprint 30 designed `keyboardStore` with a map-based architecture specifically to enable this future remapping sprint.
