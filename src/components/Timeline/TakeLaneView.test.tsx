/**
 * Smoke tests for TakeLaneView (Sprint 44).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TakeLaneView } from './TakeLaneView';
import type { TakeLane, Take } from '@/lib/ipc';

// ---------------------------------------------------------------------------
// Mock takeLaneStore — selector + getState pattern
// ---------------------------------------------------------------------------

const mockSetActiveTake = vi.fn().mockResolvedValue(undefined);
const mockDeleteTake = vi.fn().mockResolvedValue(undefined);

let mockLanes: Record<string, TakeLane> = {};

vi.mock('@/stores/takeLaneStore', () => {
  function buildState() {
    return {
      lanes: mockLanes,
      loopRecordArmed: false,
      activeLoopTrackId: null,
      setActiveTake: mockSetActiveTake,
      deleteTake: mockDeleteTake,
    };
  }

  const useTakeLaneStore = Object.assign(
    (selector: (s: ReturnType<typeof buildState>) => unknown) => selector(buildState()),
    { getState: () => buildState() },
  );

  return { useTakeLaneStore };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTake(id: string, num: number, isActive = false): Take {
  return {
    id,
    patternId: `p-${id}`,
    takeNumber: num,
    trackId: 'track-1',
    loopStartBeats: 0,
    loopEndBeats: 4,
    isActive,
  };
}

function makeLane(takes: Take[]): TakeLane {
  return {
    trackId: 'track-1',
    takes,
    compRegions: [],
    expanded: true,
  };
}

const defaultProps = {
  trackId: 'track-1',
  barToX: (bar: number) => bar * 80,
  width: 800,
  beatsPerBar: 4,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TakeLaneView', () => {
  it('renders null when no lane exists for the track', () => {
    mockLanes = {};
    const { container } = render(<TakeLaneView {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when lane has no takes', () => {
    mockLanes = { 'track-1': makeLane([]) };
    const { container } = render(<TakeLaneView {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one take row per take', () => {
    mockLanes = {
      'track-1': makeLane([
        makeTake('a', 1),
        makeTake('b', 2),
        makeTake('c', 3),
      ]),
    };
    render(<TakeLaneView {...defaultProps} />);
    expect(screen.getByTestId('take-bar-a')).toBeInTheDocument();
    expect(screen.getByTestId('take-bar-b')).toBeInTheDocument();
    expect(screen.getByTestId('take-bar-c')).toBeInTheDocument();
  });

  it('active take has different background color than inactive takes', () => {
    mockLanes = {
      'track-1': makeLane([
        makeTake('a', 1, false),
        makeTake('b', 2, true),
      ]),
    };
    render(<TakeLaneView {...defaultProps} />);

    const barA = screen.getByTestId('take-bar-a');
    const barB = screen.getByTestId('take-bar-b');

    // Active take uses '#6c63ff', inactive uses '#3a3a5a'
    expect(barB.style.background).toBe('rgb(108, 99, 255)');
    expect(barA.style.background).toBe('rgb(58, 58, 90)');
  });

  it('renders take number labels', () => {
    mockLanes = {
      'track-1': makeLane([makeTake('a', 7)]),
    };
    render(<TakeLaneView {...defaultProps} />);
    expect(screen.getByText('T7')).toBeInTheDocument();
  });
});
