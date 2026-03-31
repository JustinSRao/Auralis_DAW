import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { useSidechainStore } = await import('../sidechainStore');

beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined);
  useSidechainStore.setState({ slots: {} });
});

describe('sidechainStore', () => {
  it('setSource stores slot state and calls IPC', async () => {
    await act(async () => {
      useSidechainStore.getState().setSource('bass', 'slot-1', 'kick', 100, true);
    });
    const slot = useSidechainStore.getState().slots['bass::slot-1'];
    expect(slot?.sourceChannelId).toBe('kick');
    expect(slot?.hpfCutoffHz).toBe(100);
    expect(slot?.hpfEnabled).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('set_sidechain_source', {
      destChannelId: 'bass',
      slotId: 'slot-1',
      sourceChannelId: 'kick',
      hpfCutoffHz: 100,
      hpfEnabled: true,
    });
  });

  it('removeSource sets sourceChannelId to null and calls IPC', async () => {
    useSidechainStore.setState({
      slots: { 'bass::slot-1': { sourceChannelId: 'kick', hpfCutoffHz: 100, hpfEnabled: true } },
    });
    await act(async () => {
      useSidechainStore.getState().removeSource('bass', 'slot-1');
    });
    expect(useSidechainStore.getState().slots['bass::slot-1']?.sourceChannelId).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('remove_sidechain', {
      destChannelId: 'bass',
      slotId: 'slot-1',
    });
  });

  it('setFilter updates cutoff and enabled state and calls IPC', async () => {
    useSidechainStore.setState({
      slots: { 'bass::slot-1': { sourceChannelId: 'kick', hpfCutoffHz: 100, hpfEnabled: true } },
    });
    await act(async () => {
      useSidechainStore.getState().setFilter('bass', 'slot-1', 200, false);
    });
    const slot = useSidechainStore.getState().slots['bass::slot-1'];
    expect(slot?.hpfCutoffHz).toBe(200);
    expect(slot?.hpfEnabled).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('set_sidechain_filter', {
      destChannelId: 'bass',
      slotId: 'slot-1',
      cutoffHz: 200,
      enabled: false,
    });
  });

  it('multiple slots are keyed independently', async () => {
    await act(async () => {
      useSidechainStore.getState().setSource('ch-a', 's1', 'kick', 100, true);
      useSidechainStore.getState().setSource('ch-b', 's2', 'snare', 80, false);
    });
    expect(useSidechainStore.getState().slots['ch-a::s1']?.sourceChannelId).toBe('kick');
    expect(useSidechainStore.getState().slots['ch-b::s2']?.sourceChannelId).toBe('snare');
  });
});
