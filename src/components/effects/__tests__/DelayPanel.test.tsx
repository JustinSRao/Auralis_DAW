/**
 * Unit tests for DelayPanel component (Sprint 19).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DelayStateSnapshot } from '../../../lib/ipc';

// ─── Mock delayStore ──────────────────────────────────────────────────────────

const mockSetParam = vi.fn();
const mockSetDelayMode = vi.fn();
const mockSetPingPong = vi.fn();
const mockLoadChannel = vi.fn().mockResolvedValue(undefined);

const defaultSnapshot: DelayStateSnapshot = {
  channel_id: 'ch-1',
  delay_mode: { mode: 'ms', ms: 250 },
  feedback: 0.4,
  wet: 0.3,
  ping_pong: false,
  hicut_hz: 8000,
};

let mockChannel: DelayStateSnapshot | undefined = defaultSnapshot;

vi.mock('../../../stores/delayStore', () => ({
  useDelayStore: (selector: (s: unknown) => unknown) => {
    const state = {
      channels: { 'ch-1': mockChannel },
      loadChannel: mockLoadChannel,
      setParam: mockSetParam,
      setDelayMode: mockSetDelayMode,
      setPingPong: mockSetPingPong,
    };
    return selector(state);
  },
}));

// ─── Mock tempoMapStore ───────────────────────────────────────────────────────

vi.mock('../../../stores/tempoMapStore', () => ({
  useTempoMapStore: (selector: (s: unknown) => unknown) => {
    const state = { points: [{ tick: 0, bpm: 120, interp: 'step' }] };
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

import DelayPanel from '../DelayPanel';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DelayPanel', () => {
  beforeEach(() => {
    mockChannel = { ...defaultSnapshot };
    vi.clearAllMocks();
  });

  it('renders Delay panel heading', () => {
    render(<DelayPanel channelId="ch-1" />);
    expect(screen.getByText('Delay')).toBeTruthy();
  });

  it('calls loadChannel on mount', () => {
    render(<DelayPanel channelId="ch-1" />);
    expect(mockLoadChannel).toHaveBeenCalledWith('ch-1');
  });

  it('renders mode toggle button in ms mode', () => {
    render(<DelayPanel channelId="ch-1" />);
    const btn = screen.getByRole('button', { name: 'ms' });
    expect(btn.textContent).toBe('ms');
  });

  it('renders note division dropdown in sync mode', () => {
    mockChannel = { ...defaultSnapshot, delay_mode: { mode: 'sync', div: 'quarter' } };
    render(<DelayPanel channelId="ch-1" />);
    expect(screen.getByLabelText('Note division')).toBeTruthy();
  });

  it('shows loading state when snapshot not loaded', () => {
    mockChannel = undefined;
    render(<DelayPanel channelId="ch-1" />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('clicking mode toggle calls setDelayMode', () => {
    render(<DelayPanel channelId="ch-1" />);
    const btn = screen.getByRole('button', { name: 'ms' });
    fireEvent.click(btn);
    expect(mockSetDelayMode).toHaveBeenCalled();
  });

  it('ping-pong checkbox calls setPingPong on change', () => {
    render(<DelayPanel channelId="ch-1" />);
    const checkbox = screen.getByLabelText('Ping-pong mode');
    fireEvent.click(checkbox);
    expect(mockSetPingPong).toHaveBeenCalledWith('ch-1', true);
  });

  it('has aria-label on panel', () => {
    render(<DelayPanel channelId="ch-1" />);
    expect(screen.getByLabelText('Delay panel for channel ch-1')).toBeTruthy();
  });
});
