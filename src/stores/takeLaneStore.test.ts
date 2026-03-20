/**
 * Unit tests for takeLaneStore (Sprint 44).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTakeLaneStore } from './takeLaneStore';
import type { Take, TakeCreatedEvent } from '../lib/ipc';

// Mock all IPC calls so no real Tauri invoke happens.
vi.mock('../lib/ipc', () => ({
  ipcGetTakeLanes: vi.fn().mockResolvedValue({ trackId: 't1', takes: [], compRegions: [], expanded: true }),
  ipcSetActiveTake: vi.fn().mockResolvedValue(undefined),
  ipcDeleteTake: vi.fn().mockResolvedValue(undefined),
  ipcToggleTakeLaneExpanded: vi.fn().mockResolvedValue(true),
  ipcArmLoopRecording: vi.fn().mockResolvedValue(undefined),
}));

function makeTake(id: string, num: number, trackId = 't1'): Take {
  return {
    id,
    patternId: `p-${id}`,
    takeNumber: num,
    trackId,
    loopStartBeats: 0,
    loopEndBeats: 4,
    isActive: false,
  };
}

function makeEvent(take: Take): TakeCreatedEvent {
  return { take, trackId: take.trackId };
}

function resetStore() {
  useTakeLaneStore.setState({ lanes: {}, loopRecordArmed: false, activeLoopTrackId: null });
}

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// onTakeCreated
// ---------------------------------------------------------------------------

describe('onTakeCreated', () => {
  it('adds take to lane', () => {
    const store = useTakeLaneStore.getState();
    store.onTakeCreated(makeEvent(makeTake('a', 1)));

    const lanes = useTakeLaneStore.getState().lanes;
    expect(lanes['t1']?.takes).toHaveLength(1);
    expect(lanes['t1']?.takes[0].id).toBe('a');
  });

  it('deactivates previous takes when new take created', () => {
    const store = useTakeLaneStore.getState();
    store.onTakeCreated(makeEvent({ ...makeTake('a', 1), isActive: true }));
    store.onTakeCreated(makeEvent({ ...makeTake('b', 2), isActive: true }));

    const lanes = useTakeLaneStore.getState().lanes;
    expect(lanes['t1']?.takes[0].isActive).toBe(false);
    expect(lanes['t1']?.takes[1].isActive).toBe(true);
  });

  it('creates lane if it does not exist', () => {
    useTakeLaneStore.getState().onTakeCreated(makeEvent(makeTake('a', 1, 'new-track')));
    const lanes = useTakeLaneStore.getState().lanes;
    expect(lanes['new-track']).toBeDefined();
    expect(lanes['new-track']?.takes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// setActiveTake
// ---------------------------------------------------------------------------

describe('setActiveTake', () => {
  it('updates isActive in store', async () => {
    const store = useTakeLaneStore.getState();
    store.onTakeCreated(makeEvent(makeTake('a', 1)));
    store.onTakeCreated(makeEvent(makeTake('b', 2)));

    await useTakeLaneStore.getState().setActiveTake('t1', 'a');

    const lanes = useTakeLaneStore.getState().lanes;
    expect(lanes['t1']?.takes.find((t) => t.id === 'a')?.isActive).toBe(true);
    expect(lanes['t1']?.takes.find((t) => t.id === 'b')?.isActive).toBe(false);
  });

  it('deactivates other takes when setting one active', async () => {
    const store = useTakeLaneStore.getState();
    store.onTakeCreated(makeEvent(makeTake('a', 1)));
    store.onTakeCreated(makeEvent(makeTake('b', 2)));
    store.onTakeCreated(makeEvent(makeTake('c', 3)));

    await useTakeLaneStore.getState().setActiveTake('t1', 'b');

    const takes = useTakeLaneStore.getState().lanes['t1']?.takes ?? [];
    expect(takes.filter((t) => t.isActive)).toHaveLength(1);
    expect(takes.find((t) => t.isActive)?.id).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// deleteTake
// ---------------------------------------------------------------------------

describe('deleteTake', () => {
  it('removes take from lane', async () => {
    const store = useTakeLaneStore.getState();
    store.onTakeCreated(makeEvent(makeTake('a', 1)));
    store.onTakeCreated(makeEvent(makeTake('b', 2)));

    await useTakeLaneStore.getState().deleteTake('t1', 'a');

    const takes = useTakeLaneStore.getState().lanes['t1']?.takes ?? [];
    expect(takes).toHaveLength(1);
    expect(takes[0].id).toBe('b');
  });

  it('activates last remaining take when active take deleted', async () => {
    const store = useTakeLaneStore.getState();
    store.onTakeCreated(makeEvent(makeTake('a', 1)));
    store.onTakeCreated(makeEvent(makeTake('b', 2)));
    // 'b' is active (newest). Delete 'b', 'a' should become active.
    await useTakeLaneStore.getState().deleteTake('t1', 'b');

    const takes = useTakeLaneStore.getState().lanes['t1']?.takes ?? [];
    expect(takes).toHaveLength(1);
    expect(takes[0].isActive).toBe(true);
  });

  it('does not crash when deleting from non-existent lane', async () => {
    await expect(
      useTakeLaneStore.getState().deleteTake('ghost-track', 'take-id'),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setLoopRecordArmed
// ---------------------------------------------------------------------------

describe('setLoopRecordArmed', () => {
  it('sets armed state and active track id', () => {
    useTakeLaneStore.getState().setLoopRecordArmed(true, 't1');
    const state = useTakeLaneStore.getState();
    expect(state.loopRecordArmed).toBe(true);
    expect(state.activeLoopTrackId).toBe('t1');
  });

  it('clears active track id when disarmed', () => {
    useTakeLaneStore.getState().setLoopRecordArmed(true, 't1');
    useTakeLaneStore.getState().setLoopRecordArmed(false, null);
    const state = useTakeLaneStore.getState();
    expect(state.loopRecordArmed).toBe(false);
    expect(state.activeLoopTrackId).toBeNull();
  });
});
