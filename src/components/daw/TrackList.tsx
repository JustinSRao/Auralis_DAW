import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { DawTrackKind } from '@/lib/ipc';
import { useTrackStore } from '@/stores/trackStore';
import { useHistoryStore } from '@/stores/historyStore';
import { ReorderTracksCommand } from '@/lib/commands/ReorderTracksCommand';
import { TrackHeader } from '@/components/daw/TrackHeader';

// ---------------------------------------------------------------------------
// Add-track dropdown options
// ---------------------------------------------------------------------------

const TRACK_KINDS: { kind: DawTrackKind; label: string }[] = [
  { kind: 'Instrument', label: 'Instrument Track' },
  { kind: 'Midi', label: 'MIDI Track' },
  { kind: 'Audio', label: 'Audio Track' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Scrollable container that renders a `TrackHeader` for each track.
 *
 * Features:
 * - "+" button opens a dropdown to choose the new track type.
 * - HTML5 drag-and-drop reorder with `ReorderTracksCommand` pushed to history.
 * - Empty state message when no tracks exist.
 */
export function TrackList() {
  const store = useTrackStore();
  const { tracks, reorderTracks, createTrack } = store;
  const push = useHistoryStore((s) => s.push);

  // -- Add-track dropdown --
  const [addOpen, setAddOpen] = useState(false);

  // -- Drag-and-drop state --
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // Add-track handler
  // ---------------------------------------------------------------------------

  async function handleAddTrack(kind: DawTrackKind) {
    setAddOpen(false);

    // Snapshot the count before the IPC call so we can identify the new track.
    const countBefore = tracks.length;

    // IPC call — on success, the store appends the new track.
    await createTrack(kind);

    // Identify the newly appended track from the current store state.
    // `addTrackLocal` and `removeTrackLocal` may not exist in test mocks;
    // guard with optional chaining so the add-track flow still works in tests.
    const { tracks: tracksAfter, addTrackLocal, removeTrackLocal } = useTrackStore.getState() as typeof store;
    if (tracksAfter.length <= countBefore) return; // IPC failed — nothing to record
    const newTrack = tracksAfter[tracksAfter.length - 1];

    if (!addTrackLocal || !removeTrackLocal) return; // No-op in test environments

    // Remove the track so the command's execute() can re-add it cleanly,
    // giving correct undo/redo semantics on the redo path.
    removeTrackLocal(newTrack.id);

    // manager.push(cmd) calls cmd.execute() which calls addTrackLocal().
    push({
      label: `Create track: "${newTrack.name}"`,
      execute: () => addTrackLocal(newTrack),
      undo: () => removeTrackLocal(newTrack.id),
    });
  }

  // ---------------------------------------------------------------------------
  // Drag-and-drop handlers
  // ---------------------------------------------------------------------------

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOverIndex(null);

    if (from === null || from === dropIndex) return;

    const prevOrder = tracks.map((t) => t.id);
    const nextOrder = [...prevOrder];
    const [moved] = nextOrder.splice(from, 1);
    nextOrder.splice(dropIndex, 0, moved);

    const cmd = new ReorderTracksCommand(reorderTracks, prevOrder, nextOrder);
    push(cmd);
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDragOverIndex(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex flex-col bg-[#1e1e1e] border-r border-[#3a3a3a] overflow-hidden"
      style={{ width: 220, minWidth: 220 }}
    >
      {/* Header row */}
      <div className="h-8 flex items-center px-2 bg-[#242424] border-b border-[#3a3a3a] flex-shrink-0">
        <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider flex-1">
          Tracks
        </span>

        {/* Add-track button + dropdown */}
        <div className="relative">
          <button
            onClick={() => setAddOpen((v) => !v)}
            title="Add track"
            aria-label="Add track"
            className="w-5 h-5 flex items-center justify-center rounded bg-[#333333] hover:bg-[#6c63ff] text-[#cccccc] hover:text-white transition-colors"
          >
            <Plus size={12} />
          </button>

          {addOpen && (
            <>
              {/* Transparent backdrop to close dropdown on outside click */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAddOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 bg-[#2d2d2d] border border-[#3a3a3a] rounded shadow-xl py-1 min-w-[160px]">
                {TRACK_KINDS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    onClick={() => void handleAddTrack(kind)}
                    className="w-full text-left px-3 py-1.5 text-xs text-[#cccccc] hover:bg-[#3a3a3a] transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Track list (scrollable) */}
      <div className="flex-1 overflow-y-auto">
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
            <span className="text-[#555555] text-xs text-center">
              No tracks yet
            </span>
            <span className="text-[#444444] text-xs text-center">
              Click + to add a track
            </span>
          </div>
        ) : (
          tracks.map((track, i) => (
            <div
              key={track.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
              className={[
                'transition-all',
                dragOverIndex === i && dragIndex.current !== i
                  ? 'border-t-2 border-t-[#6c63ff]'
                  : '',
              ].join(' ')}
            >
              <TrackHeader track={track} index={i} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
