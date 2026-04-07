/**
 * FreezeProgressDialog — modal progress indicator for Track Freeze/Bounce (Sprint 40).
 *
 * Subscribes to the `freeze_progress` Tauri event and updates a progress bar.
 * Closes automatically when progress reaches 1.0. The Cancel button calls
 * `cancelFreeze` and closes the dialog without applying changes.
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { FreezeProgressPayload } from "@/lib/ipc";
import { useFreezeStore } from "@/stores/freezeStore";

interface FreezeProgressDialogProps {
  /** The ID of the track being frozen/bounced. */
  trackId: string;
  /** Human-readable track name shown in the dialog header. */
  trackName: string;
  /** Label for the operation: "Freeze" or "Bounce". */
  operation: "Freeze" | "Bounce";
  /** Called when the dialog should close (success or cancel). */
  onClose: () => void;
}

/**
 * Full-screen modal progress dialog for freeze and bounce operations.
 *
 * Mount this only while a render is in progress; `onClose` fires when done.
 */
export function FreezeProgressDialog({
  trackId,
  trackName,
  operation,
  onClose,
}: FreezeProgressDialogProps) {
  const { onProgress, getProgress, cancelFreeze, getStatus } = useFreezeStore();
  const progress = getProgress(trackId);
  const status = getStatus(trackId);

  // Subscribe to backend progress events.
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<FreezeProgressPayload>("freeze_progress", (event) => {
      if (event.payload.trackId !== trackId) return;
      onProgress(trackId, event.payload.progress);
      if (event.payload.progress >= 1.0) {
        onClose();
      }
    })
      .then((fn) => { unlisten = fn; })
      .catch((e) => console.error("Failed to listen to freeze_progress:", e));

    return () => unlisten?.();
  }, [trackId, onProgress, onClose]);

  // Close immediately if status changes to idle (cancelled) or error.
  useEffect(() => {
    if (status === "idle" || status === "error") {
      onClose();
    }
  }, [status, onClose]);

  const handleCancel = async () => {
    await cancelFreeze(trackId);
    onClose();
  };

  const pct = Math.round(progress * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      aria-modal="true"
      role="dialog"
      aria-label={`${operation} progress`}
    >
      <div className="bg-[#1e1e1e] border border-[#3a3a3a] rounded-lg p-6 w-80 flex flex-col gap-4 shadow-xl">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-[#cccccc]">
            {operation} Track
          </span>
          <span className="text-xs text-[#888888] truncate">{trackName}</span>
        </div>

        {/* Progress bar */}
        <div className="flex flex-col gap-1.5">
          <div
            className="w-full h-2 bg-[#333333] rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full bg-[#5b8def] rounded-full transition-all duration-100"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-[#888888] text-right font-mono">
            {pct}%
          </span>
        </div>

        {/* Status */}
        <p className="text-xs text-[#666666] italic">
          Rendering offline… please wait.
        </p>

        {/* Cancel */}
        <div className="flex justify-end">
          <button
            onClick={handleCancel}
            className="text-xs px-3 py-1.5 border border-[#3a3a3a] text-[#aaaaaa] hover:text-white hover:border-[#555555] rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
