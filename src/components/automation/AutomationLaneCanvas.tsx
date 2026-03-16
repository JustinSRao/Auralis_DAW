/**
 * Canvas editor for a single automation lane.
 *
 * X-axis: timeline ticks (0 → totalTicks), synced with the timeline's
 * scrollLeft and pixelsPerBar so lanes align with the clips above.
 * Y-axis: parameter value (0.0 bottom → 1.0 top).
 *
 * Interactions:
 *  - Left-click empty area → add control point with current interp mode
 *  - Left-click + drag on an existing point → move point
 *  - Right-click on a point → delete it
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import type { AutomationLaneData, AutomationInterp, ControlPointData } from '../../lib/ipc';
import { useAutomationStore } from '../../stores/automationStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POINT_RADIUS = 5;
const HIT_RADIUS = 8;
const LANE_HEIGHT = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tickToX(tick: number, scrollLeft: number, pixelsPerBar: number, beatsPerBar: number): number {
  const ticksPerBar = beatsPerBar * 480;
  return (tick / ticksPerBar) * pixelsPerBar - scrollLeft;
}

function xToTick(x: number, scrollLeft: number, pixelsPerBar: number, beatsPerBar: number): number {
  const ticksPerBar = beatsPerBar * 480;
  return Math.round(((x + scrollLeft) / pixelsPerBar) * ticksPerBar);
}

function valueToY(value: number, height: number): number {
  return height - value * height;
}

function yToValue(y: number, height: number): number {
  return Math.max(0, Math.min(1, 1 - y / height));
}

function snapTick(tick: number, beatsPerBar: number, quantDiv: number = 4): number {
  // Snap to nearest quantDiv subdivision (default: quarter note = 480/4 = 120 ticks)
  const snapTicks = (480 * beatsPerBar) / (beatsPerBar * quantDiv);
  return Math.round(tick / snapTicks) * snapTicks;
}

function interpolate(points: ControlPointData[], tick: number): number {
  if (points.length === 0) return 0;
  if (tick <= points[0].tick) return points[0].value;
  if (tick >= points[points.length - 1].tick) return points[points.length - 1].value;

  let lo = 0, hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].tick <= tick) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  const t = (tick - a.tick) / (b.tick - a.tick);

  switch (a.interp) {
    case 'Step': return a.value;
    case 'Exponential':
      if (a.value === 0 || b.value === 0 || (a.value > 0) !== (b.value > 0))
        return a.value + (b.value - a.value) * t;
      return a.value * Math.pow(b.value / a.value, t);
    default: return a.value + (b.value - a.value) * t;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  lane: AutomationLaneData;
  totalTicks: number;
  width: number;
  scrollLeft: number;
  pixelsPerBar: number;
  beatsPerBar: number;
  activeInterp: AutomationInterp;
}

export function AutomationLaneCanvas({
  lane,
  totalTicks,
  width,
  scrollLeft,
  pixelsPerBar,
  beatsPerBar,
  activeInterp,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { setPoint, deletePoint } = useAutomationStore.getState();

  // Drag state (no re-renders during drag)
  const dragRef = useRef<{ pointTick: number; startX: number; startY: number } | null>(null);
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { points } = lane;
    const h = LANE_HEIGHT;
    const w = width;

    // Background
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);

    // Grid: one line per bar
    const ticksPerBar = beatsPerBar * 480;
    const totalBars = Math.ceil(totalTicks / ticksPerBar);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    for (let bar = 0; bar <= totalBars; bar++) {
      const x = tickToX(bar * ticksPerBar, scrollLeft, pixelsPerBar, beatsPerBar);
      if (x < -1 || x > w + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal mid-line
    ctx.strokeStyle = '#2a2a2a';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (points.length === 0) return;

    // Curve fill + stroke
    ctx.beginPath();
    const steps = Math.min(w * 2, 512);
    let started = false;

    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const tick = xToTick(x, scrollLeft, pixelsPerBar, beatsPerBar);
      const val = interpolate(points, tick);
      const y = valueToY(val, h);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = lane.enabled ? '#5b8def' : '#555';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = lane.enabled ? 'rgba(91,141,239,0.12)' : 'rgba(85,85,85,0.08)';
    ctx.fill();

    // Control point circles
    for (const pt of points) {
      const x = tickToX(pt.tick, scrollLeft, pixelsPerBar, beatsPerBar);
      if (x < -POINT_RADIUS || x > w + POINT_RADIUS) continue;
      const y = valueToY(pt.value, h);
      const isHovered = hoveredTick === pt.tick;

      ctx.beginPath();
      ctx.arc(x, y, POINT_RADIUS + (isHovered ? 1 : 0), 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#ffffff' : (lane.enabled ? '#5b8def' : '#666');
      ctx.fill();
      ctx.strokeStyle = '#1e1e1e';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [lane, totalTicks, width, scrollLeft, pixelsPerBar, beatsPerBar, hoveredTick]);

  useEffect(() => { draw(); }, [draw]);

  // ---------------------------------------------------------------------------
  // Pointer events
  // ---------------------------------------------------------------------------

  function hitTestPoint(x: number, y: number): number | null {
    const h = LANE_HEIGHT;
    for (const pt of lane.points) {
      const px = tickToX(pt.tick, scrollLeft, pixelsPerBar, beatsPerBar);
      const py = valueToY(pt.value, h);
      if (Math.hypot(x - px, y - py) <= HIT_RADIUS) return pt.tick;
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.button === 2) return; // handled in contextmenu

    const hitTick = hitTestPoint(x, y);
    if (hitTick !== null) {
      dragRef.current = { pointTick: hitTick, startX: x, startY: y };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      // Add new point
      const tick = snapTick(
        xToTick(x, scrollLeft, pixelsPerBar, beatsPerBar),
        beatsPerBar,
      );
      const value = yToValue(y, LANE_HEIGHT);
      void setPoint(lane.patternId, lane.parameterId, tick, value, activeInterp);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const drag = dragRef.current;
    if (drag) {
      const newTick = Math.max(
        0,
        snapTick(
          xToTick(x, scrollLeft, pixelsPerBar, beatsPerBar),
          beatsPerBar,
        ),
      );
      const newValue = yToValue(y, LANE_HEIGHT);
      // Delete old point and add at new position
      if (newTick !== drag.pointTick) {
        void deletePoint(lane.patternId, lane.parameterId, drag.pointTick);
        drag.pointTick = newTick;
      }
      void setPoint(lane.patternId, lane.parameterId, newTick, newValue, activeInterp);
    } else {
      const hitTick = hitTestPoint(x, y);
      setHoveredTick(hitTick);
    }
  }

  function handlePointerUp(_e: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hitTick = hitTestPoint(x, y);
    if (hitTick !== null) {
      void deletePoint(lane.patternId, lane.parameterId, hitTick);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={LANE_HEIGHT}
      style={{ display: 'block', cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setHoveredTick(null)}
      onContextMenu={handleContextMenu}
      data-testid={`automation-canvas-${lane.parameterId}`}
    />
  );
}
