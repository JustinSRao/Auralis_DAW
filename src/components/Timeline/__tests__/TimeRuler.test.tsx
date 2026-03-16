import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TimeRuler } from '../TimeRuler';
import type { TimelineViewport } from '../../../stores/arrangementStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const viewport: TimelineViewport = {
  scrollLeft: 0,
  pixelsPerBar: 100,
  trackHeight: 60,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TimeRuler', () => {
  it('renders without crash with no punch markers', () => {
    const { container } = render(
      <TimeRuler
        width={800}
        viewport={viewport}
        loopStart={null}
        loopEnd={null}
        onRulerPointerDown={vi.fn()}
        punchEnabled={false}
        punchInSamples={null}
        punchOutSamples={null}
      />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('renders without crash when punchEnabled is true with marker values', () => {
    const { container } = render(
      <TimeRuler
        width={800}
        viewport={viewport}
        loopStart={null}
        loopEnd={null}
        onRulerPointerDown={vi.fn()}
        punchEnabled={true}
        punchInSamples={44100}
        punchOutSamples={176400}
        bpm={120}
        beatsPerBar={4}
      />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('renders without crash when punchEnabled is true but punch-out is null', () => {
    const { container } = render(
      <TimeRuler
        width={800}
        viewport={viewport}
        loopStart={null}
        loopEnd={null}
        onRulerPointerDown={vi.fn()}
        punchEnabled={true}
        punchInSamples={44100}
        punchOutSamples={null}
      />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('renders the canvas with the specified width', () => {
    const { container } = render(
      <TimeRuler
        width={1200}
        viewport={viewport}
        loopStart={null}
        loopEnd={null}
        onRulerPointerDown={vi.fn()}
      />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(1200);
  });

  it('renders with loop region without crash', () => {
    const { container } = render(
      <TimeRuler
        width={800}
        viewport={viewport}
        loopStart={2}
        loopEnd={6}
        onRulerPointerDown={vi.fn()}
      />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});
