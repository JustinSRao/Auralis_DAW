---
sprint: 24
title: "VST3 UI Bridge & Plugin Management"
type: fullstack
epic: 8
status: done
created: 2026-02-22T22:10:14Z
started: 2026-04-01T12:04:49Z
completed: 2026-04-01
hours: null
workflow_version: "3.1.0"


---

# Sprint 24: VST3 UI Bridge & Plugin Management

## Overview

| Field | Value |
|-------|-------|
| Sprint | 24 |
| Title | VST3 UI Bridge & Plugin Management |
| Type | fullstack |
| Epic | 8 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Build the VST3 native GUI bridge that opens a plugin's own editor window as a child of the Tauri window, and create a plugin browser panel and preset browser for discovering, loading, and dragging plugins onto instrument or effect slots.

## Background

Most VST3 plugins provide their own native Windows GUI (DirectX/OpenGL-rendered). Users expect to be able to open these GUIs by clicking on the plugin in the DAW. Without the GUI bridge, users can only control plugins via parameter knobs — missing the visual editor that most plugins are designed around. This sprint completes the VST3 epic by adding the full user-facing plugin management UI on top of Sprint 23's host backend.

## Requirements

### Functional Requirements

- [ ] Open a VST3 plugin's native editor GUI as a Win32 child window parented to the Tauri window's HWND
- [ ] Plugin GUI window resizable, draggable as a floating panel within the DAW window
- [ ] Close plugin GUI without unloading the plugin (keeps audio processing active)
- [ ] Plugin browser panel: lists all scanned VST3 plugins, grouped by category (Instrument / Effect / Dynamics / etc.)
- [ ] Plugin browser search: filter plugins by name
- [ ] Drag a plugin from the browser onto an instrument slot (for synths) or an effect chain slot (for effects) to load it
- [ ] Plugin preset browser: lists factory presets for the selected plugin via `IUnitInfo`/`IPresetManager`
- [ ] Clicking a preset applies it to the loaded plugin instance
- [ ] Plugin chain slot UI: shows plugin name, open GUI button, bypass toggle, remove button
- [ ] Tauri commands: `open_plugin_gui`, `close_plugin_gui`, `get_plugin_presets`, `apply_plugin_preset`

### Non-Functional Requirements

- [ ] Native GUI window opens in < 200 ms after "open GUI" button clicked
- [ ] Plugin GUI thread runs on the main Windows UI thread (required by most Win32 GUI plugins)
- [ ] Closing the main DAW window also closes all open plugin GUIs
- [ ] Plugin browser with 200 plugins renders without lag using React list virtualization

## Dependencies

- **Sprints**: Sprint 23 (VST3 host — plugins already loaded and processing audio; this sprint adds the GUI layer), Sprint 21 (effect chain — plugin effect slots need the open-GUI button)
- **External**: `windows` crate (Win32 HWND API for child window parenting), `vst3-sys` (IPlugView interface)

## Scope

### In Scope

- `src-tauri/src/vst3/gui_bridge.rs` — `Vst3GuiBridge`: opens `IPlugView`, creates a Win32 child window and embeds plugin view via `IPlugView::attached`
- `src-tauri/src/vst3/preset_manager.rs` — enumerate factory presets for a plugin via VST3 preset API
- Tauri commands: `open_plugin_gui`, `close_plugin_gui`, `resize_plugin_gui`, `get_plugin_presets`, `apply_plugin_preset`
- React `PluginBrowser` panel: categorized tree list of scanned plugins with search input, drag handle per plugin
- React `PluginPresetBrowser`: list of presets for the selected/active plugin, apply-on-click
- React `PluginSlot` component: used in instrument and effect chain panels to show loaded plugin name, open-GUI button, bypass, remove
- HTML5 drag from `PluginBrowser` to instrument slot or effect chain slot

### Out of Scope

