/**
 * Unit tests for ReverbPanel component (Sprint 19).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReverbStateSnapshot } from '../../../lib/ipc';

// ─── Mock reverbStore ─────────────────────────────────────────────────────────

const mockSetParam = vi.fn();
const mockLoadChannel = vi.fn().mockResolvedValue(undefined);

const defaultSnapshot: ReverbStateSnapshot = {
  channel_id: 'ch-1',
  room_size: 0.5,
  decay: 1.5,
  pre_delay_ms: 0,
  wet: 0.3,
  damping: 0.5,
  width: 1.0,
};

let mockChannel: ReverbStateSnapshot | undefined = defaultSnapshot;

vi.mock('../../../stores/reverbStore', () => ({
  useReverbStore: (selector: (s: unknown) => unknown) => {
    const state = {
      channels: { 'ch-1': mockChannel },
      loadChannel: mockLoadChannel,
      setParam: mockSetParam,
    };
    return selector(state);
  },
}));

vi.mock('../../../hooks/usePresets', () => ({
  usePresets: () => ({
    presets: [],
    filteredPresets: [],
    isLoading: false,
    error: null,
    fetchPresets: vi.fn(),
    captureAndSave: vi.fn(),
    loadAndApply: vi.fn(),
    deletePreset: vi.fn(),
  }),
}));

// ─── Import component ─────────────────────────────────────────────────────────

import ReverbPanel from '../ReverbPanel';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReverbPanel', () => {
  beforeEach(() => {
    mockChannel = defaultSnapshot;
    vi.clearAllMocks();
  });

  it('renders Reverb panel heading', () => {
    render(<ReverbPanel channelId="ch-1" />);
    expect(screen.getByText('Reverb')).toBeTruthy();
  });

  it('calls loadChannel on mount', () => {
    render(<ReverbPanel channelId="ch-1" />);
    expect(mockLoadChannel).toHaveBeenCalledWith('ch-1');
  });

  it('renders 6 knob controls', () => {
    render(<ReverbPanel channelId="ch-1" />);
    expect(screen.getByText('Room')).toBeTruthy();
    expect(screen.getByText('Decay')).toBeTruthy();
    expect(screen.getByText('Pre-Dly')).toBeTruthy();
    expect(screen.getByText('Damp')).toBeTruthy();
    expect(screen.getByText('Width')).toBeTruthy();
    expect(screen.getByText('Wet')).toBeTruthy();
  });

  it('shows loading state when snapshot not yet loaded', () => {
    mockChannel = undefined;
    render(<ReverbPanel channelId="ch-1" />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('has aria-label on panel', () => {
    render(<ReverbPanel channelId="ch-1" />);
    expect(screen.getByLabelText('Reverb panel for channel ch-1')).toBeTruthy();
  });

  it('has loading aria-label when snapshot not loaded', () => {
    mockChannel = undefined;
    render(<ReverbPanel channelId="ch-1" />);
    expect(screen.getByLabelText('Reverb panel loading')).toBeTruthy();
  });
});
