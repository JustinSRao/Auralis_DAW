import React, { useMemo } from 'react';
import type { FadeCurveType } from '../../stores/fadeStore';

// ── Curve math (mirrors Rust FadeTables formulas) ─────────────────────────────

function curveGain(t: number, curve: FadeCurveType): number {
  switch (curve) {
    case 'linear':          return t;
    case 'exponential_in':  return t * t * t;
    case 'exponential_out': return 1 - (1 - t) ** 3;
    case 's_curve':         return 0.5 * (1 - Math.cos(Math.PI * t));
    case 'logarithmic':     return Math.log10(1 + 9 * t);
  }
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface FadeCurveOverlayProps {
  /** x pixel position of the clip's left edge. */
  clipX: number;
  /** y pixel position of the clip row top. */
  clipY: number;
  /** Total pixel width of the clip. */
  clipWidth: number;
  /** Clip row height in pixels. */
  clipHeight: number;
  /** Fade-in length in samples (0 = no fade-in). */
  fadeInSamples: number;
  /** Fade-out length in samples (0 = no fade-out). */
  fadeOutSamples: number;
  /** Total clip length in samples (for converting sample offsets to pixels). */
  totalSamples: number;
  fadeInCurve: FadeCurveType;
  fadeOutCurve: FadeCurveType;
}

const STEPS = 32; // path resolution

/**
 * Renders semi-transparent SVG fade curve shapes overlaid on a clip.
 *
 * - Fade-in: filled polygon from the left edge, rising to full height.
 * - Fade-out: filled polygon from the fade-out start, dropping to zero.
 */
const FadeCurveOverlay: React.FC<FadeCurveOverlayProps> = ({
  clipX, clipY, clipWidth, clipHeight,
  fadeInSamples, fadeOutSamples, totalSamples,
  fadeInCurve, fadeOutCurve,
}) => {
  const fadeInPath = useMemo(() => {
    if (fadeInSamples <= 0 || totalSamples <= 0) return null;
    const fadeInPx = (fadeInSamples / totalSamples) * clipWidth;
    const pts: string[] = [`${clipX},${clipY + clipHeight}`];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const gain = curveGain(t, fadeInCurve);
      const px = clipX + t * fadeInPx;
      const py = clipY + clipHeight - gain * clipHeight;
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    pts.push(`${clipX + fadeInPx},${clipY + clipHeight}`);
    return pts.join(' ');
  }, [fadeInSamples, totalSamples, clipWidth, clipX, clipY, clipHeight, fadeInCurve]);

  const fadeOutPath = useMemo(() => {
    if (fadeOutSamples <= 0 || totalSamples <= 0) return null;
    const fadeOutPx = (fadeOutSamples / totalSamples) * clipWidth;
    const startX = clipX + clipWidth - fadeOutPx;
    const pts: string[] = [`${startX},${clipY + clipHeight}`];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      // Fade-out gains go from 1→0, so mirror: gain at t=0 is 1, at t=1 is 0
      const gain = curveGain(1 - t, fadeOutCurve);
      const px = startX + t * fadeOutPx;
      const py = clipY + clipHeight - gain * clipHeight;
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    pts.push(`${clipX + clipWidth},${clipY + clipHeight}`);
    return pts.join(' ');
  }, [fadeOutSamples, totalSamples, clipWidth, clipX, clipY, clipHeight, fadeOutCurve]);

  if (!fadeInPath && !fadeOutPath) return null;

  return (
    <svg
      data-testid="fade-curve-overlay"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      width={0}
      height={0}
    >
      {fadeInPath && (
        <polygon
          data-testid="fade-in-curve"
          points={fadeInPath}
          fill="rgba(99,179,237,0.25)"
          stroke="rgba(99,179,237,0.6)"
          strokeWidth={1}
        />
      )}
      {fadeOutPath && (
        <polygon
          data-testid="fade-out-curve"
          points={fadeOutPath}
          fill="rgba(99,179,237,0.25)"
          stroke="rgba(99,179,237,0.6)"
          strokeWidth={1}
        />
      )}
    </svg>
  );
};

export default FadeCurveOverlay;
