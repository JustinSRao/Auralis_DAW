import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { SynthParamName, SynthParams } from "../lib/ipc";
import {
  createSynthInstrument,
  getSynthState,
  setSynthParam,
} from "../lib/ipc";

/** Default synthesizer parameter values matching Rust defaults in `SynthParams::new()`. */
const DEFAULT_PARAMS: SynthParams = {
  waveform: 0.0,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.3,
  cutoff: 8000.0,
  resonance: 0.0,
  env_amount: 0.0,
  volume: 0.7,
  detune: 0.0,
  pulse_width: 0.5,
};

interface SynthStoreState {
  /** Current parameter values (optimistically updated on setParam). */
  params: SynthParams;
  /** True after `initialize()` completes successfully. */
  isInitialized: boolean;
  /** True while an async IPC call is in flight. */
  isLoading: boolean;
  /** Last error message, or null if none. */
  error: string | null;

  /** Initializes the synth instrument and fetches the current state. */
  initialize: () => Promise<void>;
  /**
   * Sets a parameter by name, updating local state optimistically
   * then calling the IPC command.
   *
   * `value` is the raw (denormalized) value in the parameter's native range.
   */
  setParam: (name: SynthParamName, value: number) => Promise<void>;
  /** Re-fetches the current parameter state from the backend. */
  fetchState: () => Promise<void>;
  /** Clears the current error message. */
  clearError: () => void;
}

export const useSynthStore = create<SynthStoreState>()(
  persist(
    immer((set) => ({
      params: { ...DEFAULT_PARAMS },
      isInitialized: false,
      isLoading: false,
      error: null,

      initialize: async () => {
        set((s) => {
          s.isLoading = true;
          s.error = null;
        });
        try {
          await createSynthInstrument();
          const params = await getSynthState();
          set((s) => {
            s.params = params;
            s.isInitialized = true;
            s.isLoading = false;
          });
        } catch (e) {
          set((s) => {
            s.error = String(e);
            s.isLoading = false;
          });
        }
      },

      setParam: async (name: SynthParamName, value: number) => {
        // Optimistic update — UI feels instant
        set((s) => {
          s.params[name] = value;
        });
        try {
          await setSynthParam(name, value);
        } catch (e) {
          set((s) => {
            s.error = String(e);
          });
        }
      },

      fetchState: async () => {
        try {
          const params = await getSynthState();
          set((s) => {
            s.params = params;
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
      name: "synth-storage",
      // Only persist user-tuned parameters, not transient UI state
      partialize: (state) => ({
        params: state.params,
      }),
    },
  ),
);
