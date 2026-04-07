import { useCallback } from 'react';
import { usePresetsStore } from '../stores/presetsStore';
import {
  ipcCapturePreset,
  ipcApplyPreset,
  ipcLoadPreset,
  type Preset,
  type PresetMeta,
  type PresetType,
} from '../lib/ipc';

// ─── usePresets ───────────────────────────────────────────────────────────────

/**
 * Convenience hook for preset operations in instrument/effect panels.
 *
 * Provides:
 * - `presets` — current list for the given type (from store cache).
 * - `isLoading` — true while async ops are in flight.
 * - `error` — last error message, or null.
 * - `fetchPresets` — loads/refreshes the preset list.
 * - `captureAndSave` — captures live params and saves with a given name.
 * - `loadAndApply` — loads a preset from backend and applies to instrument.
 * - `deletePreset` — deletes a user preset.
 * - `filteredPresets` — `presets` filtered by the store's `searchQuery`.
 */
export function usePresets(presetType: PresetType, channelId?: string, searchQuery?: string) {
  const presets = usePresetsStore((s) => s.presetsByType[presetType]);
  const isLoading = usePresetsStore((s) => s.isLoading);
  const error = usePresetsStore((s) => s.error);
  const storeDeletePreset = usePresetsStore((s) => s.deletePreset);
  const storeSavePreset = usePresetsStore((s) => s.savePreset);
  const storeFetchPresets = usePresetsStore((s) => s.fetchPresets);

  /** Loads/refreshes the preset list for this type. */
  const fetchPresets = useCallback(() => {
    return storeFetchPresets(presetType);
  }, [storeFetchPresets, presetType]);

  /**
   * Captures current live instrument/effect params and saves them as a new
   * user preset with the given `name`.
   */
  const captureAndSave = useCallback(
    async (name: string): Promise<void> => {
      const captured = await ipcCapturePreset(presetType, name, channelId);
      await storeSavePreset(captured);
    },
    [presetType, channelId, storeSavePreset],
  );

  /**
   * Loads the preset params from the backend and applies them to the live
   * instrument/effect. Returns the full `Preset` object for the caller to
   * update local state (e.g. `currentPresetName`).
   */
  const loadAndApply = useCallback(
    async (meta: PresetMeta): Promise<Preset> => {
      const preset = await ipcLoadPreset(meta.preset_type, meta.name);
      await ipcApplyPreset(preset, channelId);
      return preset;
    },
    [channelId],
  );

  /** Deletes a user preset by name. */
  const deletePreset = useCallback(
    (name: string): Promise<void> => {
      return storeDeletePreset(presetType, name);
    },
    [storeDeletePreset, presetType],
  );

  /** `presets` filtered by the caller-supplied search query (case-insensitive). */
  const filteredPresets = searchQuery
    ? presets.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : presets;

  return {
    presets,
    filteredPresets,
    isLoading,
    error,
    fetchPresets,
    captureAndSave,
    loadAndApply,
    deletePreset,
  };
}
