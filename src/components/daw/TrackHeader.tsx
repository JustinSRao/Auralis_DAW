import { useRef, useState } from 'react';
import { Mic, Music2, Snowflake } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { DawTrack } from '@/lib/ipc';
import { ipcStartMidiRecording, ipcStopMidiRecording } from '@/lib/ipc';
import { useFreezeStore } from '@/stores/freezeStore';
import { FreezeProgressDialog } from '@/components/daw/FreezeProgressDialog';
import { useTrackStore } from '@/stores/trackStore';
import { useHistoryStore } from '@/stores/historyStore';
import { usePianoRollStore } from '@/stores/pianoRollStore';
import { usePatternStore } from '@/stores/patternStore';
import { useTransportStore } from '@/stores/transportStore';
import { useTakeLaneStore } from '@/stores/takeLaneStore';
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
  const openPianoRoll = usePianoRollStore((s) => s.openForTrack);
  const getPatternsForTrack = usePatternStore((s) => s.getPatternsForTrack);
  const selectedPatternId = usePatternStore((s) => s.selectedPatternId);
  const { recordQuantize, recordOverdub } = useTransportStore();

  // -- Inline rename state --
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // -- Context menu state --
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);

  // -- Freeze/bounce state --
  const { isFrozen, getStatus, freezeTrack, unfreezeTrack, bounceTrack } = useFreezeStore();
  const [showFreezeDialog, setShowFreezeDialog] = useState(false);
  const [freezeOperation, setFreezeOperation] = useState<'Freeze' | 'Bounce'>('Freeze');
  const frozen = isFrozen(track.id);
  const freezeStatus = getStatus(track.id);

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
  // Recording helpers
  // ---------------------------------------------------------------------------

  async function handleArmToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (track.armed) {
      // Disarm: stop recording
      toggleArm(track.id);
      try {
        await ipcStopMidiRecording();
      } catch (err) {
        console.warn('Failed to stop MIDI recording:', err);
      }
    } else {
      // Arm: find a pattern to record into (selected pattern if it belongs to
      // this track, otherwise the first pattern for this track)
      const trackPatterns = getPatternsForTrack(track.id);
      const targetPattern =
        trackPatterns.find((p) => p.id === selectedPatternId) ??
        trackPatterns[0];
      if (!targetPattern) {
        // No pattern to record into — arm visually only (no IPC)
        toggleArm(track.id);
        return;
      }
      toggleArm(track.id);
      try {
        await ipcStartMidiRecording(
          targetPattern.id,
          track.id,
          recordOverdub,
          recordQuantize,
        );
      } catch (err) {
        console.warn('Failed to start MIDI recording:', err);
        toggleArm(track.id); // Revert arm state on error
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Take lane state (Sprint 44)
  // ---------------------------------------------------------------------------

  const takeLane = useTakeLaneStore((s) => s.lanes[track.id]);
  const takeCount = takeLane?.takes.length ?? 0;

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
        onDoubleClick={() => openPianoRoll(track.id)}
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
          onClick={(e) => void handleArmToggle(e)}
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

        {/* Freeze/Unfreeze button — visible on Midi tracks only */}
        {track.kind === 'Midi' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (frozen) {
                void unfreezeTrack(track.id);
              } else {
                setFreezeOperation('Freeze');
                setShowFreezeDialog(true);
                void freezeTrack(track.id, [], 120, '', undefined, undefined)
                  .catch(() => setShowFreezeDialog(false));
              }
            }}
            title={frozen ? 'Unfreeze track' : 'Freeze track'}
            aria-label={frozen ? 'Unfreeze track' : 'Freeze track'}
            aria-pressed={frozen}
            disabled={freezeStatus === 'rendering'}
            className={[
              'w-5 h-5 text-[10px] rounded flex-shrink-0 flex items-center justify-center transition-colors',
              frozen
                ? 'bg-[#0e4f5e] text-[#5ee7ff] border border-[#5ee7ff]'
                : 'bg-[#333333] text-[#888888] hover:bg-[#444444]',
              freezeStatus === 'rendering' ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            <Snowflake size={10} />
          </button>
        )}

        {/* FROZEN badge */}
        {frozen && (
          <span
            className="text-[8px] font-bold text-[#5ee7ff] border border-[#5ee7ff] rounded px-1 flex-shrink-0"
            title="Track is frozen — click snowflake to unfreeze"
          >
            FROZEN
          </span>
        )}

        {/* Freeze progress dialog — shown while rendering */}
        {showFreezeDialog && (
          <FreezeProgressDialog
            trackId={track.id}
            trackName={track.name}
            operation={freezeOperation}
            onClose={() => setShowFreezeDialog(false)}
          />
        )}

        {/* Take count badge — shown when loop takes exist */}
        {takeCount > 0 && (
          <span
            title={`${takeCount} take${takeCount !== 1 ? 's' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              void useTakeLaneStore.getState().toggleExpanded(track.id);
            }}
            style={{
              fontSize: 9,
              padding: '1px 4px',
              background: '#3a3a5a',
              border: '1px solid #6c63ff',
              borderRadius: 3,
              color: '#aaa',
              cursor: 'pointer',
              userSelect: 'none',
              flexShrink: 0,
            }}
            data-testid="take-count-badge"
          >
            T{takeCount}
          </span>
        )}
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
            {track.kind === 'Midi' && !frozen && (
              <button
                onClick={() => {
                  closeContextMenu();
                  setFreezeOperation('Bounce');
                  setShowFreezeDialog(true);
                  void bounceTrack(track.id, [], 120, '', undefined, undefined)
                    .catch(() => setShowFreezeDialog(false));
                }}
                className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#3a3a3a] transition-colors"
              >
                Bounce in Place…
              </button>
            )}
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
