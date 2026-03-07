/**
 * Mouse state machine hook for the Piano Roll note canvas.
 *
 * All drag state lives in `useRef` so pointer-move events never trigger
 * React re-renders. The store is updated optimistically during drags (for
 * live preview) and the final command is committed to history on pointer-up.
 */

import { useRef, useCallback } from 'react';
import { usePianoRollStore } from '../../stores/pianoRollStore';
import {
  AddNoteCommand,
  MoveNotesCommand,
  ResizeNoteCommand,
} from '../../lib/commands/PianoRollCommands';
import { useHistoryStore } from '../../stores/historyStore';
import {
  xToBeat,
  yToPitch,
  snapBeat,
  noteHitTest,
  getVisibleNotes,
} from './pianoRollUtils';
import type { MouseInteractionState, NoteId } from './pianoRollTypes';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UsePianoRollMouseOptions {
  /** Ref to the canvas element — used to call setPointerCapture. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Forces a redraw of the rubber-band selection overlay. */
  requestRedraw: () => void;
}

export function usePianoRollMouse({
  canvasRef,
  requestRedraw,
}: UsePianoRollMouseOptions) {
  const push = useHistoryStore((s) => s.push);

  // Interaction state lives in a ref — mutations do NOT trigger re-renders.
  const interaction = useRef<MouseInteractionState>({ kind: 'idle' });

  // ---------------------------------------------------------------------------
  // Pointer down
  // ---------------------------------------------------------------------------

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Capture all subsequent pointer events on this element.
      canvas.setPointerCapture(e.pointerId);

      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const state = usePianoRollStore.getState();
      const { viewport, mode, quantDiv, notes } = state;

      // Test notes in reverse render order so topmost note wins.
      const visible = getVisibleNotes(notes, viewport, canvas.width, canvas.height);
      let hitNoteId: NoteId | null = null;
      let hitZone: 'resize' | 'move' | null = null;

      for (let i = visible.length - 1; i >= 0; i--) {
        const zone = noteHitTest(visible[i], canvasX, canvasY, viewport);
        if (zone) {
          hitNoteId = visible[i].id;
          hitZone = zone;
          break;
        }
      }

      if (mode === 'draw') {
        if (hitNoteId && hitZone === 'resize') {
          // Start resizing the hit note.
          const note = notes.find((n) => n.id === hitNoteId);
          if (!note) return;
          interaction.current = {
            kind: 'resizing',
            noteId: hitNoteId,
            originalDuration: note.durationBeats,
            startX: canvasX,
          };
          return;
        }

        if (hitNoteId && hitZone === 'move') {
          // If the note isn't selected, select it exclusively.
          const { selectedNoteIds } = state;
          const toMove = selectedNoteIds.includes(hitNoteId)
            ? selectedNoteIds
            : [hitNoteId];

          if (!selectedNoteIds.includes(hitNoteId)) {
            usePianoRollStore.getState().selectNotes([hitNoteId]);
          }

          const originalPositions = new Map(
            notes
              .filter((n) => toMove.includes(n.id))
              .map((n) => [n.id, { startBeats: n.startBeats, pitch: n.pitch }]),
          );

          interaction.current = {
            kind: 'moving',
            noteIds: toMove,
            startX: canvasX,
            startY: canvasY,
            originalPositions,
          };
          return;
        }

        // No hit — start drawing a new note.
        const rawBeat = xToBeat(canvasX, viewport);
        const snappedBeat = snapBeat(rawBeat, quantDiv);
        const pitch = yToPitch(canvasY, viewport);
        const gridSize = 4 / quantDiv; // minimum note duration = one grid cell

        const newNote = {
          id: crypto.randomUUID(),
          pitch,
          startBeats: snappedBeat,
          durationBeats: gridSize,
          velocity: 100,
          channel: 0,
        };

        // Add immediately for visual feedback; undo history committed on pointer-up.
        usePianoRollStore.getState().addNote(newNote);
        usePianoRollStore.getState().selectNotes([newNote.id]);

        interaction.current = {
          kind: 'drawing',
          noteId: newNote.id,
          startX: canvasX,
          startBeat: snappedBeat,
          pitch,
        };
        requestRedraw();
        return;
      }

      // ── Select mode ──────────────────────────────────────────────────────────

      if (hitNoteId && hitZone === 'move') {
        const { selectedNoteIds } = state;
        let toMove: NoteId[];

        if (e.shiftKey) {
          // Shift-click: toggle this note in the selection, then move selection.
          toMove = selectedNoteIds.includes(hitNoteId)
            ? selectedNoteIds.filter((id) => id !== hitNoteId)
            : [...selectedNoteIds, hitNoteId];
        } else {
          toMove = selectedNoteIds.includes(hitNoteId)
            ? selectedNoteIds
            : [hitNoteId];
        }

        usePianoRollStore.getState().selectNotes(toMove);

        const originalPositions = new Map(
          notes
            .filter((n) => toMove.includes(n.id))
            .map((n) => [n.id, { startBeats: n.startBeats, pitch: n.pitch }]),
        );

        interaction.current = {
          kind: 'moving',
          noteIds: toMove,
          startX: canvasX,
          startY: canvasY,
          originalPositions,
        };
        return;
      }

      // Empty canvas area in select mode → rubber-band selection.
      if (!e.shiftKey) {
        usePianoRollStore.getState().clearSelection();
      }

      interaction.current = {
        kind: 'selecting',
        startX: canvasX,
        startY: canvasY,
        currentX: canvasX,
        currentY: canvasY,
      };
    },
    [canvasRef, requestRedraw],
  );

  // ---------------------------------------------------------------------------
  // Pointer move
  // ---------------------------------------------------------------------------

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cur = interaction.current;
      if (cur.kind === 'idle') return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const state = usePianoRollStore.getState();
      const { viewport, quantDiv } = state;

      if (cur.kind === 'drawing') {
        const rawBeat = xToBeat(canvasX, viewport);
        const snappedBeat = snapBeat(rawBeat, quantDiv);
        const gridSize = 4 / quantDiv;
        const newDuration = Math.max(gridSize, snappedBeat - cur.startBeat + gridSize);

        // Update store optimistically for live preview.
        usePianoRollStore.getState().resizeNote(cur.noteId, newDuration);
        requestRedraw();
        return;
      }

      if (cur.kind === 'resizing') {
        const rawBeat = xToBeat(canvasX, viewport);
        const snappedBeat = snapBeat(rawBeat, quantDiv);
        const note = state.notes.find((n) => n.id === cur.noteId);
        if (!note) return;

        const startBeat = note.startBeats;
        const gridSize = 4 / quantDiv;
        const newDuration = Math.max(gridSize, snappedBeat - startBeat + gridSize);

        usePianoRollStore.getState().resizeNote(cur.noteId, newDuration);
        requestRedraw();
        return;
      }

      if (cur.kind === 'moving') {
        const deltaX = canvasX - cur.startX;
        const deltaY = canvasY - cur.startY;
        const deltaBeat = deltaX / viewport.pixelsPerBeat;
        const deltaPitch = -Math.round(deltaY / viewport.pixelsPerSemitone);

        const moves = cur.noteIds.map((id) => {
          const orig = cur.originalPositions.get(id);
          if (!orig) return { id, startBeats: 0, pitch: 0 };
          const rawBeat = orig.startBeats + deltaBeat;
          const snappedBeat = snapBeat(Math.max(0, rawBeat), quantDiv);
          const newPitch = Math.min(127, Math.max(0, orig.pitch + deltaPitch));
          return { id, startBeats: snappedBeat, pitch: newPitch };
        });

        usePianoRollStore.getState().moveNotes(moves);
        requestRedraw();
        return;
      }

      if (cur.kind === 'selecting') {
        // Update rubber-band rectangle position.
        interaction.current = {
          ...cur,
          currentX: canvasX,
          currentY: canvasY,
        };
        requestRedraw();
      }
    },
    [canvasRef, requestRedraw],
  );

  // ---------------------------------------------------------------------------
  // Pointer up
  // ---------------------------------------------------------------------------

  const onPointerUp = useCallback(() => {
    const cur = interaction.current;
    interaction.current = { kind: 'idle' };

    if (cur.kind === 'idle') return;

    const state = usePianoRollStore.getState();

    if (cur.kind === 'drawing') {
      // Commit AddNoteCommand — note already exists in the store.
      const note = state.notes.find((n) => n.id === cur.noteId);
      if (note) {
        // Remove the note added optimistically in onPointerDown,
        // then let the command's execute() re-add it so redo works correctly.
        usePianoRollStore.getState().removeNotes([note.id]);
        push(new AddNoteCommand(note)); // push calls execute → re-adds the note
      }
      requestRedraw();
      return;
    }

    if (cur.kind === 'resizing') {
      const note = state.notes.find((n) => n.id === cur.noteId);
      if (note && note.durationBeats !== cur.originalDuration) {
        // The store already has the new duration. Record undo data.
        push(new ResizeNoteCommand(cur.noteId, cur.originalDuration, note.durationBeats));
      }
      requestRedraw();
      return;
    }

    if (cur.kind === 'moving') {
      // Build before/after arrays from original positions and current store state.
      const before = Array.from(cur.originalPositions.entries()).map(
        ([id, pos]) => ({ id, ...pos }),
      );
      const after = state.notes
        .filter((n) => cur.noteIds.includes(n.id))
        .map((n) => ({ id: n.id, startBeats: n.startBeats, pitch: n.pitch }));

      // Only push if something actually moved.
      const changed = after.some((a) => {
        const b = before.find((x) => x.id === a.id);
        return b && (b.startBeats !== a.startBeats || b.pitch !== a.pitch);
      });

      if (changed) {
        // The store already has the new positions from the live preview. Push a
        // command that on execute() applies `after` and on undo() restores `before`.
        // We must NOT call moveNotes again on push, so we use a command where
        // execute() re-applies `after` (idempotent if store is already there).
        push(new MoveNotesCommand(before, after));
      }
      requestRedraw();
      return;
    }

    if (cur.kind === 'selecting') {
      // Compute rubber-band bounds in canvas space.
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { viewport } = state;
      const minX = Math.min(cur.startX, cur.currentX);
      const maxX = Math.max(cur.startX, cur.currentX);
      const minY = Math.min(cur.startY, cur.currentY);
      const maxY = Math.max(cur.startY, cur.currentY);

      // Convert to beat/pitch ranges.
      const minBeat = minX / viewport.pixelsPerBeat + viewport.scrollX / viewport.pixelsPerBeat;
      const maxBeat = maxX / viewport.pixelsPerBeat + viewport.scrollX / viewport.pixelsPerBeat;
      const maxPitchFromTop = Math.round(
        127 - (minY + viewport.scrollY) / viewport.pixelsPerSemitone,
      );
      const minPitchFromBottom = Math.round(
        127 - (maxY + viewport.scrollY) / viewport.pixelsPerSemitone,
      );

      const selected = state.notes
        .filter(
          (n) =>
            n.startBeats + n.durationBeats >= minBeat &&
            n.startBeats <= maxBeat &&
            n.pitch >= minPitchFromBottom &&
            n.pitch <= maxPitchFromTop,
        )
        .map((n) => n.id);

      usePianoRollStore.getState().selectNotes(selected);
      requestRedraw();
    }
  }, [canvasRef, push, requestRedraw]);

  // ---------------------------------------------------------------------------
  // Expose current interaction for the grid renderer (rubber band overlay)
  // ---------------------------------------------------------------------------

  return {
    interaction,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
