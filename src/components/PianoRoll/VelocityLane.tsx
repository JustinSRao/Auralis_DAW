/**
 * VelocityLane — 80 px tall canvas strip below the note grid.
 *
 * Draws a vertical bar for each visible note proportional to its velocity.
 * Dragging a bar updates the note's velocity in real time; releasing commits
 * a `SetVelocityCommand` to the global undo history.
 */

import { useRef, useEffect, useCallback } from 'react';
import { usePianoRollStore } from '../../stores/pianoRollStore';
import { SetVelocityCommand } from '../../lib/commands/PianoRollCommands';
import { useHistoryStore } from '../../stores/historyStore';
import { beatToX, getVisibleNotes } from './pianoRollUtils';
import type { MidiNote, NoteId, Viewport } from './pianoRollTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANE_HEIGHT = 80;
const NOTE_COLOR = '#38bdf8';       // sky-400 — matches note fill
const NOTE_COLOR_SELECTED = '#7dd3fc'; // sky-300

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VelocityLaneProps {
  notes: MidiNote[];
  selectedNoteIds: NoteId[];
  viewport: Viewport;
  canvasWidth: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VelocityLane({
  notes,
  selectedNoteIds,
  viewport,
  canvasWidth,
}: VelocityLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const push = useHistoryStore((s) => s.push);

  // Drag state — refs to avoid re-renders during drag.
  const dragNoteId = useRef<NoteId | null>(null);
  const dragStartY = useRef(0);
  const dragBeforeVelocity = useRef(0);

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);

    // Top border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.stroke();

    const visible = getVisibleNotes(notes, viewport, w, h + LANE_HEIGHT);

    for (const note of visible) {
      const x = beatToX(note.startBeats, viewport);
      const barW = Math.max(2, note.durationBeats * viewport.pixelsPerBeat - 1);
      const barH = Math.max(2, (note.velocity / 127) * (h - 4));

      const selected = selectedNoteIds.includes(note.id);
      ctx.fillStyle = selected ? NOTE_COLOR_SELECTED : NOTE_COLOR;
      ctx.fillRect(x, h - barH, barW, barH);
    }
  }, [notes, selectedNoteIds, viewport]);

  useEffect(() => {
    draw();
  }, [draw, canvasWidth]);

  // ---------------------------------------------------------------------------
  // Hit test — find note bar at a given canvas X coordinate
  // ---------------------------------------------------------------------------

  const hitTestBar = useCallback(
    (canvasX: number): NoteId | null => {
      const visible = getVisibleNotes(notes, viewport, canvasWidth, LANE_HEIGHT);
      // Reverse so the topmost bar wins.
      for (let i = visible.length - 1; i >= 0; i--) {
        const note = visible[i];
        const x = beatToX(note.startBeats, viewport);
        const barW = Math.max(2, note.durationBeats * viewport.pixelsPerBeat - 1);
        if (canvasX >= x && canvasX <= x + barW) {
          return note.id;
        }
      }
      return null;
    },
    [notes, viewport, canvasWidth],
  );

  // ---------------------------------------------------------------------------
  // Pointer handlers
  // ---------------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;

      const noteId = hitTestBar(canvasX);
      if (!noteId) return;

      const note = notes.find((n) => n.id === noteId);
      if (!note) return;

      canvas.setPointerCapture(e.pointerId);
      dragNoteId.current = noteId;
      dragStartY.current = e.clientY;
      dragBeforeVelocity.current = note.velocity;
    },
    [hitTestBar, notes],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragNoteId.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const canvasY = e.clientY - rect.top;

      // Map y position in the lane to velocity (top = 127, bottom = 1)
      const rawVelocity = Math.round(127 * (1 - canvasY / LANE_HEIGHT));
      const clamped = Math.max(1, Math.min(127, rawVelocity));

      // Update in real time (no history entry yet)
      usePianoRollStore.getState().setVelocity(dragNoteId.current, clamped);
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    const noteId = dragNoteId.current;
    if (!noteId) return;

    const note = usePianoRollStore.getState().notes.find((n) => n.id === noteId);
    if (note && note.velocity !== dragBeforeVelocity.current) {
      // Commit to history. We call push directly (not via usePianoRollState)
      // because this component has the before/after values already.
      push(new SetVelocityCommand(noteId, dragBeforeVelocity.current, note.velocity));
    }

    dragNoteId.current = null;
  }, [push]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={LANE_HEIGHT}
      style={{ width: canvasWidth, height: LANE_HEIGHT, display: 'block', cursor: 'ns-resize' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      aria-label="Velocity lane"
    />
  );
}
