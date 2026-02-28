import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { TransportSnapshot } from "../lib/ipc";
import {
  getTransportState,
  transportPlay,
  transportStop,
  transportPause,
  setBpm,
  setTimeSignature,
  setLoopRegion,
  toggleLoop,
  toggleMetronome,
  setMetronomeVolume,
  setMetronomePitch,
  setRecordArmed,
} from "../lib/ipc";

// ---------------------------------------------------------------------------
// Store state and actions
// ---------------------------------------------------------------------------

interface TransportStoreState {
  /** Current transport snapshot received from the backend. */
  snapshot: TransportSnapshot;
  /** True while an IPC call is in flight. */
  isLoading: boolean;
  /** Last IPC error message, or null if none. */
  error: string | null;

  // -- Playback actions --
  play: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;

  // -- Parameter actions --
  setBpm: (bpm: number) => Promise<void>;
  setTimeSignature: (numerator: number, denominator: number) => Promise<void>;
  setLoopRegion: (startBeats: number, endBeats: number) => Promise<void>;
  toggleLoop: (enabled: boolean) => Promise<void>;
  toggleMetronome: (enabled: boolean) => Promise<void>;
  setMetronomeVolume: (volume: number) => Promise<void>;
  setMetronomePitch: (pitchHz: number) => Promise<void>;
  setRecordArmed: (armed: boolean) => Promise<void>;

  // -- Sync --
  /** Fetches the current snapshot via IPC and stores it. */
  refreshState: () => Promise<void>;
  /**
   * Applies a snapshot received from a Tauri event directly.
   * Does NOT make an IPC call — used by the event listener in TransportBar.
   */
  applySnapshot: (snapshot: TransportSnapshot) => void;

  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Default snapshot (matches Rust TransportSnapshot::default())
// ---------------------------------------------------------------------------

const defaultSnapshot: TransportSnapshot = {
  state: "stopped",
  position_samples: 0,
  bbt: { bar: 1, beat: 1, tick: 0 },
  bpm: 120.0,
  time_sig_numerator: 4,
  time_sig_denominator: 4,
  loop_enabled: false,
  loop_start_samples: 0,
  loop_end_samples: 0,
  metronome_enabled: false,
  metronome_volume: 0.5,
  metronome_pitch_hz: 1000.0,
  record_armed: false,
};

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

/**
 * Zustand store for transport state.
 *
 * Position data is ephemeral — we do NOT persist this store (no `persist`
 * wrapper). Restoring a stale playhead position on app restart would be
 * confusing; the backend always provides the authoritative state.
 *
 * Event-driven updates: `TransportBar` subscribes to the `transport-state`
 * Tauri event and calls `applySnapshot` on every emission, keeping the
 * store in sync at ~60 fps without polling.
 */
export const useTransportStore = create<TransportStoreState>()(
  immer((set) => ({
    snapshot: defaultSnapshot,
    isLoading: false,
    error: null,

    // -- Playback --

    play: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        await transportPlay();
        set((s) => {
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    stop: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        await transportStop();
        set((s) => {
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    pause: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        await transportPause();
        set((s) => {
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    // -- Parameters --

    setBpm: async (bpm) => {
      try {
        await setBpm(bpm);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    setTimeSignature: async (numerator, denominator) => {
      try {
        await setTimeSignature(numerator, denominator);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    setLoopRegion: async (startBeats, endBeats) => {
      try {
        await setLoopRegion(startBeats, endBeats);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    toggleLoop: async (enabled) => {
      try {
        await toggleLoop(enabled);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    toggleMetronome: async (enabled) => {
      try {
        await toggleMetronome(enabled);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    setMetronomeVolume: async (volume) => {
      try {
        await setMetronomeVolume(volume);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    setMetronomePitch: async (pitchHz) => {
      try {
        await setMetronomePitch(pitchHz);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    setRecordArmed: async (armed) => {
      try {
        await setRecordArmed(armed);
        set((s) => {
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    // -- Sync --

    refreshState: async () => {
      try {
        const snap = await getTransportState();
        set((s) => {
          s.snapshot = snap;
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    applySnapshot: (snapshot) => {
      set((s) => {
        s.snapshot = snapshot;
      });
    },

    clearError: () => {
      set((s) => {
        s.error = null;
      });
    },
  })),
);
