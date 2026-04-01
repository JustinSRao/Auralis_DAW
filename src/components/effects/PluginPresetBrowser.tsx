/**
 * PluginPresetBrowser — Sprint 24.
 *
 * Shows the list of `.vstpreset` files for the selected plugin instance.
 * Clicking a preset applies it immediately to the plugin component state.
 */

import React, { useEffect } from 'react';
import { useVst3Store } from '../../stores/vst3Store';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface PluginPresetBrowserProps {
  /** Instance ID of the currently-selected loaded plugin, or null if none. */
  instanceId: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const PluginPresetBrowser: React.FC<PluginPresetBrowserProps> = ({ instanceId }) => {
  const presets       = useVst3Store((s) => s.presets);
  const fetchPresets  = useVst3Store((s) => s.fetchPresets);
  const applyPreset   = useVst3Store((s) => s.applyPreset);
  const error         = useVst3Store((s) => s.error);

  // Fetch presets whenever the selected instance changes.
  useEffect(() => {
    if (!instanceId) return;
    void fetchPresets(instanceId);
  }, [instanceId, fetchPresets]);

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!instanceId) {
    return (
      <div className="plugin-preset-browser p-4 flex items-center justify-center">
        <p className="text-xs text-gray-500">Select a plugin to browse presets.</p>
      </div>
    );
  }

  const pluginPresets = presets[instanceId] ?? [];

  const handleApply = async (presetPath: string) => {
    try {
      await applyPreset(instanceId, presetPath);
    } catch {
      // Error surfaced via store.
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="plugin-preset-browser p-4 flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-gray-300">Presets</h3>

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      {pluginPresets.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">No presets found.</p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {pluginPresets.map((preset) => (
            <li key={preset.path}>
              <button
                aria-label={`Apply preset ${preset.name}`}
                className="w-full text-left text-xs text-white bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 truncate"
                onClick={() => void handleApply(preset.path)}
              >
                {preset.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PluginPresetBrowser;
