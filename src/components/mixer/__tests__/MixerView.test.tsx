/**
 * Unit tests for MixerView component (Sprint 17).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock IPC — ipcGetMixerState is called on mount.
// The factory uses only inline vi.fn() to avoid hoisting issues.
// ---------------------------------------------------------------------------

vi.mock('../../../lib/ipc', () => ({
  ipcGetMixerState: vi.fn().mockResolvedValue({
    channels: [],
    buses: [],
    master_fader: 1.0,
  }),
}));

// ---------------------------------------------------------------------------
// Mock the mixer store.
//
// MixerView uses useMixerStore in two ways:
//   1. Destructured call with no selector:
//        const { hydrate, applyChannelLevel, applyMasterLevel } = useMixerStore()
//   2. Selector call:
//        const channelIds = useMixerStore((s) => Object.keys(s.channels))
//
// The mock handles both by checking whether the argument is a function.
// ---------------------------------------------------------------------------

const mockHydrate = vi.fn();
const mockApplyChannelLevel = vi.fn();
const mockApplyMasterLevel = vi.fn();

interface MockState {
  channels: Record<string, unknown>;
  buses: unknown[];
  masterFader: number;
  masterPeakL: number;
  masterPeakR: number;
  hydrate: typeof mockHydrate;
  applyChannelLevel: typeof mockApplyChannelLevel;
  applyMasterLevel: typeof mockApplyMasterLevel;
  setMasterFader: ReturnType<typeof vi.fn>;
}

let mockState: MockState = {
  channels: {},
  buses: [],
  masterFader: 1.0,
  masterPeakL: 0,
  masterPeakR: 0,
  hydrate: mockHydrate,
  applyChannelLevel: mockApplyChannelLevel,
  applyMasterLevel: mockApplyMasterLevel,
  setMasterFader: vi.fn(),
};

vi.mock('../../../stores/mixerStore', () => ({
  useMixerStore: (selector?: (s: MockState) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockState);
    }
    return mockState;
  },
}));

import MixerView from '../MixerView';

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockState = {
    channels: {},
    buses: [],
    masterFader: 1.0,
    masterPeakL: 0,
    masterPeakR: 0,
    hydrate: mockHydrate,
    applyChannelLevel: mockApplyChannelLevel,
    applyMasterLevel: mockApplyMasterLevel,
    setMasterFader: vi.fn(),
  };
});

describe('MixerView', () => {
  it('renders without crashing with empty store', () => {
    const { container } = render(<MixerView />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders MasterStrip (MASTER label is visible)', () => {
    render(<MixerView />);
    expect(screen.getByText('MASTER')).toBeTruthy();
  });

  it('renders no channel name labels when channels is empty', () => {
    render(<MixerView />);
    // Only the MASTER label should be present — no per-channel name spans
    expect(screen.getByText('MASTER')).toBeTruthy();
    expect(screen.queryByTitle(/Kick|Snare|Bass/)).toBeNull();
  });

  it('calls ipcGetMixerState on mount', async () => {
    const { ipcGetMixerState } = await import('../../../lib/ipc');
    render(<MixerView />);
    // ipcGetMixerState is invoked in a useEffect; flush the microtask queue
    await Promise.resolve();
    expect(ipcGetMixerState).toHaveBeenCalledOnce();
  });

  it('renders the master fader value label', () => {
    render(<MixerView />);
    // masterFader is 1.0, so the label shows "1.00"
    expect(screen.getByText('1.00')).toBeTruthy();
  });
});
