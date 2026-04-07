import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ipcListPresets,
  ipcSavePreset,
  ipcDeletePreset,
  type Preset,
  type PresetMeta,
  type PresetType,
} from '../lib/ipc';

// ─── State shape ──────────────────────────────────────────────────────────────

interface PresetsStoreState {
  /** Whether the preset browser panel is open. */
  isOpen: boolean;
  /** Which preset type is currently shown in the browser. */
  activeType: PresetType;
  /** Cached preset lists per type — populated by `fetchPresets`. */
  presetsByType: Record<PresetType, PresetMeta[]>;
  /** True while an async operation is in flight. */
  isLoading: boolean;
  /** Non-null if the last operation failed. */
  error: string | null;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Opens the browser panel and optionally switches to a preset type. */
  openBrowser: (type?: PresetType) => void;
  /** Closes the browser panel. */
  closeBrowser: () => void;
  /** Switches the active preset type (e.g. when user clicks a tab). */
  setActiveType: (type: PresetType) => void;
  /** Fetches the preset list for the given type from the backend. */
  fetchPresets: (type: PresetType) => Promise<void>;
  /** Saves a preset to disk and refreshes the list. */
  savePreset: (preset: Preset) => Promise<void>;
  /** Deletes a user preset and refreshes the list. */
  deletePreset: (type: PresetType, name: string) => Promise<void>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePresetsStore = create<PresetsStoreState>()(
  immer((set, get) => ({
    isOpen: false,
    activeType: 'synth',
    presetsByType: {
      synth: [],
      sampler: [],
      drum_machine: [],
      eq: [],
      reverb: [],
      delay: [],
      compressor: [],
    } as Record<PresetType, PresetMeta[]>,
    isLoading: false,
    error: null,

    openBrowser: (type) => {
      set((state) => {
        state.isOpen = true;
        if (type !== undefined) {
          state.activeType = type;
        }
      });
    },

    closeBrowser: () => {
      set((state) => {
        state.isOpen = false;
      });
    },

    setActiveType: (type) => {
      set((state) => {
        state.activeType = type;
      });
    },

    fetchPresets: async (type) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const presets = await ipcListPresets(type);
        set((state) => {
          state.presetsByType[type] = presets;
          state.isLoading = false;
        });
      } catch (e) {
        set((state) => {
          state.isLoading = false;
          state.error = String(e);
        });
      }
    },

    savePreset: async (preset) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        await ipcSavePreset(preset);
        // Refresh the list for this preset type
        await get().fetchPresets(preset.preset_type);
      } catch (e) {
        set((state) => {
          state.error = String(e);
        });
      } finally {
        set(state => { state.isLoading = false; });
      }
    },

    deletePreset: async (type, name) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        await ipcDeletePreset(type, name);
        await get().fetchPresets(type);
      } catch (e) {
        set((state) => {
          state.error = String(e);
        });
      } finally {
        set(state => { state.isLoading = false; });
      }
    },
  })),
);
