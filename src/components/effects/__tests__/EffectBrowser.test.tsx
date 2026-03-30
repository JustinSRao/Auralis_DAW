import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EffectBrowser from '../EffectBrowser';
import { useEffectChainStore } from '../../../stores/effectChainStore';

vi.mock('../../../stores/effectChainStore', () => ({
  useEffectChainStore: vi.fn(),
}));

const mockAddEffect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (useEffectChainStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) =>
      selector({ addEffect: mockAddEffect })
  );
});

describe('EffectBrowser', () => {
  it('renders all effect types', () => {
    render(<EffectBrowser channelId="ch1" />);
    expect(screen.getByLabelText('Add Compressor')).toBeDefined();
    expect(screen.getByLabelText('Add Limiter')).toBeDefined();
    expect(screen.getByLabelText('Add Noise Gate')).toBeDefined();
    expect(screen.getByLabelText('Add 8-Band EQ')).toBeDefined();
    expect(screen.getByLabelText('Add Reverb')).toBeDefined();
    expect(screen.getByLabelText('Add Delay')).toBeDefined();
  });

  it('calls addEffect with correct type when button clicked', () => {
    render(<EffectBrowser channelId="ch1" />);
    fireEvent.click(screen.getByLabelText('Add Compressor'));
    expect(mockAddEffect).toHaveBeenCalledWith('ch1', 'compressor');
  });

  it('calls addEffect for reverb', () => {
    render(<EffectBrowser channelId="ch1" />);
    fireEvent.click(screen.getByLabelText('Add Reverb'));
    expect(mockAddEffect).toHaveBeenCalledWith('ch1', 'reverb');
  });

  it('renders category headers', () => {
    render(<EffectBrowser channelId="ch1" />);
    expect(screen.getByText('Dynamics')).toBeDefined();
    expect(screen.getByText('EQ')).toBeDefined();
    expect(screen.getByText('Time/Space')).toBeDefined();
  });
});
