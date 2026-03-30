import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GatePanel from '../GatePanel';
import { useGateStore } from '../../../stores/gateStore';

vi.mock('../../../stores/gateStore', () => ({
  useGateStore: vi.fn(),
}));

vi.mock('../../instruments/Knob', () => ({
  Knob: ({ label, onValue, displayValue }: { label: string; onValue: (v: number) => void; displayValue: string }) => (
    <div data-testid={`knob-${label.toLowerCase()}`}>
      <span>{displayValue}</span>
      <button onClick={() => onValue(0.5)}>{label}</button>
    </div>
  ),
}));

const mockLoadChannel = vi.fn();
const mockSetParam = vi.fn();

const baseChannel = {
  channel_id: 'ch1',
  threshold_db: -40,
  attack_ms: 1,
  hold_ms: 50,
  release_ms: 100,
  range_db: -60,
  enabled: true,
  gain_reduction_db: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  (useGateStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({
      channels: { ch1: baseChannel },
      loadChannel: mockLoadChannel,
      setParam: mockSetParam,
    })
  );
});

describe('GatePanel', () => {
  it('renders title and all 5 knobs', () => {
    render(<GatePanel channelId="ch1" />);
    expect(screen.getByText('Noise Gate')).toBeDefined();
    expect(screen.getByTestId('knob-thresh')).toBeDefined();
    expect(screen.getByTestId('knob-attack')).toBeDefined();
    expect(screen.getByTestId('knob-hold')).toBeDefined();
    expect(screen.getByTestId('knob-release')).toBeDefined();
    expect(screen.getByTestId('knob-range')).toBeDefined();
  });

  it('shows loading state when no channel data', () => {
    (useGateStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ channels: {}, loadChannel: mockLoadChannel, setParam: mockSetParam })
    );
    render(<GatePanel channelId="ch1" />);
    expect(screen.getByLabelText('Gate panel loading')).toBeDefined();
  });

  it('calls loadChannel on mount', () => {
    render(<GatePanel channelId="ch1" />);
    expect(mockLoadChannel).toHaveBeenCalledWith('ch1');
  });

  it('calls setParam when threshold knob changes', () => {
    render(<GatePanel channelId="ch1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Thresh' }));
    expect(mockSetParam).toHaveBeenCalledWith('ch1', 'threshold_db', expect.any(Number));
  });

  it('calls setParam when hold knob changes', () => {
    render(<GatePanel channelId="ch1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    expect(mockSetParam).toHaveBeenCalledWith('ch1', 'hold_ms', expect.any(Number));
  });

  it('calls setParam when range knob changes', () => {
    render(<GatePanel channelId="ch1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Range' }));
    expect(mockSetParam).toHaveBeenCalledWith('ch1', 'range_db', expect.any(Number));
  });

  it('displays threshold display value with dB suffix', () => {
    render(<GatePanel channelId="ch1" />);
    expect(screen.getByText('-40dB')).toBeDefined();
  });
});
