/**
 * PianoKeyboard — vertical canvas-based piano keyboard for the Piano Roll.
 *
 * Fixed 48 px wide. Each semitone row is `pixelsPerSemitone` tall.
 * Scrolls with the viewport's `scrollY`. Clicking a key calls the
 * `previewNote` IPC to sound a brief note on the active instrument.
 */

import { useEffect, useRef, useCallback } from 'react';
import { previewNote } from '../../lib/ipc';
import { isBlackKey, pitchToName } from './pianoRollUtils';
import type { Viewport } from './pianoRollTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYBOARD_WIDTH = 48;
const BLACK_KEY_WIDTH_RATIO = 0.65;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PianoKeyboardProps {
  viewport: Viewport;
  canvasHeight: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PianoKeyboard({ viewport, canvasHeight }: PianoKeyboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { scrollY, pixelsPerSemitone } = viewport;
    const h = canvas.height;
    const w = canvas.width;

    ctx.clearRect(0, 0, w, h);

    // Draw each visible pitch row from 127 down to 0.
    // pitchToY for pitch p = (127 - p) * pps - scrollY
    // Visible if y in [0, h)
    const topPitch = Math.min(127, Math.floor(127 - scrollY / pixelsPerSemitone));
    const bottomPitch = Math.max(0, Math.ceil(127 - (scrollY + h) / pixelsPerSemitone));

    for (let pitch = bottomPitch; pitch <= topPitch; pitch++) {
      const y = (127 - pitch) * pixelsPerSemitone - scrollY;
      const keyH = pixelsPerSemitone;
      const black = isBlackKey(pitch);

      if (!black) {
        // White key background
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(0, y, w, keyH);
        // Bottom border
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + keyH);
        ctx.lineTo(w, y + keyH);
        ctx.stroke();
      }
    }

    // Draw black keys on top so they overlap white key borders cleanly.
    for (let pitch = bottomPitch; pitch <= topPitch; pitch++) {
      const y = (127 - pitch) * pixelsPerSemitone - scrollY;
      const keyH = pixelsPerSemitone;
      const black = isBlackKey(pitch);

      if (black) {
        const bw = Math.round(w * BLACK_KEY_WIDTH_RATIO);
        ctx.fillStyle = '#222';
        ctx.fillRect(0, y, bw, keyH);
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(0, y, bw, keyH);
      }
    }

    // Octave labels at each C note (pitch % 12 === 0), drawn over white keys.
    ctx.fillStyle = '#888';
    ctx.font = `${Math.max(8, Math.min(10, pixelsPerSemitone - 2))}px monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    for (let pitch = bottomPitch; pitch <= topPitch; pitch++) {
      if (pitch % 12 === 0) {
        const y = (127 - pitch) * pixelsPerSemitone - scrollY;
        const label = pitchToName(pitch); // e.g. "C4"
        ctx.fillText(label, w - 2, y + pixelsPerSemitone - 1);
      }
    }
  }, [viewport]);

  // Redraw whenever viewport changes or canvas resizes.
  useEffect(() => {
    draw();
  }, [draw, canvasHeight]);

  // ---------------------------------------------------------------------------
  // Pointer — preview note on click
  // ---------------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const canvasY = e.clientY - rect.top;
      const { scrollY, pixelsPerSemitone } = viewport;
      const pitch = Math.min(
        127,
        Math.max(0, Math.round(127 - (canvasY + scrollY) / pixelsPerSemitone)),
      );
      void previewNote(pitch, 100, 200);
    },
    [viewport],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <canvas
      ref={canvasRef}
      width={KEYBOARD_WIDTH}
      height={canvasHeight}
      style={{ width: KEYBOARD_WIDTH, height: canvasHeight, flexShrink: 0, cursor: 'pointer' }}
      onPointerDown={handlePointerDown}
      aria-label="Piano keyboard"
    />
  );
}
