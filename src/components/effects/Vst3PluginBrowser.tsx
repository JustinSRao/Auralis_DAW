/**
 * Vst3PluginBrowser — UI for scanning, listing, and loading VST3 plugins.
 *
 * Sprint 23: renders the scan button, plugin list with load/unload controls,
 * and displays current scan and loading state.
 */

import React from 'react';
import { useVst3Store } from '../../stores/vst3Store';
import type { Vst3PluginInfo, LoadedPluginView } from '../../lib/ipc';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface Vst3PluginBrowserProps {
  /** Optional callback fired when a plugin is successfully loaded. */
  onPluginLoaded?: (view: LoadedPluginView) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const Vst3PluginBrowser: React.FC<Vst3PluginBrowserProps> = ({ onPluginLoaded }) => {
  const scanResults   = useVst3Store((s) => s.scanResults);
  const loadedPlugins = useVst3Store((s) => s.loadedPlugins);
  const isScanning    = useVst3Store((s) => s.isScanning);
  const error         = useVst3Store((s) => s.error);
  const scanPlugins   = useVst3Store((s) => s.scanPlugins);
  const loadPlugin    = useVst3Store((s) => s.loadPlugin);
  const unloadPlugin  = useVst3Store((s) => s.unloadPlugin);
  const clearError    = useVst3Store((s) => s.clearError);

  const handleScan = () => {
    void scanPlugins();
  };

  const handleLoad = async (info: Vst3PluginInfo) => {
    try {
      const view = await loadPlugin(info);
      onPluginLoaded?.(view);
    } catch {
      // Error is set in the store; UI will display it.
    }
  };

  const handleUnload = async (instanceId: string) => {
    try {
      await unloadPlugin(instanceId);
    } catch {
      // Error surfaced via store.
    }
  };

  // Find instance id for a scan result by name (first match).
  const instanceIdForPlugin = (info: Vst3PluginInfo): string | undefined =>
    Object.values(loadedPlugins).find((p) => p.name === info.name)?.instance_id;

  return (
    <div className="vst3-plugin-browser p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">VST3 Plugins</h2>
        <button
          aria-label="Scan for VST3 plugins"
          className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
          disabled={isScanning}
          onClick={handleScan}
        >
          {isScanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="text-xs text-red-400 bg-red-900/30 rounded p-2 flex justify-between"
        >
          <span>{error}</span>
          <button
            aria-label="Dismiss error"
            className="ml-2 underline"
            onClick={clearError}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loaded plugins section */}
      {Object.keys(loadedPlugins).length > 0 && (
        <section aria-label="Loaded plugins">
          <h3 className="text-xs font-medium text-gray-400 mb-1">Loaded</h3>
          <ul className="space-y-1">
            {Object.values(loadedPlugins).map((plugin) => (
              <li
                key={plugin.instance_id}
                className="flex items-center justify-between bg-green-900/30 rounded px-2 py-1"
              >
                <span className="text-xs text-white truncate max-w-[160px]">{plugin.name}</span>
                <button
                  aria-label={`Unload ${plugin.name}`}
                  className="text-xs text-red-400 hover:text-red-300 ml-2"
                  onClick={() => void handleUnload(plugin.instance_id)}
                >
                  Unload
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Scan results list */}
      {scanResults.length === 0 && !isScanning && (
        <p className="text-xs text-gray-500 text-center py-4">
          Click Scan to discover VST3 plugins.
        </p>
      )}

      {scanResults.length > 0 && (
        <section aria-label="Available plugins">
          <h3 className="text-xs font-medium text-gray-400 mb-1">
            Available ({scanResults.length})
          </h3>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {scanResults.map((info) => {
              const instId = instanceIdForPlugin(info);
              const isLoaded = !!instId;
              return (
                <li
                  key={info.id}
                  className="flex items-center justify-between bg-gray-800 rounded px-2 py-1"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-white truncate">{info.name}</span>
                    {info.vendor && (
                      <span className="text-xs text-gray-400 truncate">{info.vendor}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    {info.is_instrument && (
                      <span className="text-xs text-purple-400">Instr</span>
                    )}
                    {isLoaded ? (
                      <button
                        aria-label={`Unload ${info.name}`}
                        className="text-xs text-red-400 hover:text-red-300"
                        onClick={() => instId && void handleUnload(instId)}
                      >
                        Unload
                      </button>
                    ) : (
                      <button
                        aria-label={`Load ${info.name}`}
                        className="text-xs text-blue-400 hover:text-blue-300"
                        onClick={() => void handleLoad(info)}
                      >
                        Load
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
};

export default Vst3PluginBrowser;
