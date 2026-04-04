import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  AudioDeviceInfo,
  AudioHostType,
  EngineConfig,
  EngineState,
} from "../lib/ipc";
import {
  getAudioDevices,
  getEngineStatus,
  startEngine,
  stopEngine,
  setAudioDevice,
  setEngineConfig,
  setTestTone,
} from "../lib/ipc";

interface AudioStoreState {
  // State
  devices: AudioDeviceInfo[];
  engineState: EngineState;
  config: EngineConfig;
  activeHost: AudioHostType | null;
  testToneActive: boolean;
  error: string | null;
  isLoading: boolean;

  // Actions
  refreshDevices: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  selectDevice: (name: string, isInput: boolean) => Promise<void>;
  updateConfig: (sampleRate?: number, bufferSize?: number) => Promise<void>;
  toggleTestTone: (enabled: boolean) => Promise<void>;
  clearError: () => void;
}

function applyStatus(
  state: AudioStoreState,
  status: { state: EngineState; config: EngineConfig; active_host: AudioHostType | null; test_tone_active: boolean },
) {
  state.engineState = status.state;
  state.config = status.config;
  state.activeHost = status.active_host;
  state.testToneActive = status.test_tone_active;
  state.error = null;
  state.isLoading = false;
}

export const useAudioStore = create<AudioStoreState>()(
  immer((set) => ({
    devices: [],
    engineState: "stopped" as EngineState,
    config: {
      sample_rate: 44100,
      buffer_size: 256,
      output_device: null,
      input_device: null,
    },
    activeHost: null,
    testToneActive: false,
    error: null,
    isLoading: false,

    refreshDevices: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const devices = await getAudioDevices();
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
        const status = await getEngineStatus();
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

    start: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await startEngine();
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

    stop: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await stopEngine();
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

    selectDevice: async (name: string, isInput: boolean) => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await setAudioDevice(name, isInput);
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

    updateConfig: async (sampleRate?: number, bufferSize?: number) => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const status = await setEngineConfig(sampleRate, bufferSize);
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

    toggleTestTone: async (enabled: boolean) => {
      try {
        await setTestTone(enabled);
        set((s) => {
          s.testToneActive = enabled;
          s.error = null;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
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