- Linux/macOS plugin GUI support (Windows only — Tauri's HWND accessible on Windows)
- Plugin sandboxing in a child process
- Custom parameter mapping UI (Sprint 23 handles parameter knobs)
- VST3 MIDI learn

## Technical Approach

`Vst3GuiBridge` retrieves the Tauri window's Win32 HWND using the `tauri::Window::hwnd()` API (available on Windows via `tauri::Manager`). It calls `IComponent::createInstance(IPlugView)` to get the plugin's view object, then calls `IPlugView::getSize()` to determine the GUI dimensions and creates a Win32 child window (via `windows-sys::Win32::UI::WindowsAndMessaging::CreateWindowExW`) parented to the Tauri HWND. `IPlugView::attached(hwnd, kPlatformTypeHWND)` embeds the plugin's GUI into the child window. The child window is positioned as a floating panel within the Tauri window client area. Preset enumeration uses `IPresetManager` or reads `.vstpreset` files from the plugin's standard preset folder (`Documents\VST3 Presets\{Vendor}\{Plugin}`). The React `PluginBrowser` fetches the scanned plugin list from Zustand (populated by Sprint 23's `scan_vst3_plugins`) and renders it as a virtualized tree with `react-virtual` or `@tanstack/react-virtual`.

## Tasks

### Phase 1: Planning
- [ ] Confirm `tauri::Window::hwnd()` API is available in Tauri 2 on Windows (check Tauri docs)
- [ ] Test Win32 child window creation and plugin embedding with a known plugin (e.g., LABS)
- [ ] Design `PluginBrowser` component layout — tree by category, flat search results

### Phase 2: Implementation
- [ ] Implement `Vst3GuiBridge` — get Tauri HWND, create child window, call `IPlugView::attached`
- [ ] Implement `close_plugin_gui` — call `IPlugView::removed`, destroy Win32 child window
- [ ] Implement `get_plugin_presets` — enumerate factory presets via preset folder or IPresetManager
- [ ] Implement `apply_plugin_preset` — call `IComponent::setState` with preset file bytes
- [ ] Build React `PluginBrowser` with category tree, search filter, virtualized list, drag handle
- [ ] Build React `PluginPresetBrowser` with preset list and apply-on-click
- [ ] Build React `PluginSlot` component (show plugin name, open-GUI button, bypass toggle, remove button)
- [ ] Wire drag-from-browser drop onto `PluginSlot` (instrument) or `EffectChainPanel` slot
- [ ] Close all plugin GUIs on Tauri window close event

### Phase 3: Validation
- [ ] Click "Open GUI" on a loaded plugin (e.g., Surge XT free) — native plugin GUI appears embedded in DAW window
- [ ] Close GUI — window disappears, plugin continues processing audio
- [ ] Load 200 plugins in browser — list renders fast, search filters correctly
- [ ] Browse factory presets for a plugin — list appears, clicking a preset changes the plugin sound
- [ ] Drag a VST3 synth from browser onto an instrument slot — plugin loads and plays MIDI notes
- [ ] Drag a VST3 effect from browser onto an effect chain slot — plugin processes audio

### Phase 4: Documentation
- [ ] Rustdoc on `Vst3GuiBridge`, child window creation, `IPlugView` lifecycle
- [ ] Document Win32 HWND retrieval approach and Tauri 2 API used
- [ ] Document preset folder convention and fallback when IPresetManager is not implemented

## Acceptance Criteria

- [ ] A VST3 plugin's native GUI opens as a child window within the Tauri window
- [ ] The GUI window closes without stopping the plugin's audio processing
- [ ] Plugin browser lists all scanned plugins organized by category
- [ ] Search field filters the plugin list by name in real time
- [ ] Dragging a plugin from the browser onto a slot loads and activates it
- [ ] Plugin presets are listed and can be applied by clicking
- [ ] All open plugin GUI windows close when the main DAW window closes

## Notes

Created: 2026-02-22
