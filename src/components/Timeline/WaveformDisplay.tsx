import React, { useEffect, useRef } from 'react';
import type { PeakData } from '../../lib/ipc';

interface WaveformDisplayProps {
  peaks: PeakData;
  width: number;
  height: number;
  color?: string;
}

/**
 * Renders waveform peak data onto a canvas element.
 *
 * Each peak frame column is drawn as a vertical line from `min` to `max`.
 * Only the left channel is shown by default.
 */
const WaveformDisplay: React.FC<WaveformDisplayProps> = ({
  peaks,
  width,
  height,
  color = '#4ade80',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.left.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    const mid = height / 2;
    const n = peaks.left.length;

    for (let i = 0; i < n; i++) {
      const x = (i / n) * width;
      const { min, max } = peaks.left[i];

      const yMax = mid - max * mid;
      const yMin = mid - min * mid;

      ctx.beginPath();
      ctx.moveTo(x, yMax);
      ctx.lineTo(x, yMin);
      ctx.stroke();
    }
  }, [peaks, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      aria-label="Waveform display"
      style={{ display: 'block' }}
    />
  );
};

export default WaveformDisplay;
