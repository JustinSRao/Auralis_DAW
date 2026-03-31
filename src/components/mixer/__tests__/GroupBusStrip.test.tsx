/**
 * Unit tests for GroupBusStrip component (Sprint 42).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GroupBusState } from '../../../stores/mixerStore';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockSetFader = vi.fn();
const mockSetPan = vi.fn();
const mockSetMute = vi.fn();
const mockSetSolo = vi.fn();
const mockSetOutput = vi.fn().mockResolvedValue(undefined);

let mockBus: GroupBusState = {
  id: 0,
  name: 'Drums',
  outputTarget: { kind: 'master' },
  fader: 1.0,
  pan: 0.0,
  mute: false,
  solo: false,
  peakL: 0,
  peakR: 0,
};

vi.mock('../../../stores/mixerStore', () => ({
  useMixerStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      groupBuses: [mockBus],
      setGroupBusFader: mockSetFader,
      setGroupBusPan: mockSetPan,
      setGroupBusMute: mockSetMute,
      setGroupBusSolo: mockSetSolo,
      setGroupBusOutput: mockSetOutput,
    }),
}));

vi.mock('../LevelMeter', () => ({
  default: () => <div data-testid="level-meter" />,
}));

vi.mock('../OutputSelector', () => ({
  default: ({ onChange }: { onChange: (t: unknown) => void }) => (
    <select data-testid="output-selector" onChange={(e) => onChange(e.target.value)} />
  ),
}));

import GroupBusStrip from '../GroupBusStrip';

describe('GroupBusStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBus = {
      id: 0, name: 'Drums', outputTarget: { kind: 'master' },
      fader: 1.0, pan: 0.0, mute: false, solo: false, peakL: 0, peakR: 0,
    };
  });

  it('renders bus name', () => {
    render(<GroupBusStrip busId={0} />);
    expect(screen.getByText('Drums')).toBeInTheDocument();
  });

  it('renders GRP label', () => {
    render(<GroupBusStrip busId={0} />);
    expect(screen.getByText('GRP')).toBeInTheDocument();
  });

  it('renders level meter', () => {
    render(<GroupBusStrip busId={0} />);
    expect(screen.getByTestId('level-meter')).toBeInTheDocument();
  });

  it('renders output selector', () => {
    render(<GroupBusStrip busId={0} />);
    expect(screen.getByTestId('output-selector')).toBeInTheDocument();
  });

  it('clicking M calls setGroupBusMute', () => {
    render(<GroupBusStrip busId={0} />);
    fireEvent.click(screen.getByText('M'));
    expect(mockSetMute).toHaveBeenCalledWith(0, true);
  });

  it('clicking S calls setGroupBusSolo', () => {
    render(<GroupBusStrip busId={0} />);
    fireEvent.click(screen.getByText('S'));
    expect(mockSetSolo).toHaveBeenCalledWith(0, true);
  });

  it('returns null for unknown busId', () => {
    const { container } = render(<GroupBusStrip busId={99} />);
    expect(container.firstChild).toBeNull();
  });
});
