/**
 * Convenience hook that wraps Piano Roll store actions with history integration.
 *
 * Components should call these wrappers rather than touching the store directly
 * so that every user-facing mutation is recorded in the global undo stack.
 */

import { useCallback } from 'react';
import { usePianoRollStore } from '../../stores/pianoRollStore';
import { useHistoryStore } from '../../stores/historyStore';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  ResizeNoteCommand,
  SetVelocityCommand,
  PasteNotesCommand,
} from '../../lib/commands/PianoRollCommands';
import type { MidiNote, NoteId } from './pianoRollTypes';

export function usePianoRollState() {
  const store = usePianoRollStore();
  const push = useHistoryStore((s) => s.push);

  // ---------------------------------------------------------------------------
  // History-integrated mutations
  // ---------------------------------------------------------------------------

  /** Add a note and record it in global history. */
  const addNote = useCallback(
    (note: MidiNote) => {
      push(new AddNoteCommand(note));
    },
    [push],
  );

  /**
   * Delete selected notes and record the operation in global history.
   * Reads selected IDs from store at call time.
   */
  const deleteSelectedNotes = useCallback(() => {
    const state = usePianoRollStore.getState();
    const toDelete = state.notes.filter((n) =>
      state.selectedNoteIds.includes(n.id),
    );
    if (toDelete.length === 0) return;
    push(new DeleteNotesCommand(toDelete));
  }, [push]);

  /** Delete specific notes by ID (used by mouse handler on right-click). */
  const deleteNotes = useCallback(
    (ids: NoteId[]) => {
      const state = usePianoRollStore.getState();
      const toDelete = state.notes.filter((n) => ids.includes(n.id));
      if (toDelete.length === 0) return;
      push(new DeleteNotesCommand(toDelete));
    },
    [push],
  );

  /**
   * Commit a move operation after a drag ends.
   *
   * `before` and `after` are full snapshots of position so undo is exact.
   */
  const commitMove = useCallback(
    (
      before: Array<{ id: NoteId; startBeats: number; pitch: number }>,
      after: Array<{ id: NoteId; startBeats: number; pitch: number }>,
    ) => {
      if (before.length === 0) return;
      push(new MoveNotesCommand(before, after));
    },
    [push],
  );

  /** Commit a resize operation after a drag ends. */
  const commitResize = useCallback(
    (id: NoteId, beforeDuration: number, afterDuration: number) => {
      push(new ResizeNoteCommand(id, beforeDuration, afterDuration));
    },
    [push],
  );

  /** Commit a velocity change (called by VelocityLane on pointer-up). */
  const commitVelocity = useCallback(
    (id: NoteId, before: number, after: number) => {
      if (before === after) return;
      push(new SetVelocityCommand(id, before, after));
    },
    [push],
  );

  /**
   * Paste clipboard notes at the given beat position and record the operation.
   *
   * Note: `PasteNotesCommand.execute()` calls `store.pasteAtBeat()` internally,
   * so the state is already updated when `push` returns.
   */
  const pasteAtBeat = useCallback(
    (beat: number) => {
      push(new PasteNotesCommand(beat));
    },
    [push],
  );

  // ---------------------------------------------------------------------------
  // Plain store pass-throughs (no history needed)
  // ---------------------------------------------------------------------------

  return {
    // State
    notes: store.notes,
    selectedNoteIds: store.selectedNoteIds,
    viewport: store.viewport,
    mode: store.mode,
    quantDiv: store.quantDiv,
    isOpen: store.isOpen,
    activeTrackId: store.activeTrackId,

    // History-integrated mutations
    addNote,
    deleteSelectedNotes,
    deleteNotes,
    commitMove,
    commitResize,
    commitVelocity,
    pasteAtBeat,

    // Plain store actions (selection, viewport, clipboard)
    selectNotes: store.selectNotes,
    clearSelection: store.clearSelection,
    copySelection: store.copySelection,
    setMode: store.setMode,
    setQuantDiv: store.setQuantDiv,
    setViewport: store.setViewport,
    close: store.close,
  };
}
