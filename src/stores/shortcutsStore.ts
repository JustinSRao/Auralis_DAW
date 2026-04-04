/**
 * Shortcuts store (Sprint 46).
 *
 * Manages two copies of keyboard bindings:
 *   - `currentBindings` — the live set used by `useGlobalKeyboard` at runtime
 *   - `draftBindings`   — the working copy being edited in the Shortcuts settings tab
 *
 * Workflow mirrors `settingsStore`:
 *   1. On app startup `hydrate()` is called with the saved bindings from TOML.
 *   2. User edits update `draftBindings` only.
 *   3. On "Save & Apply", `settingsStore` calls `commitDraft()` which promotes
 *      draftBindings → currentBindings and rebuilds `reverseMap`.
 *   4. On "Discard", `discardDraft()` resets draftBindings to currentBindings.
 *
 * `reverseMap` (combo → actionId) is the fast lookup used by the keyboard
 * handler — rebuilt whenever `currentBindings` changes.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { DEFAULT_BINDINGS } from '../lib/shortcuts';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface ShortcutsStore {
  /** Live bindings used by useGlobalKeyboard. */
  currentBindings: Record<string, string>;
  /** Editable copy shown in the Settings → Shortcuts tab. */
  draftBindings: Record<string, string>;
  /** Reverse lookup: combo string → actionId. Built from currentBindings. */
  reverseMap: Record<string, string>;

  /**
   * Called once on startup with the `bindings` map loaded from TOML.
   * Merges saved bindings over defaults so any unrecognised action IDs from
   * a newer version are preserved.
   */
  hydrate(saved: Record<string, string>): void;

  /** Update a single action's draft binding, unbinding any conflicting action. */
  setDraftBinding(actionId: string, combo: string): void;

  /** Reset a single action's draft binding to its default. */
  resetOne(actionId: string): void;

  /** Reset all draft bindings to defaults. */
  resetAll(): void;

  /**
   * Promote draftBindings → currentBindings and rebuild reverseMap.
   * Called by settingsStore after a successful save.
   */
  commitDraft(): void;

  /** Reset draftBindings to match currentBindings (discard edits). */
  discardDraft(): void;

  /**
   * Scan draftBindings for an action that already uses `combo`,
   * excluding `excludingActionId`. Returns the conflicting actionId or null.
   */
  findConflict(combo: string, excludingActionId: string): string | null;
}

// ---------------------------------------------------------------------------
// Helper — rebuild reverse map from a bindings object
// ---------------------------------------------------------------------------

function buildReverseMap(bindings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bindings)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => [v, k]),
  );
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useShortcutsStore = create<ShortcutsStore>()(
  immer((set, get) => ({
    currentBindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as Record<string, string>,
    draftBindings:   JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as Record<string, string>,
    reverseMap:      buildReverseMap(DEFAULT_BINDINGS),

    hydrate(saved: Record<string, string>) {
      // NOTE: called outside the immer recipe so we use JSON clone, not structuredClone.
      const merged: Record<string, string> = {
        ...DEFAULT_BINDINGS,
        ...saved,
      };
      set((s) => {
        s.currentBindings = merged;
        s.draftBindings   = JSON.parse(JSON.stringify(merged)) as Record<string, string>;
        s.reverseMap      = buildReverseMap(merged);
      });
    },

    setDraftBinding(actionId: string, combo: string) {
      set((s) => {
        // Unbind any other action that currently holds this combo.
        for (const id of Object.keys(s.draftBindings)) {
          if (id !== actionId && s.draftBindings[id] === combo) {
            s.draftBindings[id] = '';
          }
        }
        s.draftBindings[actionId] = combo;
      });
    },

    resetOne(actionId: string) {
      set((s) => {
        s.draftBindings[actionId] = DEFAULT_BINDINGS[actionId] ?? '';
      });
    },

    resetAll() {
      set((s) => {
        s.draftBindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as Record<string, string>;
      });
    },

    commitDraft() {
      set((s) => {
        s.currentBindings = JSON.parse(JSON.stringify(s.draftBindings)) as Record<string, string>;
        s.reverseMap      = buildReverseMap(s.currentBindings);
      });
    },

    discardDraft() {
      set((s) => {
        s.draftBindings = JSON.parse(JSON.stringify(s.currentBindings)) as Record<string, string>;
      });
    },

    findConflict(combo: string, excludingActionId: string): string | null {
      const { draftBindings } = get();
      for (const [id, bound] of Object.entries(draftBindings)) {
        if (id !== excludingActionId && bound === combo) return id;
      }
      return null;
    },
  })),
);
