import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

const { useMixerStore } = await import('../mixerStore');

const emptyState = () =>
  useMixerStore.setState({
    channels: {},
    buses: [],
    masterFader: 1.0,
    masterPeakL: 0,
    masterPeakR: 0,
    groupBuses: [],
  });

beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined);
  emptyState();
});

describe('mixerStore — group bus actions', () => {
  it('hydrateGroupBuses populates groupBuses from snapshots', () => {
    useMixerStore.getState().hydrateGroupBuses([
      { id: 0, name: 'Drums', output_target: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peak_l: 0, peak_r: 0 },
    ]);
    const buses = useMixerStore.getState().groupBuses;
    expect(buses).toHaveLength(1);
    expect(buses[0].name).toBe('Drums');
    expect(buses[0].outputTarget.kind).toBe('master');
  });

  it('createGroupBus calls IPC and adds bus to state', async () => {
    mockInvoke.mockResolvedValueOnce(0); // backend returns id=0
    await act(async () => {
      await useMixerStore.getState().createGroupBus('Brass');
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_group_bus', { name: 'Brass' });
    expect(useMixerStore.getState().groupBuses[0].name).toBe('Brass');
    expect(useMixerStore.getState().groupBuses[0].id).toBe(0);
  });

  it('deleteGroupBus calls IPC and removes bus from state', async () => {
    useMixerStore.setState({
      groupBuses: [
        { id: 0, name: 'Drums', outputTarget: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0 },
      ],
    } as Parameters<typeof useMixerStore.setState>[0]);
    await act(async () => {
      await useMixerStore.getState().deleteGroupBus(0);
    });
    expect(mockInvoke).toHaveBeenCalledWith('delete_group_bus', { busId: 0 });
    expect(useMixerStore.getState().groupBuses).toHaveLength(0);
  });

  it('renameGroupBus calls IPC and updates name', async () => {
    useMixerStore.setState({
      groupBuses: [
        { id: 0, name: 'Drums', outputTarget: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0 },
      ],
    } as Parameters<typeof useMixerStore.setState>[0]);
    await act(async () => {
      await useMixerStore.getState().renameGroupBus(0, 'Percussion');
    });
    expect(mockInvoke).toHaveBeenCalledWith('rename_group_bus', { busId: 0, name: 'Percussion' });
    expect(useMixerStore.getState().groupBuses[0].name).toBe('Percussion');
  });

  it('setGroupBusFader updates store and calls IPC', () => {
    useMixerStore.setState({
      groupBuses: [
        { id: 0, name: 'Drums', outputTarget: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0 },
      ],
    } as Parameters<typeof useMixerStore.setState>[0]);
    useMixerStore.getState().setGroupBusFader(0, 0.5);
    expect(useMixerStore.getState().groupBuses[0].fader).toBe(0.5);
    expect(mockInvoke).toHaveBeenCalledWith('set_group_bus_fader', { busId: 0, value: 0.5 });
  });

  it('setGroupBusMute updates store and calls IPC', () => {
    useMixerStore.setState({
      groupBuses: [
        { id: 0, name: 'Drums', outputTarget: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0 },
      ],
    } as Parameters<typeof useMixerStore.setState>[0]);
    useMixerStore.getState().setGroupBusMute(0, true);
    expect(useMixerStore.getState().groupBuses[0].mute).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('set_group_bus_mute', { busId: 0, muted: true });
  });

  it('setGroupBusOutput calls IPC and updates outputTarget', async () => {
    useMixerStore.setState({
      groupBuses: [
        { id: 0, name: 'Drums', outputTarget: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0 },
        { id: 1, name: 'Synths', outputTarget: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0 },
      ],
    } as Parameters<typeof useMixerStore.setState>[0]);
    await act(async () => {
      await useMixerStore.getState().setGroupBusOutput(0, { kind: 'group', group_id: 1 });
    });
    expect(mockInvoke).toHaveBeenCalledWith('set_group_bus_output', {
      busId: 0,
      target: { kind: 'group', group_id: 1 },
    });
    expect(useMixerStore.getState().groupBuses[0].outputTarget).toEqual({ kind: 'group', group_id: 1 });
  });

  it('applyGroupBusLevel updates peak values', () => {
    useMixerStore.setState({
      groupBuses: [
        { id: 0, name: 'Drums', outputTarget: { kind: 'master' }, fader: 1, pan: 0, mute: false, solo: false, peakL: 0, peakR: 0 },
      ],
    } as Parameters<typeof useMixerStore.setState>[0]);
    useMixerStore.getState().applyGroupBusLevel(0, 0.8, 0.75);
    const gb = useMixerStore.getState().groupBuses[0];
    expect(gb.peakL).toBe(0.8);
    expect(gb.peakR).toBe(0.75);
  });
});
