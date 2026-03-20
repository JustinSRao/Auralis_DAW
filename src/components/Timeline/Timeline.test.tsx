/**
 * Smoke tests for the Timeline component.
 *
 * Canvas drawing is opaque in jsdom — we test DOM structure, drop behaviour,
 * and keyboard shortcuts rather than pixel output.
 *
 * Mocking strategy:
 * - useArrangementStore: mocked with selector + getState() pattern.
 * - useTrackStore: mocked with selector pattern.
 * - usePatternStore: mocked with selector + getState() pattern (used by
 *   drop handler via usePatternStore.getState().patterns[id]).
 * - @tauri-apps/api/event: listen() returns a no-op unlisten function.
 * - ResizeObserver: global no-op stub (jsdom does not implement it).
 * - HTMLCanvasElement.getContext: stubbed to null in setup.ts.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Timeline } from './Timeline'
import type { ArrangementClip } from '../../stores/arrangementStore'
import { listen } from '@tauri-apps/api/event'
import type { DawTrack } from '../../stores/trackStore'
import type { PatternData } from '../../lib/ipc'

// ---------------------------------------------------------------------------
// ResizeObserver stub — absent in jsdom
// ---------------------------------------------------------------------------

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// ---------------------------------------------------------------------------
// Ensure canvas mock is in place for this file (setup.ts covers global runs,
// but explicit beforeAll is defensive for file isolation in watch mode)
// ---------------------------------------------------------------------------

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null as unknown as CanvasRenderingContext2D
})

// ---------------------------------------------------------------------------
// Mock action spies — declared before vi.mock so factories can close over them
// ---------------------------------------------------------------------------

const mockAddClip = vi.fn()
const mockMoveClip = vi.fn()
const mockResizeClip = vi.fn()
const mockDeleteClip = vi.fn()
const mockDuplicateClip = vi.fn()
const mockUpdateClipOptimistic = vi.fn()
const mockRevertClipOptimistic = vi.fn()
const mockSetViewport = vi.fn()
const mockSelectClip = vi.fn()

// ---------------------------------------------------------------------------
// Mutable state shared between tests
// ---------------------------------------------------------------------------

let mockClips: Record<string, ArrangementClip> = {}
let mockSelectedClipId: string | null = null
let mockTracks: DawTrack[] = []
let mockPatterns: Record<string, PatternData> = {}

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

vi.mock('../../stores/arrangementStore', () => {
  function buildState() {
    return {
      clips: mockClips,
      viewport: { scrollLeft: 0, pixelsPerBar: 80, trackHeight: 64 },
      selectedClipId: mockSelectedClipId,
      error: null,
      addClip: mockAddClip,
      moveClip: mockMoveClip,
      resizeClip: mockResizeClip,
      deleteClip: mockDeleteClip,
      duplicateClip: mockDuplicateClip,
      updateClipOptimistic: mockUpdateClipOptimistic,
      revertClipOptimistic: mockRevertClipOptimistic,
      setViewport: mockSetViewport,
      selectClip: mockSelectClip,
      loadFromProject: vi.fn(),
      clearError: vi.fn(),
    }
  }

  const useArrangementStore = Object.assign(
    (selector: (s: ReturnType<typeof buildState>) => unknown) => selector(buildState()),
    { getState: () => buildState() },
  )

  return { useArrangementStore }
})

vi.mock('../../stores/trackStore', () => {
  return {
    useTrackStore: (selector: (s: { tracks: DawTrack[] }) => unknown) =>
      selector({ tracks: mockTracks }),
  }
})

vi.mock('../../stores/patternStore', () => {
  function buildPatternState() {
    return {
      patterns: mockPatterns,
      selectedPatternId: null,
      isLoading: false,
      error: null,
      getPatternsForTrack: (_trackId: string) => [],
    }
  }

  const usePatternStore = Object.assign(
    (selector: (s: ReturnType<typeof buildPatternState>) => unknown) =>
      selector(buildPatternState()),
    { getState: () => buildPatternState() },
  )

  return { usePatternStore }
})

vi.mock('../../stores/takeLaneStore', () => {
  function buildTakeLaneState() {
    return {
      lanes: {} as Record<string, unknown>,
      loopRecordArmed: false,
      activeLoopTrackId: null,
      onTakeCreated: vi.fn(),
      onTakeRecordingStarted: vi.fn(),
    }
  }

  const useTakeLaneStore = Object.assign(
    (selector: (s: ReturnType<typeof buildTakeLaneState>) => unknown) =>
      selector(buildTakeLaneState()),
    { getState: () => buildTakeLaneState() },
  )

  return { useTakeLaneStore }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(overrides: Partial<DawTrack> = {}): DawTrack {
  return {
    id: 'track-1',
    name: 'Lead Synth',
    kind: 'Midi',
    color: '#6c63ff',
    volume: 0.8,
    pan: 0.0,
    muted: false,
    soloed: false,
    armed: false,
    instrumentId: null,
    ...overrides,
  }
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

function makePattern(overrides: Partial<PatternData> = {}): PatternData {
  return {
    id: 'pat-1',
    name: 'Verse',
    trackId: 'track-1',
    lengthBars: 4,
    content: { type: 'Midi', notes: [] },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Re-apply listen mock after clearAllMocks wipes the resolved value set in
  // setup.ts.  Timeline.tsx calls listen(...).then(...), so listen MUST return
  // a Promise; clearAllMocks resets it to return undefined, which breaks the
  // .then() chain in the transport-event useEffect.
  vi.mocked(listen).mockResolvedValue(() => {})

  mockClips = {}
  mockSelectedClipId = null
  mockTracks = [makeTrack()]
  mockPatterns = { 'pat-1': makePattern() }
  mockAddClip.mockResolvedValue(undefined)
  mockDeleteClip.mockResolvedValue(undefined)
  mockMoveClip.mockResolvedValue(undefined)
  mockResizeClip.mockResolvedValue(undefined)
  mockDuplicateClip.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Timeline', () => {
  // ── DOM structure ───────────────────────────────────────────────────────────

  it('renders without crashing with empty clips', () => {
    expect(() => render(<Timeline />)).not.toThrow()
  })

  it('renders data-testid="timeline" element', () => {
    render(<Timeline />)
    expect(screen.getByTestId('timeline')).toBeInTheDocument()
  })

  it('renders data-testid="timeline-clips-canvas" canvas', () => {
    render(<Timeline />)
    expect(screen.getByTestId('timeline-clips-canvas')).toBeInTheDocument()
  })

  it('renders the zoom slider', () => {
    render(<Timeline />)
    expect(screen.getByLabelText('Timeline zoom')).toBeInTheDocument()
  })

  // ── Drop handling ────────────────────────────────────────────────────────────

  it('drop with application/pattern-id calls addClip', async () => {
    mockTracks = [makeTrack({ id: 'track-1' })]
    mockPatterns = { 'pat-1': makePattern({ id: 'pat-1', trackId: 'track-1', lengthBars: 4 }) }

    render(<Timeline />)
    const timeline = screen.getByTestId('timeline')

    await act(async () => {
      fireEvent.drop(timeline, {
        dataTransfer: {
          types: ['application/pattern-id'],
          getData: (type: string) => (type === 'application/pattern-id' ? 'pat-1' : ''),
        },
        clientX: 0,
        clientY: 60, // below RULER_HEIGHT=32, so clipsY = 60-32 = 28 → track 0
      })
    })

    expect(mockAddClip).toHaveBeenCalledWith('pat-1', 'track-1', expect.any(Number), 4)
  })

  it('drop without application/pattern-id does NOT call addClip', async () => {
    render(<Timeline />)
    const timeline = screen.getByTestId('timeline')

    await act(async () => {
      fireEvent.drop(timeline, {
        dataTransfer: {
          types: [],
          getData: () => '',
        },
        clientX: 0,
        clientY: 60,
      })
    })

    expect(mockAddClip).not.toHaveBeenCalled()
  })

  it('drop with unknown pattern id does NOT call addClip', async () => {
    render(<Timeline />)
    const timeline = screen.getByTestId('timeline')

    await act(async () => {
      fireEvent.drop(timeline, {
        dataTransfer: {
          types: ['application/pattern-id'],
          getData: (type: string) => (type === 'application/pattern-id' ? 'nonexistent-pat' : ''),
        },
        clientX: 0,
        clientY: 60,
      })
    })

    expect(mockAddClip).not.toHaveBeenCalled()
  })

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  it('Delete key with selectedClipId calls deleteClip', async () => {
    mockSelectedClipId = 'clip-1'
    mockClips = { 'clip-1': makeClip() }

    render(<Timeline />)
    const timeline = screen.getByTestId('timeline')

    await act(async () => {
      fireEvent.keyDown(timeline, { key: 'Delete' })
    })

    expect(mockDeleteClip).toHaveBeenCalledWith('clip-1')
  })

  it('Backspace key with selectedClipId calls deleteClip', async () => {
    mockSelectedClipId = 'clip-1'
    mockClips = { 'clip-1': makeClip() }

    render(<Timeline />)
    const timeline = screen.getByTestId('timeline')

    await act(async () => {
      fireEvent.keyDown(timeline, { key: 'Backspace' })
    })

    expect(mockDeleteClip).toHaveBeenCalledWith('clip-1')
  })

  it('Delete key WITHOUT selectedClipId does NOT call deleteClip', async () => {
    mockSelectedClipId = null

    render(<Timeline />)
    const timeline = screen.getByTestId('timeline')

    await act(async () => {
      fireEvent.keyDown(timeline, { key: 'Delete' })
    })

    expect(mockDeleteClip).not.toHaveBeenCalled()
  })

  // ── Unmount ──────────────────────────────────────────────────────────────────

  it('unmounts cleanly without throwing', () => {
    const { unmount } = render(<Timeline />)
    expect(() => unmount()).not.toThrow()
  })
})
