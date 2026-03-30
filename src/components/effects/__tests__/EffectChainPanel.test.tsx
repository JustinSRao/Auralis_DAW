import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EffectChainPanel from '../EffectChainPanel';
import { useEffectChainStore } from '../../../stores/effectChainStore';

vi.mock('../../../stores/effectChainStore', () => ({
  useEffectChainStore: vi.fn(),
}));

vi.mock('../../instruments/Knob', () => ({
  Knob: ({ label, displayValue }: { label: string; displayValue: string }) => (
    <div data-testid={`knob-${label.toLowerCase()}`}>{displayValue}</div>
  ),
}));

const mockLoadChain  = vi.fn();
const mockSetBypass  = vi.fn();
const mockSetWetDry  = vi.fn();
const mockRemove     = vi.fn();
const mockMove       = vi.fn();

const baseChain = {
  channel_id: 'ch1',
  slots: [
    { slot_id: 's1', effect_type: 'compressor' as const, bypass: false, wet_dry: 1.0 },
    { slot_id: 's2', effect_type: 'reverb' as const,     bypass: false, wet_dry: 0.8 },
  ],
};

function mockStore(overrides: Partial<typeof baseChain> = {}) {
  (useEffectChainStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) =>
      selector({
        chains: { ch1: { ...baseChain, ...overrides } },
        loadChain:    mockLoadChain,
        setBypass:    mockSetBypass,
        setWetDry:    mockSetWetDry,
        removeEffect: mockRemove,
        moveEffect:   mockMove,
      })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore();
});

describe('EffectChainPanel', () => {
  it('renders title', () => {
    render(<EffectChainPanel channelId="ch1" />);
    expect(screen.getByText('Effect Chain')).toBeDefined();
  });

  it('calls loadChain on mount', () => {
    render(<EffectChainPanel channelId="ch1" />);
    expect(mockLoadChain).toHaveBeenCalledWith('ch1');
  });

  it('renders each slot label', () => {
    render(<EffectChainPanel channelId="ch1" />);
    expect(screen.getByText('Compressor')).toBeDefined();
    expect(screen.getByText('Reverb')).toBeDefined();
  });

  it('shows empty state when chain is undefined', () => {
    (useEffectChainStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: unknown) => unknown) =>
        selector({ chains: {}, loadChain: mockLoadChain, setBypass: mockSetBypass, setWetDry: mockSetWetDry, removeEffect: mockRemove, moveEffect: mockMove })
    );
    render(<EffectChainPanel channelId="ch1" />);
    expect(screen.getByLabelText('No effects in chain')).toBeDefined();
  });

  it('calls setBypass when bypass checkbox is toggled', () => {
    render(<EffectChainPanel channelId="ch1" />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(mockSetBypass).toHaveBeenCalledWith('ch1', 's1', true);
  });

  it('calls removeEffect when remove button clicked', () => {
    render(<EffectChainPanel channelId="ch1" />);
    const removeButtons = screen.getAllByLabelText(/Remove/);
    fireEvent.click(removeButtons[0]);
    expect(mockRemove).toHaveBeenCalledWith('ch1', 's1');
  });

  it('calls moveEffect when move up button clicked', () => {
    render(<EffectChainPanel channelId="ch1" />);
    const downButtons = screen.getAllByLabelText('Move effect down');
    fireEvent.click(downButtons[0]);
    expect(mockMove).toHaveBeenCalledWith('ch1', 0, 1);
  });

  it('disables move-up button for first slot', () => {
    render(<EffectChainPanel channelId="ch1" />);
    const upButtons = screen.getAllByLabelText('Move effect up');
    expect((upButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
