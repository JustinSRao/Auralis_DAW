import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { useGateStore } = await import('../gateStore');

beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined);
  useGateStore.setState({ channels: {} });
});

describe('gateStore', () => {
  it('loadChannel populates channel from IPC snapshot', async () => {
    const snapshot = {
      channel_id: 'ch1',
      threshold_db: -40,
      attack_ms: 1,
      hold_ms: 50,
      release_ms: 100,
      range_db: -60,
      enabled: true,
      gain_reduction_db: 0,
    };
    mockInvoke.mockResolvedValueOnce(snapshot);
    await act(async () => {
      await useGateStore.getState().loadChannel('ch1');
    });
    expect(useGateStore.getState().channels['ch1']).toMatchObject(snapshot);
  });

  it('setParam updates threshold_db and calls IPC', async () => {
    await act(async () => {
      useGateStore.getState().setParam('ch1', 'threshold_db', -50);
    });
    expect(useGateStore.getState().channels['ch1'].threshold_db).toBe(-50);
    expect(mockInvoke).toHaveBeenCalledWith('set_gate_param', {
      channelId: 'ch1',
      paramName: 'threshold_db',
      value: -50,
    });
  });

  it('setParam seeds missing channel with defaults', async () => {
    await act(async () => {
      useGateStore.getState().setParam('new-ch', 'hold_ms', 200);
    });
    const ch = useGateStore.getState().channels['new-ch'];
    expect(ch).toBeDefined();
    expect(ch.hold_ms).toBe(200);
  });

  it('applySnapshot replaces channel data', () => {
    const snap = {
      channel_id: 'ch2',
      threshold_db: -30,
      attack_ms: 2,
      hold_ms: 80,
      release_ms: 150,
      range_db: -80,
      enabled: true,
      gain_reduction_db: 0,
    };
    act(() => { useGateStore.getState().applySnapshot(snap); });
    expect(useGateStore.getState().channels['ch2'].range_db).toBe(-80);
  });

  it('setParam updates range_db', async () => {
    await act(async () => {
      useGateStore.getState().setParam('ch1', 'range_db', -90);
    });
    expect(useGateStore.getState().channels['ch1'].range_db).toBe(-90);
  });
});
