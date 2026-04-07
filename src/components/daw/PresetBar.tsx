import React, { useState, useRef, useEffect } from 'react';
import type { PresetType } from '../../lib/ipc';

// ─── Icons ────────────────────────────────────────────────────────────────────

function SaveIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function BrowseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PresetBarProps {
  /** The preset category this bar represents. */
  presetType: PresetType;
  /** Name of the currently active preset, or null if none selected. */
  currentPresetName: string | null;
  /** Called when the user confirms a save with the entered name. */
  onSave: (name: string) => void;
  /** Called when the user clicks the browse icon. */
  onBrowse: () => void;
}

// ─── PresetBar ────────────────────────────────────────────────────────────────

/**
 * Compact 32px strip that shows the current preset name and provides
 * Save and Browse icon buttons.
 *
 * Clicking Save reveals an inline text input for the preset name.
 * Pressing Enter or clicking the confirm button triggers `onSave`.
 */
export function PresetBar({
  presetType: _presetType,
  currentPresetName,
  onSave,
  onBrowse,
}: PresetBarProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input whenever the save form appears
  useEffect(() => {
    if (isSaving) {
      setSaveName(currentPresetName ?? '');
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isSaving, currentPresetName]);

  function handleSaveClick() {
    setIsSaving(true);
  }

  function handleConfirmSave() {
    const trimmed = saveName.trim();
    if (trimmed.length === 0) return;
    onSave(trimmed);
    setIsSaving(false);
    setSaveName('');
  }

  function handleCancelSave() {
    setIsSaving(false);
    setSaveName('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleConfirmSave();
    } else if (e.key === 'Escape') {
      handleCancelSave();
    }
  }

  return (
    <div
      className="flex items-center gap-2 h-8 px-2 bg-[#1a1a1a] border-b border-[#333333] select-none"
      aria-label="Preset bar"
    >
      {/* Current preset name display */}
      {!isSaving && (
        <span className="flex-1 text-[10px] font-mono text-[#888888] truncate">
          {currentPresetName ?? '— no preset —'}
        </span>
      )}

      {/* Inline save name input */}
      {isSaving && (
        <div className="flex flex-1 items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Preset name…"
            className="flex-1 h-5 px-1 text-[10px] font-mono bg-[#2a2a2a] border border-[#5b8def] rounded text-[#cccccc] outline-none"
            aria-label="Preset name"
          />
          <button
            onClick={handleConfirmSave}
            disabled={saveName.trim().length === 0}
            className="px-1.5 h-5 text-[10px] font-mono rounded bg-[#5b8def] text-white disabled:opacity-40 hover:bg-[#4a7cde]"
            aria-label="Confirm save"
          >
            OK
          </button>
          <button
            onClick={handleCancelSave}
            className="px-1.5 h-5 text-[10px] font-mono rounded bg-[#3a3a3a] text-[#888888] hover:text-[#aaaaaa]"
            aria-label="Cancel save"
          >
            ✕
          </button>
        </div>
      )}

      {/* Save button — only visible when not saving */}
      {!isSaving && (
        <button
          onClick={handleSaveClick}
          className="flex items-center justify-center w-6 h-6 rounded text-[#666666] hover:text-[#aaaaaa] hover:bg-[#2a2a2a] transition-colors"
          aria-label="Save preset"
          title="Save preset"
        >
          <SaveIcon />
        </button>
      )}

      {/* Browse button */}
      <button
        onClick={onBrowse}
        className="flex items-center justify-center w-6 h-6 rounded text-[#666666] hover:text-[#aaaaaa] hover:bg-[#2a2a2a] transition-colors"
        aria-label="Browse presets"
        title="Browse presets"
      >
        <BrowseIcon />
      </button>
    </div>
  );
}
