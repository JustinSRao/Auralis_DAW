import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcLoadAudioClip,
  ipcSetClipGain,
  ipcSetClipOffset,
  ipcTriggerAudioClip,
  ipcStopAudioClip,
  ipcGetClipState,
  ipcGetWaveformPeaks,
  type ClipStateSnapshot,
  type PeakData,
} from '../lib/ipc';

interface ClipPlayerState {
  clips: Record<string, ClipStateSnapshot>;
  peaks: Record<string, PeakData>;

  loadClip: (clipId: string, filePath: string, startBar: number, durationBars: number) => Promise<void>;
  setGain: (clipId: string, gain: number) => void;
  setOffset: (clipId: string, startOffsetFrames: number) => void;
  triggerClip: (clipId: string) => Promise<void>;
  stopClip: (clipId: string) => Promise<void>;
  refreshClip: (clipId: string) => Promise<void>;
  loadPeaks: (filePath: string, framesPerPixel: number) => Promise<PeakData>;
}

export const useClipPlayerStore = create<ClipPlayerState>()(
  immer((set, get) => ({
    clips: {},
    peaks: {},

    loadClip: async (clipId, filePath, startBar, durationBars) => {
      const snap = await ipcLoadAudioClip(clipId, filePath, startBar, durationBars);
      set((state) => { state.clips[clipId] = snap; });
    },

    setGain: (clipId, gain) => {
      set((state) => {
        if (state.clips[clipId]) state.clips[clipId].gain = gain;
      });
      ipcSetClipGain(clipId, gain).catch(() => {});
    },

    setOffset: (clipId, startOffsetFrames) => {
      set((state) => {
        if (state.clips[clipId]) state.clips[clipId].start_offset_frames = startOffsetFrames;
      });
      ipcSetClipOffset(clipId, startOffsetFrames).catch(() => {});
    },

    triggerClip: async (clipId) => {
      await ipcTriggerAudioClip(clipId);
    },

    stopClip: async (clipId) => {
      await ipcStopAudioClip(clipId);
    },

    refreshClip: async (clipId) => {
      const snap = await ipcGetClipState(clipId);
      set((state) => { state.clips[clipId] = snap; });
    },

    loadPeaks: async (filePath, framesPerPixel) => {
      const key = `${filePath}::${framesPerPixel}`;
      const cached = get().peaks[key];
      if (cached) return cached;
      const data = await ipcGetWaveformPeaks(filePath, framesPerPixel);
      set((state) => { state.peaks[key] = data; });
      return data;
    },
  })),
);
