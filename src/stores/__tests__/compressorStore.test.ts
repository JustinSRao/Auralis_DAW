import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

// Import after mock
const { useCompressorStore } = await import('../compressorStore');

beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined);
  useCompressorStore.setState({ channels: {} });
});

describe('compressorStore', () => {
  it('loadChannel populates channel from IPC snapshot', async () => {
    const snapshot = {
      channel_id: 'ch1',
      threshold_db: -20,
      ratio: 4,
      attack_ms: 10,
      release_ms: 100,
      knee_db: 6,
      makeup_db: 3,
      enabled: true,
      gain_reduction_db: 0,
    };
    mockInvoke.mockResolvedValueOnce(snapshot);
    await act(async () => {
      await useCompressorStore.getState().loadChannel('ch1');
    });
    expect(useCompressorStore.getState().channels['ch1']).toMatchObject(snapshot);
  });

  it('setParam updates threshold_db and calls IPC', async () => {
    await act(async () => {
      useCompressorStore.getState().setParam('ch1', 'threshold_db', -30);
    });
    expect(useCompressorStore.getState().channels['ch1'].threshold_db).toBe(-30);
    expect(mockInvoke).toHaveBeenCalledWith('set_compressor_param', {
      channelId: 'ch1',
      paramName: 'threshold_db',
      value: -30,
    });
  });

  it('setParam seeds missing channel with defaults before updating', async () => {
    await act(async () => {
      useCompressorStore.getState().setParam('new-ch', 'ratio', 8);
    });
    const ch = useCompressorStore.getState().channels['new-ch'];
    expect(ch).toBeDefined();
    expect(ch.ratio).toBe(8);
  });

  it('applySnapshot replaces channel data', () => {
    const snap = {
      channel_id: 'ch2',
      threshold_db: -10,
      ratio: 2,
      attack_ms: 5,
      release_ms: 50,
      knee_db: 3,
      makeup_db: 0,
      enabled: true,
      gain_reduction_db: 2.5,
    };
    act(() => { useCompressorStore.getState().applySnapshot(snap); });
    expect(useCompressorStore.getState().channels['ch2'].gain_reduction_db).toBe(2.5);
  });

  it('setParam updates makeup_db', async () => {
    await act(async () => {
      useCompressorStore.getState().setParam('ch1', 'makeup_db', 6);
    });
    expect(useCompressorStore.getState().channels['ch1'].makeup_db).toBe(6);
  });
});
