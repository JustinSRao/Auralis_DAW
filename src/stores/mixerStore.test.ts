/**
 * Unit tests for mixerStore (Sprint 17).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — factory must use only inline vi.fn() calls, not outer vars.
vi.mock('../lib/ipc', () => ({
  ipcSetChannelFader: vi.fn().mockResolvedValue(undefined),
  ipcSetChannelPan: vi.fn().mockResolvedValue(undefined),
  ipcSetChannelMute: vi.fn().mockResolvedValue(undefined),
  ipcSetChannelSolo: vi.fn().mockResolvedValue(undefined),
  ipcSetChannelSend: vi.fn().mockResolvedValue(undefined),
  ipcSetMasterFader: vi.fn().mockResolvedValue(undefined),
}));

// Import the real store and the mocked IPC module AFTER the mock declaration.
import { useMixerStore } from './mixerStore';
import type { MixerSnapshot } from '../lib/ipc';
import * as ipc from '../lib/ipc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MixerSnapshot> = {}): MixerSnapshot {
  return {
    channels: [
      {
        id: 'ch-1',
        name: 'Kick',
        fader: 1.0,
        pan: 0,
        mute: false,
        solo: false,
        sends: [0, 0, 0, 0],
      },
      {
        id: 'ch-2',
        name: 'Snare',
        fader: 0.8,
        pan: -0.2,
        mute: true,
        solo: false,
        sends: [0.5, 0, 0, 0],
      },
    ],
    buses: [{ id: 'bus-1', name: 'Reverb', fader: 1.0 }],
    master_fader: 0.9,
    ...overrides,
  };
}

function resetStore() {
  useMixerStore.setState({
    channels: {},
    buses: [],
    masterFader: 1.0,
    masterPeakL: 0,
    masterPeakR: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ---------------------------------------------------------------------------
// hydrate
// ---------------------------------------------------------------------------

describe('hydrate', () => {
  it('populates channels from snapshot', () => {
    useMixerStore.getState().hydrate(makeSnapshot());

    const { channels } = useMixerStore.getState();
    expect(Object.keys(channels)).toHaveLength(2);
    expect(channels['ch-1']).toBeDefined();
    expect(channels['ch-1']?.name).toBe('Kick');
    expect(channels['ch-1']?.fader).toBe(1.0);
  });

  it('populates buses from snapshot', () => {
    useMixerStore.getState().hydrate(makeSnapshot());

    const { buses } = useMixerStore.getState();
    expect(buses).toHaveLength(1);
    expect(buses[0]?.id).toBe('bus-1');
    expect(buses[0]?.name).toBe('Reverb');
  });

  it('sets masterFader from snapshot', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    expect(useMixerStore.getState().masterFader).toBe(0.9);
  });

  it('initialises peakL and peakR to 0 for each channel', () => {
    useMixerStore.getState().hydrate(makeSnapshot());

    const { channels } = useMixerStore.getState();
    expect(channels['ch-1']?.peakL).toBe(0);
    expect(channels['ch-1']?.peakR).toBe(0);
    expect(channels['ch-2']?.peakL).toBe(0);
    expect(channels['ch-2']?.peakR).toBe(0);
  });

  it('replaces channels on subsequent hydrate calls', () => {
    useMixerStore.getState().hydrate(makeSnapshot());

    const newSnapshot: MixerSnapshot = {
      channels: [
        { id: 'ch-99', name: 'Bass', fader: 1.0, pan: 0, mute: false, solo: false, sends: [0, 0, 0, 0] },
      ],
      buses: [],
      master_fader: 1.0,
    };
    useMixerStore.getState().hydrate(newSnapshot);

    const { channels } = useMixerStore.getState();
    expect(Object.keys(channels)).toHaveLength(1);
    expect(channels['ch-99']).toBeDefined();
    expect(channels['ch-1']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setChannelFader
// ---------------------------------------------------------------------------

describe('setChannelFader', () => {
  it('updates fader value in store', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelFader('ch-1', 0.5);

    expect(useMixerStore.getState().channels['ch-1']?.fader).toBe(0.5);
  });

  it('calls ipcSetChannelFader with correct args', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelFader('ch-1', 0.75);

    expect(ipc.ipcSetChannelFader).toHaveBeenCalledOnce();
    expect(ipc.ipcSetChannelFader).toHaveBeenCalledWith('ch-1', 0.75);
  });

  it('does not update store when channelId is unknown', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelFader('unknown-ch', 0.5);

    expect(useMixerStore.getState().channels['unknown-ch']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setChannelMute
// ---------------------------------------------------------------------------

describe('setChannelMute', () => {
  it('sets mute to true', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelMute('ch-1', true);

    expect(useMixerStore.getState().channels['ch-1']?.mute).toBe(true);
  });

  it('sets mute to false (toggles off)', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    // ch-2 starts muted (mute: true in snapshot)
    useMixerStore.getState().setChannelMute('ch-2', false);

    expect(useMixerStore.getState().channels['ch-2']?.mute).toBe(false);
  });

  it('calls ipcSetChannelMute', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelMute('ch-1', true);

    expect(ipc.ipcSetChannelMute).toHaveBeenCalledWith('ch-1', true);
  });
});

// ---------------------------------------------------------------------------
// setChannelSolo
// ---------------------------------------------------------------------------

describe('setChannelSolo', () => {
  it('sets solo to true', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelSolo('ch-1', true);

    expect(useMixerStore.getState().channels['ch-1']?.solo).toBe(true);
  });

  it('sets solo to false (toggles off)', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelSolo('ch-1', true);
    useMixerStore.getState().setChannelSolo('ch-1', false);

    expect(useMixerStore.getState().channels['ch-1']?.solo).toBe(false);
  });

  it('calls ipcSetChannelSolo', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().setChannelSolo('ch-2', true);

    expect(ipc.ipcSetChannelSolo).toHaveBeenCalledWith('ch-2', true);
  });
});

// ---------------------------------------------------------------------------
// applyChannelLevel
// ---------------------------------------------------------------------------

describe('applyChannelLevel', () => {
  it('updates peakL and peakR for the channel', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    useMixerStore.getState().applyChannelLevel('ch-1', 0.7, 0.65);

    const ch = useMixerStore.getState().channels['ch-1'];
    expect(ch?.peakL).toBe(0.7);
    expect(ch?.peakR).toBe(0.65);
  });

  it('does not call any IPC function', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    vi.clearAllMocks();
    useMixerStore.getState().applyChannelLevel('ch-1', 0.5, 0.5);

    expect(ipc.ipcSetChannelFader).not.toHaveBeenCalled();
    expect(ipc.ipcSetChannelMute).not.toHaveBeenCalled();
    expect(ipc.ipcSetChannelSolo).not.toHaveBeenCalled();
    expect(ipc.ipcSetMasterFader).not.toHaveBeenCalled();
  });

  it('does not crash for unknown channelId', () => {
    useMixerStore.getState().hydrate(makeSnapshot());
    expect(() =>
      useMixerStore.getState().applyChannelLevel('ghost', 0.5, 0.5)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyMasterLevel
// ---------------------------------------------------------------------------

describe('applyMasterLevel', () => {
  it('updates masterPeakL and masterPeakR', () => {
    useMixerStore.getState().applyMasterLevel(0.9, 0.85);

    const state = useMixerStore.getState();
    expect(state.masterPeakL).toBe(0.9);
    expect(state.masterPeakR).toBe(0.85);
  });

  it('does not call any IPC function', () => {
    vi.clearAllMocks();
    useMixerStore.getState().applyMasterLevel(0.5, 0.5);

    expect(ipc.ipcSetMasterFader).not.toHaveBeenCalled();
  });
});
