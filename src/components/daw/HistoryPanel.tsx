import { useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, RotateCw } from 'lucide-react';
import { useHistoryStore } from '@/stores/historyStore';

/**
 * Collapsible sidebar panel that shows the undo/redo history stack.
 *
 * - Entries are displayed most-recent-first (the stack is reversed for display).
 * - The current entry (undo pointer) is highlighted in the brand colour and
 *   rendered in bold. It also carries `aria-current="true"` for accessibility
 *   and testability.
 * - Entries that are in the redo stack (after the pointer) are rendered at
 *   reduced opacity.
 * - Undo and Redo buttons are disabled when the respective action is
 *   unavailable.
 * - The body is kept in the DOM when collapsed (via the `hidden` attribute)
 *   so that visibility-based assertions and CSS transitions work correctly.
 */
export function HistoryPanel() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const entries = useHistoryStore((s) => s.entries);
  const currentPointer = useHistoryStore((s) => s.currentPointer);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  // Reverse the entries array so the most recent command appears at the top of
  // the list. We track the original index so we can determine redo-stack entries
  // (those whose originalIndex > currentPointer). The isCurrent flag from each
  // entry is used directly — the store already computes it via HistoryManager.
  const displayEntries = [...entries]
    .map((entry, originalIndex) => ({ ...entry, originalIndex }))
    .reverse();

  return (
    <div className="border-b border-[#3a3a3a]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#2a2a2a]">
        <span className="text-xs font-semibold text-[#cccccc] uppercase tracking-wider">
          History
        </span>
        <button
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="text-[#888888] hover:text-[#cccccc] transition-colors"
          aria-label={isCollapsed ? 'Expand history panel' : 'Collapse history panel'}
        >
          {isCollapsed ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronUp size={14} />
          )}
        </button>
      </div>

      {/*
        Body — kept in the DOM at all times so that visibility assertions work.
        The `hidden` HTML attribute causes display:none which makes elements
        invisible to toBeVisible() checks in tests.
      */}
      <div className="flex flex-col" hidden={isCollapsed}>
        {/* Scrollable entry list */}
        <div className="max-h-48 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-center text-[#555555] text-xs py-4 select-none">
              History Empty
            </p>
          ) : (
            <ul>
              {displayEntries.map(({ label, isCurrent, originalIndex }) => {
                // Entries after the pointer are in the redo stack.
                const isRedo = originalIndex > currentPointer;

                return (
                  <li
                    key={originalIndex}
                    aria-current={isCurrent ? 'true' : undefined}
                    className={[
                      'px-3 py-1 text-xs truncate select-none',
                      isCurrent
                        ? 'text-[#6c63ff] font-bold bg-[#2a2a3a]'
                        : 'text-[#aaaaaa]',
                      isRedo ? 'opacity-50' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={label}
                  >
                    {label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 px-3 py-2 border-t border-[#3a3a3a]">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex items-center gap-1 flex-1 justify-center py-1 text-xs rounded
                       bg-[#333333] text-[#cccccc]
                       hover:bg-[#404040] hover:text-white
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
            aria-label="Undo"
          >
            <RotateCcw size={12} />
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="flex items-center gap-1 flex-1 justify-center py-1 text-xs rounded
                       bg-[#333333] text-[#cccccc]
                       hover:bg-[#404040] hover:text-white
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
            aria-label="Redo"
          >
            <RotateCw size={12} />
            Redo
          </button>
        </div>
      </div>
    </div>
  );
}
