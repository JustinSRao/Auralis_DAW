import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { MidiDeviceInfo, MidiStatus } from "../lib/ipc";
import {
  getMidiDevices,
  getMidiStatus,
  connectMidiInput,
  disconnectMidiInput,
  connectMidiOutput,
  disconnectMidiOutput,
} from "../lib/ipc";

interface MidiStoreState {
  // State
  devices: MidiDeviceInfo[];
  activeInput: string | null;
  activeOutput: string | null;
  error: string | null;
  isLoading: boolean;

  // Actions
  refreshDevices: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  connectInput: (portName: string) => Promise<void>;
  disconnectInput: () => Promise<void>;
  connectOutput: (portName: string) => Promise<void>;
  disconnectOutput: () => Promise<void>;
  clearError: () => void;
}

function applyStatus(state: MidiStoreState, status: MidiStatus) {
  state.activeInput = status.active_input;
  state.activeOutput = status.active_output;
  state.error = null;
  state.isLoading = false;
}

export const useMidiStore = create<MidiStoreState>()(
  immer((set) => ({
    devices: [],
    activeInput: null,
    activeOutput: null,
    error: null,
    isLoading: false,

    refreshDevices: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const devices = await getMidiDevices();
        set((s) => {
          s.devices = devices ?? [];
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    refreshStatus: async () => {
      try {
        const status = await getMidiStatus();
        if (status) {
          set((s) => {
            applyStatus(s, status);
          });
        }
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    connectInput: async (portName: string) => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await connectMidiInput(portName);
        set((s) => {
          applyStatus(s, status);
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    disconnectInput: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await disconnectMidiInput();
        set((s) => {
          applyStatus(s, status);
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    connectOutput: async (portName: string) => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await connectMidiOutput(portName);
        set((s) => {
          applyStatus(s, status);
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    disconnectOutput: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await disconnectMidiOutput();
        set((s) => {
          applyStatus(s, status);
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    clearError: () => {
      set((s) => {
        s.error = null;
      });
    },
  })),
);
