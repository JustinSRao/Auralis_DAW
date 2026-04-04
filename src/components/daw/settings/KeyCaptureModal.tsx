/**
 * KeyCaptureModal — full-screen overlay that listens for a key combo (Sprint 46).
 *
 * Renders above the SettingsPanel (z-[60]) with a dark scrim. Shows the
 * combo being pressed as it is captured. On Escape, calls `onCancel`.
 * On any other complete combo, calls `onConfirm(combo)`.
 */

import { useEffect, useState } from 'react';
import { serializeCombo } from '@/lib/shortcuts';
import { KeyBadge } from './KeyBadge';

interface Props {
  onConfirm(combo: string): void;
  onCancel(): void;
}

export function KeyCaptureModal({ onConfirm, onCancel }: Props) {
  const [preview, setPreview] = useState<string>('');

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels without capturing.
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      const combo = serializeCombo(e);
      if (!combo) return; // bare modifier — show nothing yet

      setPreview(combo);
      onConfirm(combo);
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onConfirm, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Press a key combination"
    >
      <div className="bg-[#1e1e1e] border border-[#3a3a3a] rounded-lg px-8 py-6 text-center shadow-2xl min-w-[280px]">
        <p className="text-[#888888] text-xs mb-4">Press a key combination...</p>

        <div className="min-h-[28px] flex items-center justify-center mb-4">
          {preview ? (
            <KeyBadge combo={preview} highlighted />
          ) : (
            <span className="text-[#555555] text-xs">Waiting for input...</span>
          )}
        </div>

        <p className="text-[#555555] text-xs">
          Press <kbd className="font-mono bg-[#2a2a2a] border border-[#3a3a3a] px-1 rounded text-[#888888]">Escape</kbd> to cancel
        </p>
      </div>
    </div>
  );
}
