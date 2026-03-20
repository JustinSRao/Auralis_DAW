/**
 * TempoTrack — canvas-based tempo automation lane for the Timeline.
 *
 * Rendered as the topmost lane in the arrangement view, above all tracks.
 * The canvas x-axis maps bars (via pixelsPerBar/scrollLeft) and the y-axis
 * maps BPM in [20, 300].
 *
 * Interactions (using setPointerCapture for reliable drag behaviour):
 *   - Click on empty area  → add a new Step point
 *   - Drag an existing point → move its tick (x) and BPM (y); commit on pointer-up
 *   - tick-0 point → vertical drag only (BPM changes, tick stays 0)
 *   - Right-click on point → context menu: Set Linear / Set Step / Delete
 *                            (Delete is disabled for tick-0)
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useTempoMapStore, type TempoPoint } from '../../stores/tempoMapStore';
import { useTransportStore } from '../../stores/transportStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BPM_MIN = 20;
const BPM_MAX = 300;
const TICKS_PER_BEAT = 480; // Must match transport::TICKS_PER_BEAT (480 PPQ)

/** BPM grid-lines drawn across the canvas. */
const BPM_GRIDLINES = [60, 80, 100, 120, 140, 160, 180, 200, 240, 300];

/** Radius of a tempo point circle in pixels. */
const POINT_RADIUS = 5;

