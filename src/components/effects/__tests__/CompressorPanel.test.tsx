import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CompressorPanel from '../CompressorPanel';
import { useCompressorStore } from '../../../stores/compressorStore';

vi.mock('../../../stores/compressorStore', () => ({
  useCompressorStore: vi.fn(),
}));

vi.mock('../../../stores/sidechainStore', () => ({
  useSidechainStore: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../stores/mixerStore', () => ({
  useMixerStore: vi.fn().mockReturnValue({}),
}));

vi.mock('../../instruments/Knob', () => ({
  Knob: ({ label, onValue, displayValue }: { label: string; onValue: (v: number) => void; displayValue: string }) => (
    <div data-testid={`knob-${label.toLowerCase()}`}>
      <span>{displayValue}</span>
      <button onClick={() => onValue(0.5)}>{label}</button>
    </div>
  ),
}));

vi.mock('../SidechainSourceSelector', () => ({
  default: () => <div data-testid="sidechain-source-selector" />,
}));

vi.mock('../SidechainHpfControl', () => ({
  default: () => <div data-testid="sidechain-hpf-control" />,
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

const mockLoadChannel = vi.fn();
const mockSetParam = vi.fn();

const baseChannel = {
  channel_id: 'ch1',
  threshold_db: -24,
  ratio: 4,
  attack_ms: 10,
  release_ms: 100,
  knee_db: 6,
  makeup_db: 2,
  enabled: true,
  gain_reduction_db: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  (useCompressorStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({
      channels: { ch1: baseChannel },
      loadChannel: mockLoadChannel,
      setParam: mockSetParam,
    })
  );
});

describe('CompressorPanel', () => {
  it('renders title and all knobs', () => {
    render(<CompressorPanel channelId="ch1" />);
    expect(screen.getByText('Compressor')).toBeDefined();
    expect(screen.getByTestId('knob-thresh')).toBeDefined();
    expect(screen.getByTestId('knob-ratio')).toBeDefined();
    expect(screen.getByTestId('knob-attack')).toBeDefined();
    expect(screen.getByTestId('knob-release')).toBeDefined();
    expect(screen.getByTestId('knob-knee')).toBeDefined();
    expect(screen.getByTestId('knob-makeup')).toBeDefined();
  });

  it('shows loading state when no channel data', () => {
    (useCompressorStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ channels: {}, loadChannel: mockLoadChannel, setParam: mockSetParam })
    );
    render(<CompressorPanel channelId="ch1" />);
    expect(screen.getByLabelText('Compressor panel loading')).toBeDefined();
  });

  it('calls loadChannel on mount', () => {
    render(<CompressorPanel channelId="ch1" />);
    expect(mockLoadChannel).toHaveBeenCalledWith('ch1');
  });

  it('calls setParam when threshold knob changes', () => {
    render(<CompressorPanel channelId="ch1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Thresh' }));
    expect(mockSetParam).toHaveBeenCalledWith('ch1', 'threshold_db', expect.any(Number));
  });

  it('renders gain reduction meter', () => {
    render(<CompressorPanel channelId="ch1" />);
    expect(screen.getByLabelText('Gain reduction meter')).toBeDefined();
  });

  it('displays positive gain reduction with minus sign', () => {
    (useCompressorStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
      selector({
        channels: { ch1: { ...baseChannel, gain_reduction_db: 6 } },
        loadChannel: mockLoadChannel,
        setParam: mockSetParam,
      })
    );
    render(<CompressorPanel channelId="ch1" />);
    expect(screen.getByText('-6.0dB')).toBeDefined();
  });

  it('displays ratio with :1 format', () => {
    render(<CompressorPanel channelId="ch1" />);
    expect(screen.getByText('4.0:1')).toBeDefined();
  });

  it('displays makeup with + prefix when positive', () => {
    render(<CompressorPanel channelId="ch1" />);
    expect(screen.getByText('+2.0dB')).toBeDefined();
  });
});
