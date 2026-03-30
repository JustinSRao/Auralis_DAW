import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetGateParam,
  ipcGetGateState,
  type GateStateSnapshot,
} from '../lib/ipc';

const DEFAULT: Omit<GateStateSnapshot, 'channel_id'> = {
  threshold_db: -40,
  attack_ms: 1,
  hold_ms: 50,
  release_ms: 100,
  range_db: -60,
  enabled: true,
  gain_reduction_db: 0,
};

interface GateStoreState {
  channels: Record<string, GateStateSnapshot>;
  loadChannel: (channelId: string) => Promise<void>;
  setParam: (channelId: string, paramName: string, value: number) => void;
  applySnapshot: (snapshot: GateStateSnapshot) => void;
}

export const useGateStore = create<GateStoreState>()(
  immer((set, get) => ({
    channels: {},

    loadChannel: async (channelId) => {
      const snapshot = await ipcGetGateState(channelId);
      get().applySnapshot(snapshot);
    },

    setParam: (channelId, paramName, value) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = { channel_id: channelId, ...DEFAULT };
        }
        (state.channels[channelId] as Record<string, unknown>)[paramName] = value;
      });
      ipcSetGateParam(channelId, paramName, value).catch(() => {});
    },

    applySnapshot: (snapshot) => {
      set((state) => { state.channels[snapshot.channel_id] = snapshot; });
    },
  })),
);
