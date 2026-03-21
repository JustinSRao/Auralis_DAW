import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetEqBand,
  ipcEnableEqBand,
  ipcGetEqState,
  type EqBandParams,
  type EqStateSnapshot,
} from '../lib/ipc';

// ─── Default band layout (mirrors Rust EqBandParams::default_for_index) ──────

const DEFAULT_BANDS: EqBandParams[] = [
  { filter_type: 'high_pass',  frequency: 20,     gain_db: 0, q: 1, enabled: false },
  { filter_type: 'low_shelf',  frequency: 200,    gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 500,    gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 1000,   gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 4000,   gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 8000,   gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'high_shelf', frequency: 10000,  gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'low_pass',   frequency: 20000,  gain_db: 0, q: 1, enabled: false },
];

// ─── Store types ──────────────────────────────────────────────────────────────

interface EqStoreState {
  /** Per-channel band arrays, keyed by channel_id. */
  channels: Record<string, EqBandParams[]>;

  /** Load (or re-load) EQ state from the backend for a channel. */
  loadChannel: (channelId: string) => Promise<void>;

  /** Update a single band in local state and send to backend. */
  setBand: (channelId: string, bandIndex: number, params: EqBandParams) => void;

  /** Toggle enabled for a single band and send to backend. */
  enableBand: (channelId: string, bandIndex: number, enabled: boolean) => void;

  /** Apply a full snapshot (used by loadChannel). */
  applySnapshot: (snapshot: EqStateSnapshot) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useEqStore = create<EqStoreState>()(
  immer((set, get) => ({
    channels: {},

    loadChannel: async (channelId) => {
      const snapshot = await ipcGetEqState(channelId);
      get().applySnapshot(snapshot);
    },

    setBand: (channelId, bandIndex, params) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = DEFAULT_BANDS.map((b) => ({ ...b }));
        }
        state.channels[channelId][bandIndex] = params;
      });
      // Fire-and-forget; caller throttles as needed.
      ipcSetEqBand(channelId, bandIndex, params).catch(() => {});
    },

    enableBand: (channelId, bandIndex, enabled) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = DEFAULT_BANDS.map((b) => ({ ...b }));
        }
        state.channels[channelId][bandIndex].enabled = enabled;
      });
      ipcEnableEqBand(channelId, bandIndex, enabled).catch(() => {});
    },

    applySnapshot: (snapshot) => {
      set((state) => {
        state.channels[snapshot.channel_id] = snapshot.bands;
      });
    },
  })),
);
