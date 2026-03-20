/**
 * Tests for tempoMapStore.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ipc module before importing the store
// ---------------------------------------------------------------------------

vi.mock('../lib/ipc', () => ({
  setTempoMap: vi.fn().mockResolvedValue(undefined),
  getTempoMap: vi.fn().mockResolvedValue([{ tick: 0, bpm: 120, interp: 'Step' }]),
}));

import { useTempoMapStore } from './tempoMapStore';
import * as ipc from '../lib/ipc';

const mockSetTempoMap = vi.mocked(ipc.setTempoMap);
const mockGetTempoMap = vi.mocked(ipc.getTempoMap);

beforeEach(() => {
  // Reset store to default state
  useTempoMapStore.setState({
    points: [{ tick: 0, bpm: 120.0, interp: 'Step' }],
  });
  vi.clearAllMocks();
  mockSetTempoMap.mockResolvedValue(undefined);
  mockGetTempoMap.mockResolvedValue([{ tick: 0, bpm: 120, interp: 'Step' }]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tempoMapStore', () => {
  it('adds a new point and calls setTempoMap IPC', async () => {
    const store = useTempoMapStore.getState();
    await store.setPoint(1920, 140, 'Step');

    expect(mockSetTempoMap).toHaveBeenCalledTimes(1);
    const sentPoints = mockSetTempoMap.mock.calls[0][0];
    expect(sentPoints).toHaveLength(2);
    expect(sentPoints[1]).toMatchObject({ tick: 1920, bpm: 140, interp: 'Step' });

    const current = useTempoMapStore.getState().points;
    expect(current).toHaveLength(2);
  });

  it('cannot delete tick-0 point — no IPC call', async () => {
    const store = useTempoMapStore.getState();
    await store.deletePoint(0);

    expect(mockSetTempoMap).not.toHaveBeenCalled();
    expect(useTempoMapStore.getState().points).toHaveLength(1);
  });

  it('loadFromProject replaces all points', () => {
    useTempoMapStore.getState().loadFromProject([
      { tick: 0, bpm: 100, interp: 'Step' },
      { tick: 960, bpm: 80, interp: 'Linear' },
    ]);

    const pts = useTempoMapStore.getState().points;
    expect(pts).toHaveLength(2);
    expect(pts[0].bpm).toBe(100);
    expect(pts[1].bpm).toBe(80);
  });

  it('loadFromProject with empty array falls back to default', () => {
    useTempoMapStore.getState().loadFromProject([]);
    const pts = useTempoMapStore.getState().points;
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ tick: 0, bpm: 120, interp: 'Step' });
  });

  it('setPoint with duplicate tick updates in place', async () => {
    await useTempoMapStore.getState().setPoint(0, 90, 'Step');

    const pts = useTempoMapStore.getState().points;
    expect(pts).toHaveLength(1);
    expect(pts[0].bpm).toBe(90);
    expect(mockSetTempoMap).toHaveBeenCalledWith([{ tick: 0, bpm: 90, interp: 'Step' }]);
  });

  it('setInterpMode updates only the interp field', async () => {
    // First add a second point
    await useTempoMapStore.getState().setPoint(960, 100, 'Step');
    vi.clearAllMocks();
    mockSetTempoMap.mockResolvedValue(undefined);

    await useTempoMapStore.getState().setInterpMode(960, 'Linear');

    const pts = useTempoMapStore.getState().points;
    const p = pts.find((x) => x.tick === 960);
    expect(p?.interp).toBe('Linear');
    expect(p?.bpm).toBe(100); // BPM unchanged
  });
});
