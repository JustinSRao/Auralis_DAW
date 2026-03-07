/**
 * PianoRoll — full-screen modal overlay for MIDI note editing.
 *
 * Triggered by double-clicking a track header in the DAW shell.
 * Integrates with the global undo/redo history (Sprint 26) via
 * `usePianoRollState` and `useHistoryStore`.
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { usePianoRollStore } from '../../stores/pianoRollStore';
import { usePatternStore } from '../../stores/patternStore';
import { useHistoryStore } from '../../stores/historyStore';
import { usePianoRollState } from './usePianoRollState';
import { usePianoRollMouse } from './usePianoRollMouse';
import { PianoKeyboard } from './PianoKeyboard';
import { VelocityLane } from './VelocityLane';
import { getTransportState } from '../../lib/ipc';
import {
  beatToX,
  pitchToY,
  getVisibleNotes,
  NOTE_NAMES,
  isBlackKey,
} from './pianoRollUtils';
import type { EditMode, QuantDiv } from './pianoRollTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VELOCITY_LANE_HEIGHT = 80;
const NOTE_FILL = '#38bdf8';         // sky-400
const NOTE_FILL_SELECTED = '#7dd3fc'; // sky-300
const MIN_LABEL_WIDTH = 20;          // px — label shown only when note is wide enough

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PianoRoll() {
  // ── Store slices ──────────────────────────────────────────────────────────
  const { isOpen, activeTrackId, notes, selectedNoteIds, viewport, mode, quantDiv } =
    usePianoRollState();
  const store = usePianoRollStore();
  const { undo, redo } = useHistoryStore();
  const activePatternId = usePianoRollStore((s) => s.activePatternId);
  const activePattern = usePatternStore((s) =>
    activePatternId ? s.patterns[activePatternId] : null,
  );
  const { deleteSelectedNotes, pasteAtBeat } = usePianoRollState();

  // ── Canvas refs ───────────────────────────────────────────────────────────
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const noteCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stable ref to the latest drawNoteCanvas so requestRedraw never closes
  // over a stale version of the function (notes/viewport change its identity).
  const drawNoteCanvasRef = useRef<() => void>(() => undefined);

  // ── Canvas dimensions (updated by ResizeObserver) ─────────────────────────
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // ── Playhead position (in beats, from transport) ──────────────────────────
  const playheadBeat = useRef(0);

  // ---------------------------------------------------------------------------
  // Mouse state machine
  // ---------------------------------------------------------------------------

  // Always delegates through the ref so the mouse hook always invokes the
  // current draw function regardless of when its own useCallback was created.
  const requestRedraw = useCallback(() => {
    drawNoteCanvasRef.current();
  }, []);

  const { interaction, onPointerDown, onPointerMove, onPointerUp } =
    usePianoRollMouse({ canvasRef: noteCanvasRef, requestRedraw });

  // ---------------------------------------------------------------------------
  // ResizeObserver — keep canvas dimensions in sync with container
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // Draw: background grid
  // ---------------------------------------------------------------------------

  const drawGridCanvas = useCallback(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const { scrollX, scrollY, pixelsPerBeat, pixelsPerSemitone } = viewport;

    // Background fill
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    // ── Semitone rows ──────────────────────────────────────────────────────
    const topPitch = Math.min(127, Math.ceil(127 - scrollY / pixelsPerSemitone));
    const bottomPitch = Math.max(0, Math.floor(127 - (scrollY + h) / pixelsPerSemitone));

    for (let pitch = bottomPitch; pitch <= topPitch; pitch++) {
      const y = (127 - pitch) * pixelsPerSemitone - scrollY;
      ctx.fillStyle = isBlackKey(pitch) ? '#222222' : '#1a1a1a';
      ctx.fillRect(0, y, w, pixelsPerSemitone);
      // Row border
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // ── Beat / bar lines ──────────────────────────────────────────────────
    const firstBeat = Math.floor(scrollX / pixelsPerBeat);
    const lastBeat = Math.ceil((scrollX + w) / pixelsPerBeat);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '9px monospace';

    for (let beat = firstBeat; beat <= lastBeat; beat++) {
      const x = beat * pixelsPerBeat - scrollX;
      const isBar = beat % 4 === 0;

      ctx.strokeStyle = isBar ? '#3a3a3a' : '#2a2a2a';
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      // Bar number label at bar lines
      if (isBar && pixelsPerBeat * 4 > 30) {
        ctx.fillStyle = '#555';
        ctx.fillText(String(beat / 4 + 1), x + 2, 2);
      }
    }
  }, [viewport]);

  // ---------------------------------------------------------------------------
  // Draw: notes + rubber band
  // ---------------------------------------------------------------------------

  const drawNoteCanvas = useCallback(() => {
    const canvas = noteCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const visible = getVisibleNotes(notes, viewport, w, h);

    for (const note of visible) {
      const x = beatToX(note.startBeats, viewport);
      const y = pitchToY(note.pitch, viewport);
      const nw = note.durationBeats * viewport.pixelsPerBeat;
      const nh = viewport.pixelsPerSemitone - 1;

      const selected = selectedNoteIds.includes(note.id);
      ctx.fillStyle = selected ? NOTE_FILL_SELECTED : NOTE_FILL;
      ctx.fillRect(x, y, nw, nh);

      // Note label
      if (nw > MIN_LABEL_WIDTH) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.font = `${Math.max(8, viewport.pixelsPerSemitone - 3)}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(NOTE_NAMES[note.pitch % 12], x + 2, y + nh - 1);
      }
    }

    // ── Rubber-band selection overlay ─────────────────────────────────────
    const cur = interaction.current;
    if (cur.kind === 'selecting') {
      const rx = Math.min(cur.startX, cur.currentX);
      const ry = Math.min(cur.startY, cur.currentY);
      const rw = Math.abs(cur.currentX - cur.startX);
      const rh = Math.abs(cur.currentY - cur.startY);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(56,189,248,0.15)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }

    // ── Playhead ──────────────────────────────────────────────────────────
    const phX = beatToX(playheadBeat.current, viewport);
    if (phX >= 0 && phX <= w) {
      ctx.strokeStyle = '#f87171'; // red-400
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, h);
      ctx.stroke();
    }
  }, [notes, selectedNoteIds, viewport, interaction]);

  // Keep the ref current so requestRedraw always calls the latest version.
  useEffect(() => {
    drawNoteCanvasRef.current = drawNoteCanvas;
  }, [drawNoteCanvas]);

  // Redraw both canvases when relevant state changes.
  useEffect(() => {
    drawGridCanvas();
  }, [drawGridCanvas, canvasSize]);

  useEffect(() => {
    drawNoteCanvas();
  }, [drawNoteCanvas, canvasSize]);

  // ---------------------------------------------------------------------------
  // Playhead polling (~30 Hz while open)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    let lastBeat = -1;

    const poll = () => {
      void getTransportState().then((snap) => {
        // Convert sample position to beats: bbt gives us bars/beats/ticks
        // Use bbt.bar and bbt.beat for a coarse beat estimate.
        const beatPos = (snap.bbt.bar - 1) * snap.time_sig_numerator + (snap.bbt.beat - 1);
        if (beatPos !== lastBeat) {
          playheadBeat.current = beatPos;
          lastBeat = beatPos;
          drawNoteCanvasRef.current();
        }
      });
      timerId = setTimeout(poll, 33);
    };

    poll();
    return () => clearTimeout(timerId);
  }, [isOpen]);

  // ---------------------------------------------------------------------------
  // Wheel — scroll and zoom
  // ---------------------------------------------------------------------------

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey) {
        // Zoom: Ctrl+wheel changes pixelsPerBeat
        const delta = -e.deltaY * 0.5;
        const newPpb = Math.min(400, Math.max(20, viewport.pixelsPerBeat + delta));
        store.setViewport({ pixelsPerBeat: newPpb });
      } else if (e.shiftKey) {
        // Horizontal scroll
        store.setViewport({ scrollX: Math.max(0, viewport.scrollX + e.deltaY) });
      } else {
        // Vertical scroll
        const maxScrollY = 127 * viewport.pixelsPerSemitone;
        store.setViewport({
          scrollY: Math.max(0, Math.min(maxScrollY, viewport.scrollY + e.deltaY)),
        });
      }
    },
    [viewport, store],
  );

  // ---------------------------------------------------------------------------
  // Close handler — saves pattern notes before closing
  // ---------------------------------------------------------------------------

  const handleClose = useCallback(() => {
    const currentPatternId = usePianoRollStore.getState().activePatternId;
    if (currentPatternId !== null) {
      const currentNotes = usePianoRollStore.getState().notes;
      usePatternStore.getState().updatePatternNotes(currentPatternId, currentNotes);
    }
    store.close();
  }, [store]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Don't intercept while typing in an input.
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedNotes();
        return;
      }

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo();
        return;
      }

      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        store.copySelection();
        return;
      }

      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        pasteAtBeat(playheadBeat.current);
        return;
      }
    },
    [deleteSelectedNotes, undo, redo, store, pasteAtBeat, handleClose],
  );

  // ---------------------------------------------------------------------------
  // Quantization label helper
  // ---------------------------------------------------------------------------

  function quantLabel(q: QuantDiv): string {
    return `1/${q}`;
  }

  // ---------------------------------------------------------------------------
  // Early return when not open
  // ---------------------------------------------------------------------------

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const noteCanvasH = canvasSize.h;
  const noteCanvasW = canvasSize.w;

  return (
    /* Focus-trap wrapper so keyboard shortcuts work without focus on a child */
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#1a1a1a] outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Piano Roll Editor"
      aria-modal="true"
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-10 bg-[#242424] border-b border-[#3a3a3a] flex-shrink-0">
        <span className="text-xs font-mono text-[#aaa] font-semibold">
          {activePattern
            ? `PIANO ROLL — ${activePattern.name}`
            : `PIANO ROLL${activeTrackId ? ` — track ${activeTrackId.slice(0, 8)}` : ''}`}
        </span>

        <div className="w-px h-4 bg-[#3a3a3a]" />

        {/* Mode toggle */}
        {(['draw', 'select'] as EditMode[]).map((m) => (
          <button
            key={m}
            onClick={() => store.setMode(m)}
            className={[
              'px-2 py-0.5 text-[10px] font-mono rounded transition-colors',
              mode === m
                ? 'bg-[#38bdf8] text-black'
                : 'bg-[#333] text-[#888] hover:text-[#ccc]',
            ].join(' ')}
          >
            {m === 'draw' ? 'DRAW' : 'SELECT'}
          </button>
        ))}

        <div className="w-px h-4 bg-[#3a3a3a]" />

        {/* Quantization */}
        <label className="text-[10px] text-[#666] font-mono">SNAP</label>
        <select
          value={quantDiv}
          onChange={(e) => store.setQuantDiv(Number(e.target.value) as QuantDiv)}
          className="bg-[#2d2d2d] border border-[#444] text-[10px] text-[#ccc] rounded px-1 py-0.5 font-mono"
        >
          {([4, 8, 16, 32] as QuantDiv[]).map((q) => (
            <option key={q} value={q}>
              {quantLabel(q)}
            </option>
          ))}
        </select>

        <div className="w-px h-4 bg-[#3a3a3a]" />

        {/* Zoom slider */}
        <label className="text-[10px] text-[#666] font-mono">ZOOM</label>
        <input
          type="range"
          min={20}
          max={400}
          value={viewport.pixelsPerBeat}
          onChange={(e) =>
            store.setViewport({ pixelsPerBeat: Number(e.target.value) })
          }
          className="w-20 accent-[#38bdf8]"
          aria-label="Horizontal zoom"
        />

        <div className="flex-1" />

        {/* Close */}
        <button
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center rounded text-[#888] hover:text-white hover:bg-[#3a3a3a] transition-colors text-sm font-mono"
          aria-label="Close Piano Roll"
        >
          X
        </button>
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Piano keyboard (fixed width) */}
        <PianoKeyboard
          viewport={viewport}
          canvasHeight={Math.max(1, noteCanvasH)}
        />

        {/* Canvas stack + velocity lane */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Stacked canvases — grid beneath notes */}
          <div
            ref={containerRef}
            className="relative flex-1 overflow-hidden"
            onWheel={handleWheel}
          >
            {/* Grid canvas */}
            <canvas
              ref={gridCanvasRef}
              width={noteCanvasW}
              height={noteCanvasH}
              style={{
                position: 'absolute',
                inset: 0,
                width: noteCanvasW,
                height: noteCanvasH,
              }}
            />
            {/* Note canvas (transparent background, receives pointer events) */}
            <canvas
              ref={noteCanvasRef}
              width={noteCanvasW}
              height={noteCanvasH}
              style={{
                position: 'absolute',
                inset: 0,
                width: noteCanvasW,
                height: noteCanvasH,
                cursor: mode === 'draw' ? 'crosshair' : 'default',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </div>

          {/* Velocity lane */}
          <div className="flex-shrink-0" style={{ height: VELOCITY_LANE_HEIGHT }}>
            <VelocityLane
              notes={notes}
              selectedNoteIds={selectedNoteIds}
              viewport={viewport}
              canvasWidth={Math.max(1, noteCanvasW)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
