import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetReverbParam,
  ipcGetReverbState,
  type ReverbStateSnapshot,
} from '../lib/ipc';

// ─── Defaults (mirrors Rust ReverbAtomics::default) ──────────────────────────

const DEFAULT_REVERB: Omit<ReverbStateSnapshot, 'channel_id'> = {
  room_size: 0.5,
  decay: 1.5,
  pre_delay_ms: 0.0,
  wet: 0.3,
  damping: 0.5,
  width: 1.0,
};

// ─── Store types ──────────────────────────────────────────────────────────────

interface ReverbStoreState {
  /** Per-channel snapshots, keyed by channel_id. */
  channels: Record<string, ReverbStateSnapshot>;

  /** Load (or re-load) reverb state from the backend for a channel. */
  loadChannel: (channelId: string) => Promise<void>;

  /** Update a single param in local state and send to backend. */
  setParam: (channelId: string, paramName: string, value: number) => void;

  /** Apply a full snapshot (used by loadChannel). */
  applySnapshot: (snapshot: ReverbStateSnapshot) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useReverbStore = create<ReverbStoreState>()(
  immer((set, get) => ({
    channels: {},

    loadChannel: async (channelId) => {
      const snapshot = await ipcGetReverbState(channelId);
      get().applySnapshot(snapshot);
    },

    setParam: (channelId, paramName, value) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = { channel_id: channelId, ...DEFAULT_REVERB };
        }
        (state.channels[channelId] as Record<string, unknown>)[paramName] = value;
      });
      ipcSetReverbParam(channelId, paramName, value).catch(() => {});
    },

    applySnapshot: (snapshot) => {
      set((state) => {
        state.channels[snapshot.channel_id] = snapshot;
      });
    },
  })),
);
