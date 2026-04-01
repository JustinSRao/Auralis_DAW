/**
 * vst3Store — Zustand state for the VST3 plugin host (Sprint 23).
 *
 * Tracks scan results, loaded plugin instances, and scanning progress.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Vst3PluginInfo, LoadedPluginView, PresetInfo } from '../lib/ipc';
import {
  ipcScanVst3Plugins,
  ipcLoadVst3Plugin,
  ipcUnloadVst3Plugin,
  ipcSetVst3Param,
  ipcGetVst3Params,
  ipcSaveVst3State,
  ipcLoadVst3State,
  ipcOpenPluginGui,
  ipcClosePluginGui,
  ipcGetPluginPresets,
  ipcApplyPluginPreset,
} from '../lib/ipc';

// ────────────────────────────────────────────────────────────────────────────
// State shape
// ────────────────────────────────────────────────────────────────────────────

interface Vst3State {
  /** Results of the last scan, or empty array if no scan has been run. */
  scanResults: Vst3PluginInfo[];
  /** Currently loaded plugin instances, keyed by instance_id. */
  loadedPlugins: Record<string, LoadedPluginView>;
  /** Whether a scan is currently in progress. */
  isScanning: boolean;
  /** Last error message, or null. */
  error: string | null;

  // ── Sprint 24 additions ───────────────────────────────────────────────────

  /** Set of instance IDs whose native GUIs are currently open. */
  openGuis: Set<string>;
  /** Cached preset lists per instance ID. */
  presets: Record<string, PresetInfo[]>;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Scans the default VST3 directories and populates `scanResults`. */
  scanPlugins(extraDirs?: string[]): Promise<void>;

  /** Loads a VST3 plugin and registers it in `loadedPlugins`. */
  loadPlugin(info: Vst3PluginInfo): Promise<LoadedPluginView>;

  /** Unloads a VST3 plugin and removes it from `loadedPlugins`. */
  unloadPlugin(instanceId: string): Promise<void>;

  /** Sets a normalised parameter value on a loaded plugin. */
  setParam(instanceId: string, paramId: number, value: number): Promise<void>;

  /** Refreshes the parameter list for a loaded plugin. */
  refreshParams(instanceId: string): Promise<void>;

  /** Saves the plugin state to a base64 string. */
  saveState(instanceId: string): Promise<string>;

  /** Loads plugin state from a base64 string. */
  loadState(instanceId: string, stateB64: string): Promise<void>;

  /** Clears the last error message. */
  clearError(): void;

  // ── Sprint 24 GUI & preset actions ────────────────────────────────────────

  /** Opens the native plugin GUI window. */
  openGui(instanceId: string): Promise<void>;

  /** Closes the native plugin GUI window. */
  closeGui(instanceId: string): Promise<void>;

  /** Fetches and caches the preset list for the given instance. */
  setPresets(instanceId: string, presets: PresetInfo[]): void;

  /** Fetches presets from the backend and caches them. */
  fetchPresets(instanceId: string): Promise<void>;

  /** Applies a preset file to the plugin and refreshes params. */
  applyPreset(instanceId: string, presetPath: string): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// Store implementation
// ────────────────────────────────────────────────────────────────────────────

export const useVst3Store = create<Vst3State>()(
  immer((set) => ({
    scanResults:   [],
    loadedPlugins: {},
    isScanning:    false,
    error:         null,
    openGuis:      new Set<string>(),
    presets:       {},

    async scanPlugins(extraDirs) {
      set((s) => { s.isScanning = true; s.error = null; });
      try {
        const results = await ipcScanVst3Plugins(extraDirs);
        set((s) => { s.scanResults = results; });
      } catch (e) {
        set((s) => { s.error = String(e); });
      } finally {
        set((s) => { s.isScanning = false; });
      }
    },

    async loadPlugin(info) {
      set((s) => { s.error = null; });
      try {
        const view = await ipcLoadVst3Plugin(info);
        set((s) => { s.loadedPlugins[view.instance_id] = view; });
        return view;
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    async unloadPlugin(instanceId) {
      try {
        await ipcUnloadVst3Plugin(instanceId);
        set((s) => { delete s.loadedPlugins[instanceId]; });
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    async setParam(instanceId, paramId, value) {
      try {
        await ipcSetVst3Param(instanceId, paramId, value);
        set((s) => {
          const plugin = s.loadedPlugins[instanceId];
          if (plugin) {
            const param = plugin.params.find((p) => p.id === paramId);
            if (param) param.current_normalized = value;
          }
        });
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    async refreshParams(instanceId) {
      try {
        const params = await ipcGetVst3Params(instanceId);
        set((s) => {
          const plugin = s.loadedPlugins[instanceId];
          if (plugin) plugin.params = params;
        });
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    async saveState(instanceId) {
      try {
        return await ipcSaveVst3State(instanceId);
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    async loadState(instanceId, stateB64) {
      try {
        await ipcLoadVst3State(instanceId, stateB64);
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    clearError() {
      set((s) => { s.error = null; });
    },

    async openGui(instanceId) {
      try {
        await ipcOpenPluginGui(instanceId);
        set((s) => { s.openGuis.add(instanceId); });
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    async closeGui(instanceId) {
      try {
        await ipcClosePluginGui(instanceId);
        set((s) => { s.openGuis.delete(instanceId); });
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    setPresets(instanceId, presets) {
      set((s) => { s.presets[instanceId] = presets; });
    },

    async fetchPresets(instanceId) {
      try {
        const presets = await ipcGetPluginPresets(instanceId);
        set((s) => { s.presets[instanceId] = presets; });
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },

    async applyPreset(instanceId, presetPath) {
      try {
        await ipcApplyPluginPreset(instanceId, presetPath);
      } catch (e) {
        set((s) => { s.error = String(e); });
        throw e;
      }
    },
  })),
);
