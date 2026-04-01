import React, { useCallback, useRef, useState } from 'react';
import { useFadeStore } from '../../stores/fadeStore';
import type { FadeCurveType } from '../../stores/fadeStore';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Horizontal drag sensitivity: pixels of drag per sample change. */
const PX_PER_SAMPLE = 0.002;

/** Maximum fade-in or fade-out length in samples (≈10 s at 44.1 kHz). */
const MAX_FADE_SAMPLES = 441000;

const CURVE_LABELS: Record<FadeCurveType, string> = {
  linear:          'Linear',
  exponential_in:  'Exp In',
  exponential_out: 'Exp Out',
  s_curve:         'S-Curve',
  logarithmic:     'Logarithmic',
};

const ALL_CURVES: FadeCurveType[] = [
  'linear', 'exponential_in', 'exponential_out', 's_curve', 'logarithmic',
];

// ── Props ──────────────────────────────────────────────────────────────────────

interface FadeHandleProps {
  clipId: string;
  /** 'in' handle sits at the left edge; 'out' handle sits at the right edge. */
  kind: 'in' | 'out';
  /** Absolute x pixel position of the handle on the canvas overlay. */
  x: number;
  /** Absolute y pixel position of the top of the clip row. */
  y: number;
  /** Height of the clip row in pixels. */
  height: number;
  /** Current fade length in samples (for display). */
  fadeSamples: number;
  /** Current pixels-per-bar ratio (for drag-to-sample conversion). */
  pixelsPerBar: number;
  /** Bars per second at current tempo — used to convert drag px → samples. */
  samplesPerBar: number;
}

/**
 * A draggable triangle fade handle rendered as a small absolutely-positioned
 * div overlay on top of the timeline canvas.
 *
 * - Horizontal drag sets fade length.
 * - Double-click resets fade to 0.
 * - Right-click opens a context menu for curve type selection.
 */
const FadeHandle: React.FC<FadeHandleProps> = ({
  clipId, kind, x, y, height, fadeSamples, pixelsPerBar, samplesPerBar,
}) => {
  const fade = useFadeStore((s) => s.fades[clipId]);
  const setFadeIn  = useFadeStore((s) => s.setFadeIn);
  const setFadeOut = useFadeStore((s) => s.setFadeOut);
  const setCurve   = useFadeStore((s) => s.setCurveType);

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const dragStartSamples = useRef<number>(0);

  const currentCurve: FadeCurveType =
    kind === 'in'
      ? (fade?.fadeInCurve ?? 'linear')
      : (fade?.fadeOutCurve ?? 'linear');

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    dragStartSamples.current = fadeSamples;
  }, [fadeSamples]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartX.current === null) return;
    // For fade-in: drag right = longer fade; for fade-out: drag left = longer fade
    const deltaX = kind === 'in'
      ? e.clientX - dragStartX.current
      : dragStartX.current - e.clientX;

    const deltaSamples = (deltaX / pixelsPerBar) * samplesPerBar;
    const newSamples = Math.max(0, Math.min(MAX_FADE_SAMPLES,
      Math.round(dragStartSamples.current + deltaSamples)));

    if (kind === 'in') setFadeIn(clipId, newSamples, currentCurve);
    else setFadeOut(clipId, newSamples, currentCurve);
  }, [kind, pixelsPerBar, samplesPerBar, currentCurve, clipId, setFadeIn, setFadeOut]);

  const onPointerUp = useCallback(() => {
    dragStartX.current = null;
  }, []);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (kind === 'in') setFadeIn(clipId, 0, currentCurve);
    else setFadeOut(clipId, 0, currentCurve);
  }, [kind, clipId, currentCurve, setFadeIn, setFadeOut]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuOpen(true);
  }, []);

  const selectCurve = useCallback((curve: FadeCurveType) => {
    setCurve(clipId, kind, curve);
    setContextMenuOpen(false);
  }, [clipId, kind, setCurve]);

  // Triangle dimensions
  const TRI = 10; // px
  // For fade-in the triangle points right (→); for fade-out it points left (←)
  const points =
    kind === 'in'
      ? `0,0 ${TRI},${height / 2} 0,${height}`
      : `${TRI},0 0,${height / 2} ${TRI},${height}`;

  return (
    <>
      <svg
        data-testid={`fade-handle-${kind}`}
        style={{
          position: 'absolute',
          left: kind === 'in' ? x - TRI : x,
          top: y,
          width: TRI,
          height,
          cursor: 'ew-resize',
          zIndex: 10,
          pointerEvents: 'all',
          overflow: 'visible',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <polygon
          points={points}
          fill={fadeSamples > 0 ? 'rgba(99,179,237,0.85)' : 'rgba(255,255,255,0.25)'}
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={0.5}
        />
        {fadeSamples > 0 && (
          <title>{`Fade ${kind}: ${Math.round(fadeSamples / 44.1)} ms`}</title>
        )}
      </svg>

      {/* Curve type context menu */}
      {contextMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenuOpen(false)}
          />
          <div
            className="fixed z-50 bg-[#2a2a2a] border border-[#444] rounded shadow-lg py-1 text-xs font-mono text-[#cccccc]"
            style={{ left: kind === 'in' ? x + TRI : x - 90, top: y + height }}
            data-testid={`fade-curve-menu-${kind}`}
          >
            <div className="px-3 py-0.5 text-[10px] text-[#666] uppercase tracking-wide">
              Curve type
            </div>
            {ALL_CURVES.map((c) => (
              <button
                key={c}
                data-testid={`fade-curve-option-${c}`}
                className={[
                  'block w-full px-4 py-1 text-left hover:bg-[#3a3a3a]',
                  c === currentCurve ? 'text-[#5b8def]' : '',
                ].join(' ')}
                onClick={() => selectCurve(c)}
              >
                {CURVE_LABELS[c]}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
};

export default FadeHandle;
