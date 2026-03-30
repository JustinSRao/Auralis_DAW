import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcAddEffectToChain,
  ipcRemoveEffectFromChain,
  ipcMoveEffectInChain,
  ipcBypassEffect,
  ipcSetEffectWetDry,
  ipcGetChainState,
  ipcSaveChainPreset,
  ipcLoadChainPreset,
  ipcListChainPresets,
  type EffectType,
  type ChainStateSnapshot,
} from '../lib/ipc';

interface EffectChainState {
  chains: Record<string, ChainStateSnapshot>;
  presetNames: string[];

  loadChain: (channelId: string) => Promise<void>;
  addEffect: (channelId: string, effectType: EffectType, position?: number) => Promise<string>;
  removeEffect: (channelId: string, slotId: string) => Promise<void>;
  moveEffect: (channelId: string, fromIndex: number, toIndex: number) => Promise<void>;
  setBypass: (channelId: string, slotId: string, bypass: boolean) => Promise<void>;
  setWetDry: (channelId: string, slotId: string, wetDry: number) => Promise<void>;
  savePreset: (channelId: string, presetName: string) => Promise<void>;
  loadPreset: (channelId: string, presetName: string) => Promise<void>;
  refreshPresets: () => Promise<void>;
  applySnapshot: (snapshot: ChainStateSnapshot) => void;
}

export const useEffectChainStore = create<EffectChainState>()(
  immer((set, get) => ({
    chains: {},
    presetNames: [],

    loadChain: async (channelId) => {
      const snapshot = await ipcGetChainState(channelId);
      get().applySnapshot(snapshot);
    },

    addEffect: async (channelId, effectType, position) => {
      const slotId = await ipcAddEffectToChain(channelId, effectType, position);
      await get().loadChain(channelId);
      return slotId;
    },

    removeEffect: async (channelId, slotId) => {
      await ipcRemoveEffectFromChain(channelId, slotId);
      await get().loadChain(channelId);
    },

    moveEffect: async (channelId, fromIndex, toIndex) => {
      await ipcMoveEffectInChain(channelId, fromIndex, toIndex);
      await get().loadChain(channelId);
    },

    setBypass: async (channelId, slotId, bypass) => {
      set((state) => {
        const chain = state.chains[channelId];
        if (chain) {
          const slot = chain.slots.find((s) => s.slot_id === slotId);
          if (slot) slot.bypass = bypass;
        }
      });
      ipcBypassEffect(channelId, slotId, bypass).catch(() => {});
    },

    setWetDry: async (channelId, slotId, wetDry) => {
      set((state) => {
        const chain = state.chains[channelId];
        if (chain) {
          const slot = chain.slots.find((s) => s.slot_id === slotId);
          if (slot) slot.wet_dry = wetDry;
        }
      });
      ipcSetEffectWetDry(channelId, slotId, wetDry).catch(() => {});
    },

    savePreset: async (channelId, presetName) => {
      await ipcSaveChainPreset(channelId, presetName);
      await get().refreshPresets();
    },

    loadPreset: async (channelId, presetName) => {
      await ipcLoadChainPreset(channelId, presetName);
      await get().loadChain(channelId);
    },

    refreshPresets: async () => {
      const names = await ipcListChainPresets();
      set((state) => { state.presetNames = names; });
    },

    applySnapshot: (snapshot) => {
      set((state) => { state.chains[snapshot.channel_id] = snapshot; });
    },
  })),
);
