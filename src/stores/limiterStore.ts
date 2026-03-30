import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetLimiterParam,
  ipcGetLimiterState,
  type LimiterStateSnapshot,
} from '../lib/ipc';

const DEFAULT: Omit<LimiterStateSnapshot, 'channel_id'> = {
  ceiling_db: -0.3,
  release_ms: 50,
  enabled: true,
  gain_reduction_db: 0,
};

interface LimiterStoreState {
  channels: Record<string, LimiterStateSnapshot>;
  loadChannel: (channelId: string) => Promise<void>;
  setParam: (channelId: string, paramName: string, value: number) => void;
  applySnapshot: (snapshot: LimiterStateSnapshot) => void;
}

export const useLimiterStore = create<LimiterStoreState>()(
  immer((set, get) => ({
    channels: {},

    loadChannel: async (channelId) => {
      const snapshot = await ipcGetLimiterState(channelId);
      get().applySnapshot(snapshot);
    },

    setParam: (channelId, paramName, value) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = { channel_id: channelId, ...DEFAULT };
        }
        (state.channels[channelId] as Record<string, unknown>)[paramName] = value;
      });
      ipcSetLimiterParam(channelId, paramName, value).catch(() => {});
    },

    applySnapshot: (snapshot) => {
      set((state) => { state.channels[snapshot.channel_id] = snapshot; });
    },
  })),
);