/** How close (px) the pointer must be to a point to "hit" it. */
const HIT_TOLERANCE = 8;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TempoTrackProps {
  width: number;
  height: number;
  scrollLeft: number;
  pixelsPerBar: number;
  beatsPerBar: number;
  totalBars: number;
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function bpmToY(bpm: number, height: number): number {
  const t = (BPM_MAX - bpm) / (BPM_MAX - BPM_MIN);
  return t * height;
}

function yToBpm(y: number, height: number): number {
  const t = y / height;
  return BPM_MAX - t * (BPM_MAX - BPM_MIN);
}

function tickToBar(tick: number, beatsPerBar: number): number {
  return tick / (TICKS_PER_BEAT * beatsPerBar);
}

function barToTick(bar: number, beatsPerBar: number): number {
  return Math.round(bar * TICKS_PER_BEAT * beatsPerBar);
}

function barToX(bar: number, scrollLeft: number, pixelsPerBar: number): number {
  return bar * pixelsPerBar - scrollLeft;
}

function xToBar(x: number, scrollLeft: number, pixelsPerBar: number): number {
  return Math.max(0, (x + scrollLeft) / pixelsPerBar);
}

// ---------------------------------------------------------------------------
// Context menu state
// ---------------------------------------------------------------------------

interface ContextMenuState {
  x: number;
  y: number;
  tick: number;
  interp: 'Step' | 'Linear';
}

// ---------------------------------------------------------------------------
// Drag state (stored in ref — no re-renders during drag)
// ---------------------------------------------------------------------------

type DragState =
  | { kind: 'idle' }
  | {
      kind: 'dragging';
      pointTick: number;
      isAnchor: boolean;
      pendingTick: number;
      pendingBpm: number;
    };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TempoTrack({
  width,
  height,
  scrollLeft,
  pixelsPerBar,
  beatsPerBar,
  totalBars,
}: TempoTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawFnRef = useRef<() => void>(() => undefined);
  const dragRef = useRef<DragState>({ kind: 'idle' });

  const points = useTempoMapStore((s) => s.points);
  const { setPoint, deletePoint, setInterpMode } = useTempoMapStore.getState();

  const playheadSamples = useTransportStore((s) => s.snapshot.position_samples);
  const bpmFromSnap = useTransportStore((s) => s.snapshot.bpm);
  // Derive playhead bar: approximate using current BPM
  const playheadBar =
    bpmFromSnap > 0
      ? (playheadSamples / 44100 / 60) * bpmFromSnap / beatsPerBar
      : 0;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // -------------------------------------------------------------------------
  // Draw function (stored in ref to avoid stale closures)
  // -------------------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // BPM grid lines
    for (const gridBpm of BPM_GRIDLINES) {
      const y = Math.round(bpmToY(gridBpm, height));
      ctx.strokeStyle = gridBpm === 120 ? '#444466' : '#2a2a3a';
      ctx.lineWidth = gridBpm === 120 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Label
      ctx.fillStyle = '#555577';
      ctx.font = '9px monospace';
      ctx.fillText(String(gridBpm), 2, y - 2);
    }

    // Playhead vertical line
    const phX = barToX(playheadBar, scrollLeft, pixelsPerBar);
    if (phX >= 0 && phX <= width) {
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, height);
      ctx.stroke();
    }

    // Segments between points
    if (points.length > 0) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const x = barToX(tickToBar(p.tick, beatsPerBar), scrollLeft, pixelsPerBar);
        const y = bpmToY(p.bpm, height);

        if (i < points.length - 1) {
          const pNext = points[i + 1];
          const xNext = barToX(tickToBar(pNext.tick, beatsPerBar), scrollLeft, pixelsPerBar);
          const yNext = bpmToY(pNext.bpm, height);

          ctx.strokeStyle = '#6c63ff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y);

          if (p.interp === 'Step') {
            // Horizontal then vertical jump
            ctx.lineTo(xNext, y);
            ctx.lineTo(xNext, yNext);
          } else {
            // Linear diagonal
            ctx.lineTo(xNext, yNext);
          }
          ctx.stroke();
        } else {
          // Extend last segment to the right edge
          const xEnd = barToX(totalBars, scrollLeft, pixelsPerBar);
          ctx.strokeStyle = '#6c63ff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(Math.min(xEnd, width + 10), y);
          ctx.stroke();
        }
      }

      // Draw circles on top of segments
      for (const p of points) {
        const x = barToX(tickToBar(p.tick, beatsPerBar), scrollLeft, pixelsPerBar);
        const y = bpmToY(p.bpm, height);
        ctx.beginPath();
        ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = p.tick === 0 ? '#ff9900' : '#6c63ff';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [points, width, height, scrollLeft, pixelsPerBar, beatsPerBar, totalBars, playheadBar]);

  // Store draw fn in ref so event listeners can call the latest version
  useEffect(() => {
    drawFnRef.current = draw;
  }, [draw]);

  // Redraw when dependencies change
  useEffect(() => {
    drawFnRef.current();
  }, [points, width, height, scrollLeft, pixelsPerBar, beatsPerBar, playheadBar]);

  // -------------------------------------------------------------------------
  // Hit test: find which point (if any) is under (x, y)
  // -------------------------------------------------------------------------

  function hitTestPoint(x: number, y: number): TempoPoint | null {
    for (const p of points) {
      const px = barToX(tickToBar(p.tick, beatsPerBar), scrollLeft, pixelsPerBar);
      const py = bpmToY(p.bpm, height);
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist <= HIT_TOLERANCE) return p;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Pointer events
  // -------------------------------------------------------------------------

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button === 2) return; // right-click handled separately
    setContextMenu(null);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTestPoint(x, y);

    if (hit) {
      // Start dragging
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: 'dragging',
        pointTick: hit.tick,
        isAnchor: hit.tick === 0,
        pendingTick: hit.tick,
        pendingBpm: hit.bpm,
      };
    } else {
      // Add new point
      const bar = xToBar(x, scrollLeft, pixelsPerBar);
      const tick = barToTick(bar, beatsPerBar);
      const bpm = Math.round(yToBpm(y, height));
      const clamped = Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));
      void setPoint(tick, clamped, 'Step');
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag.kind !== 'dragging') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, yToBpm(y, height)));

    if (drag.isAnchor) {
      // Anchor point: only BPM changes
      dragRef.current = { ...drag, pendingBpm: bpm };
    } else {
      const bar = xToBar(x, scrollLeft, pixelsPerBar);
      const tick = Math.max(1, barToTick(bar, beatsPerBar));
      dragRef.current = { ...drag, pendingTick: tick, pendingBpm: bpm };
    }

    // Redraw optimistically during drag
    drawFnRef.current();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag.kind !== 'dragging') return;

    e.currentTarget.releasePointerCapture(e.pointerId);

    // Commit: delete old tick if moved, then upsert new position
    const originalTick = drag.pointTick;
    const newTick = drag.isAnchor ? 0 : drag.pendingTick;
    const newBpm = drag.pendingBpm;

    const existing = points.find((p) => p.tick === originalTick);
    const interp = existing?.interp ?? 'Step';

    if (!drag.isAnchor && newTick !== originalTick) {
      // Remove old point, add at new tick
      void deletePoint(originalTick).then(() =>
        void setPoint(newTick, newBpm, interp)
      );
    } else {
      void setPoint(newTick, newBpm, interp);
    }

    dragRef.current = { kind: 'idle' };
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTestPoint(x, y);
    if (hit) {
      setContextMenu({ x: e.clientX, y: e.clientY, tick: hit.tick, interp: hit.interp });
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ position: 'relative', width, height }}>
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor: 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        aria-label="Tempo track"
      />

      {/* "TEMPO" label overlay */}
      <div
        style={{
          position: 'absolute',
          top: 2,
          right: 6,
          fontSize: 9,
          fontFamily: 'monospace',
          color: '#888',
          pointerEvents: 'none',
          userSelect: 'none',
          letterSpacing: 1,
        }}
      >
        TEMPO
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: 4,
            zIndex: 1000,
            fontSize: 12,
            color: '#e0e0e0',
            minWidth: 120,
          }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {contextMenu.interp === 'Step' ? (
            <button
              style={menuItemStyle}
              onClick={() => {
                void setInterpMode(contextMenu.tick, 'Linear');
                setContextMenu(null);
              }}
            >
              Set Linear
            </button>
          ) : (
            <button
              style={menuItemStyle}
              onClick={() => {
                void setInterpMode(contextMenu.tick, 'Step');
                setContextMenu(null);
              }}
            >
              Set Step
            </button>
          )}
          <button
            style={{
              ...menuItemStyle,
              opacity: contextMenu.tick === 0 ? 0.4 : 1,
              cursor: contextMenu.tick === 0 ? 'not-allowed' : 'pointer',
            }}
            disabled={contextMenu.tick === 0}
            onClick={() => {
              if (contextMenu.tick !== 0) {
                void deletePoint(contextMenu.tick);
              }
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  background: 'none',
  border: 'none',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 12,
};
