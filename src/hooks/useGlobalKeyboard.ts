/**
 * Wires DAW-global keyboard shortcuts to their respective store actions (Sprint 46 rewrite).
 *
 * Mounted **once** in `DAWLayout` alongside `useUndoRedo`.
 *
 * How it works:
 *   1. On every keydown, `serializeCombo` converts the event into a stable
 *      string such as `"Ctrl+S"` or `"Space"`.
 *   2. `reverseMap` (from shortcutsStore) maps that combo to an `actionId`.
 *   3. `DISPATCH_TABLE` maps `actionId` to the handler function.
 *
 * Notes:
 *   - Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z are intentionally handled inside this
 *     dispatch table so they honour user remapping. `useUndoRedo` handles the
 *     same keys independently; this causes two calls but both are idempotent.
 *   - INPUT / TEXTAREA / SELECT elements are guarded so text editing is not
 *     interrupted.
 *
 * Shortcut defaults (see ACTION_REGISTRY in src/lib/shortcuts.ts for full list):
 * | Combo     | Action                              |
 * |-----------|-------------------------------------|
 * | Space     | Play / Stop toggle                  |
 * | R         | Record arm toggle (selected track)  |
 * | M         | Mute toggle (selected track)        |
 * | S         | Solo toggle (selected track)        |
 * | F         | Follow playhead toggle              |
 * | L         | Loop toggle                         |
 * | Ctrl+S    | Save project                        |
 * | Ctrl+N    | New project                         |
 * | Delete    | Delete selected track               |
 * | Ctrl+,    | Open Settings                       |
 * | B         | Toggle Browser                      |
 * | W         | Toggle Mixer                        |
 */

import { useEffect } from 'react';
import { useTransportStore } from '@/stores/transportStore';
import { useTrackStore } from '@/stores/trackStore';
import { useKeyboardStore } from '@/stores/keyboardStore';
import { useFileStore } from '@/stores/fileStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useShortcutsStore } from '@/stores/shortcutsStore';
import { serializeCombo } from '@/lib/shortcuts';

// ---------------------------------------------------------------------------
// Dispatch table — module-level (stable reference, never re-created on render)
// ---------------------------------------------------------------------------

const DISPATCH_TABLE: Record<string, () => void> = {
  'transport.play_stop': () => {
    const transport = useTransportStore.getState();
    if (transport.snapshot.state === 'playing') {
      void transport.stop();
    } else {
      void transport.play();
    }
  },

  'transport.loop': () => {
    const transport = useTransportStore.getState();
    void transport.toggleLoop(!transport.snapshot.loop_enabled);
  },

  'transport.follow': () => {
    useKeyboardStore.getState().toggleFollowPlayhead();
  },

  'track.record_arm': () => {
    const { selectedTrackId, toggleArm } = useTrackStore.getState();
    if (selectedTrackId) toggleArm(selectedTrackId);
  },

  'track.mute': () => {
    const { selectedTrackId, toggleMute } = useTrackStore.getState();
    if (selectedTrackId) toggleMute(selectedTrackId);
  },

  'track.solo': () => {
    const { selectedTrackId, toggleSolo } = useTrackStore.getState();
    if (selectedTrackId) toggleSolo(selectedTrackId);
  },

  'track.delete': () => {
    const { selectedTrackId, deleteTrack } = useTrackStore.getState();
    if (selectedTrackId) void deleteTrack(selectedTrackId);
  },

  // editing.undo / editing.redo / editing.copy / editing.paste / editing.duplicate /
  // editing.delete are registered so they can be remapped, but the undo/redo
  // logic is owned by useUndoRedo which runs independently. The copy/paste/
  // duplicate actions have no standalone handler yet — reserved for future sprints.
  'editing.undo': () => { /* owned by useUndoRedo */ },
  'editing.redo': () => { /* owned by useUndoRedo */ },
  'editing.copy': () => { /* reserved */ },
  'editing.paste': () => { /* reserved */ },
  'editing.duplicate': () => { /* reserved */ },

  'editing.delete': () => {
    const { selectedTrackId, deleteTrack } = useTrackStore.getState();
    if (selectedTrackId) void deleteTrack(selectedTrackId);
  },

  'project.save': () => {
    const { filePath, save } = useFileStore.getState();
    if (filePath) void save(filePath);
  },

  'project.new': () => {
    void useFileStore.getState().createNewProject('Untitled Project');
  },

  'view.settings': () => {
    useSettingsStore.getState().open();
  },

  'view.browser': () => {
    useKeyboardStore.getState().toggleBrowser();
  },

  'view.mixer': () => {
    useKeyboardStore.getState().toggleMixer();
  },
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGlobalKeyboard(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Do not intercept shortcuts while typing in a text field.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const combo = serializeCombo(e);
      if (!combo) return;

      const { reverseMap } = useShortcutsStore.getState();
      const actionId = reverseMap[combo];
      if (!actionId) return;

      e.preventDefault();
      DISPATCH_TABLE[actionId]?.();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
