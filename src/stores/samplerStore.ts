import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  SampleZoneSnapshot,
  SamplerParamName,
  SamplerParams,
} from "../lib/ipc";
import {
  createSamplerInstrument,
  getSamplerState,
  loadSampleZone,
  removeSampleZone,
  setSamplerParam,
} from "../lib/ipc";

/** Default sampler parameter values matching Rust defaults in `SamplerParams::new()`. */
const DEFAULT_PARAMS: SamplerParams = {
  attack: 0.01,
  decay: 0.1,
  sustain: 1.0,
  release: 0.3,
  volume: 0.8,
};

interface SamplerStoreState {
  /** Current ADSR + volume parameter values. */
  params: SamplerParams;
  /** All currently loaded zones. */
  zones: SampleZoneSnapshot[];
  /** Monotonically increasing counter for assigning zone IDs in this session. */
  nextZoneId: number;
  /** True after `initialize()` completes successfully. */
  isInitialized: boolean;
  /** True while an async IPC call is in flight. */
  isLoading: boolean;
  /** Last error message, or null if none. */
  error: string | null;

  /** Initializes the sampler instrument and fetches current state. */
  initialize: () => Promise<void>;
  /**
   * Sets a parameter by name, updating local state optimistically
   * then calling the IPC command.
   */
  setParam: (name: SamplerParamName, value: number) => Promise<void>;
  /**
   * Loads an audio file as a new zone. Returns the created snapshot on success.
   * `rootNote`, `minNote`, `maxNote` default to full-range C4 root if omitted.
   */
  loadZone: (
    filePath: string,
    rootNote?: number,
    minNote?: number,
    maxNote?: number,
  ) => Promise<SampleZoneSnapshot | null>;
  /** Removes a zone by id. */
  removeZone: (zoneId: number) => Promise<void>;
  /** Re-fetches the current state from the backend. */
  fetchState: () => Promise<void>;
  /** Clears the current error message. */
  clearError: () => void;
}

export const useSamplerStore = create<SamplerStoreState>()(
  persist(
    immer((set, get) => ({
      params: { ...DEFAULT_PARAMS },
      zones: [],
      nextZoneId: 0,
      isInitialized: false,
      isLoading: false,
      error: null,

      initialize: async () => {
        set((s) => {
          s.isLoading = true;
          s.error = null;
        });
        try {
          await createSamplerInstrument();
          const state = await getSamplerState();
          set((s) => {
            s.params = state.params;
            s.zones = state.zones;
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

      setParam: async (name: SamplerParamName, value: number) => {
        set((s) => {
          s.params[name] = value;
        });
        try {
          await setSamplerParam(name, value);
        } catch (e) {
          set((s) => {
            s.error = String(e);
          });
        }
      },

      loadZone: async (
        filePath: string,
        rootNote = 60,
        minNote = 0,
        maxNote = 127,
      ) => {
        const zoneId = get().nextZoneId;
        set((s) => {
          s.nextZoneId += 1;
          s.isLoading = true;
          s.error = null;
        });
        try {
          const snapshot = await loadSampleZone(
            filePath,
            zoneId,
            rootNote,
            minNote,
            maxNote,
            0,
            0,
            false,
          );
          set((s) => {
            const existing = s.zones.findIndex((z) => z.id === zoneId);
            if (existing >= 0) {
              s.zones[existing] = snapshot;
            } else {
              s.zones.push(snapshot);
            }
            s.isLoading = false;
          });
          return snapshot;
        } catch (e) {
          set((s) => {
            s.error = String(e);
            s.isLoading = false;
          });
          return null;
        }
      },

      removeZone: async (zoneId: number) => {
        // Optimistic removal
        set((s) => {
          s.zones = s.zones.filter((z) => z.id !== zoneId);
        });
        try {
          await removeSampleZone(zoneId);
        } catch (e) {
          set((s) => {
            s.error = String(e);
          });
        }
      },

      fetchState: async () => {
        try {
          const state = await getSamplerState();
          set((s) => {
            s.params = state.params;
            s.zones = state.zones;
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
      name: "sampler-storage",
      // Only persist user-tuned parameters, not zones (zones depend on loaded files)
      partialize: (state) => ({
        params: state.params,
      }),
    },
  ),
);
