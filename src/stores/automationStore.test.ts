/**
 * Unit tests for automationStore (Sprint 14).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAutomationStore } from './automationStore';
import type { AutomationLaneData } from '../lib/ipc';

// Mock all IPC calls
vi.mock('../lib/ipc', () => ({
  ipcSetAutomationPoint: vi.fn().mockResolvedValue({ tick: 0, value: 0.5, interp: 'Linear' }),
  ipcDeleteAutomationPoint: vi.fn().mockResolvedValue(undefined),
  ipcSetAutomationInterp: vi.fn().mockResolvedValue(undefined),
  ipcEnableAutomationLane: vi.fn().mockResolvedValue(undefined),
  ipcRecordAutomationBatch: vi.fn().mockResolvedValue(undefined),
}));

function getStore() {
  return useAutomationStore.getState();
}

beforeEach(() => {
  // Reset store state before each test
  useAutomationStore.getState().clear();
});

// ---------------------------------------------------------------------------
// setPoint
// ---------------------------------------------------------------------------

describe('setPoint', () => {
  it('creates a new lane when none exists', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 0, 0.5, 'Linear');
    const lane = getStore().getLane('pat-1', 'synth.cutoff');
    expect(lane).toBeDefined();
    expect(lane!.points).toHaveLength(1);
    expect(lane!.points[0]).toMatchObject({ tick: 0, value: 0.5, interp: 'Linear' });
  });

  it('inserts points in sorted tick order', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 960, 0.8, 'Linear');
    await getStore().setPoint('pat-1', 'synth.cutoff', 0, 0.2, 'Linear');
    await getStore().setPoint('pat-1', 'synth.cutoff', 480, 0.5, 'Linear');

    const lane = getStore().getLane('pat-1', 'synth.cutoff')!;
    expect(lane.points[0].tick).toBe(0);
    expect(lane.points[1].tick).toBe(480);
    expect(lane.points[2].tick).toBe(960);
  });

  it('replaces an existing point at the same tick', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 480, 0.3, 'Linear');
    await getStore().setPoint('pat-1', 'synth.cutoff', 480, 0.9, 'Step');

    const lane = getStore().getLane('pat-1', 'synth.cutoff')!;
    expect(lane.points).toHaveLength(1);
    expect(lane.points[0]).toMatchObject({ tick: 480, value: 0.9, interp: 'Step' });
  });
});

// ---------------------------------------------------------------------------
// deletePoint
// ---------------------------------------------------------------------------

describe('deletePoint', () => {
  it('removes a point at the given tick', async () => {
    await getStore().setPoint('pat-1', 'synth.volume', 0, 1.0, 'Linear');
    await getStore().setPoint('pat-1', 'synth.volume', 480, 0.5, 'Linear');
    await getStore().deletePoint('pat-1', 'synth.volume', 0);

    const lane = getStore().getLane('pat-1', 'synth.volume')!;
    expect(lane.points).toHaveLength(1);
    expect(lane.points[0].tick).toBe(480);
  });

  it('is a no-op if the lane does not exist', async () => {
    // Should not throw
    await expect(
      getStore().deletePoint('nonexistent', 'synth.volume', 0),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateAt
// ---------------------------------------------------------------------------

describe('evaluateAt', () => {
  it('returns 0 when no lane exists', () => {
    expect(getStore().evaluateAt('pat-x', 'synth.cutoff', 100)).toBe(0);
  });

  it('linear interpolation between two points', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 0, 0.0, 'Linear');
    await getStore().setPoint('pat-1', 'synth.cutoff', 960, 1.0, 'Linear');
    // Midpoint should be ~0.5
    const v = getStore().evaluateAt('pat-1', 'synth.cutoff', 480);
    expect(v).toBeCloseTo(0.5, 4);
  });

  it('step interpolation holds the value', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 0, 0.2, 'Step');
    await getStore().setPoint('pat-1', 'synth.cutoff', 480, 0.8, 'Linear');
    // Between 0 and 480 with Step interp, value should be 0.2
    const v = getStore().evaluateAt('pat-1', 'synth.cutoff', 240);
    expect(v).toBeCloseTo(0.2, 4);
  });

  it('clamps to first point value before start', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 100, 0.5, 'Linear');
    const v = getStore().evaluateAt('pat-1', 'synth.cutoff', 0);
    expect(v).toBeCloseTo(0.5, 4);
  });

  it('clamps to last point value after end', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 0, 0.3, 'Linear');
    const v = getStore().evaluateAt('pat-1', 'synth.cutoff', 9999);
    expect(v).toBeCloseTo(0.3, 4);
  });

  it('returns 0 when lane is disabled', async () => {
    await getStore().setPoint('pat-1', 'synth.cutoff', 0, 1.0, 'Linear');
    await getStore().enableLane('pat-1', 'synth.cutoff', false);
    expect(getStore().evaluateAt('pat-1', 'synth.cutoff', 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadFromProject / persistence
// ---------------------------------------------------------------------------

describe('loadFromProject', () => {
  it('loads automation lanes from pattern automation fields', () => {
    const patterns = [
      {
        id: 'pat-1',
        automation: {
          'synth.cutoff': {
            patternId: 'pat-1',
            parameterId: 'synth.cutoff',
            enabled: true,
            points: [{ tick: 0, value: 0.5, interp: 'Linear' as const }],
          } satisfies AutomationLaneData,
        },
      },
    ];
    getStore().loadFromProject(patterns);
    const lane = getStore().getLane('pat-1', 'synth.cutoff');
    expect(lane).toBeDefined();
    expect(lane!.points).toHaveLength(1);
  });

  it('clears existing lanes on load', async () => {
    await getStore().setPoint('old-pat', 'synth.volume', 0, 1.0, 'Linear');
    getStore().loadFromProject([]);
    expect(getStore().getLane('old-pat', 'synth.volume')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Record mode
// ---------------------------------------------------------------------------

describe('record mode', () => {
  it('setRecordEnabled toggles the flag', () => {
    expect(getStore().recordEnabled).toBe(false);
    getStore().setRecordEnabled(true);
    expect(getStore().recordEnabled).toBe(true);
  });

  it('pushRecordEvent buffers the event and updates the lane', () => {
    getStore().setRecordEnabled(true);
    getStore().setRecordPatternId('pat-1');
    getStore().pushRecordEvent({ parameterId: 'synth.volume', value: 0.7, tick: 240 });

    expect(getStore().pendingEvents).toHaveLength(1);
    const lane = getStore().getLane('pat-1', 'synth.volume');
    expect(lane).toBeDefined();
    expect(lane!.points[0]).toMatchObject({ tick: 240, value: 0.7, interp: 'Linear' });
  });

  it('flushRecordBatch clears pending events', async () => {
    getStore().setRecordPatternId('pat-1');
    getStore().pushRecordEvent({ parameterId: 'synth.volume', value: 0.5, tick: 0 });
    expect(getStore().pendingEvents).toHaveLength(1);
    await getStore().flushRecordBatch();
    expect(getStore().pendingEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Timeline expansion
// ---------------------------------------------------------------------------

describe('toggleTrackExpanded', () => {
  it('adds a track id when collapsed', () => {
    getStore().toggleTrackExpanded('track-1');
    expect(getStore().expandedTrackIds).toContain('track-1');
  });

  it('removes a track id when already expanded', () => {
    getStore().toggleTrackExpanded('track-1');
    getStore().toggleTrackExpanded('track-1');
    expect(getStore().expandedTrackIds).not.toContain('track-1');
  });
});
