/**
 * Track Freeze & Bounce state store (Sprint 40).
 *
 * Tracks which tracks are frozen and manages the freeze/unfreeze/bounce
 * workflow. Delegates render calls to typed IPC wrappers.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ClipData, FreezeRenderResult } from "@/lib/ipc";
import {
  ipcFreezeTrack,
  ipcUnfreezeTrack,
  ipcBounceTrackInPlace,
  ipcCancelFreeze,
  ipcGetFreezeProgress,
} from "@/lib/ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreezeStatus = "idle" | "rendering" | "frozen" | "error";

export interface FrozenTrackInfo {
  /** The audio clip ID inserted for frozen playback (must be removed on unfreeze). */
  freezeClipId: string;
  /** Absolute path to the freeze WAV. */
  wavPath: string;
}

interface FreezeState {
  /** Status per track. */
  statusByTrack: Record<string, FreezeStatus>;
  /** Render progress (0–1) per track while rendering. */
  progressByTrack: Record<string, number>;
  /** Per-frozen-track metadata needed for unfreeze. */
  frozenInfo: Record<string, FrozenTrackInfo>;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Returns the freeze status for a track. */
  getStatus: (trackId: string) => FreezeStatus;

  /** Returns true if the track is currently frozen. */
  isFrozen: (trackId: string) => boolean;

  /** Returns the render progress for a track (0–1), or 0 if idle. */
  getProgress: (trackId: string) => number;

  /**
   * Begins the freeze render for a MIDI track.
   * On success, stores the frozen info and marks the track as frozen.
   * Returns the `FreezeRenderResult` so the caller can update the project.
   */
  freezeTrack: (
    trackId: string,
    clips: ClipData[],
    bpm: number,
    outputDir: string,
    startBeats?: number,
    endBeats?: number,
  ) => Promise<FreezeRenderResult>;

  /**
   * Unfreezes a track. Returns the freeze clip ID to remove from the track.
   */
  unfreezeTrack: (trackId: string) => Promise<string>;

  /**
   * Bounces a track in place.
   * Returns `FreezeRenderResult` so the caller can convert the track to Audio.
   */
  bounceTrack: (
    trackId: string,
    clips: ClipData[],
    bpm: number,
    outputDir: string,
    startBeats?: number,
    endBeats?: number,
  ) => Promise<FreezeRenderResult>;

  /** Cancels an in-progress render. */
  cancelFreeze: (trackId: string) => Promise<void>;

  /** Updates progress from the `freeze_progress` Tauri event (called by hook). */
  onProgress: (trackId: string, progress: number) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFreezeStore = create<FreezeState>()(
  immer((set, get) => ({
    statusByTrack: {},
    progressByTrack: {},
    frozenInfo: {},

    getStatus: (trackId) => get().statusByTrack[trackId] ?? "idle",

    isFrozen: (trackId) => get().statusByTrack[trackId] === "frozen",

    getProgress: (trackId) => get().progressByTrack[trackId] ?? 0,

    freezeTrack: async (trackId, clips, bpm, outputDir, startBeats, endBeats) => {
      set((s) => {
        s.statusByTrack[trackId] = "rendering";
        s.progressByTrack[trackId] = 0;
      });
      try {
        const result = await ipcFreezeTrack(
          trackId,
          clips,
          bpm,
          outputDir,
          startBeats,
          endBeats,
        );
        set((s) => {
          s.statusByTrack[trackId] = "frozen";
          s.progressByTrack[trackId] = 1;
          s.frozenInfo[trackId] = {
            freezeClipId: result.clipId,
            wavPath: result.wavPath,
          };
        });
        return result;
      } catch (err) {
        set((s) => {
          s.statusByTrack[trackId] = "error";
        });
        throw err;
      }
    },

    unfreezeTrack: async (trackId) => {
      const clipId = await ipcUnfreezeTrack(trackId);
      set((s) => {
        s.statusByTrack[trackId] = "idle";
        s.progressByTrack[trackId] = 0;
        delete s.frozenInfo[trackId];
      });
      return clipId;
    },

    bounceTrack: async (trackId, clips, bpm, outputDir, startBeats, endBeats) => {
      set((s) => {
        s.statusByTrack[trackId] = "rendering";
        s.progressByTrack[trackId] = 0;
      });
      try {
        const result = await ipcBounceTrackInPlace(
          trackId,
          clips,
          bpm,
          outputDir,
          startBeats,
          endBeats,
        );
        set((s) => {
          s.statusByTrack[trackId] = "idle"; // bounce is done — track converted
          s.progressByTrack[trackId] = 1;
        });
        return result;
      } catch (err) {
        set((s) => {
          s.statusByTrack[trackId] = "error";
        });
        throw err;
      }
    },

    cancelFreeze: async (trackId) => {
      await ipcCancelFreeze(trackId);
      set((s) => {
        s.statusByTrack[trackId] = "idle";
        s.progressByTrack[trackId] = 0;
      });
    },

    onProgress: (trackId, progress) => {
      set((s) => {
        s.progressByTrack[trackId] = progress;
      });
    },
  })),
);
