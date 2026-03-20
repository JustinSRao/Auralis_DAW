/**
 * Smoke tests for TempoTrack component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { TempoTrack } from './TempoTrack';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/ipc', () => ({
  setTempoMap: vi.fn().mockResolvedValue(undefined),
  getTempoMap: vi.fn().mockResolvedValue([{ tick: 0, bpm: 120, interp: 'Step' }]),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const defaultProps = {
  width: 800,
  height: 80,
  scrollLeft: 0,
  pixelsPerBar: 80,
  beatsPerBar: 4,
  totalBars: 128,
};

describe('TempoTrack', () => {
  it('renders without crashing', () => {
    const { container } = render(<TempoTrack {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('canvas getContext null does not throw', () => {
    // jsdom returns null for getContext — setup.ts sets this globally.
    // This test verifies the component gracefully handles the null case.
    expect(() => render(<TempoTrack {...defaultProps} />)).not.toThrow();
  });

  it('renders the TEMPO label', () => {
    const { getByText } = render(<TempoTrack {...defaultProps} />);
    expect(getByText('TEMPO')).toBeTruthy();
  });

  it('renders a canvas element', () => {
    const { container } = render(<TempoTrack {...defaultProps} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-label')).toBe('Tempo track');
  });
});
