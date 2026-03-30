/**
 * Unit tests for delayStore (Sprint 19).
 */
import { invoke } from '@tauri-apps/api/core';
import { useDelayStore } from '../delayStore';

const mockInvoke = vi.mocked(invoke);

const defaultSnapshot = {
  channel_id: 'ch-1',
  delay_mode: { mode: 'ms' as const, ms: 250 },
  feedback: 0.4,
  wet: 0.3,
  ping_pong: false,
  hicut_hz: 8000,
};

describe('delayStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    useDelayStore.setState({ channels: {} });
  });

  it('starts with empty channels', () => {
    expect(Object.keys(useDelayStore.getState().channels)).toHaveLength(0);
  });

  it('applySnapshot creates channel entry', () => {
    useDelayStore.getState().applySnapshot(defaultSnapshot);
    expect(useDelayStore.getState().channels['ch-1'].feedback).toBe(0.4);
  });

  it('loadChannel calls ipcGetDelayState and applies snapshot', async () => {
    mockInvoke.mockResolvedValueOnce(defaultSnapshot);
    await useDelayStore.getState().loadChannel('ch-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_delay_state', { channelId: 'ch-1' });
    expect(useDelayStore.getState().channels['ch-1'].ping_pong).toBe(false);
  });

  it('setParam updates feedback and calls ipc', async () => {
    useDelayStore.getState().applySnapshot(defaultSnapshot);
    mockInvoke.mockResolvedValueOnce(undefined);
    useDelayStore.getState().setParam('ch-1', 'feedback', 0.7);
    expect(useDelayStore.getState().channels['ch-1'].feedback).toBe(0.7);
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_delay_param', {
        channelId: 'ch-1',
        paramName: 'feedback',
        value: 0.7,
      });
    });
  });

  it('setPingPong sends 1.0 for true', async () => {
    useDelayStore.getState().applySnapshot(defaultSnapshot);
    mockInvoke.mockResolvedValueOnce(undefined);
    useDelayStore.getState().setPingPong('ch-1', true);
    expect(useDelayStore.getState().channels['ch-1'].ping_pong).toBe(true);
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_delay_param', {
        channelId: 'ch-1',
        paramName: 'ping_pong',
        value: 1.0,
      });
    });
  });

  it('setDelayMode to sync calls set_delay_sync', async () => {
    useDelayStore.getState().applySnapshot(defaultSnapshot);
    mockInvoke.mockResolvedValueOnce(undefined);
    useDelayStore.getState().setDelayMode('ch-1', { mode: 'sync', div: 'quarter' }, 120);
    expect(useDelayStore.getState().channels['ch-1'].delay_mode).toEqual({
      mode: 'sync',
      div: 'quarter',
    });
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_delay_sync', {
        channelId: 'ch-1',
        noteDiv: 'quarter',
        bpm: 120,
      });
    });
  });

  it('setDelayMode to ms calls set_delay_param with delay_ms', async () => {
    useDelayStore.getState().applySnapshot({
      ...defaultSnapshot,
      delay_mode: { mode: 'sync', div: 'quarter' },
    });
    mockInvoke.mockResolvedValueOnce(undefined);
    useDelayStore.getState().setDelayMode('ch-1', { mode: 'ms', ms: 500 }, 120);
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_delay_param', {
        channelId: 'ch-1',
        paramName: 'delay_ms',
        value: 500,
      });
    });
  });

  it('setParam on unloaded channel creates default entry', () => {
    useDelayStore.getState().setParam('ch-new', 'wet', 0.6);
    expect(useDelayStore.getState().channels['ch-new']).toBeDefined();
    expect(useDelayStore.getState().channels['ch-new'].wet).toBe(0.6);
  });
});
