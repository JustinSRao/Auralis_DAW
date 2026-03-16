/**
 * Zustand store for the Automation Editor (Sprint 14).
 *
 * Tracks all automation lanes in memory (keyed by `patternId::parameterId`),
 * record mode state, and which track rows are expanded in the timeline.
 *
 * Rust's AutomationLaneStore is the playback source of truth; this store is the
 * frontend display + editing source of truth. Changes here are forwarded to Rust
 * via IPC immediately (set_automation_point / delete_automation_point).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  AutomationLaneData,
  AutomationInterp,
  AutomationRecordEvent,
  ControlPointData,
} from '../lib/ipc';
import {
  ipcSetAutomationPoint,
  ipcDeleteAutomationPoint,
  ipcSetAutomationInterp,
  ipcEnableAutomationLane,
  ipcRecordAutomationBatch,
} from '../lib/ipc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function laneKey(patternId: string, parameterId: string): string {
  return `${patternId}::${parameterId}`;
}

function evaluateAt(points: ControlPointData[], tick: number): number {
  if (points.length === 0) return 0;
  if (tick <= points[0].tick) return points[0].value;
  if (tick >= points[points.length - 1].tick) return points[points.length - 1].value;

  // Binary search for surrounding pair
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].tick <= tick) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  const t = (tick - a.tick) / (b.tick - a.tick);

  switch (a.interp) {
    case 'Step':
      return a.value;
    case 'Exponential':
      if (a.value === 0 || b.value === 0 || (a.value > 0) !== (b.value > 0)) {
        return a.value + (b.value - a.value) * t;
      }
      return a.value * Math.pow(b.value / a.value, t);
    case 'Linear':
    default:
      return a.value + (b.value - a.value) * t;
  }
}

// ---------------------------------------------------------------------------
// State / Actions
// ---------------------------------------------------------------------------

interface AutomationState {
  /** All lanes keyed by `patternId::parameterId`. */
  lanes: Record<string, AutomationLaneData>;
  /** True while automation record mode is active. */
  recordEnabled: boolean;
  /** Pattern being recorded into (set by the user before recording). */
  recordPatternId: string | null;
  /** Buffered record events, flushed to Rust every 100 ms. */
  pendingEvents: AutomationRecordEvent[];
  /** Track IDs with expanded automation rows in the timeline. */
  expandedTrackIds: string[];
  error: string | null;
}

interface AutomationActions {
  /** Add or update a breakpoint. Updates local store and calls IPC. */
  setPoint(
    patternId: string,
    parameterId: string,
    tick: number,
    value: number,
    interp: AutomationInterp,
  ): Promise<void>;

  /** Delete a breakpoint. Updates local store and calls IPC. */
  deletePoint(patternId: string, parameterId: string, tick: number): Promise<void>;

  /** Change the interpolation mode of a breakpoint. */
  setInterp(
    patternId: string,
    parameterId: string,
    tick: number,
    interp: AutomationInterp,
  ): Promise<void>;

  /** Enable/disable a lane. */
  enableLane(patternId: string, parameterId: string, enabled: boolean): Promise<void>;

  /** Buffer a record event for the next flush batch. */
  pushRecordEvent(event: AutomationRecordEvent): void;

  /** Flush pending record events to the Rust backend (called every 100 ms). */
  flushRecordBatch(): Promise<void>;

  /** Enable or disable record mode. */
  setRecordEnabled(enabled: boolean): void;

  /** Set which pattern to record into. */
  setRecordPatternId(patternId: string | null): void;

  /** Toggle a track's automation row expansion. */
  toggleTrackExpanded(trackId: string): void;

  /** Replace all lanes from a loaded project's patterns. Called by fileStore.open(). */
  loadFromProject(patterns: Array<{ id: string; automation?: Record<string, AutomationLaneData> }>): void;

  /** Clear all lanes (called on new project). */
  clear(): void;

  /** Get a lane by patternId + parameterId, or undefined. */
  getLane(patternId: string, parameterId: string): AutomationLaneData | undefined;

  /** Evaluate the curve for a lane at a given tick position. */
  evaluateAt(patternId: string, parameterId: string, tick: number): number;

