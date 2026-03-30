import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetDelayParam,
  ipcSetDelaySync,
  ipcGetDelayState,
  type DelayStateSnapshot,
  type DelayTimeMode,
  type NoteDivision,
} from '../lib/ipc';

// ─── Defaults (mirrors Rust DelayAtomics::default) ───────────────────────────

const DEFAULT_DELAY: Omit<DelayStateSnapshot, 'channel_id'> = {
  delay_mode: { mode: 'ms', ms: 250.0 },
  feedback: 0.4,
  wet: 0.3,
  ping_pong: false,
  hicut_hz: 8000.0,
};

// ─── Store types ──────────────────────────────────────────────────────────────

interface DelayStoreState {
  /** Per-channel snapshots, keyed by channel_id. */
  channels: Record<string, DelayStateSnapshot>;

  /** Load (or re-load) delay state from the backend for a channel. */
  loadChannel: (channelId: string) => Promise<void>;

  /** Update a numeric param in local state and send to backend. */
  setParam: (channelId: string, paramName: string, value: number) => void;

  /** Switch delay mode (ms or tempo-sync). */
  setDelayMode: (channelId: string, mode: DelayTimeMode, bpm: number) => void;

  /** Toggle ping-pong mode. */
  setPingPong: (channelId: string, enabled: boolean) => void;

  /** Apply a full snapshot (used by loadChannel). */
  applySnapshot: (snapshot: DelayStateSnapshot) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDelayStore = create<DelayStoreState>()(
  immer((set, get) => ({
    channels: {},

    loadChannel: async (channelId) => {
      const snapshot = await ipcGetDelayState(channelId);
      get().applySnapshot(snapshot);
    },

    setParam: (channelId, paramName, value) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = { channel_id: channelId, ...DEFAULT_DELAY };
        }
        if (paramName === 'delay_ms') {
          state.channels[channelId].delay_mode = { mode: 'ms', ms: value };
        } else {
          (state.channels[channelId] as Record<string, unknown>)[paramName] = value;
        }
      });
      ipcSetDelayParam(channelId, paramName, value).catch(() => {});
    },

    setDelayMode: (channelId, mode, bpm) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = { channel_id: channelId, ...DEFAULT_DELAY };
        }
        state.channels[channelId].delay_mode = mode;
      });
      if (mode.mode === 'ms') {
        ipcSetDelayParam(channelId, 'delay_ms', mode.ms).catch(() => {});
      } else {
        ipcSetDelaySync(channelId, mode.div as NoteDivision, bpm).catch(() => {});
      }
    },

    setPingPong: (channelId, enabled) => {
      set((state) => {
        if (!state.channels[channelId]) {
          state.channels[channelId] = { channel_id: channelId, ...DEFAULT_DELAY };
        }
        state.channels[channelId].ping_pong = enabled;
      });
      ipcSetDelayParam(channelId, 'ping_pong', enabled ? 1.0 : 0.0).catch(() => {});
    },

    applySnapshot: (snapshot) => {
      set((state) => {
        state.channels[snapshot.channel_id] = snapshot;
      });
    },
  })),
);
