import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { DawTrack, DawTrackKind } from '../lib/ipc';

// Re-export so consumers can import DawTrack from either ipc or trackStore.
export type { DawTrack, DawTrackKind } from '../lib/ipc';
import {
  ipcCreateTrack,
  ipcDeleteTrack,
  ipcRenameTrack,
  ipcReorderTracks,
  ipcSetTrackColor,
} from '../lib/ipc';

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

/**
 * Zustand slice that owns all runtime track state.
 *
 * TypeScript `trackStore` is the source of truth for tracks at runtime.
 * The Rust backend only validates inputs and generates UUIDs — it holds
 * no authoritative track list of its own.
 *
 * No `persist` wrapper: track state is ephemeral and reconstructed from the
 * project file on load (future Sprint).
 */
interface TrackStoreState {
  /** Ordered list of all tracks in the project. */
  tracks: DawTrack[];
  /** UUID of the currently selected track, or null if nothing is selected. */
  selectedTrackId: string | null;
  /** True while an IPC call is in flight. */
  isLoading: boolean;
  /** Last IPC error message, or null if none. */
  error: string | null;

  // -- Async IPC actions --

  /** Creates a new track of the given kind on the backend and appends it to the local list. */
  createTrack: (kind: DawTrackKind, name?: string) => Promise<void>;
  /** Removes a track from the backend and from the local list. Clears selection if the track was selected. */
  deleteTrack: (id: string) => Promise<void>;
  /** Renames a track on the backend and updates the local name. */
  renameTrack: (id: string, name: string) => Promise<void>;
  /** Reorders tracks to match `ids`. Optimistically updates; rolls back on error. */
  reorderTracks: (ids: string[]) => Promise<void>;
  /** Updates a track's display color optimistically; rolls back on error. */
  setTrackColor: (id: string, color: string) => Promise<void>;

  // -- Sync UI actions --

  /** Sets the active selection to the given track UUID, or clears it when null. */
  selectTrack: (id: string | null) => void;
  /** Toggles the muted flag on the given track (local only, no IPC). */
  toggleMute: (id: string) => void;
  /** Toggles the soloed flag on the given track (local only, no IPC). */
  toggleSolo: (id: string) => void;
  /** Toggles the record-arm flag on the given track (local only, no IPC). */
  toggleArm: (id: string) => void;
  /**
   * Appends a track object to the end of the list without making an IPC call.
   * Used by `CreateTrackCommand.execute()` (redo path) after the track has
   * already been created on the backend.
   */
  addTrackLocal: (track: DawTrack) => void;
  /**
   * Directly inserts a track object at a given position.
   * Used by `DeleteTrackCommand.undo()` to restore a deleted track at its
   * original index without making an IPC call.
   */
  insertTrack: (track: DawTrack, index: number) => void;
  /**
   * Directly removes a track by UUID without an IPC call.
   * Used by `CreateTrackCommand.undo()` and `DeleteTrackCommand.execute()`.
   */
  removeTrackLocal: (id: string) => void;
  /** Clears the current error message. */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Default track names per kind
// ---------------------------------------------------------------------------

const DEFAULT_TRACK_NAMES: Record<DawTrackKind, string> = {
  Midi: 'MIDI Track',
  Audio: 'Audio Track',
  Instrument: 'Instrument Track',
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTrackStore = create<TrackStoreState>()(
  immer((set, get) => ({
    tracks: [],
    selectedTrackId: null,
    isLoading: false,
    error: null,

    // -- Async IPC actions --

    createTrack: async (kind, name) => {
      const trackName = name ?? DEFAULT_TRACK_NAMES[kind];
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const track = await ipcCreateTrack(kind, trackName);
        set((s) => {
          s.tracks.push(track);
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      } finally {
        set((s) => {
          s.isLoading = false;
        });
      }
    },

    deleteTrack: async (id) => {
      set((s) => {
        s.error = null;
      });
      try {
        await ipcDeleteTrack(id);
        set((s) => {
          s.tracks = s.tracks.filter((t) => t.id !== id);
          if (s.selectedTrackId === id) s.selectedTrackId = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    renameTrack: async (id, name) => {
      set((s) => {
        s.error = null;
      });
      try {
        await ipcRenameTrack(id, name);
        set((s) => {
          const t = s.tracks.find((t) => t.id === id);
          if (t) t.name = name;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    reorderTracks: async (ids) => {
      // Snapshot for rollback
      const prev = get().tracks.map((t) => t.id);
      // Optimistic update
      set((s) => {
        s.tracks = ids
          .map((id) => s.tracks.find((t) => t.id === id))
          .filter((t): t is DawTrack => t !== undefined);
      });
      try {
        await ipcReorderTracks(ids);
      } catch (e) {
        // Rollback
        set((s) => {
          s.tracks = prev
            .map((id) => s.tracks.find((t) => t.id === id))
            .filter((t): t is DawTrack => t !== undefined);
          s.error = String(e);
        });
      }
    },

    setTrackColor: async (id, color) => {
      // Optimistic update
      set((s) => {
        const t = s.tracks.find((t) => t.id === id);
        if (t) t.color = color;
      });
      try {
        await ipcSetTrackColor(id, color);
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    // -- Sync UI actions --

    selectTrack: (id) => {
      set((s) => {
        s.selectedTrackId = id;
      });
    },

    toggleMute: (id) => {
      set((s) => {
        const t = s.tracks.find((t) => t.id === id);
        if (t) t.muted = !t.muted;
      });
    },

    toggleSolo: (id) => {
      set((s) => {
        const t = s.tracks.find((t) => t.id === id);
        if (t) t.soloed = !t.soloed;
      });
    },

    toggleArm: (id) => {
      set((s) => {
        const t = s.tracks.find((t) => t.id === id);
        if (t) t.armed = !t.armed;
      });
    },

    addTrackLocal: (track) => {
      set((s) => {
        s.tracks.push(track);
      });
    },

    insertTrack: (track, index) => {
      set((s) => {
        s.tracks.splice(index, 0, track);
      });
    },

    removeTrackLocal: (id) => {
      set((s) => {
        s.tracks = s.tracks.filter((t) => t.id !== id);
        if (s.selectedTrackId === id) s.selectedTrackId = null;
      });
    },

    clearError: () => {
      set((s) => {
        s.error = null;
      });
    },
  })),
);
