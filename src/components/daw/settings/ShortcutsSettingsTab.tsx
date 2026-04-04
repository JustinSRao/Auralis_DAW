/**
 * ShortcutsSettingsTab — keyboard shortcut remapping UI (Sprint 46).
 *
 * Features:
 * - Search field filters by action label or current combo.
 * - Actions are grouped by category with always-expanded sections.
 * - Each row shows the action label, a category tag, the current binding,
 *   a "Remap" button, and a "Reset" button (only when the binding differs
 *   from the default).
 * - Clicking "Remap" opens `KeyCaptureModal`.
 * - A captured combo that conflicts with another action shows `ConflictDialog`.
 * - "Reset All Shortcuts" at the bottom restores all defaults.
 *
 * Conflict resolution:
 *   - Swap:    the two actions exchange bindings.
 *   - Replace: the capturing action gets the combo; the other is unbound.
 *   - Cancel:  no change.
 */

import { useState } from 'react';
import { useShortcutsStore } from '@/stores/shortcutsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ACTION_REGISTRY, DEFAULT_BINDINGS, type ActionCategory, type ActionDef } from '@/lib/shortcuts';
import { KeyBadge } from './KeyBadge';
import { KeyCaptureModal } from './KeyCaptureModal';
import { ConflictDialog } from './ConflictDialog';

// ---------------------------------------------------------------------------
// Category colour tags
// ---------------------------------------------------------------------------

const CATEGORY_COLOURS: Record<ActionCategory, string> = {
  Transport: 'bg-blue-800/50 text-blue-300',
  Editing:   'bg-purple-800/50 text-purple-300',
  Track:     'bg-green-800/50 text-green-300',
  View:      'bg-orange-800/50 text-orange-300',
  Project:   'bg-red-800/50 text-red-300',
};

// ---------------------------------------------------------------------------
// Conflict info shape
// ---------------------------------------------------------------------------

interface ConflictInfo {
  pendingCombo: string;
  capturingActionId: string;
  conflictingActionId: string;
  conflictingActionLabel: string;
  previousComboOfCapturing: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShortcutsSettingsTab() {
  const draftBindings = useShortcutsStore((s) => s.draftBindings);
  const { setDraftBinding, resetOne, resetAll, findConflict } = useShortcutsStore.getState();
  const { updateShortcuts } = useSettingsStore.getState();

  const [search, setSearch] = useState('');
  const [capturingActionId, setCapturingActionId] = useState<string | null>(null);
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);

  // ---------------------------------------------------------------------------
  // Filter and group
  // ---------------------------------------------------------------------------

  const lowerSearch = search.toLowerCase();
  const filtered: ActionDef[] = lowerSearch
    ? ACTION_REGISTRY.filter(
        (a) =>
          a.label.toLowerCase().includes(lowerSearch) ||
          (draftBindings[a.id] ?? '').toLowerCase().includes(lowerSearch),
      )
    : ACTION_REGISTRY;

  const categories = Array.from(new Set(ACTION_REGISTRY.map((a) => a.category)));

  // ---------------------------------------------------------------------------
  // Helper — flush draftBindings to settingsStore after each mutation
  // ---------------------------------------------------------------------------

  function flushToSettings() {
    updateShortcuts(useShortcutsStore.getState().draftBindings);
  }

  // ---------------------------------------------------------------------------
  // Key capture flow
  // ---------------------------------------------------------------------------

  function handleCaptureConfirm(combo: string) {
    if (!capturingActionId) return;

    const conflictId = findConflict(combo, capturingActionId);
    if (!conflictId) {
      // No conflict — apply directly.
      setDraftBinding(capturingActionId, combo);
      flushToSettings();
      setCapturingActionId(null);
      return;
    }

    // Conflict — ask user what to do.
    const conflictingAction = ACTION_REGISTRY.find((a) => a.id === conflictId);
    setCapturingActionId(null);
    setConflictInfo({
      pendingCombo: combo,
      capturingActionId,
      conflictingActionId: conflictId,
      conflictingActionLabel: conflictingAction?.label ?? conflictId,
      previousComboOfCapturing: draftBindings[capturingActionId] ?? '',
    });
  }

