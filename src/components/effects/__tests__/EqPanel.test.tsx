/**
 * Unit tests for EqPanel component (Sprint 18).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EqBandParams } from '../../../lib/ipc';

// ─── Mock eqStore ─────────────────────────────────────────────────────────────

const mockSetBand = vi.fn();
const mockEnableBand = vi.fn();
const mockLoadChannel = vi.fn().mockResolvedValue(undefined);

const defaultBands: EqBandParams[] = [
  { filter_type: 'high_pass',  frequency: 20,    gain_db: 0, q: 1, enabled: false },
  { filter_type: 'low_shelf',  frequency: 200,   gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 500,   gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 1000,  gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 4000,  gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'peaking',    frequency: 8000,  gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'high_shelf', frequency: 10000, gain_db: 0, q: 1, enabled: true  },
  { filter_type: 'low_pass',   frequency: 20000, gain_db: 0, q: 1, enabled: false },
];

let mockBands: EqBandParams[] | undefined = defaultBands;

vi.mock('../../../stores/eqStore', () => ({
  useEqStore: (selector: (s: unknown) => unknown) => {
    const state = {
      channels: { 'ch-1': mockBands },
      loadChannel: mockLoadChannel,
      setBand: mockSetBand,
      enableBand: mockEnableBand,
    };
    return selector(state);
  },
}));

// ─── Mock canvas getContext (jsdom stub) ──────────────────────────────────────

const ctxMock = {
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  set fillStyle(_: unknown) {},
  set strokeStyle(_: unknown) {},
  set lineWidth(_: unknown) {},
  set font(_: unknown) {},
  set globalAlpha(_: unknown) {},
  set textAlign(_: unknown) {},
  set textBaseline(_: unknown) {},
};

HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxMock) as unknown as typeof HTMLCanvasElement.prototype.getContext;

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

// ─── Import after mocks ───────────────────────────────────────────────────────

import EqPanel from '../EqPanel';

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockBands = defaultBands.map((b) => ({ ...b }));
  mockLoadChannel.mockResolvedValue(undefined);
});

describe('EqPanel', () => {
  it('renders the panel heading', () => {
    render(<EqPanel channelId="ch-1" />);
    expect(screen.getByText(/parametric eq/i)).toBeTruthy();
  });

  it('calls loadChannel on mount with the given channelId', () => {
    render(<EqPanel channelId="ch-1" />);
    expect(mockLoadChannel).toHaveBeenCalledWith('ch-1');
  });

  it('renders a canvas element with aria-label', () => {
    render(<EqPanel channelId="ch-1" />);
    expect(screen.getByLabelText('frequency response canvas')).toBeTruthy();
  });

  it('renders a BiquadBandControl for each of the 8 bands', () => {
    render(<EqPanel channelId="ch-1" />);
    // Each band renders a filter-type button; count them
    const buttons = screen.getAllByRole('button');
    // 8 enable-toggle buttons, one per band
    expect(buttons.length).toBeGreaterThanOrEqual(8);
  });

  it('shows loading state when bands are not yet loaded', () => {
    mockBands = undefined;
    render(<EqPanel channelId="ch-1" />);
    expect(screen.getByText(/loading eq/i)).toBeTruthy();
  });

  it('calls enableBand when a band toggle is clicked', () => {
    render(<EqPanel channelId="ch-1" />);
    // Band 1 (low shelf) is enabled — click to disable
    const lsButton = screen.getByText('LS');
    fireEvent.click(lsButton);
    expect(mockEnableBand).toHaveBeenCalledWith('ch-1', 1, false);
  });

  it('calls enableBand to enable when clicking a disabled HP band toggle', () => {
    render(<EqPanel channelId="ch-1" />);
    // Band 0 (HP) is disabled
    const hpButton = screen.getByText('HP');
    fireEvent.click(hpButton);
    expect(mockEnableBand).toHaveBeenCalledWith('ch-1', 0, true);
  });

  it('renders the EQ panel container with aria-label', () => {
    render(<EqPanel channelId="ch-1" />);
    expect(screen.getByLabelText('EQ panel')).toBeTruthy();
  });

  it('renders frequency axis labels (20, 1k, 20k)', () => {
    render(<EqPanel channelId="ch-1" />);
    // '20' can match both axis label and band-0 freq display, use getAllByText
    expect(screen.getAllByText('20').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1k')).toBeTruthy();
    expect(screen.getByText('20k')).toBeTruthy();
  });
});
