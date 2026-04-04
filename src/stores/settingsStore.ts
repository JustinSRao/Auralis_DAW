/**
 * Settings store (Sprint 27).
 *
 * Manages the application config edit lifecycle:
 *   - `config`  — the last-saved backend value (source of truth)
 *   - `draft`   — working copy being edited in the modal
 *   - `isDirty` — true whenever draft differs from config
 *
 * All persistence is delegated to the Rust backend via ipcSaveAppConfig.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  AppConfig,
  AppAudioConfig,
  AppMidiConfig,
  AppGeneralConfig,
  AppUiConfig,
} from "@/lib/ipc";
import { ipcGetAppConfig, ipcSaveAppConfig } from "@/lib/ipc";

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface SettingsStore {
  // State
  config: AppConfig | null;
  draft: AppConfig | null;
  isOpen: boolean;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  open(): void;
  close(): void;
  loadConfig(): Promise<void>;
  updateAudio(patch: Partial<AppAudioConfig>): void;
  updateMidi(patch: Partial<AppMidiConfig>): void;
  updateGeneral(patch: Partial<AppGeneralConfig>): void;
  updateUi(patch: Partial<AppUiConfig>): void;
  saveAndApply(): Promise<void>;
  discardChanges(): void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsStore>()(
  immer((set, get) => ({
    config: null,
    draft: null,
    isOpen: false,
    isDirty: false,
    isLoading: false,
    error: null,

    open() {
      set((s) => {
        s.isOpen = true;
      });
      // loadConfig is async — fire-and-forget; errors land in store.error.
      void get().loadConfig();
    },

    close() {
      set((s) => {
        s.isOpen = false;
      });
    },

    async loadConfig() {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const cfg = await ipcGetAppConfig();
        set((s) => {
          s.config = cfg;
          s.draft = structuredClone(cfg);
          s.isDirty = false;
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    updateAudio(patch: Partial<AppAudioConfig>) {
      set((s) => {
        if (!s.draft) return;
        Object.assign(s.draft.audio, patch);
        s.isDirty = true;
      });
    },

    updateMidi(patch: Partial<AppMidiConfig>) {
      set((s) => {
        if (!s.draft) return;
        Object.assign(s.draft.midi, patch);
        s.isDirty = true;
      });
    },

    updateGeneral(patch: Partial<AppGeneralConfig>) {
      set((s) => {
        if (!s.draft) return;
        Object.assign(s.draft.general, patch);
        s.isDirty = true;
      });
    },

    updateUi(patch: Partial<AppUiConfig>) {
      set((s) => {
        if (!s.draft) return;
        Object.assign(s.draft.ui, patch);
        s.isDirty = true;
      });
    },

    async saveAndApply() {
      const { draft } = get();
      if (!draft) return;
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        await ipcSaveAppConfig(draft);
        set((s) => {
          s.config = structuredClone(draft);
          s.isDirty = false;
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.isLoading = false;
        });
      }
    },

    discardChanges() {
      const current = get().config;
      set((s) => {
        if (current) {
          s.draft = JSON.parse(JSON.stringify(current));
        }
        s.isDirty = false;
      });
    },
  })),
);
