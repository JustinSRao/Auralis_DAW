import React, { useEffect, useState } from 'react';
import { usePresets } from '../../hooks/usePresets';
import type { PresetMeta, PresetType } from '../../lib/ipc';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PresetBrowserProps {
  /** Which preset type this browser displays. */
  presetType: PresetType;
  /**
   * Called when the user clicks "Load" on a preset.
   * The parent is responsible for calling apply/ipc.
   */
  onLoad: (preset: PresetMeta) => void;
  /** Called when the user clicks the close button. */
  onClose: () => void;
  /** Optional channel ID forwarded to apply command for effect presets. */
  channelId?: string;
}

// ─── Label helpers ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<PresetType, string> = {
  synth: 'Synth',
  sampler: 'Sampler',
  drum_machine: 'Drum Machine',
  eq: 'EQ',
  reverb: 'Reverb',
  delay: 'Delay',
  compressor: 'Compressor',
};

// ─── PresetBrowser ────────────────────────────────────────────────────────────

/**
 * Scrollable preset browser panel for a single preset type.
 *
 * Shows factory presets (read-only) followed by user presets.
 * Each row has a Load button and, for user presets, a Delete button.
 *
 * Uses a plain CSS `overflow-y: auto` scroll container (no windowing library).
 */
export function PresetBrowser({
  presetType,
  onLoad,
  onClose,
  channelId: _channelId,
}: PresetBrowserProps) {
  // Local search state — each browser instance starts fresh, so a query for one
  // preset type never bleeds across to another type.
  const [searchQuery, setSearchQuery] = useState('');

  const { filteredPresets, isLoading, error, fetchPresets, deletePreset } =
    usePresets(presetType, undefined, searchQuery);

  // Load preset list on mount and when type changes
  useEffect(() => {
    void fetchPresets();
  }, [fetchPresets]);

  const [deletingName, setDeletingName] = useState<string | null>(null);

  async function handleDelete(preset: PresetMeta) {
    if (preset.is_factory) return;
    setDeletingName(preset.name);
    try {
      await deletePreset(preset.name);
    } finally {
      setDeletingName(null);
    }
  }

  return (
    <div
      className="flex flex-col w-64 bg-[#1e1e1e] border border-[#333333] rounded shadow-xl"
      role="dialog"
      aria-label={`${TYPE_LABELS[presetType]} preset browser`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#333333]">
        <span className="text-[11px] font-mono font-semibold text-[#cccccc] uppercase tracking-wider">
          {TYPE_LABELS[presetType]} Presets
        </span>
        <button
          onClick={onClose}
          className="text-[#666666] hover:text-[#aaaaaa] text-sm leading-none"
          aria-label="Close preset browser"
        >
          ✕
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pt-2 pb-1">
        <input
          type="text"
          placeholder="Search…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-6 px-2 text-[10px] font-mono bg-[#2a2a2a] border border-[#444444] rounded text-[#cccccc] outline-none focus:border-[#5b8def]"
          aria-label="Search presets"
        />
      </div>

      {/* Preset list */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ maxHeight: 320 }}
        role="listbox"
        aria-label="Preset list"
      >
        {isLoading && (
          <p className="text-[10px] font-mono text-[#666666] px-3 py-2">
            Loading…
          </p>
        )}
        {error !== null && (
          <p className="text-[10px] font-mono text-red-400 px-3 py-2">
            {error}
          </p>
        )}
        {!isLoading && !error && filteredPresets.length === 0 && (
          <p className="text-[10px] font-mono text-[#666666] px-3 py-2">
            No presets found.
          </p>
        )}

        {filteredPresets.map((preset) => (
          <PresetRow
            key={`${preset.is_factory ? 'factory' : 'user'}-${preset.name}`}
            preset={preset}
            isDeleting={deletingName === preset.name}
            onLoad={onLoad}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}

// ─── PresetRow ────────────────────────────────────────────────────────────────

interface PresetRowProps {
  preset: PresetMeta;
  isDeleting: boolean;
  onLoad: (preset: PresetMeta) => void;
  onDelete: (preset: PresetMeta) => void;
}

function PresetRow({ preset, isDeleting, onLoad, onDelete }: PresetRowProps) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 hover:bg-[#2a2a2a] group"
      role="option"
      aria-label={preset.name}
    >
      {/* Factory badge */}
      {preset.is_factory && (
        <span
          className="shrink-0 text-[8px] font-mono px-1 py-0.5 rounded bg-[#3a3a3a] text-[#5b8def] uppercase tracking-wider"
          title="Factory preset — read-only"
        >
          F
        </span>
      )}

      {/* Name */}
      <span className="flex-1 text-[10px] font-mono text-[#cccccc] truncate">
        {preset.name}
      </span>

      {/* Load button */}
      <button
        onClick={() => onLoad(preset)}
        className="shrink-0 px-1.5 py-0.5 text-[9px] font-mono rounded bg-[#5b8def] text-white hover:bg-[#4a7cde] opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={`Load preset ${preset.name}`}
      >
        Load
      </button>

      {/* Delete button — hidden for factory presets */}
      {!preset.is_factory && (
        <button
          onClick={() => onDelete(preset)}
          disabled={isDeleting}
          className="shrink-0 px-1 py-0.5 text-[9px] font-mono rounded text-[#666666] hover:text-red-400 hover:bg-[#3a1a1a] opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
          aria-label={`Delete preset ${preset.name}`}
          title="Delete preset"
        >
          ✕
        </button>
      )}
    </div>
  );
}
