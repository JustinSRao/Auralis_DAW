/**
 * PluginBrowser — Sprint 24 replacement for Vst3PluginBrowser.
 *
 * Features:
 * - Search input that filters by plugin name
 * - Plugins grouped by category (Instrument / Effect / Other)
 * - Windowed scrollable list (simple overflow-y approach, no extra dep)
 * - Each available-plugin row has a drag handle for HTML5 drag-and-drop
 * - Loaded-plugins section shows name + "Open GUI" + "Unload" buttons
 */

import React, { useState, useMemo } from 'react';
import { useVst3Store } from '../../stores/vst3Store';
import type { Vst3PluginInfo, LoadedPluginView } from '../../lib/ipc';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface PluginBrowserProps {
  /** Optional callback fired when a plugin is successfully loaded. */
  onPluginLoaded?: (view: LoadedPluginView) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function pluginCategory(info: Vst3PluginInfo): 'Instrument' | 'Effect' | 'Other' {
  if (info.is_instrument) return 'Instrument';
  const cat = info.category.toLowerCase();
  if (cat.includes('fx') || cat.includes('effect') || cat.includes('eq') ||
      cat.includes('reverb') || cat.includes('delay') || cat.includes('dynamics')) {
    return 'Effect';
  }
  return 'Other';
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const PluginBrowser: React.FC<PluginBrowserProps> = ({ onPluginLoaded }) => {
  const scanResults   = useVst3Store((s) => s.scanResults);
  const loadedPlugins = useVst3Store((s) => s.loadedPlugins);
  const openGuis      = useVst3Store((s) => s.openGuis);
  const isScanning    = useVst3Store((s) => s.isScanning);
  const error         = useVst3Store((s) => s.error);
  const scanPlugins   = useVst3Store((s) => s.scanPlugins);
  const loadPlugin    = useVst3Store((s) => s.loadPlugin);
  const unloadPlugin  = useVst3Store((s) => s.unloadPlugin);
  const openGui       = useVst3Store((s) => s.openGui);
  const closeGui      = useVst3Store((s) => s.closeGui);
  const clearError    = useVst3Store((s) => s.clearError);

  const [search, setSearch] = useState('');

  // ── Filtered + grouped scan results ───────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return scanResults.filter((p) => p.name.toLowerCase().includes(q));
  }, [scanResults, search]);

  const groups = useMemo(() => {
    const map: Record<string, Vst3PluginInfo[]> = {
      Instrument: [],
      Effect: [],
      Other: [],
    };
    for (const p of filtered) {
      map[pluginCategory(p)].push(p);
    }
    return map;
  }, [filtered]);

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleScan = () => { void scanPlugins(); };

  const handleLoad = async (info: Vst3PluginInfo) => {
    try {
      const view = await loadPlugin(info);
      onPluginLoaded?.(view);
    } catch {
      // Error set in store; displayed via error banner.
    }
  };

  const handleUnload = async (instanceId: string) => {
    try {
      await unloadPlugin(instanceId);
    } catch {
      // Surfaced via store.
    }
  };

  const handleOpenGui = async (instanceId: string) => {
    try {
      await openGui(instanceId);
    } catch {
      // Surfaced via store.
    }
  };

  const handleCloseGui = async (instanceId: string) => {
    try {
      await closeGui(instanceId);
    } catch {
      // Surfaced via store.
    }
  };

  const instanceIdForPlugin = (info: Vst3PluginInfo): string | undefined =>
    Object.values(loadedPlugins).find((p) => p.name === info.name)?.instance_id;

  const handleDragStart = (
    e: React.DragEvent<HTMLLIElement>,
    info: Vst3PluginInfo,
  ) => {
    e.dataTransfer.setData('vst3/plugin', JSON.stringify(info));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const CATEGORY_LABELS: Record<string, string> = {
    Instrument: 'Instruments',
    Effect: 'Effects',
    Other: 'Other',
  };

  return (
    <div className="plugin-browser p-4 flex flex-col gap-3">
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

      {/* Search */}
      {scanResults.length > 0 && (
        <input
          aria-label="Search plugins"
          className="w-full bg-gray-700 text-xs text-white rounded px-2 py-1 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Search plugins…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

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
            {Object.values(loadedPlugins).map((plugin) => {
              const guiOpen = openGuis.has(plugin.instance_id);
              return (
                <li
                  key={plugin.instance_id}
                  className="flex items-center justify-between bg-green-900/30 rounded px-2 py-1"
                >
                  <span className="text-xs text-white truncate max-w-[120px]">
                    {plugin.name}
                  </span>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <button
                      aria-label={guiOpen ? `Close GUI for ${plugin.name}` : `Open GUI for ${plugin.name}`}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                      onClick={() =>
                        void (guiOpen
                          ? handleCloseGui(plugin.instance_id)
                          : handleOpenGui(plugin.instance_id))
                      }
                    >
                      {guiOpen ? 'Close GUI' : 'Open GUI'}
                    </button>
                    <button
                      aria-label={`Unload ${plugin.name}`}
                      className="text-xs text-red-400 hover:text-red-300"
                      onClick={() => void handleUnload(plugin.instance_id)}
                    >
                      Unload
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Empty state */}
      {scanResults.length === 0 && !isScanning && (
        <p className="text-xs text-gray-500 text-center py-4">
          Click Scan to discover VST3 plugins.
        </p>
      )}

      {/* Available plugins grouped by category */}
      {filtered.length > 0 && (
        <div className="max-h-72 overflow-y-auto space-y-3">
          {(['Instrument', 'Effect', 'Other'] as const).map((cat) => {
            const items = groups[cat];
            if (items.length === 0) return null;
            return (
              <section key={cat} aria-label={`${CATEGORY_LABELS[cat]} plugins`}>
                <h3 className="text-xs font-medium text-gray-400 mb-1">
                  {CATEGORY_LABELS[cat]} ({items.length})
                </h3>
                <ul className="space-y-1">
                  {items.map((info) => {
                    const instId = instanceIdForPlugin(info);
                    const isLoaded = !!instId;
                    return (
                      <li
                        key={info.id}
                        draggable={true}
                        className="flex items-center justify-between bg-gray-800 rounded px-2 py-1 cursor-grab active:cursor-grabbing"
                        onDragStart={(e) => handleDragStart(e, info)}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs text-white truncate">{info.name}</span>
                          {info.vendor && (
                            <span className="text-xs text-gray-400 truncate">{info.vendor}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
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
            );
          })}
        </div>
      )}

      {/* No search results */}
      {scanResults.length > 0 && filtered.length === 0 && search.length > 0 && (
        <p className="text-xs text-gray-500 text-center py-2">
          No plugins match &ldquo;{search}&rdquo;.
        </p>
      )}
    </div>
  );
};

export default PluginBrowser;
