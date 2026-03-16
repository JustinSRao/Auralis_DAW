import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  setPunchIn as ipcSetPunchIn,
  setPunchOut as ipcSetPunchOut,
  togglePunchMode as ipcTogglePunchMode,
  getPunchMarkers,
} from '../lib/ipc';

// ---------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------

interface PunchState {
  punchEnabled: boolean;
  punchInBeats: number;
  punchOutBeats: number;
  preRollBars: number;
  isLoading: boolean;
  error: string | null;
}

interface PunchActions {
  setPunchIn: (beats: number) => Promise<void>;
  setPunchOut: (beats: number) => Promise<void>;
  togglePunchMode: (enabled: boolean) => Promise<void>;
  setPreRollBars: (bars: number) => void;
  refreshMarkers: () => Promise<void>;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Zustand store for punch in/out recording state.
 *
 * Not persisted — state flows back from the backend via TransportSnapshot
 * events (`punch_enabled`, `punch_in_samples`, `punch_out_samples`).
 * Pre-roll is local UI state only.
 */
export const usePunchStore = create<PunchState & PunchActions>()(
  immer((set) => ({
    punchEnabled: false,
    punchInBeats: 0,
    punchOutBeats: 4,
    preRollBars: 2,
    isLoading: false,
    error: null,

    setPunchIn: async (beats) => {
      const prev = usePunchStore.getState().punchInBeats;
      set((s) => {
        s.punchInBeats = beats;
        s.isLoading = true;
        s.error = null;
      });
      try {
        await ipcSetPunchIn(beats);
        set((s) => {
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.punchInBeats = prev; // revert
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    setPunchOut: async (beats) => {
      const prev = usePunchStore.getState().punchOutBeats;
      set((s) => {
        s.punchOutBeats = beats;
        s.isLoading = true;
        s.error = null;
      });
      try {
        await ipcSetPunchOut(beats);
        set((s) => {
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.punchOutBeats = prev; // revert
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    togglePunchMode: async (enabled) => {
      // Optimistic update
      set((s) => {
        s.punchEnabled = enabled;
        s.isLoading = true;
        s.error = null;
      });
      try {
        await ipcTogglePunchMode(enabled);
        set((s) => {
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.punchEnabled = !enabled; // revert
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    setPreRollBars: (bars) => {
      set((s) => {
        s.preRollBars = bars;
      });
    },

    refreshMarkers: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const markers = await getPunchMarkers();
        set((s) => {
          s.punchInBeats = markers.punch_in_beats;
          s.punchOutBeats = markers.punch_out_beats;
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    clearError: () => {
      set((s) => {
        s.error = null;
      });
    },
  })),
);
