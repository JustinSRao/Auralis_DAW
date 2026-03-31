/**
 * Sidechain routing store (Sprint 39).
 *
 * Tracks the sidechain configuration for each compressor slot:
 * key = `"${channelId}::${slotId}"`.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetSidechainSource,
  ipcRemoveSidechain,
  ipcSetSidechainFilter,
} from '../lib/ipc';

export interface SidechainSlotState {
  sourceChannelId: string | null;
  hpfCutoffHz: number;
  hpfEnabled: boolean;
}

interface SidechainStoreState {
  /** Map of `"${channelId}::${slotId}"` → slot state. */
  slots: Record<string, SidechainSlotState>;
  /** Wires a sidechain source; creates the entry if absent. */
  setSource: (
    destChannelId: string,
    slotId: string,
    sourceChannelId: string,
    hpfCutoffHz: number,
    hpfEnabled: boolean,
  ) => void;
  /** Reverts the compressor to self-detection (no sidechain). */
  removeSource: (destChannelId: string, slotId: string) => void;
  /** Updates HPF cutoff and enable state for an existing route. */
  setFilter: (
    destChannelId: string,
    slotId: string,
    cutoffHz: number,
    enabled: boolean,
  ) => void;
}

const key = (channelId: string, slotId: string) => `${channelId}::${slotId}`;

export const useSidechainStore = create<SidechainStoreState>()(
  immer((set) => ({
    slots: {},

    setSource: (destChannelId, slotId, sourceChannelId, hpfCutoffHz, hpfEnabled) => {
      set((s) => {
        s.slots[key(destChannelId, slotId)] = { sourceChannelId, hpfCutoffHz, hpfEnabled };
      });
      ipcSetSidechainSource(destChannelId, slotId, sourceChannelId, hpfCutoffHz, hpfEnabled)
        .catch(console.error);
    },

    removeSource: (destChannelId, slotId) => {
      set((s) => {
        const k = key(destChannelId, slotId);
        if (s.slots[k]) {
          s.slots[k].sourceChannelId = null;
        }
      });
      ipcRemoveSidechain(destChannelId, slotId).catch(console.error);
    },

    setFilter: (destChannelId, slotId, cutoffHz, enabled) => {
      set((s) => {
        const k = key(destChannelId, slotId);
        if (s.slots[k]) {
          s.slots[k].hpfCutoffHz = cutoffHz;
          s.slots[k].hpfEnabled = enabled;
        }
      });
      ipcSetSidechainFilter(destChannelId, slotId, cutoffHz, enabled).catch(console.error);
    },
  })),
);
