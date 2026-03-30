import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetCompressorParam,
  ipcGetCompressorState,
  type CompressorStateSnapshot,
} from '../lib/ipc';

const DEFAULT: Omit<CompressorStateSnapshot, 'channel_id'> = {
  threshold_db: -18,
  ratio: 4,
  attack_ms: 10,
  release_ms: 100,
  knee_db: 2,
  makeup_db: 0,
  enabled: true,
  gain_reduction_db: 0,
};

interface CompressorStoreState {
  channels: Record<string, CompressorStateSnapshot>;
  loadChannel: (channelId: string) => Promise<void>;
  setParam: (channelId: string, paramName: string, value: number) => void;
  applySnapshot: (snapshot: CompressorStateSnapshot) => void;
}

export const useCompressorStore = create<CompressorStoreState>()(
  immer((set, get) => ({
    channels: {},

    loadChannel: async (channelId) => {
      const snapshot = await ipcGetCompressorState(channelId);
      get().applySnapshot(snapshot);
    },

    setParam: (channelId, paramName, value) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = { channel_id: channelId, ...DEFAULT };
        }
        (state.channels[channelId] as Record<string, unknown>)[paramName] = value;
      });
      ipcSetCompressorParam(channelId, paramName, value).catch(() => {});
    },

    applySnapshot: (snapshot) => {
      set((state) => { state.channels[snapshot.channel_id] = snapshot; });
    },
  })),
);
