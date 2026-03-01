import { useEffect } from 'react';
import { useHistoryStore } from '@/stores/historyStore';

/**
 * Registers global keyboard shortcuts for undo and redo.
 *
 * Mount this hook **once** at the DAW layout level. It attaches a `keydown`
 * listener to `document` and removes it on unmount.
 *
 * Shortcuts:
 * - `Ctrl+Z`           → undo
 * - `Ctrl+Shift+Z`     → redo
 * - `Ctrl+Y`           → redo
 *
 * The handler is a no-op when the focused element is an editable field
 * (`INPUT`, `TEXTAREA`, `SELECT`) so that native text-editing shortcuts are
 * not intercepted.
 */
export function useUndoRedo(): void {
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Check the event target's tag so the guard works correctly in both the
      // browser (where document.activeElement is reliable) and in jsdom tests
      // (where fireEvent.focus does not always update document.activeElement).
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!e.ctrlKey) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);
}
