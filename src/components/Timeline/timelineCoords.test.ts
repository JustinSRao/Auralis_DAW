/**
 * Unit tests for timelineCoords.ts
 *
 * All functions are pure and stateless — no DOM or React setup required.
 * Tests cover happy paths, boundary values, clamp behaviour, round-trips,
 * and the hit-test state machine.
 */

import { describe, it, expect } from 'vitest'
import {
  barToX,
  xToBar,
  snapToBar,
  trackIndexToY,
  yToTrackIndex,
  barToSamples,
  samplesToBar,
  clipHitTest,
} from './timelineCoords'
import type { TimelineViewport } from '../../stores/arrangementStore'
import type { ArrangementClip } from '../../stores/arrangementStore'

// ---------------------------------------------------------------------------
// Shared test viewport
// ---------------------------------------------------------------------------

const VP: TimelineViewport = { scrollLeft: 0, pixelsPerBar: 80, trackHeight: 64 }

function vp(overrides: Partial<TimelineViewport> = {}): TimelineViewport {
  return { ...VP, ...overrides }
}

function makeClip(overrides: Partial<ArrangementClip> = {}): ArrangementClip {
  return {
    id: 'clip-1',
    patternId: 'pat-1',
    trackId: 'track-1',
    startBar: 0,
    lengthBars: 4,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// barToX
// ---------------------------------------------------------------------------

describe('barToX', () => {
  it('returns -scrollLeft when bar is 0', () => {
    expect(barToX(0, vp({ scrollLeft: 120 }))).toBe(-120)
  })

  it('returns 0 when bar is 0 and scrollLeft is 0', () => {
    expect(barToX(0, VP)).toBe(0)
  })

  it('returns 320 for bar=4 at 80px/bar with no scroll', () => {
    expect(barToX(4, VP)).toBe(320)
  })

  it('accounts for scrollLeft in the result', () => {
    expect(barToX(4, vp({ scrollLeft: 80 }))).toBe(240)
  })

  it('returns fractional x for fractional bar positions', () => {
    expect(barToX(1.5, VP)).toBeCloseTo(120)
  })

  it('returns negative value for bars scrolled off screen', () => {
    expect(barToX(1, vp({ scrollLeft: 200 }))).toBe(-120)
  })

  it('scales linearly with pixelsPerBar', () => {
    expect(barToX(2, vp({ pixelsPerBar: 40 }))).toBe(80)
    expect(barToX(2, vp({ pixelsPerBar: 160 }))).toBe(320)
  })
})

// ---------------------------------------------------------------------------
// xToBar
// ---------------------------------------------------------------------------

describe('xToBar', () => {
  it('returns 0 when x=0 and no scroll', () => {
    expect(xToBar(0, VP)).toBe(0)
  })

  it('returns 4 for x=320 at 80px/bar', () => {
    expect(xToBar(320, VP)).toBeCloseTo(4)
  })

  it('clamps at 0 for negative x values', () => {
    expect(xToBar(-100, VP)).toBe(0)
  })

  it('accounts for scrollLeft', () => {
    // x=0 with scrollLeft=80 means bar 1 is at x=0
    expect(xToBar(0, vp({ scrollLeft: 80 }))).toBeCloseTo(1)
  })
})

// ---------------------------------------------------------------------------
// Round-trip: barToX / xToBar
// ---------------------------------------------------------------------------

describe('barToX / xToBar round-trip', () => {
  it('recovers the original bar from barToX result', () => {
    const bar = 7.25
    const x = barToX(bar, VP)
    expect(xToBar(x, VP)).toBeCloseTo(bar)
  })

  it('round-trip works with a non-zero scrollLeft', () => {
    const scrolledVp = vp({ scrollLeft: 160, pixelsPerBar: 100 })
    const bar = 3.5
    const x = barToX(bar, scrolledVp)
    expect(xToBar(x, scrolledVp)).toBeCloseTo(bar)
  })
})

// ---------------------------------------------------------------------------
// snapToBar
// ---------------------------------------------------------------------------

describe('snapToBar', () => {
  it('snaps 3.7 down to 3', () => {
    expect(snapToBar(3.7)).toBe(3)
  })

  it('snaps 0.1 down to 0', () => {
    expect(snapToBar(0.1)).toBe(0)
  })

  it('leaves whole-bar positions unchanged', () => {
    expect(snapToBar(5)).toBe(5)
    expect(snapToBar(0)).toBe(0)
  })

  it('snaps 0.99 to 0', () => {
    expect(snapToBar(0.99)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// trackIndexToY
// ---------------------------------------------------------------------------

describe('trackIndexToY', () => {
  it('returns 0 for track index 0', () => {
    expect(trackIndexToY(0, VP)).toBe(0)
  })

  it('returns 2 * trackHeight for index 2', () => {
    expect(trackIndexToY(2, VP)).toBe(2 * VP.trackHeight)
  })

  it('scales with trackHeight', () => {
    expect(trackIndexToY(3, vp({ trackHeight: 80 }))).toBe(240)
  })
})

// ---------------------------------------------------------------------------
// yToTrackIndex
// ---------------------------------------------------------------------------

describe('yToTrackIndex', () => {
  it('returns 0 for y=0', () => {
    expect(yToTrackIndex(0, VP)).toBe(0)
  })

  it('clamps at 0 for negative y', () => {
    expect(yToTrackIndex(-10, VP)).toBe(0)
  })

  it('returns correct track index at the top of each row', () => {
    expect(yToTrackIndex(64, VP)).toBe(1)
    expect(yToTrackIndex(128, VP)).toBe(2)
  })

  it('returns same index for any y within the same row', () => {
    expect(yToTrackIndex(65, VP)).toBe(1)
    expect(yToTrackIndex(127, VP)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// barToSamples
// ---------------------------------------------------------------------------

describe('barToSamples', () => {
  it('bar 1 at 120 BPM 4/4 at 44100 Hz returns 88200 samples', () => {
    // 1 bar = 2 seconds at 120 BPM 4/4 → 2 * 44100 = 88200
    expect(barToSamples(1, 120, 4, 44100)).toBeCloseTo(88200)
  })

  it('bar 0 always returns 0 samples', () => {
    expect(barToSamples(0, 120, 4, 44100)).toBe(0)
  })

  it('scales linearly with bar count', () => {
    const onebar = barToSamples(1, 120, 4, 44100)
    expect(barToSamples(4, 120, 4, 44100)).toBeCloseTo(onebar * 4)
  })

  it('handles 3/4 time signature correctly', () => {
    // At 120 BPM 3/4: 1 bar = 1.5 s → 66150 samples
    expect(barToSamples(1, 120, 3, 44100)).toBeCloseTo(66150)
  })
})

// ---------------------------------------------------------------------------
// samplesToBar — inverse of barToSamples
// ---------------------------------------------------------------------------

describe('samplesToBar', () => {
  it('is the inverse of barToSamples', () => {
    const samples = barToSamples(3, 120, 4, 44100)
    expect(samplesToBar(samples, 120, 4, 44100)).toBeCloseTo(3)
  })

  it('returns 0 for 0 samples', () => {
    expect(samplesToBar(0, 120, 4, 44100)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// clipHitTest
// ---------------------------------------------------------------------------

describe('clipHitTest', () => {
  // Clip: startBar=2, lengthBars=4, track index 1
  // With VP (80px/bar, trackHeight=64, scrollLeft=0):
  //   clipX = 2*80 = 160, clipW = 4*80 = 320, clipX+clipW = 480
  //   clipY = 1*64 = 64, clipH = 64

  const clip = makeClip({ startBar: 2, lengthBars: 4 })
  const trackIndex = 1

  it('returns null when x/y is entirely outside the clip bounds', () => {
    expect(clipHitTest(clip, trackIndex, 10, 96, VP)).toBeNull()
  })

  it('returns null when y is on the wrong track row (above)', () => {
    // y=10 is inside track 0, not track 1
    expect(clipHitTest(clip, trackIndex, 200, 10, VP)).toBeNull()
  })

  it('returns null when y is on the wrong track row (below)', () => {
    // y=130 is inside track 2
    expect(clipHitTest(clip, trackIndex, 200, 130, VP)).toBeNull()
  })

  it('returns null when x is left of clip start', () => {
    expect(clipHitTest(clip, trackIndex, 159, 96, VP)).toBeNull()
  })

  it('returns null when x is at or past the right edge', () => {
    expect(clipHitTest(clip, trackIndex, 480, 96, VP)).toBeNull()
  })

  it('returns "move" when the point is inside the clip body', () => {
    // x=200, y=96 is well inside the clip
    expect(clipHitTest(clip, trackIndex, 200, 96, VP)).toBe('move')
  })

  it('returns "move" at the left edge of the clip', () => {
    expect(clipHitTest(clip, trackIndex, 160, 96, VP)).toBe('move')
  })

  it('returns "resize" when within the last 8px of the right edge', () => {
    // clipX + clipW - 8 = 472
    expect(clipHitTest(clip, trackIndex, 472, 96, VP)).toBe('resize')
    expect(clipHitTest(clip, trackIndex, 479, 96, VP)).toBe('resize')
  })

  it('returns "move" just before the resize handle zone', () => {
    expect(clipHitTest(clip, trackIndex, 471, 96, VP)).toBe('move')
  })

  it('returns null when the clip is at track 0 and y is negative', () => {
    const track0Clip = makeClip({ startBar: 0, lengthBars: 2 })
    expect(clipHitTest(track0Clip, 0, 80, -1, VP)).toBeNull()
  })

  it('works correctly with a non-zero scrollLeft', () => {
    const scrolledVp = vp({ scrollLeft: 160 })
    // With scroll=160, clipX for startBar=2 = 2*80-160 = 0
    // Resize zone starts at clipW-8 = 320-8 = 312
    expect(clipHitTest(clip, trackIndex, 5, 96, scrolledVp)).toBe('move')
    expect(clipHitTest(clip, trackIndex, 315, 96, scrolledVp)).toBe('resize')
    expect(clipHitTest(clip, trackIndex, 320, 96, scrolledVp)).toBeNull()
  })
})
