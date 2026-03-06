import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockSetStep = vi.fn().mockResolvedValue(undefined);
const mockSetLength = vi.fn().mockResolvedValue(undefined);
const mockSetTimeDiv = vi.fn().mockResolvedValue(undefined);
const mockSetTranspose = vi.fn().mockResolvedValue(undefined);
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockReset = vi.fn().mockResolvedValue(undefined);
const mockSetCurrentStep = vi.fn();
const mockFetchState = vi.fn().mockResolvedValue(undefined);
const mockClearError = vi.fn();

function makeDefaultState(overrides = {}) {
  return {
    playing: false,
    current_step: 0,
    pattern_length: 16 as const,
    time_div: 16 as const,
    transpose: 0,
    steps: Array.from({ length: 64 }, () => ({
      enabled: false, note: 60, velocity: 100, gate: 0.8, probability: 100,
    })),
    ...overrides,
  };
}

let mockStoreState = {
  state: makeDefaultState(),
  initialized: true,
  error: null as string | null,
  initialize: mockInitialize,
  fetchState: mockFetchState,
  setStep: mockSetStep,
  setLength: mockSetLength,
  setTimeDiv: mockSetTimeDiv,
  setTranspose: mockSetTranspose,
  play: mockPlay,
  stop: mockStop,
  reset: mockReset,
  setCurrentStep: mockSetCurrentStep,
  clearError: mockClearError,
};

vi.mock('../../../stores/sequencerStore', () => ({
  useSequencerStore: () => mockStoreState,
}));

import { StepSequencerPanel } from '../StepSequencerPanel';

describe('StepSequencerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      state: makeDefaultState(),
      initialized: true,
      error: null,
      initialize: mockInitialize,
      fetchState: mockFetchState,
      setStep: mockSetStep,
      setLength: mockSetLength,
      setTimeDiv: mockSetTimeDiv,
      setTranspose: mockSetTranspose,
      play: mockPlay,
      stop: mockStop,
      reset: mockReset,
      setCurrentStep: mockSetCurrentStep,
      clearError: mockClearError,
    };
  });

  it('renders 16 step buttons by default', () => {
    render(<StepSequencerPanel />);
    const buttons = screen.getAllByRole('button', { name: /step (on|off)/i });
    expect(buttons).toHaveLength(16);
  });

  it('clicking step 0 calls setStep', () => {
    render(<StepSequencerPanel />);
    const buttons = screen.getAllByRole('button', { name: /step off/i });
    fireEvent.click(buttons[0]);
    expect(mockSetStep).toHaveBeenCalledWith(0, { enabled: true });
  });

  it('play button calls store.play', () => {
    render(<StepSequencerPanel />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('stop button calls store.stop', () => {
    mockStoreState = { ...mockStoreState, state: makeDefaultState({ playing: true }) };
    render(<StepSequencerPanel />);
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('reset button calls store.reset', () => {
    render(<StepSequencerPanel />);
    fireEvent.click(screen.getByLabelText('Reset'));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('length selector 32 calls setLength(32)', () => {
    render(<StepSequencerPanel />);
    fireEvent.click(screen.getByLabelText('Length 32'));
    expect(mockSetLength).toHaveBeenCalledWith(32);
  });

  it('time div 1/16 calls setTimeDiv(16)', () => {
    render(<StepSequencerPanel />);
    fireEvent.click(screen.getByLabelText('Div 1/16'));
    expect(mockSetTimeDiv).toHaveBeenCalledWith(16);
  });

  it('transpose slider calls setTranspose', () => {
    render(<StepSequencerPanel />);
    const slider = screen.getByLabelText('Transpose') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '5' } });
    expect(mockSetTranspose).toHaveBeenCalledWith(5);
  });

  it('current step highlights with ring class', () => {
    mockStoreState = { ...mockStoreState, state: makeDefaultState({ current_step: 0, playing: true }) };
    render(<StepSequencerPanel />);
    const buttons = screen.getAllByRole('button', { name: /step off/i });
    expect(buttons[0].className).toContain('ring-2');
  });

  it('64 steps renders 64 buttons', () => {
    mockStoreState = { ...mockStoreState, state: makeDefaultState({ pattern_length: 64 as const }) };
    render(<StepSequencerPanel />);
    const buttons = screen.getAllByRole('button', { name: /step (on|off)/i });
    expect(buttons).toHaveLength(64);
  });
});
