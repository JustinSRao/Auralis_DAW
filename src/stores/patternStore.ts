/**
 * Zustand store for the Pattern System (Sprint 12).
 *
 * Rust acts as a pure validator / UUID generator. All in-memory pattern state
 * lives here. The store is populated from the project file on load and
 * serialised back on save via fileStore.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcCreatePattern,
  ipcRenamePattern,
  ipcDuplicatePattern,
  ipcDeletePattern,
  ipcSetPatternLength,
  type PatternData,
  type PatternLengthBars,
  type PatternMidiNote,
} from '../lib/ipc';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface PatternStoreState {
  /** All patterns keyed by their UUID. */
  patterns: Record<string, PatternData>;
  /** Currently selected pattern id (for browser highlight). */
  selectedPatternId: string | null;
  /** True while an async IPC call is in-flight. */
  isLoading: boolean;
  /** Last IPC error message, or null when clear. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface PatternStoreActions {
  /**
   * Creates a new MIDI pattern for the given track. If no name is provided,
   * auto-generates "Pattern N" where N = count + 1.
   */
  createPattern(trackId: string, name?: string): Promise<void>;

  /** Renames an existing pattern by id. */
  renamePattern(id: string, name: string): Promise<void>;

  /** Duplicates an existing pattern by id. */
  duplicatePattern(id: string): Promise<void>;

  /** Deletes a pattern by id and clears selectedPatternId if it matched. */
  deletePattern(id: string): Promise<void>;

  /** Sets the length_bars of a pattern. Must be 1, 2, 4, 8, 16, or 32. */
  setPatternLength(id: string, lengthBars: PatternLengthBars): Promise<void>;

  /** Sets the selected pattern id (for browser highlight). */
  selectPattern(id: string | null): void;

  /**
   * Updates the MIDI note array of a Midi-type pattern.
   * Used by PianoRoll on close to persist edits into the store.
   */
  updatePatternNotes(id: string, notes: PatternMidiNote[]): void;

  /** Returns all patterns belonging to a specific track (pure selector). */
  getPatternsForTrack(trackId: string): PatternData[];

  /** Returns the count of patterns belonging to a specific track. */
  getPatternCount(trackId: string): number;

  /**
   * Replaces the entire patterns map from a loaded project.
   * Called by fileStore after a successful project open.
   */
  loadFromProject(patterns: PatternData[]): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePatternStore = create<PatternStoreState & PatternStoreActions>()(
  immer((set, get) => ({
    patterns: {},
    selectedPatternId: null,
    isLoading: false,
    error: null,

    // ── Async actions ────────────────────────────────────────────────────

    createPattern: async (trackId, name) => {
      const count = get().getPatternCount(trackId);
      const patternName = name ?? `Pattern ${count + 1}`;
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const pattern = await ipcCreatePattern(trackId, patternName);
        set((s) => {
          s.patterns[pattern.id] = pattern;
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.isLoading = false;
          s.error = String(e);
        });
      }
    },

    renamePattern: async (id, name) => {
      set((s) => { s.error = null; });
      try {
        await ipcRenamePattern(id, name);
        set((s) => {
          if (s.patterns[id]) s.patterns[id].name = name;
        });
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    duplicatePattern: async (id) => {
      const original = get().patterns[id];
      if (!original) return;
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const copy = await ipcDuplicatePattern(original);
        set((s) => {
          s.patterns[copy.id] = copy;
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.isLoading = false;
          s.error = String(e);
        });
      }
    },

    deletePattern: async (id) => {
      set((s) => { s.error = null; });
      try {
        await ipcDeletePattern(id);
        set((s) => {
          delete s.patterns[id];
          if (s.selectedPatternId === id) s.selectedPatternId = null;
        });
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    setPatternLength: async (id, lengthBars) => {
      set((s) => { s.error = null; });
      try {
        await ipcSetPatternLength(id, lengthBars);
        set((s) => {
          if (s.patterns[id]) s.patterns[id].lengthBars = lengthBars;
        });
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    // ── Synchronous actions ───────────────────────────────────────────────

    selectPattern: (id) =>
      set((s) => { s.selectedPatternId = id; }),

    updatePatternNotes: (id, notes) =>
      set((s) => {
        const p = s.patterns[id];
        if (p?.content.type === 'Midi') {
          p.content.notes = notes;
        }
      }),

    // ── Pure selectors (called via getState() or inline) ─────────────────

    getPatternsForTrack: (trackId) =>
      Object.values(get().patterns).filter((p) => p.trackId === trackId),

    getPatternCount: (trackId) =>
      Object.values(get().patterns).filter((p) => p.trackId === trackId).length,

    // ── Project load/save ─────────────────────────────────────────────────

    loadFromProject: (patterns) =>
      set((s) => {
        s.patterns = {};
        for (const p of patterns) {
          s.patterns[p.id] = p;
        }
        s.selectedPatternId = null;
        s.error = null;
      }),
  })),
);