  /** Return all lanes for a given patternId, as a Record<parameterId, lane>. */
  getLanesForPattern(patternId: string): Record<string, AutomationLaneData>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAutomationStore = create<AutomationState & AutomationActions>()(
  immer((set, get) => ({
    lanes: {},
    recordEnabled: false,
    recordPatternId: null,
    pendingEvents: [],
    expandedTrackIds: [],
    error: null,

    setPoint: async (patternId, parameterId, tick, value, interp) => {
      // Optimistic local update
      set((s) => {
        const key = laneKey(patternId, parameterId);
        if (!s.lanes[key]) {
          s.lanes[key] = { patternId, parameterId, enabled: true, points: [] };
        }
        const lane = s.lanes[key];
        const idx = lane.points.findIndex((p) => p.tick === tick);
        if (idx >= 0) {
          lane.points[idx] = { tick, value, interp };
        } else {
          // Insert sorted
          let i = 0;
          while (i < lane.points.length && lane.points[i].tick < tick) i++;
          lane.points.splice(i, 0, { tick, value, interp });
        }
      });
      try {
        await ipcSetAutomationPoint(patternId, parameterId, tick, value, interp);
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    deletePoint: async (patternId, parameterId, tick) => {
      set((s) => {
        const key = laneKey(patternId, parameterId);
        const lane = s.lanes[key];
        if (!lane) return;
        const idx = lane.points.findIndex((p) => p.tick === tick);
        if (idx >= 0) lane.points.splice(idx, 1);
      });
      try {
        await ipcDeleteAutomationPoint(patternId, parameterId, tick);
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    setInterp: async (patternId, parameterId, tick, interp) => {
      set((s) => {
        const key = laneKey(patternId, parameterId);
        const lane = s.lanes[key];
        if (!lane) return;
        const pt = lane.points.find((p) => p.tick === tick);
        if (pt) pt.interp = interp;
      });
      try {
        await ipcSetAutomationInterp(patternId, parameterId, tick, interp);
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    enableLane: async (patternId, parameterId, enabled) => {
      set((s) => {
        const key = laneKey(patternId, parameterId);
        if (s.lanes[key]) s.lanes[key].enabled = enabled;
      });
      try {
        await ipcEnableAutomationLane(patternId, parameterId, enabled);
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    pushRecordEvent: (event) => {
      set((s) => {
        s.pendingEvents.push(event);
        // Also update local lane immediately for live visual feedback
        if (s.recordPatternId) {
          const key = laneKey(s.recordPatternId, event.parameterId);
          if (!s.lanes[key]) {
            s.lanes[key] = {
              patternId: s.recordPatternId,
              parameterId: event.parameterId,
              enabled: true,
              points: [],
            };
          }
          const lane = s.lanes[key];
          let i = 0;
          while (i < lane.points.length && lane.points[i].tick < event.tick) i++;
          // Replace existing tick or insert
          if (lane.points[i]?.tick === event.tick) {
            lane.points[i].value = event.value;
          } else {
            lane.points.splice(i, 0, { tick: event.tick, value: event.value, interp: 'Linear' });
          }
        }
      });
    },

    flushRecordBatch: async () => {
      const { pendingEvents } = get();
      if (pendingEvents.length === 0) return;
      set((s) => { s.pendingEvents = []; });
      try {
        await ipcRecordAutomationBatch(pendingEvents);
      } catch (e) {
        set((s) => { s.error = String(e); });
      }
    },

    setRecordEnabled: (enabled) =>
      set((s) => { s.recordEnabled = enabled; }),

    setRecordPatternId: (patternId) =>
      set((s) => { s.recordPatternId = patternId; }),

    toggleTrackExpanded: (trackId) =>
      set((s) => {
        const idx = s.expandedTrackIds.indexOf(trackId);
        if (idx >= 0) s.expandedTrackIds.splice(idx, 1);
        else s.expandedTrackIds.push(trackId);
      }),

    loadFromProject: (patterns) =>
      set((s) => {
        s.lanes = {};
        for (const pattern of patterns) {
          if (!pattern.automation) continue;
          for (const [parameterId, lane] of Object.entries(pattern.automation)) {
            const key = laneKey(pattern.id, parameterId);
            s.lanes[key] = lane;
          }
        }
      }),

    clear: () =>
      set((s) => {
        s.lanes = {};
        s.recordEnabled = false;
        s.recordPatternId = null;
        s.pendingEvents = [];
        s.expandedTrackIds = [];
        s.error = null;
      }),

    getLane: (patternId, parameterId) =>
      get().lanes[laneKey(patternId, parameterId)],

    evaluateAt: (patternId, parameterId, tick) => {
      const lane = get().lanes[laneKey(patternId, parameterId)];
      if (!lane || !lane.enabled) return 0;
      return evaluateAt(lane.points, tick);
    },

    getLanesForPattern: (patternId) => {
      const result: Record<string, AutomationLaneData> = {};
      for (const [key, lane] of Object.entries(get().lanes)) {
        if (lane.patternId === patternId) {
          result[key] = lane;
        }
      }
      return result;
    },
  })),
);
