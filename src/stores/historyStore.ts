import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { HistoryManager, type Command } from '../lib/history';

/**
 * A single entry in the rendered history list.
 */
export interface HistoryEntry {
  /** Human-readable label for the command. */
  label: string;
  /**
   * `true` for the most recently executed command (the current undo pointer).
   * `false` for both older entries (undoable) and future entries (redoable).
   */
  isCurrent: boolean;
}

/**
 * Zustand slice for the global undo/redo system.
 *
 * The {@link HistoryManager} instance lives as a **module-level singleton**
 * outside of Zustand state so that Immer never proxies the internal
 * `Command` objects. After each mutation the derived booleans and entry list
 * are synced back into the store, triggering a re-render of any subscribed
 * components.
 */
interface HistoryStoreState {
  /** `true` when there is at least one command that can be undone. */
  canUndo: boolean;
  /** `true` when there is at least one command that can be redone. */
  canRedo: boolean;
  /**
   * Snapshot of the undo stack for display in the History panel.
   * Index 0 is the oldest command; the last index is the most recent.
   */
  entries: HistoryEntry[];
  /**
   * Index of the current undo pointer. `-1` means the stack is empty or
   * all commands have been undone.
   */
  currentPointer: number;

  /**
   * Execute a command and push it onto the undo stack.
   * Discards any existing redo stack entries.
   */
  push: (cmd: Command) => void;
  /** Undo the most recently executed command. Silent no-op when {@link canUndo} is `false`. */
  undo: () => void;
  /** Re-execute the next command in the redo stack. Silent no-op when {@link canRedo} is `false`. */
  redo: () => void;
  /**
   * Clear the entire undo/redo stack.
   * Should be called whenever a new project is created or loaded so that
   * stale history from a previous session cannot be applied.
   */
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Module-level singleton — intentionally NOT stored inside Zustand state so
// that Immer never wraps Command instances in a Proxy.
// ---------------------------------------------------------------------------
const manager = new HistoryManager();

/**
 * Copy derived state from the manager into the Zustand draft.
 * Called after every mutation so that React components re-render with fresh
 * canUndo/canRedo/entries values.
 */
function syncFromManager(s: HistoryStoreState): void {
  s.canUndo = manager.canUndo;
  s.canRedo = manager.canRedo;
  s.entries = [...manager.entries] as HistoryEntry[];
  s.currentPointer = manager.currentPointer;
}

export const useHistoryStore = create<HistoryStoreState>()(
  immer((set) => ({
    canUndo: false,
    canRedo: false,
    entries: [],
    currentPointer: -1,

    push: (cmd) => {
      manager.push(cmd);
      set(syncFromManager);
    },

    undo: () => {
      manager.undo();
      set(syncFromManager);
    },

    redo: () => {
      manager.redo();
      set(syncFromManager);
    },

    clear: () => {
      manager.clear();
      set(syncFromManager);
    },
  })),
);
