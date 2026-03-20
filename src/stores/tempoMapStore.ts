/**
 * Zustand store for the project tempo map.
 *
 * The tempo map is a list of {@link TempoPoint} objects that define the BPM
 * at each musical position.  Each mutation sends the full updated list to the
 * backend via the `set_tempo_map` IPC call, which rebuilds the
 * `CumulativeTempoMap` on the audio thread.
 *
 * The tick-0 point is non-deletable and always present.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { type TempoPoint, setTempoMap, getTempoMap } from '../lib/ipc';

export type { TempoPoint };

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

interface TempoMapState {
  /** Sorted (by tick) list of tempo automation points. */
  points: TempoPoint[];

  /**
   * Upserts a tempo point.  If a point at `tick` already exists it is
   * replaced; otherwise a new point is inserted in sorted order.
   *
   * Sends the updated list to the backend.
   */
  setPoint: (tick: number, bpm: number, interp: 'Step' | 'Linear') => Promise<void>;

  /**
   * Removes the point at `tick`.
   *
   * The tick-0 point cannot be deleted (the call is a no-op).
   */
  deletePoint: (tick: number) => Promise<void>;

  /**
   * Changes only the interpolation mode of the point at `tick`.
   */
  setInterpMode: (tick: number, interp: 'Step' | 'Linear') => Promise<void>;

  /**
   * Replaces the entire point list from a loaded project.
   *
   * Does NOT call the backend IPC (caller is responsible for sending
   * `setTempoMap` separately if the engine needs to be updated).
   */
  loadFromProject: (points: TempoPoint[]) => void;

  /**
   * Fetches the current point list from the backend and syncs the store.
   */
  hydrate: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useTempoMapStore = create<TempoMapState>()(
  immer((set, get) => ({
    points: [{ tick: 0, bpm: 120.0, interp: 'Step' }],

    setPoint: async (tick, bpm, interp) => {
      const current = get().points;
      let updated: TempoPoint[];
      const existingIdx = current.findIndex((p) => p.tick === tick);
      if (existingIdx >= 0) {
        updated = current.map((p, i) =>
          i === existingIdx ? { tick, bpm, interp } : p
        );
      } else {
        updated = [...current, { tick, bpm, interp }].sort((a, b) => a.tick - b.tick);
      }
      await setTempoMap(updated);
      set((state) => {
        state.points = updated;
      });
    },

    deletePoint: async (tick) => {
      if (tick === 0) return; // tick-0 is the anchor point; non-deletable
      const updated = get().points.filter((p) => p.tick !== tick);
      await setTempoMap(updated);
      set((state) => {
        state.points = updated;
      });
    },

    setInterpMode: async (tick, interp) => {
      const updated = get().points.map((p) =>
        p.tick === tick ? { ...p, interp } : p
      );
      await setTempoMap(updated);
      set((state) => {
        state.points = updated;
      });
    },

    loadFromProject: (points) => {
      set((state) => {
        state.points =
          points.length > 0
            ? points
            : [{ tick: 0, bpm: 120.0, interp: 'Step' }];
      });
    },

    hydrate: async () => {
      const points = await getTempoMap();
      set((state) => {
        state.points = points;
      });
    },
  }))
);
