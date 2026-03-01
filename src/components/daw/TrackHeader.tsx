import { useRef, useState } from 'react';
import { Mic, Music2 } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { DawTrack } from '@/lib/ipc';
import { useTrackStore } from '@/stores/trackStore';
import { useHistoryStore } from '@/stores/historyStore';
import { RenameTrackCommand } from '@/lib/commands/RenameTrackCommand';
import { DeleteTrackCommand } from '@/lib/commands/DeleteTrackCommand';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TrackHeaderProps {
  /** The track data to render. */
  track: DawTrack;
  /**
   * Zero-based position of this track in the list (used for delete undo).
   * Defaults to 0 when not provided (e.g. in tests).
   */
  index?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A single track row in the track list.
 *
 * Handles:
 * - Click to select
 * - Double-click on name to inline-rename (Enter/blur = confirm, Escape = cancel)
 * - Mute (M), Solo (S), Arm (R) buttons
 * - Color swatch via Radix UI Popover + `<input type="color">`
 * - Right-click context menu with "Delete Track"
 * - Track-type icon: `Music2` for Midi/Instrument, `Mic` for Audio
 */
export function TrackHeader({ track, index = 0 }: TrackHeaderProps) {
  const store = useTrackStore();
  const {
    selectedTrackId,
    selectTrack,
    toggleMute,
    toggleSolo,
    toggleArm,
    renameTrack,
    setTrackColor,
  } = store;

  // These methods may not exist in test mocks — use safe access via unknown cast.
  const storeAsAny = store as unknown as Record<string, unknown>;
  const removeTrackLocal = storeAsAny['removeTrackLocal'] as
    ((id: string) => void) | undefined;
  const insertTrack = storeAsAny['insertTrack'] as
    ((track: DawTrack, index: number) => void) | undefined;

  const push = useHistoryStore((s) => s.push);

  // -- Inline rename state --
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // -- Context menu state --
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);

  const isSelected = selectedTrackId === track.id;

  // ---------------------------------------------------------------------------
  // Rename helpers
  // ---------------------------------------------------------------------------

  function startEditing() {
    setEditValue(track.name);
    setIsEditing(true);
    // Focus deferred so the input mounts first
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function confirmRename() {
    const next = editValue.trim();
    setIsEditing(false);
    if (!next || next === track.name) return;
    const cmd = new RenameTrackCommand(renameTrack, track.id, track.name, next);
    push(cmd);
  }

  function cancelRename() {
    setIsEditing(false);
  }

  // ---------------------------------------------------------------------------
  // Context menu helpers
  // ---------------------------------------------------------------------------

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setCtxPos({ x: e.clientX, y: e.clientY });
  }

  function closeContextMenu() {
    setCtxPos(null);
  }

  function handleDeleteFromMenu() {
    closeContextMenu();
    if (!window.confirm(`Delete track "${track.name}"?`)) return;
    if (!removeTrackLocal || !insertTrack) return; // Guard for test environments
    const cmd = new DeleteTrackCommand(insertTrack, removeTrackLocal, track, index);
    push(cmd);
  }

  // ---------------------------------------------------------------------------
  // Track type icon
  // ---------------------------------------------------------------------------

  const isAudio = track.kind === 'Audio';
  const TrackIcon = isAudio ? Mic : Music2;
  const iconTestId = isAudio ? 'icon-audio' : 'icon-midi';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Track row */}
      <div
        role="row"
        aria-selected={isSelected}
        onClick={() => selectTrack(track.id)}
        onContextMenu={handleContextMenu}
        className={[
          'flex items-center gap-1 px-2 h-10 border-b border-[#2a2a2a] cursor-pointer select-none',
          'hover:bg-[#2a2a2a] transition-colors',
          isSelected ? 'bg-[#2d2d4a] border-l-2 border-l-[#6c63ff]' : 'bg-[#1e1e1e]',
        ].join(' ')}
      >
        {/* Color swatch */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="w-3 h-6 rounded-sm flex-shrink-0 border border-[#444] hover:border-[#888] transition-colors"
              style={{ backgroundColor: track.color }}
              title="Track color"
              aria-label="Change track color"
            />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="right"
              sideOffset={4}
              className="bg-[#2d2d2d] border border-[#3a3a3a] rounded p-2 shadow-xl z-50"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="color"
                value={track.color}
                onChange={(e) => void setTrackColor(track.id, e.target.value)}
                className="w-16 h-8 cursor-pointer border-0 bg-transparent"
                title="Pick track color"
              />
              <Popover.Arrow className="fill-[#3a3a3a]" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/* Track kind icon */}
        <TrackIcon
          size={12}
          className="flex-shrink-0 text-[#888888]"
          aria-hidden="true"
          data-testid={iconTestId}
        />

        {/* Track name — static or inline edit */}
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={confirmRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename();
              if (e.key === 'Escape') cancelRename();
              e.stopPropagation(); // Prevent global keyboard handler from firing
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-[#1a1a3a] border border-[#6c63ff] rounded px-1 text-xs text-[#cccccc] outline-none"
            aria-label="Rename track"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
            className="flex-1 min-w-0 text-xs text-[#cccccc] truncate"
            title={track.name}
          >
            {track.name}
          </span>
        )}

        {/* M / S / R buttons */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
          title="Mute"
          aria-label="Mute track"
          aria-pressed={track.muted}
          className={[
            'w-5 h-5 text-[10px] font-bold rounded flex-shrink-0 flex items-center justify-center transition-colors',
            track.muted
              ? 'bg-[#ff8800] text-black'
              : 'bg-[#333333] text-[#888888] hover:bg-[#444444]',
          ].join(' ')}
        >
          M
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
          title="Solo"
          aria-label="Solo track"
          aria-pressed={track.soloed}
          className={[
            'w-5 h-5 text-[10px] font-bold rounded flex-shrink-0 flex items-center justify-center transition-colors',
            track.soloed
              ? 'bg-[#ffdd00] text-black'
              : 'bg-[#333333] text-[#888888] hover:bg-[#444444]',
          ].join(' ')}
        >
          S
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); toggleArm(track.id); }}
          title="Record arm"
          aria-label="Arm track for recording"
          aria-pressed={track.armed}
          className={[
            'w-5 h-5 text-[10px] font-bold rounded flex-shrink-0 flex items-center justify-center transition-colors',
            track.armed
              ? 'bg-[#ff4444] text-white'
              : 'bg-[#333333] text-[#888888] hover:bg-[#444444]',
          ].join(' ')}
        >
          R
        </button>
      </div>

      {/* Right-click context menu overlay */}
      {ctxPos && (
        <>
          {/* Transparent backdrop to dismiss on outside click */}
          <div
            className="fixed inset-0 z-40"
            onClick={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
          />
          <div
            className="fixed z-50 bg-[#2d2d2d] border border-[#3a3a3a] rounded shadow-xl py-1 text-xs min-w-[140px]"
            style={{ top: ctxPos.y, left: ctxPos.x }}
          >
            <button
              onClick={handleDeleteFromMenu}
              className="w-full text-left px-3 py-1.5 text-[#ff6666] hover:bg-[#3a1a1a] transition-colors"
            >
              Delete Track
            </button>
          </div>
        </>
      )}
    </>
  );
}
