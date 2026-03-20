/**
 * Zustand store for take lane state.
 *
 * Mirrors the Rust `TakeLaneStore`. Populated from `take-created` and
 * `take-recording-started` Tauri events. Not persisted — reloaded from
 * backend on project open.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  TakeLane,
  Take,
  TakeCreatedEvent,
  TakeRecordingStartedEvent,
} from '../lib/ipc';
import {
  ipcGetTakeLanes,
  ipcSetActiveTake,
  ipcDeleteTake,
  ipcToggleTakeLaneExpanded,
} from '../lib/ipc';

interface TakeLaneState {
  /** Take lanes keyed by trackId. */
  lanes: Record<string, TakeLane>;
  /** Whether loop recording is currently armed (a track is recording in loop mode). */
  loopRecordArmed: boolean;
  /** The trackId being loop-recorded (null if not recording). */
  activeLoopTrackId: string | null;

  /** Load takes for a specific track from the backend. */
  loadTakeLanes: (trackId: string) => Promise<void>;
  /** Called when a take-created event arrives. */
  onTakeCreated: (event: TakeCreatedEvent) => void;
  /** Called when take-recording-started arrives — creates an empty placeholder pattern slot. */
  onTakeRecordingStarted: (event: TakeRecordingStartedEvent) => void;
  /** Set the active take for a track (also calls IPC). */
  setActiveTake: (trackId: string, takeId: string) => Promise<void>;
  /** Delete a take (also calls IPC). */
  deleteTake: (trackId: string, takeId: string) => Promise<void>;
  /** Toggle expanded state of a lane. */
  toggleExpanded: (trackId: string) => Promise<void>;
  /** Set the armed status for loop recording. */
  setLoopRecordArmed: (armed: boolean, trackId: string | null) => void;
}

export const useTakeLaneStore = create<TakeLaneState>()(
  immer((set, _get) => ({
    lanes: {},
    loopRecordArmed: false,
    activeLoopTrackId: null,

    loadTakeLanes: async (trackId) => {
      try {
        const lane = await ipcGetTakeLanes(trackId);
        set((s) => {
          s.lanes[trackId] = lane;
        });
      } catch (e) {
        console.warn('loadTakeLanes failed:', e);
      }
    },

    onTakeCreated: (event) => {
      set((s) => {
        const { take, trackId } = event;
        if (!s.lanes[trackId]) {
          s.lanes[trackId] = {
            trackId,
            takes: [],
            compRegions: [],
            expanded: true,
          };
        }
        // Deactivate all existing takes
        s.lanes[trackId].takes.forEach((t: Take) => {
          t.isActive = false;
        });
        s.lanes[trackId].takes.push(take);
      });
    },

    onTakeRecordingStarted: (_event) => {
      // The new recording pattern is handled by the MIDI recording events.
      // No state update needed here — just notification.
    },

    setActiveTake: async (trackId, takeId) => {
      set((s) => {
        if (s.lanes[trackId]) {
          s.lanes[trackId].takes.forEach((t: Take) => {
            t.isActive = t.id === takeId;
          });
        }
      });
      try {
        await ipcSetActiveTake(trackId, takeId);
      } catch (e) {
        console.warn('setActiveTake failed:', e);
      }
    },

    deleteTake: async (trackId, takeId) => {
      set((s) => {
        if (s.lanes[trackId]) {
          s.lanes[trackId].takes = s.lanes[trackId].takes.filter(
            (t: Take) => t.id !== takeId,
          );
          // Re-activate the last remaining take if needed
          const lane = s.lanes[trackId];
          if (lane.takes.length > 0 && !lane.takes.some((t: Take) => t.isActive)) {
            lane.takes[lane.takes.length - 1].isActive = true;
          }
        }
      });
      try {
        await ipcDeleteTake(trackId, takeId);
      } catch (e) {
        console.warn('deleteTake failed:', e);
      }
    },

    toggleExpanded: async (trackId) => {
      try {
        const expanded = await ipcToggleTakeLaneExpanded(trackId);
        set((s) => {
          if (s.lanes[trackId]) {
            s.lanes[trackId].expanded = expanded;
          }
        });
      } catch (e) {
        console.warn('toggleExpanded failed:', e);
      }
    },

    setLoopRecordArmed: (armed, trackId) => {
      set((s) => {
        s.loopRecordArmed = armed;
        s.activeLoopTrackId = trackId;
      });
    },
  })),
);
