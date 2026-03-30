import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { useLimiterStore } = await import('../limiterStore');

beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined);
  useLimiterStore.setState({ channels: {} });
});

describe('limiterStore', () => {
  it('loadChannel populates channel from IPC snapshot', async () => {
    const snapshot = {
      channel_id: 'ch1',
      ceiling_db: -0.3,
      release_ms: 50,
      enabled: true,
      gain_reduction_db: 0,
    };
    mockInvoke.mockResolvedValueOnce(snapshot);
    await act(async () => {
      await useLimiterStore.getState().loadChannel('ch1');
    });
    expect(useLimiterStore.getState().channels['ch1']).toMatchObject(snapshot);
  });

  it('setParam updates ceiling_db and calls IPC', async () => {
    await act(async () => {
      useLimiterStore.getState().setParam('ch1', 'ceiling_db', -1);
    });
    expect(useLimiterStore.getState().channels['ch1'].ceiling_db).toBe(-1);
    expect(mockInvoke).toHaveBeenCalledWith('set_limiter_param', {
      channelId: 'ch1',
      paramName: 'ceiling_db',
      value: -1,
    });
  });

  it('setParam seeds missing channel with defaults', async () => {
    await act(async () => {
      useLimiterStore.getState().setParam('new-ch', 'release_ms', 200);
    });
    const ch = useLimiterStore.getState().channels['new-ch'];
    expect(ch).toBeDefined();
    expect(ch.release_ms).toBe(200);
  });

  it('applySnapshot replaces channel data', () => {
    const snap = {
      channel_id: 'ch2',
      ceiling_db: -2,
      release_ms: 100,
      enabled: true,
      gain_reduction_db: 3,
    };
    act(() => { useLimiterStore.getState().applySnapshot(snap); });
    expect(useLimiterStore.getState().channels['ch2'].gain_reduction_db).toBe(3);
  });

  it('setParam updates release_ms', async () => {
    await act(async () => {
      useLimiterStore.getState().setParam('ch1', 'release_ms', 300);
    });
    expect(useLimiterStore.getState().channels['ch1'].release_ms).toBe(300);
  });
});
