import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { useEffectChainStore } = await import('../effectChainStore');

const baseSnapshot = {
  channel_id: 'ch1',
  slots: [
    { slot_id: 'slot-1', effect_type: 'compressor' as const, bypass: false, wet_dry: 1.0 },
  ],
};

beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined);
  useEffectChainStore.setState({ chains: {}, presetNames: [] });
});

describe('effectChainStore', () => {
  it('loadChain calls get_chain_state and populates chains', async () => {
    mockInvoke.mockResolvedValueOnce(baseSnapshot);
    await act(async () => {
      await useEffectChainStore.getState().loadChain('ch1');
    });
    expect(useEffectChainStore.getState().chains['ch1']).toMatchObject(baseSnapshot);
  });

  it('addEffect calls add_effect_to_chain then reloads chain', async () => {
    mockInvoke.mockResolvedValueOnce('slot-abc'); // add_effect_to_chain
    mockInvoke.mockResolvedValueOnce(baseSnapshot); // get_chain_state (reload)
    await act(async () => {
      const id = await useEffectChainStore.getState().addEffect('ch1', 'reverb');
      expect(id).toBe('slot-abc');
    });
    expect(mockInvoke).toHaveBeenCalledWith('add_effect_to_chain', expect.objectContaining({
      channelId: 'ch1',
      effectType: 'reverb',
    }));
  });

  it('setBypass updates local state optimistically', async () => {
    useEffectChainStore.setState({ chains: { ch1: baseSnapshot }, presetNames: [] });
    await act(async () => {
      useEffectChainStore.getState().setBypass('ch1', 'slot-1', true);
    });
    expect(useEffectChainStore.getState().chains['ch1'].slots[0].bypass).toBe(true);
  });

  it('setWetDry updates local state optimistically', async () => {
    useEffectChainStore.setState({ chains: { ch1: baseSnapshot }, presetNames: [] });
    await act(async () => {
      useEffectChainStore.getState().setWetDry('ch1', 'slot-1', 0.5);
    });
    expect(useEffectChainStore.getState().chains['ch1'].slots[0].wet_dry).toBe(0.5);
  });

  it('refreshPresets populates presetNames', async () => {
    mockInvoke.mockResolvedValueOnce(['my-preset', 'another']);
    await act(async () => {
      await useEffectChainStore.getState().refreshPresets();
    });
    expect(useEffectChainStore.getState().presetNames).toEqual(['my-preset', 'another']);
  });

  it('applySnapshot directly sets chain state', () => {
    act(() => { useEffectChainStore.getState().applySnapshot(baseSnapshot); });
    expect(useEffectChainStore.getState().chains['ch1']).toBe(baseSnapshot);
  });

  it('removeEffect calls IPC and reloads chain', async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // remove
    mockInvoke.mockResolvedValueOnce({ channel_id: 'ch1', slots: [] }); // reload
    await act(async () => {
      await useEffectChainStore.getState().removeEffect('ch1', 'slot-1');
    });
    expect(mockInvoke).toHaveBeenCalledWith('remove_effect_from_chain', {
      channelId: 'ch1',
      slotId: 'slot-1',
    });
  });
});
