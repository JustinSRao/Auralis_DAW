/**
 * ConflictDialog — inline banner shown when a captured combo is already bound (Sprint 46).
 *
 * Not a modal overlay — renders inside the content area of ShortcutsSettingsTab.
 * Offers three resolutions: Swap, Replace (unbind the existing action), or Cancel.
 */

import { KeyBadge } from './KeyBadge';

interface Props {
  combo: string;
  existingActionLabel: string;
  onSwap(): void;
  onReplace(): void;
  onCancel(): void;
}

export function ConflictDialog({
  combo,
  existingActionLabel,
  onSwap,
  onReplace,
  onCancel,
}: Props) {
  return (
    <div
      className="bg-yellow-900/40 border border-yellow-600 rounded p-3 mb-3 flex flex-col gap-2"
      role="alert"
    >
      <p className="text-[#cccccc] text-xs leading-relaxed">
        <KeyBadge combo={combo} highlighted /> is already assigned to{' '}
        <span className="text-yellow-300 font-medium">{existingActionLabel}</span>.
        What would you like to do?
      </p>

      <div className="flex gap-2">
        <button
          onClick={onSwap}
          className="px-3 py-1 text-xs text-white bg-[#5b8def] hover:bg-[#4a7de0] rounded transition-colors"
        >
          Swap
        </button>
        <button
          onClick={onReplace}
          className="px-3 py-1 text-xs text-white bg-[#c0392b] hover:bg-[#e74c3c] rounded transition-colors"
        >
          Replace (unbind existing)
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-[#cccccc] bg-[#3a3a3a] hover:bg-[#4a4a4a] rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
