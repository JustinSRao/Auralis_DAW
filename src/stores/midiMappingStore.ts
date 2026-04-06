/**
 * MIDI CC → Parameter Mapping store (Sprint 29).
 *
 * Tracks all active CC mappings and the current MIDI Learn state.
 * Mappings are persisted in the project file via `ipcLoadMidiMappings` /
 * `ipcGetMidiMappings` rather than localStorage.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { MidiMapping } from "@/lib/ipc";
import {
  ipcGetMidiMappings,
  ipcStartMidiLearn,
  ipcCancelMidiLearn,
  ipcDeleteMidiMapping,
  ipcLoadMidiMappings,
} from "@/lib/ipc";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface MidiMappingState {
  /** All active CC → parameter mappings. */
  mappings: MidiMapping[];
  /** `param_id` currently being learned, or `null` when idle. */
  learningParamId: string | null;
  /** Whether the last learn completed successfully (resets to false on next learn). */
  lastLearnedParamId: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Loads all mappings from the backend into the store. */
  hydrate: () => Promise<void>;

  /** Replaces the mapping table (called on project load). */
  loadMappings: (mappings: MidiMapping[]) => Promise<void>;

  /** Enters MIDI learn mode for the given parameter. */
  startLearn: (paramId: string, minValue: number, maxValue: number) => Promise<void>;

  /** Cancels MIDI learn without creating a mapping. */
  cancelLearn: () => Promise<void>;

  /**
   * Called by `useMidiLearn` when the backend emits `midi-learn-captured`.
   * Updates the local mapping list with the newly captured CC.
   */
  onLearnCaptured: (paramId: string, cc: number, channel: number) => void;

  /** Removes the mapping for `paramId`. */
  deleteMapping: (paramId: string) => Promise<void>;

  /** Returns the mapping for `paramId`, or `undefined`. */
  getMappingForParam: (paramId: string) => MidiMapping | undefined;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMidiMappingStore = create<MidiMappingState>()(
  immer((set, get) => ({
    mappings: [],
    learningParamId: null,
    lastLearnedParamId: null,

    hydrate: async () => {
      const mappings = await ipcGetMidiMappings();
      set((s) => {
        s.mappings = mappings;
      });
    },

    loadMappings: async (mappings) => {
      await ipcLoadMidiMappings(mappings);
      set((s) => {
        s.mappings = mappings;
      });
    },

    startLearn: async (paramId, minValue, maxValue) => {
      await ipcStartMidiLearn(paramId, minValue, maxValue);
      set((s) => {
        s.learningParamId = paramId;
        s.lastLearnedParamId = null;
      });
    },

    cancelLearn: async () => {
      await ipcCancelMidiLearn();
      set((s) => {
        s.learningParamId = null;
      });
    },

    onLearnCaptured: (paramId, cc, channel) => {
      set((s) => {
        // Update or add the mapping in local state (the backend already updated
        // its registry — we just mirror it here for the UI).
        const existing = s.mappings.findIndex((m) => m.param_id === paramId);
        // Retrieve range from the existing placeholder (if present).
        const minValue = existing >= 0 ? s.mappings[existing].min_value : 0;
        const maxValue = existing >= 0 ? s.mappings[existing].max_value : 1;
        const mapping: MidiMapping = {
          param_id: paramId,
          cc,
          channel,
          min_value: minValue,
          max_value: maxValue,
        };
        if (existing >= 0) {
          s.mappings[existing] = mapping;
        } else {
          s.mappings.push(mapping);
        }
        s.learningParamId = null;
        s.lastLearnedParamId = paramId;
      });
    },

    deleteMapping: async (paramId) => {
      await ipcDeleteMidiMapping(paramId);
      set((s) => {
        s.mappings = s.mappings.filter((m) => m.param_id !== paramId);
      });
    },

    getMappingForParam: (paramId) => {
      return get().mappings.find((m) => m.param_id === paramId);
    },
  })),
);
