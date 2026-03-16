/**
 * Smoke tests for AutomationRow (Sprint 14).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { AutomationRow } from './AutomationRow';
import type { AutomationLaneData } from '../../lib/ipc';

// Canvas is not implemented in jsdom — suppress the null-context gracefully
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null as unknown as CanvasRenderingContext2D;
});

vi.mock('../../lib/ipc', () => ({
  ipcSetAutomationPoint: vi.fn().mockResolvedValue({ tick: 0, value: 0.5, interp: 'Linear' }),
  ipcDeleteAutomationPoint: vi.fn().mockResolvedValue(undefined),
  ipcSetAutomationInterp: vi.fn().mockResolvedValue(undefined),
  ipcEnableAutomationLane: vi.fn().mockResolvedValue(undefined),
  ipcRecordAutomationBatch: vi.fn().mockResolvedValue(undefined),
}));

const LANE: AutomationLaneData = {
  patternId: 'pat-1',
  parameterId: 'synth.cutoff',
  enabled: true,
  points: [
    { tick: 0, value: 0.2, interp: 'Linear' },
    { tick: 960, value: 0.8, interp: 'Linear' },
  ],
};

describe('AutomationRow', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <AutomationRow
        lane={LANE}
        totalTicks={1920}
        width={800}
        scrollLeft={0}
        pixelsPerBar={80}
        beatsPerBar={4}
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the parameter id label', () => {
    const { getByText } = render(
      <AutomationRow
        lane={LANE}
        totalTicks={1920}
        width={800}
        scrollLeft={0}
        pixelsPerBar={80}
        beatsPerBar={4}
      />,
    );
    expect(getByText('synth.cutoff')).toBeTruthy();
  });
});
