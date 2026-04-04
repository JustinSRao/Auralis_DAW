/**
 * SettingsPanel — full-screen modal for application preferences (Sprint 27).
 *
 * Features:
 * - Four tabs: General | Audio | MIDI | UI
 * - "Save & Apply" writes config to disk and re-applies audio/MIDI settings
 * - Dirty-close guard: shows an inline confirmation before discarding changes
 * - Engine-restart warning when sample rate or buffer size is changed
 * - Keyboard shortcut: Escape closes (with dirty check)
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GeneralSettingsTab } from "./settings/GeneralSettingsTab";
import { AudioSettingsTab } from "./settings/AudioSettingsTab";
import { MidiSettingsTab } from "./settings/MidiSettingsTab";
import { UiSettingsTab } from "./settings/UiSettingsTab";
import { ShortcutsSettingsTab } from "./settings/ShortcutsSettingsTab";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "general" | "audio" | "midi" | "ui" | "shortcuts";

const TABS: { id: TabId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "audio", label: "Audio" },
  { id: "midi", label: "MIDI" },
  { id: "ui", label: "UI" },
  { id: "shortcuts", label: "Shortcuts" },
];

// ---------------------------------------------------------------------------
// Helper: detect engine-restart-required changes
// ---------------------------------------------------------------------------

function needsEngineRestart(
  config: { audio: { sampleRate: number; bufferSize: number } } | null,
  draft: { audio: { sampleRate: number; bufferSize: number } } | null,
): boolean {
  if (!config || !draft) return false;
  return (
    draft.audio.sampleRate !== config.audio.sampleRate ||
    draft.audio.bufferSize !== config.audio.bufferSize
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const {
    config,
    draft,
    isOpen,
    isDirty,
    isLoading,
    error,
    close,
    saveAndApply,
    discardChanges,
  } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<TabId>("general");

  // Inline confirmation state: "dirty-close" or "engine-restart" or null
  type ConfirmKind = "dirty-close" | "engine-restart" | null;
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);

  // Reset confirmation state whenever the modal opens/closes.
  useEffect(() => {
    if (!isOpen) setConfirmKind(null);
  }, [isOpen]);

  // Escape key handler.
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleRequestClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isDirty, confirmKind]);

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Close request — shows dirty confirmation if needed
  // ---------------------------------------------------------------------------

  function handleRequestClose() {
    if (confirmKind) {
      // Already showing a confirmation — treat Escape as "Keep editing"
      setConfirmKind(null);
      return;
    }
    if (isDirty) {
      setConfirmKind("dirty-close");
    } else {
      close();
    }
  }

  // ---------------------------------------------------------------------------
  // Save & Apply — shows engine-restart warning if needed
  // ---------------------------------------------------------------------------

  function handleSaveClick() {
    if (confirmKind) {
      setConfirmKind(null);
      return;
    }
    if (needsEngineRestart(config, draft)) {
      setConfirmKind("engine-restart");
    } else {
      void saveAndApply();
    }
  }

  function handleConfirmSave() {
    setConfirmKind(null);
    void saveAndApply();
  }

  // ---------------------------------------------------------------------------
  // Discard
  // ---------------------------------------------------------------------------

  function handleDiscard() {
    discardChanges();
    setConfirmKind(null);
    close();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const tabContent: Record<TabId, React.ReactNode> = {
    general: <GeneralSettingsTab />,
    audio: <AudioSettingsTab />,
    midi: <MidiSettingsTab />,
    ui: <UiSettingsTab />,
    shortcuts: <ShortcutsSettingsTab />,
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onMouseDown={(e) => {
        // Click outside the dialog closes it (with dirty check).
        if (e.target === e.currentTarget) handleRequestClose();
      }}
    >
      {/* Dialog */}
      <div className="w-[700px] h-[620px] bg-[#1e1e1e] rounded-lg border border-[#3a3a3a] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#3a3a3a] flex-shrink-0">
          <h2 className="text-[#cccccc] text-sm font-semibold">Settings</h2>
          <button
            onClick={handleRequestClose}
            aria-label="Close settings"
            className="text-[#666666] hover:text-[#cccccc] transition-colors rounded p-0.5"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[#3a3a3a] px-5 flex-shrink-0">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={[
                "px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
                activeTab === id
                  ? "border-[#5b8def] text-[#cccccc]"
                  : "border-transparent text-[#666666] hover:text-[#999999]",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && !draft ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-[#666666] text-xs">Loading...</span>
            </div>
          ) : error && !draft ? (
            <div className="p-4 text-[#ff6b6b] text-xs">
              Error loading settings: {error}
            </div>
          ) : (
            tabContent[activeTab]
          )}
        </div>

        {/* Inline confirmation banners */}
        {confirmKind === "dirty-close" && (
          <div className="bg-[#2a2a2a] border-t border-[#3a3a3a] px-5 py-3 flex items-center justify-between flex-shrink-0">
            <span className="text-[#cccccc] text-xs">
              You have unsaved changes. Discard them?
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmKind(null)}
                className="px-3 py-1 text-xs text-[#cccccc] bg-[#3a3a3a] hover:bg-[#4a4a4a] rounded transition-colors"
              >
                Keep Editing
              </button>
              <button
                onClick={handleDiscard}
                className="px-3 py-1 text-xs text-white bg-[#c0392b] hover:bg-[#e74c3c] rounded transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {confirmKind === "engine-restart" && (
          <div className="bg-[#2a2a2a] border-t border-[#3a3a3a] px-5 py-3 flex items-center justify-between flex-shrink-0">
            <span className="text-[#cccccc] text-xs">
              Changing sample rate or buffer size requires restarting the audio engine.
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmKind(null)}
                className="px-3 py-1 text-xs text-[#cccccc] bg-[#3a3a3a] hover:bg-[#4a4a4a] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                className="px-3 py-1 text-xs text-white bg-[#5b8def] hover:bg-[#4a7de0] rounded transition-colors"
              >
                Save &amp; Restart
              </button>
            </div>
          </div>
        )}

        {/* Footer (hidden when a confirmation banner is showing) */}
        {!confirmKind && (
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[#3a3a3a] flex-shrink-0">
            {error && (
              <span className="text-[#ff6b6b] text-xs mr-auto">
                {error}
              </span>
            )}
            <button
              onClick={() => {
                discardChanges();
                close();
              }}
              className="px-4 py-1.5 text-xs text-[#cccccc] bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#3a3a3a] rounded transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSaveClick}
              disabled={isLoading || !draft}
              className="px-4 py-1.5 text-xs text-white bg-[#5b8def] hover:bg-[#4a7de0] rounded transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {isLoading ? "Saving..." : "Save & Apply"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
