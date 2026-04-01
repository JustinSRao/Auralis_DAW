/**
 * PluginSlot — Sprint 24.
 *
 * A single slot in an effect chain that hosts a loaded VST3 plugin.
 * Shows the plugin name, provides open-GUI / bypass / remove controls,
 * and acts as a drop target for dragged plugin entries from PluginBrowser.
 */

import React from 'react';
import type { Vst3PluginInfo } from '../../lib/ipc';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface PluginSlotProps {
  /** The instance ID of the loaded plugin occupying this slot. */
  instanceId: string;
  /** Human-readable plugin name. */
  pluginName: string;
  /** Whether this plugin is bypassed (processing disabled). */
  isBypassed: boolean;
  /** Called when the user clicks the "Open GUI" button. */
  onOpenGui(): void;
  /** Called when the user toggles the bypass state. */
  onBypassToggle(): void;
  /** Called when the user clicks the remove / unload button. */
  onRemove(): void;
  /** Called when a plugin is dropped onto this slot (optional drop target). */
  onDrop?(pluginInfo: Vst3PluginInfo): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const PluginSlot: React.FC<PluginSlotProps> = ({
  instanceId,
  pluginName,
  isBypassed,
  onOpenGui,
  onBypassToggle,
  onRemove,
  onDrop,
}) => {
  // ── Drag-and-drop (drop target) ───────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('vst3/plugin')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!onDrop) return;
    const raw = e.dataTransfer.getData('vst3/plugin');
    if (!raw) return;
    try {
      const pluginInfo = JSON.parse(raw) as Vst3PluginInfo;
      onDrop(pluginInfo);
    } catch {
      // Silently ignore malformed drag data.
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      role="listitem"
      aria-label={`Plugin slot: ${pluginName}`}
      data-instance-id={instanceId}
      className={[
        'plugin-slot flex items-center justify-between rounded px-2 py-1',
        isBypassed ? 'bg-gray-700 opacity-60' : 'bg-gray-800',
        onDrop ? 'border border-transparent hover:border-indigo-500' : '',
      ].join(' ')}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Plugin name */}
      <span className="text-xs text-white truncate max-w-[120px]">{pluginName}</span>

      {/* Controls */}
      <div className="flex items-center gap-1 ml-2 shrink-0">
        {/* Open GUI */}
        <button
          aria-label={`Open GUI for ${pluginName}`}
          title="Open Plugin GUI"
          className="text-xs text-indigo-400 hover:text-indigo-300 px-1"
          onClick={onOpenGui}
        >
          GUI
        </button>

        {/* Bypass toggle */}
        <button
          aria-label={isBypassed ? `Enable ${pluginName}` : `Bypass ${pluginName}`}
          title={isBypassed ? 'Enable' : 'Bypass'}
          className={[
            'text-xs px-1 rounded',
            isBypassed
              ? 'text-yellow-400 hover:text-yellow-300'
              : 'text-gray-400 hover:text-gray-300',
          ].join(' ')}
          onClick={onBypassToggle}
        >
          {isBypassed ? 'On' : 'Off'}
        </button>

        {/* Remove */}
        <button
          aria-label={`Remove ${pluginName}`}
          title="Remove plugin"
          className="text-xs text-red-400 hover:text-red-300 px-1"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default PluginSlot;
