import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetChannelFader, ipcSetChannelPan, ipcSetChannelMute,
  ipcSetChannelSolo, ipcSetChannelSend, ipcSetMasterFader,
} from '../lib/ipc';
import type { MixerSnapshot } from '../lib/ipc';

interface ChannelState {
  id: string;
  name: string;
  fader: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  sends: [number, number, number, number];
  peakL: number;
  peakR: number;
}

interface BusState {
  id: string;
  name: string;
  fader: number;
}

interface MixerStoreState {
  channels: Record<string, ChannelState>;
  buses: BusState[];
  masterFader: number;
  masterPeakL: number;
  masterPeakR: number;
  hydrate: (snapshot: MixerSnapshot) => void;
  setChannelFader: (channelId: string, value: number) => void;
  setChannelPan: (channelId: string, value: number) => void;
  setChannelMute: (channelId: string, muted: boolean) => void;
  setChannelSolo: (channelId: string, solo: boolean) => void;
  setChannelSend: (channelId: string, busIndex: number, value: number) => void;
  setMasterFader: (value: number) => void;
  applyChannelLevel: (channelId: string, peakL: number, peakR: number) => void;
  applyMasterLevel: (peakL: number, peakR: number) => void;
}

export const useMixerStore = create<MixerStoreState>()(
  immer((set) => ({
    channels: {},
    buses: [],
    masterFader: 1.0,
    masterPeakL: 0,
    masterPeakR: 0,

    hydrate: (snapshot) => set((state) => {
      state.channels = {};
      for (const ch of snapshot.channels) {
        state.channels[ch.id] = {
          id: ch.id,
          name: ch.name,
          fader: ch.fader,
          pan: ch.pan,
          mute: ch.mute,
          solo: ch.solo,
          sends: ch.sends as [number, number, number, number],
          peakL: 0,
          peakR: 0,
        };
      }
      state.buses = snapshot.buses;
      state.masterFader = snapshot.master_fader;
    }),

    setChannelFader: (channelId, value) => {
      set((state) => {
        if (state.channels[channelId]) state.channels[channelId].fader = value;
      });
      void ipcSetChannelFader(channelId, value);
    },

    setChannelPan: (channelId, value) => {
      set((state) => {
        if (state.channels[channelId]) state.channels[channelId].pan = value;
      });
      void ipcSetChannelPan(channelId, value);
    },

    setChannelMute: (channelId, muted) => {
      set((state) => {
        if (state.channels[channelId]) state.channels[channelId].mute = muted;
      });
      void ipcSetChannelMute(channelId, muted);
    },

    setChannelSolo: (channelId, solo) => {
      set((state) => {
        if (state.channels[channelId]) state.channels[channelId].solo = solo;
      });
      void ipcSetChannelSolo(channelId, solo);
    },

    setChannelSend: (channelId, busIndex, value) => {
      set((state) => {
        if (state.channels[channelId]) state.channels[channelId].sends[busIndex] = value;
      });
      void ipcSetChannelSend(channelId, busIndex, value);
    },

    setMasterFader: (value) => {
      set((state) => { state.masterFader = value; });
      void ipcSetMasterFader(value);
    },

    applyChannelLevel: (channelId, peakL, peakR) => set((state) => {
      if (state.channels[channelId]) {
        state.channels[channelId].peakL = peakL;
        state.channels[channelId].peakR = peakR;
      }
    }),

    applyMasterLevel: (peakL, peakR) => set((state) => {
      state.masterPeakL = peakL;
      state.masterPeakR = peakR;
    }),
  }))
);
