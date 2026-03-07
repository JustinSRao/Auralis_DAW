/**
 * PatternBrowser — left-panel pattern list grouped by track.
 *
 * Displays all patterns organised by their owning track. Supports:
 * - Single click: select a pattern
 * - Double click: open in Piano Roll (MIDI) or show toast (Audio)
 * - Right click: context menu (rename, duplicate, set length, delete)
 * - Drag: initiates a drag with `application/pattern-id` transfer data
 * - "+ Add Pattern" per track group
 */

import { useRef, useState, type KeyboardEvent } from 'react';
import { usePatternStore } from '../../stores/patternStore';
import { usePianoRollStore } from '../../stores/pianoRollStore';
import { useTrackStore } from '../../stores/trackStore';
import type { PatternData, PatternLengthBars } from '../../lib/ipc';
import type { MidiNote } from '../PianoRoll/pianoRollTypes';

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface ContextMenuState {
  patternId: string;
  x: number;
  y: number;
}

interface PatternContextMenuProps {
  patternId: string;
  x: number;
  y: number;
  onClose(): void;
}

const LENGTH_OPTIONS: PatternLengthBars[] = [1, 2, 4, 8, 16, 32];

function PatternContextMenu({ patternId, x, y, onClose }: PatternContextMenuProps) {
  const patternStore = usePatternStore();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const pattern = usePatternStore((s) => s.patterns[patternId]);
  if (!pattern) return null;

  function handleRenameStart() {
    setRenameValue(pattern.name);
    setRenaming(true);
  }

  function handleRenameConfirm() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== pattern.name) {
      void patternStore.renamePattern(patternId, trimmed);
    }
    setRenaming(false);
    onClose();
  }

  function handleRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleRenameConfirm();
    if (e.key === 'Escape') { setRenaming(false); onClose(); }
    e.stopPropagation();
  }

  function handleDuplicate() {
    void patternStore.duplicatePattern(patternId);
    onClose();
  }

  function handleSetLength(len: PatternLengthBars) {
    void patternStore.setPatternLength(patternId, len);
    onClose();
  }

  function handleDelete() {
    onClose();
    if (window.confirm(`Delete pattern "${pattern.name}"?`)) {
      void patternStore.deletePattern(patternId);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />

      {/* Menu */}
      <div
        className="fixed z-50 bg-[#2d2d2d] border border-[#3a3a3a] rounded shadow-xl py-1 text-xs min-w-[160px]"
        style={{ top: y, left: x }}
        data-testid="pattern-context-menu"
      >
        {renaming ? (
          <div className="px-3 py-1.5">
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameConfirm}
              onKeyDown={handleRenameKey}
              className="w-full bg-[#1a1a3a] border border-[#6c63ff] rounded px-1 text-xs text-[#cccccc] outline-none"
              aria-label="Rename pattern"
            />
          </div>
        ) : (
          <>
            <button
              onClick={handleRenameStart}
              className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#3a3a3a] transition-colors"
            >
              Rename
            </button>

            <button
              onClick={handleDuplicate}
              className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#3a3a3a] transition-colors"
            >
              Duplicate
            </button>

            {/* Set Length submenu */}
            <div className="border-t border-[#3a3a3a] mt-1 pt-1">
              <span className="px-3 py-0.5 text-[10px] text-[#666] uppercase font-mono block">
                Set Length
              </span>
              {LENGTH_OPTIONS.map((len) => (
                <button
                  key={len}
                  onClick={() => handleSetLength(len)}
                  className={[
                    'w-full text-left px-3 py-1 transition-colors',
                    pattern.lengthBars === len
                      ? 'text-[#5b8def] hover:bg-[#3a3a3a]'
                      : 'text-[#cccccc] hover:bg-[#3a3a3a]',
                  ].join(' ')}
                >
                  {len === 1 ? '1 bar' : `${len} bars`}
                </button>
              ))}
            </div>

            <div className="border-t border-[#3a3a3a] mt-1 pt-1">
              <button
                onClick={handleDelete}
                className="w-full text-left px-3 py-1.5 text-[#ff6666] hover:bg-[#3a1a1a] transition-colors"
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pattern row
// ---------------------------------------------------------------------------

interface PatternRowProps {
  pattern: PatternData;
  isSelected: boolean;
  onSelect(): void;
  onDoubleClick(): void;
  onContextMenu(x: number, y: number): void;
}

function PatternRow({ pattern, isSelected, onSelect, onDoubleClick, onContextMenu }: PatternRowProps) {
  const isMidi = pattern.content.type === 'Midi';

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    onContextMenu(e.clientX, e.clientY);
  }

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('application/pattern-id', pattern.id);
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <div
      role="row"
      aria-selected={isSelected}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
      data-testid={`pattern-row-${pattern.id}`}
      className={[
        'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors',
        'hover:bg-[#2a2a2a]',
        isSelected ? 'bg-[#2d2d4a] border-l-2 border-l-[#5b8def]' : '',
      ].join(' ')}
    >
      {/* Type indicator pill */}
      <span
        className={[
          'text-[8px] font-mono px-1 rounded flex-shrink-0',
          isMidi ? 'bg-[#1d3a5f] text-[#5b8def]' : 'bg-[#3a2a1d] text-[#c87533]',
        ].join(' ')}
      >
        {isMidi ? 'MIDI' : 'AUD'}
      </span>

      {/* Pattern name */}
      <span className="flex-1 min-w-0 text-xs text-[#cccccc] truncate" title={pattern.name}>
        {pattern.name}
      </span>

      {/* Length badge */}
      <span className="text-[9px] text-[#666] font-mono flex-shrink-0">
        {pattern.lengthBars}b
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track group
// ---------------------------------------------------------------------------

interface TrackGroupProps {
  trackId: string;
  trackName: string;
  trackColor: string;
  patterns: PatternData[];
  selectedPatternId: string | null;
  onSelect(id: string): void;
  onOpenPattern(pattern: PatternData): void;
  onContextMenu(id: string, x: number, y: number): void;
  onAddPattern(): void;
}

function TrackGroup({
  trackId,
  trackName,
  trackColor,
  patterns,
  selectedPatternId,
  onSelect,
  onOpenPattern,
  onContextMenu,
  onAddPattern,
}: TrackGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-[#2a2a2a]">
      {/* Track header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        data-testid={`track-group-${trackId}`}
        className="w-full flex items-center gap-2 px-2 py-1 hover:bg-[#2a2a2a] transition-colors"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: trackColor }}
        />
        <span className="flex-1 text-left text-[10px] font-mono text-[#888] truncate uppercase">
          {trackName}
        </span>
        <span className="text-[9px] text-[#555]">{collapsed ? '▶' : '▼'}</span>
      </button>

      {/* Pattern list */}
      {!collapsed && (
        <>
          {patterns.map((p) => (
            <PatternRow
              key={p.id}
              pattern={p}
              isSelected={selectedPatternId === p.id}
              onSelect={() => onSelect(p.id)}
              onDoubleClick={() => onOpenPattern(p)}
              onContextMenu={(x, y) => onContextMenu(p.id, x, y)}
            />
          ))}

          {/* Add pattern button */}
          <button
            onClick={onAddPattern}
            data-testid={`add-pattern-${trackId}`}
            className="w-full text-left px-4 py-1 text-[10px] text-[#555] hover:text-[#888] transition-colors font-mono"
          >
            + Add Pattern
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatternBrowser (root)
// ---------------------------------------------------------------------------

export function PatternBrowser() {
  const patternStore = usePatternStore();
  const { tracks } = useTrackStore();
  const openForPattern = usePianoRollStore((s) => s.openForPattern);
  const selectedPatternId = usePatternStore((s) => s.selectedPatternId);
  const patterns = usePatternStore((s) => s.patterns);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Use a ref to track toast timeout so we can clear it on unmount.
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  function showAudioToast() {
    setToastVisible(true);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastVisible(false), 2500);
  }

  function handleOpenPattern(pattern: PatternData) {
    if (pattern.content.type === 'Midi') {
      // Cast is safe: PatternMidiNote fields are identical to MidiNote fields.
      const notes = pattern.content.notes as unknown as MidiNote[];
      openForPattern(pattern.trackId, pattern.id, notes);
    } else {
      showAudioToast();
    }
  }

  function handleAddPattern(trackId: string) {
    void patternStore.createPattern(trackId);
  }

  function handleContextMenu(id: string, x: number, y: number) {
    setContextMenu({ patternId: id, x, y });
  }

  // Only show tracks that exist in trackStore.
  const tracksWithPatterns = tracks.map((t) => ({
    track: t,
    patterns: Object.values(patterns).filter((p) => p.trackId === t.id),
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="pattern-browser">
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b border-[#3a3a3a] flex-shrink-0">
        <span className="text-[10px] font-mono text-[#666] uppercase tracking-widest">
          Patterns
        </span>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {tracksWithPatterns.length === 0 ? (
          <div className="flex items-center justify-center h-full p-4">
            <span className="text-[10px] text-[#444] text-center font-mono">
              No tracks yet.
              <br />
              Add a track to create patterns.
            </span>
          </div>
        ) : (
          tracksWithPatterns.map(({ track, patterns: trackPatterns }) => (
            <TrackGroup
              key={track.id}
              trackId={track.id}
              trackName={track.name}
              trackColor={track.color}
              patterns={trackPatterns}
              selectedPatternId={selectedPatternId}
              onSelect={(id) => patternStore.selectPattern(id)}
              onOpenPattern={handleOpenPattern}
              onContextMenu={handleContextMenu}
              onAddPattern={() => handleAddPattern(track.id)}
            />
          ))
        )}
      </div>

      {/* Audio editing toast */}
      {toastVisible && (
        <div
          className="absolute bottom-2 left-2 right-2 bg-[#3a3a2a] border border-[#666633] text-[#cccc88] text-[10px] font-mono rounded px-2 py-1.5 text-center"
          role="status"
          aria-live="polite"
          data-testid="audio-toast"
        >
          Audio editing coming soon.
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <PatternContextMenu
          patternId={contextMenu.patternId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
