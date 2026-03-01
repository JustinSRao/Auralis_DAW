import { useEffect } from 'react';
import { useTransportStore } from '@/stores/transportStore';
import { useTrackStore } from '@/stores/trackStore';
import { useKeyboardStore } from '@/stores/keyboardStore';
import { useFileStore } from '@/stores/fileStore';

/**
 * Wires DAW-global keyboard shortcuts to their respective store actions.
 *
 * Mounted **once** in `DAWLayout` alongside `useUndoRedo`.
 * Does NOT intercept Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — those are owned by
 * `useUndoRedo` and must not be double-handled here.
 * Guards against INPUT / TEXTAREA / SELECT focus to preserve text editing.
 *
 * Shortcut reference:
 * | Key               | Action                                     |
 * |-------------------|--------------------------------------------|
 * | Space             | Play / Stop toggle                         |
 * | R                 | Record arm toggle (selected track)         |
 * | M                 | Mute toggle (selected track)               |
 * | S                 | Solo toggle (selected track)               |
 * | F                 | Follow playhead toggle                     |
 * | L                 | Loop toggle                                |
 * | Ctrl+S            | Save project                               |
 * | Ctrl+N            | New project                                |
 * | Delete / Backspace| Delete selected track (when no text field) |
 */
export function useGlobalKeyboard(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Do not intercept shortcuts while typing in a text field.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — owned by useUndoRedo, skip entirely.
      if (ctrl && (key === 'z' || key === 'y')) return;

      // Ctrl+S — save project to the current file path.
      if (ctrl && key === 's') {
        e.preventDefault();
        const { filePath, save } = useFileStore.getState();
        if (filePath) void save(filePath);
        return;
      }

      // Ctrl+N — create a new (untitled) project.
      if (ctrl && key === 'n') {
        e.preventDefault();
        void useFileStore.getState().createNewProject('Untitled Project');
        return;
      }

      // Ignore other Ctrl combos — they may be browser or OS shortcuts.
      if (ctrl) return;

      const { selectedTrackId, toggleMute, toggleSolo, toggleArm, deleteTrack } =
        useTrackStore.getState();
      const transport = useTransportStore.getState();
      const keyboard = useKeyboardStore.getState();

      switch (key) {
        case ' ':
          e.preventDefault();
          if (transport.snapshot.state === 'playing') {
            void transport.stop();
          } else {
            void transport.play();
          }
          break;

        case 'r':
          if (selectedTrackId) toggleArm(selectedTrackId);
          break;

        case 'm':
          if (selectedTrackId) toggleMute(selectedTrackId);
          break;

        case 's':
          if (selectedTrackId) toggleSolo(selectedTrackId);
          break;

        case 'f':
          keyboard.toggleFollowPlayhead();
          break;

        case 'l':
          // Loop toggle — transport store owns the loop state.
          // The enabled flag is the logical inverse of the current state.
          void transport.toggleLoop(!transport.snapshot.loop_enabled);
          break;

        case 'delete':
        case 'backspace':
          if (selectedTrackId) void deleteTrack(selectedTrackId);
          break;

        default:
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
