import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import {
  getInputDevices,
  setInputDevice,
  startRecording,
  stopRecording,
  getRecordingStatus,
  setMonitoringEnabled,
  setMonitoringGain,
  type AudioDeviceInfo,
  type RecorderStatus,
} from "../lib/ipc";

// ── Store interface ───────────────────────────────────────────────────────────

interface RecorderStoreState {
  inputDevices: AudioDeviceInfo[];
  selectedDevice: string | null;
  isRecording: boolean;
  isFinalizing: boolean;
  inputLevel: number;       // 0.0–1.0 RMS
  monitoringEnabled: boolean;
  monitoringGain: number;   // 0.0–1.0
  outputPath: string | null;
  error: string | null;

  /** Fetches available input devices from the backend. */
  fetchInputDevices(): Promise<void>;
  /** Selects an input device for recording. */
  selectInputDevice(name: string): Promise<void>;
  /** Starts recording. */
  startRecording(): Promise<void>;
  /** Stops recording and begins WAV finalization. */
  stopRecording(): Promise<void>;
  /** Enables or disables monitoring pass-through. */
  setMonitoring(enabled: boolean): Promise<void>;
  /** Sets monitoring gain (0.0–1.0). */
  setMonitoringGain(gain: number): Promise<void>;
  /** Fetches and syncs status from the backend. */
  fetchStatus(): Promise<void>;
  /** Updates the input level (called from the input-level-changed event listener). */
  setInputLevel(level: number): void;
  /** Updates the output path after finalization (called from recording-finalized listener). */
  setOutputPath(path: string): void;
  /** Clears the error field. */
  clearError(): void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useRecorderStore = create<RecorderStoreState>()(
  immer((set, get) => ({
    inputDevices: [],
    selectedDevice: null,
    isRecording: false,
    isFinalizing: false,
    inputLevel: 0,
    monitoringEnabled: false,
    monitoringGain: 0.7,
    outputPath: null,
    error: null,

    async fetchInputDevices() {
      try {
        const devices = await getInputDevices();
        set((s) => {
          s.inputDevices = devices;
          s.error = null;
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async selectInputDevice(name) {
      const prev = get().selectedDevice;
      set((s) => {
        s.selectedDevice = name;
      });
      try {
        await setInputDevice(name);
      } catch (err) {
        set((s) => {
          s.selectedDevice = prev; // rollback
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async startRecording() {
      if (get().isRecording || get().isFinalizing) return;
      set((s) => {
        s.isRecording = true;
        s.outputPath = null;
        s.error = null;
      });
      try {
        const path = await startRecording();
        set((s) => {
          s.outputPath = path;
        });
      } catch (err) {
        set((s) => {
          s.isRecording = false;
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async stopRecording() {
      if (!get().isRecording) return;
      set((s) => {
        s.isRecording = false;
        s.isFinalizing = true;
      });
      try {
        await stopRecording();
      } catch (err) {
        // Restore isRecording: backend is still in REC_RECORDING state
        set((s) => {
          s.isRecording = true;
          s.isFinalizing = false;
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setMonitoring(enabled) {
      set((s) => {
        s.monitoringEnabled = enabled;
      });
      try {
        await setMonitoringEnabled(enabled);
      } catch (err) {
        set((s) => {
          s.monitoringEnabled = !enabled; // rollback
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setMonitoringGain(gain) {
      const prev = get().monitoringGain;
      set((s) => {
        s.monitoringGain = gain;
      });
      try {
        await setMonitoringGain(gain);
      } catch (err) {
        set((s) => {
          s.monitoringGain = prev; // rollback
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async fetchStatus() {
      try {
        const status: RecorderStatus = await getRecordingStatus();
        set((s) => {
          s.isRecording = status.state === "recording";
          s.isFinalizing = status.state === "finalizing";
          s.monitoringEnabled = status.monitoring_enabled;
          s.monitoringGain = status.monitoring_gain;
          if (status.output_path) s.outputPath = status.output_path;
          s.error = null;
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    setInputLevel(level) {
      set((s) => {
        s.inputLevel = level;
      });
    },

    setOutputPath(path) {
      set((s) => {
        s.outputPath = path;
        s.isFinalizing = false;
      });
    },

    clearError() {
      set((s) => {
        s.error = null;
      });
    },
  })),
);
