/**
 * exportStore — Zustand state for the audio export dialog (Sprint 22).
 *
 * Tracks whether the dialog is open, whether an export is in progress,
 * the current progress (0–1), and any error message.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface ExportState {
  /** Whether the export dialog is open. */
  isOpen: boolean;
  /** Whether an export job is currently running. */
  isExporting: boolean;
  /** Export progress in [0, 1]. */
  progress: number;
  /** Error message from the last failed export, or null. */
  error: string | null;

  open(): void;
  close(): void;
  setExporting(v: boolean): void;
  setProgress(p: number): void;
  setError(e: string | null): void;
  /** Resets isExporting, progress, and error (but not isOpen). */
  reset(): void;
}

export const useExportStore = create<ExportState>()(
  immer((set) => ({
    isOpen:      false,
    isExporting: false,
    progress:    0,
    error:       null,

    open:         () => set((s) => { s.isOpen = true; }),
    close:        () => set((s) => { s.isOpen = false; }),
    setExporting: (v) => set((s) => { s.isExporting = v; }),
    setProgress:  (p) => set((s) => { s.progress = p; }),
    setError:     (e) => set((s) => { s.error = e; }),
    reset:        () =>
      set((s) => {
        s.isExporting = false;
        s.progress    = 0;
        s.error       = null;
      }),
  })),
);