  function handleConflictSwap() {
    if (!conflictInfo) return;
    const { pendingCombo, capturingActionId, conflictingActionId, previousComboOfCapturing } = conflictInfo;
    // Give capturing action the new combo.
    setDraftBinding(capturingActionId, pendingCombo);
    // Give conflicting action the previous combo of the capturing action.
    setDraftBinding(conflictingActionId, previousComboOfCapturing);
    flushToSettings();
    setConflictInfo(null);
  }

  function handleConflictReplace() {
    if (!conflictInfo) return;
    const { pendingCombo, capturingActionId } = conflictInfo;
    // setDraftBinding already unbinds the conflicting action.
    setDraftBinding(capturingActionId, pendingCombo);
    flushToSettings();
    setConflictInfo(null);
  }

  function handleConflictCancel() {
    setConflictInfo(null);
  }

  function handleResetAll() {
    resetAll();
    flushToSettings();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-4 flex flex-col gap-3">
      {/* Search */}
      <input
        type="search"
        placeholder="Search actions or keys..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded px-3 py-1.5 text-xs text-[#cccccc] placeholder:text-[#555555] focus:outline-none focus:border-[#5b8def]"
      />

      {/* Conflict dialog */}
      {conflictInfo && (
        <ConflictDialog
          combo={conflictInfo.pendingCombo}
          existingActionLabel={conflictInfo.conflictingActionLabel}
          onSwap={handleConflictSwap}
          onReplace={handleConflictReplace}
          onCancel={handleConflictCancel}
        />
      )}

      {/* Action groups */}
      {categories.map((category) => {
        const actions = filtered.filter((a) => a.category === category);
        if (actions.length === 0) return null;

        return (
          <div key={category}>
            <h3 className="text-[#888888] text-[10px] uppercase tracking-widest mb-1.5 font-semibold">
              {category}
            </h3>
            <div className="flex flex-col gap-px">
              {actions.map((action) => {
                const current = draftBindings[action.id] ?? '';
                const isModified = current !== (DEFAULT_BINDINGS[action.id] ?? '');

                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#2a2a2a] group"
                  >
                    {/* Label */}
                    <span className="flex-1 text-xs text-[#cccccc]">{action.label}</span>

                    {/* Category tag */}
                    <span
                      className={[
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        CATEGORY_COLOURS[action.category],
                      ].join(' ')}
                    >
                      {action.category}
                    </span>

                    {/* Current binding */}
                    <div className="w-28 flex justify-end">
                      <KeyBadge combo={current} />
                    </div>

                    {/* Reset button — only when modified */}
                    <button
                      onClick={() => {
                        resetOne(action.id);
                        flushToSettings();
                      }}
                      aria-label={`Reset ${action.label} to default`}
                      className={[
                        'text-[10px] text-[#888888] hover:text-[#cccccc] transition-colors w-10 text-right',
                        isModified ? 'opacity-100' : 'opacity-0 pointer-events-none',
                      ].join(' ')}
                    >
                      Reset
                    </button>

                    {/* Remap button */}
                    <button
                      onClick={() => setCapturingActionId(action.id)}
                      aria-label={`Remap ${action.label}`}
                      className="px-2 py-0.5 text-[10px] bg-[#2a2a2a] group-hover:bg-[#3a3a3a] border border-[#3a3a3a] hover:border-[#5b8def] text-[#888888] hover:text-[#cccccc] rounded transition-colors"
                    >
                      Remap
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Reset all */}
      <div className="flex justify-end pt-1 border-t border-[#3a3a3a]">
        <button
          onClick={handleResetAll}
          className="px-3 py-1 text-xs text-[#cccccc] bg-[#2a2a2a] hover:bg-[#3a3a3a] border border-[#3a3a3a] rounded transition-colors"
        >
          Reset All Shortcuts
        </button>
      </div>

      {/* Key capture modal — rendered above everything else */}
      {capturingActionId && (
        <KeyCaptureModal
          onConfirm={handleCaptureConfirm}
          onCancel={() => setCapturingActionId(null)}
        />
      )}
    </div>
  );
}
