/**
 * Unit tests for reverbStore (Sprint 19).
 */
import { invoke } from '@tauri-apps/api/core';
import { useReverbStore } from '../reverbStore';

const mockInvoke = vi.mocked(invoke);

const defaultSnapshot = {
  channel_id: 'ch-1',
  room_size: 0.5,
  decay: 1.5,
  pre_delay_ms: 0,
  wet: 0.3,
  damping: 0.5,
  width: 1.0,
};

describe('reverbStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    useReverbStore.setState({ channels: {} });
  });

  it('starts with empty channels', () => {
    const { channels } = useReverbStore.getState();
    expect(Object.keys(channels)).toHaveLength(0);
  });

  it('applySnapshot creates channel entry', () => {
    useReverbStore.getState().applySnapshot(defaultSnapshot);
    const { channels } = useReverbStore.getState();
    expect(channels['ch-1']).toBeDefined();
    expect(channels['ch-1'].room_size).toBe(0.5);
  });

  it('loadChannel calls ipcGetReverbState and applies snapshot', async () => {
    mockInvoke.mockResolvedValueOnce(defaultSnapshot);
    await useReverbStore.getState().loadChannel('ch-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_reverb_state', { channelId: 'ch-1' });
    expect(useReverbStore.getState().channels['ch-1'].decay).toBe(1.5);
  });

  it('setParam updates channel state and calls ipc', async () => {
    useReverbStore.getState().applySnapshot(defaultSnapshot);
    mockInvoke.mockResolvedValueOnce(undefined);
    useReverbStore.getState().setParam('ch-1', 'room_size', 0.8);
    expect(useReverbStore.getState().channels['ch-1'].room_size).toBe(0.8);
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_reverb_param', {
        channelId: 'ch-1',
        paramName: 'room_size',
        value: 0.8,
      });
    });
  });

  it('setParam on unloaded channel creates default entry', () => {
    useReverbStore.getState().setParam('ch-new', 'wet', 0.5);
    expect(useReverbStore.getState().channels['ch-new']).toBeDefined();
    expect(useReverbStore.getState().channels['ch-new'].wet).toBe(0.5);
  });
});
