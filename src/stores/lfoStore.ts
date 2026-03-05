import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { LfoParamName, LfoParams } from "../lib/ipc";
import { getLfoState, setLfoParam } from "../lib/ipc";

/** Default values for a single LFO matching Rust defaults. */
const DEFAULT_LFO_PARAMS: LfoParams = {
  rate: 1.0,
  depth: 0.0,
  waveform: 0,
  bpm_sync: 0,
  division: 1,
  phase_reset: 0,
  destination: 0,
};

interface LfoStoreState {
  /** Current parameter values for LFO 1 (optimistically updated). */
  lfo1: LfoParams;
  /** Current parameter values for LFO 2 (optimistically updated). */
  lfo2: LfoParams;
  /** Last error message, or null if none. */
  error: string | null;

  /**
   * Sets a parameter on the specified LFO slot, updating local state
   * optimistically then calling the IPC command.
   */
  setLfoParam: (slot: 1 | 2, name: LfoParamName, value: number) => Promise<void>;
  /** Re-fetches both LFO states from the backend. */
  fetchLfoState: () => Promise<void>;
  /** Clears the current error message. */
  clearError: () => void;
}

export const useLfoStore = create<LfoStoreState>()(
  persist(
    immer((set) => ({
      lfo1: { ...DEFAULT_LFO_PARAMS },
      lfo2: { ...DEFAULT_LFO_PARAMS },
      error: null,

      setLfoParam: async (slot: 1 | 2, name: LfoParamName, value: number) => {
        // Optimistic update — UI feels instant
        set((s) => {
          const key = slot === 1 ? "lfo1" : "lfo2";
          s[key][name] = value;
        });
        try {
          await setLfoParam(slot, name, value);
        } catch (e) {
          set((s) => {
            s.error = String(e);
          });
        }
      },

      fetchLfoState: async () => {
        try {
          const snapshot = await getLfoState();
          set((s) => {
            s.lfo1 = snapshot.lfo1;
            s.lfo2 = snapshot.lfo2;
            s.error = null;
          });
        } catch (e) {
          set((s) => {
            s.error = String(e);
          });
        }
      },

      clearError: () => {
        set((s) => {
          s.error = null;
        });
      },
    })),
    {
      name: "lfo-storage",
      // Only persist user-tuned parameters, not transient UI/error state
      partialize: (state) => ({
        lfo1: state.lfo1,
        lfo2: state.lfo2,
      }),
    },
  ),
);
