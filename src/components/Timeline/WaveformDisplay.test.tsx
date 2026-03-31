import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import WaveformDisplay from './WaveformDisplay';
import type { PeakData } from '../../lib/ipc';

// Mock canvas context
const mockCtx = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);
});

const makePeaks = (n: number): PeakData => ({
  framesPerPixel: 512,
  left: Array.from({ length: n }, (_, i) => ({
    min: -0.5,
    max: 0.5,
  })),
  right: Array.from({ length: n }, () => ({ min: -0.5, max: 0.5 })),
  totalFrames: n * 512,
  sampleRate: 44100,
});

describe('WaveformDisplay', () => {
  it('renders a canvas with correct dimensions', () => {
    render(<WaveformDisplay peaks={makePeaks(10)} width={400} height={80} />);
    const canvas = screen.getByLabelText('Waveform display') as HTMLCanvasElement;
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(80);
  });

  it('draws background rect on mount', () => {
    render(<WaveformDisplay peaks={makePeaks(10)} width={400} height={80} />);
    expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 400, 80);
  });

  it('draws lines for each peak frame', () => {
    render(<WaveformDisplay peaks={makePeaks(5)} width={200} height={60} />);
    expect(mockCtx.beginPath).toHaveBeenCalledTimes(5);
    expect(mockCtx.stroke).toHaveBeenCalledTimes(5);
  });

  it('does not throw with empty peaks', () => {
    expect(() =>
      render(<WaveformDisplay peaks={makePeaks(0)} width={200} height={60} />)
    ).not.toThrow();
  });

  it('applies custom color', () => {
    render(<WaveformDisplay peaks={makePeaks(2)} width={100} height={40} color="#ff0000" />);
    expect(mockCtx.strokeStyle).toBe('#ff0000');
  });
});
