import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcSetChannelFader, ipcSetChannelPan, ipcSetChannelMute,
  ipcSetChannelSolo, ipcSetChannelSend, ipcSetMasterFader,
  ipcCreateGroupBus, ipcDeleteGroupBus, ipcRenameGroupBus,
  ipcSetChannelOutput, ipcSetGroupBusOutput,
  ipcSetGroupBusFader, ipcSetGroupBusPan,
  ipcSetGroupBusMute, ipcSetGroupBusSolo,
} from '../lib/ipc';
import type { MixerSnapshot, GroupBusSnapshot, OutputTargetDto } from '../lib/ipc';

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

export interface GroupBusState {
  id: number;
  name: string;
  outputTarget: OutputTargetDto;
  fader: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  peakL: number;
  peakR: number;
}

interface MixerStoreState {
  channels: Record<string, ChannelState>;
  buses: BusState[];
  masterFader: number;
  masterPeakL: number;
  masterPeakR: number;
  groupBuses: GroupBusState[];
  hydrate: (snapshot: MixerSnapshot) => void;
  hydrateGroupBuses: (snapshots: GroupBusSnapshot[]) => void;
  setChannelFader: (channelId: string, value: number) => void;
  setChannelPan: (channelId: string, value: number) => void;
  setChannelMute: (channelId: string, muted: boolean) => void;
  setChannelSolo: (channelId: string, solo: boolean) => void;
  setChannelSend: (channelId: string, busIndex: number, value: number) => void;
  setMasterFader: (value: number) => void;
  applyChannelLevel: (channelId: string, peakL: number, peakR: number) => void;
  applyMasterLevel: (peakL: number, peakR: number) => void;
  createGroupBus: (name: string) => Promise<number>;
  deleteGroupBus: (busId: number) => Promise<void>;
  renameGroupBus: (busId: number, name: string) => Promise<void>;
  setChannelOutput: (channelId: string, target: OutputTargetDto) => Promise<void>;
  setGroupBusOutput: (busId: number, target: OutputTargetDto) => Promise<void>;
  setGroupBusFader: (busId: number, value: number) => void;
  setGroupBusPan: (busId: number, value: number) => void;
  setGroupBusMute: (busId: number, muted: boolean) => void;
  setGroupBusSolo: (busId: number, soloed: boolean) => void;
  applyGroupBusLevel: (busId: number, peakL: number, peakR: number) => void;
}

export const useMixerStore = create<MixerStoreState>()(
  immer((set) => ({
    channels: {},
    buses: [],
    masterFader: 1.0,
    masterPeakL: 0,
    masterPeakR: 0,
    groupBuses: [],

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

    hydrateGroupBuses: (snapshots) => set((state) => {
      state.groupBuses = snapshots.map((s) => ({
        id: s.id,
        name: s.name,
        outputTarget: s.output_target,
        fader: s.fader,
        pan: s.pan,
        mute: s.mute,
        solo: s.solo,
        peakL: s.peak_l,
        peakR: s.peak_r,
      }));
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

    createGroupBus: async (name) => {
      const id = await ipcCreateGroupBus(name);
      set((state) => {
        state.groupBuses.push({
          id,
          name,
          outputTarget: { kind: 'master' },
          fader: 1.0,
          pan: 0.0,
          mute: false,
          solo: false,
          peakL: 0,
          peakR: 0,
        });
      });
      return id;
    },

    deleteGroupBus: async (busId) => {
      await ipcDeleteGroupBus(busId);
      set((state) => {
        state.groupBuses = state.groupBuses.filter((gb) => gb.id !== busId);
      });
    },

    renameGroupBus: async (busId, name) => {
      await ipcRenameGroupBus(busId, name);
      set((state) => {
        const gb = state.groupBuses.find((b) => b.id === busId);
        if (gb) gb.name = name;
      });
    },

    setChannelOutput: async (channelId, target) => {
      await ipcSetChannelOutput(channelId, target);
    },

    setGroupBusOutput: async (busId, target) => {
      await ipcSetGroupBusOutput(busId, target);
      set((state) => {
        const gb = state.groupBuses.find((b) => b.id === busId);
        if (gb) gb.outputTarget = target;
      });
    },

    setGroupBusFader: (busId, value) => {
      set((state) => {
        const gb = state.groupBuses.find((b) => b.id === busId);
        if (gb) gb.fader = value;
      });
      void ipcSetGroupBusFader(busId, value);
    },

    setGroupBusPan: (busId, value) => {
      set((state) => {
        const gb = state.groupBuses.find((b) => b.id === busId);
        if (gb) gb.pan = value;
      });
      void ipcSetGroupBusPan(busId, value);
    },

    setGroupBusMute: (busId, muted) => {
      set((state) => {
        const gb = state.groupBuses.find((b) => b.id === busId);
        if (gb) gb.mute = muted;
      });
      void ipcSetGroupBusMute(busId, muted);
    },

    setGroupBusSolo: (busId, soloed) => {
      set((state) => {
        const gb = state.groupBuses.find((b) => b.id === busId);
        if (gb) gb.solo = soloed;
      });
      void ipcSetGroupBusSolo(busId, soloed);
    },

    applyGroupBusLevel: (busId, peakL, peakR) => set((state) => {
      const gb = state.groupBuses.find((b) => b.id === busId);
      if (gb) {
        gb.peakL = peakL;
        gb.peakR = peakR;
      }
    }),
  }))
);
