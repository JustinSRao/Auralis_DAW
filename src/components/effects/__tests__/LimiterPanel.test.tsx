import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LimiterPanel from '../LimiterPanel';
import { useLimiterStore } from '../../../stores/limiterStore';

vi.mock('../../../stores/limiterStore', () => ({
  useLimiterStore: vi.fn(),
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
  ceiling_db: -0.3,
  release_ms: 50,
  enabled: true,
  gain_reduction_db: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  (useLimiterStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({
      channels: { ch1: baseChannel },
      loadChannel: mockLoadChannel,
      setParam: mockSetParam,
    })
  );
});

describe('LimiterPanel', () => {
  it('renders title and knobs', () => {
    render(<LimiterPanel channelId="ch1" />);
    expect(screen.getByText('Limiter')).toBeDefined();
    expect(screen.getByTestId('knob-ceiling')).toBeDefined();
    expect(screen.getByTestId('knob-release')).toBeDefined();
  });

  it('shows loading state when no channel data', () => {
    (useLimiterStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ channels: {}, loadChannel: mockLoadChannel, setParam: mockSetParam })
    );
    render(<LimiterPanel channelId="ch1" />);
    expect(screen.getByLabelText('Limiter panel loading')).toBeDefined();
  });

  it('calls loadChannel on mount', () => {
    render(<LimiterPanel channelId="ch1" />);
    expect(mockLoadChannel).toHaveBeenCalledWith('ch1');
  });

  it('calls setParam when ceiling knob changes', () => {
    render(<LimiterPanel channelId="ch1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ceiling' }));
    expect(mockSetParam).toHaveBeenCalledWith('ch1', 'ceiling_db', expect.any(Number));
  });

  it('renders gain reduction meter', () => {
    render(<LimiterPanel channelId="ch1" />);
    expect(screen.getByLabelText('Limiter gain reduction meter')).toBeDefined();
  });

  it('displays positive gain reduction with minus sign', () => {
    (useLimiterStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
      selector({
        channels: { ch1: { ...baseChannel, gain_reduction_db: 3 } },
        loadChannel: mockLoadChannel,
        setParam: mockSetParam,
      })
    );
    render(<LimiterPanel channelId="ch1" />);
    expect(screen.getByText('-3.0dB')).toBeDefined();
  });
});
