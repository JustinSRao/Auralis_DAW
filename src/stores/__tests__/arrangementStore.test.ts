/**
 * Unit tests for arrangementStore.
 *
 * All IPC functions are mocked so tests run without a Tauri runtime.
 * Zustand store state is reset to defaults before each test via setState.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useArrangementStore } from '../arrangementStore'
import type { ArrangementClip } from '../arrangementStore'

// ---------------------------------------------------------------------------
// Mock the IPC module
// ---------------------------------------------------------------------------

vi.mock('../../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../../lib/ipc')>('../../lib/ipc')
  return {
    ...actual,
    ipcAddArrangementClip: vi.fn(),
    ipcMoveArrangementClip: vi.fn(),
    ipcResizeArrangementClip: vi.fn(),
    ipcDeleteArrangementClip: vi.fn(),
    ipcDuplicateArrangementClip: vi.fn(),
  }
})

import {
  ipcAddArrangementClip,
  ipcMoveArrangementClip,
  ipcResizeArrangementClip,
  ipcDeleteArrangementClip,
  ipcDuplicateArrangementClip,
} from '../../lib/ipc'

const mockAdd = vi.mocked(ipcAddArrangementClip)
const mockMove = vi.mocked(ipcMoveArrangementClip)
const mockResize = vi.mocked(ipcResizeArrangementClip)
const mockDelete = vi.mocked(ipcDeleteArrangementClip)
const mockDuplicate = vi.mocked(ipcDuplicateArrangementClip)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const INITIAL_STATE = {
  clips: {} as Record<string, ArrangementClip>,
  viewport: { scrollLeft: 0, pixelsPerBar: 80, trackHeight: 64 },
  selectedClipId: null as string | null,
  error: null as string | null,
}

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  useArrangementStore.setState({ ...INITIAL_STATE, clips: {} })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('arrangementStore', () => {
  // ── Initial state ──────────────────────────────────────────────────────────

  it('has correct initial state', () => {
    const s = useArrangementStore.getState()
    expect(s.clips).toEqual({})
    expect(s.selectedClipId).toBeNull()
    expect(s.error).toBeNull()
    expect(s.viewport).toEqual({ scrollLeft: 0, pixelsPerBar: 80, trackHeight: 64 })
  })

  // ── addClip ────────────────────────────────────────────────────────────────

  it('addClip inserts the clip returned by IPC into the store', async () => {
    const newClip = makeClip({ id: 'clip-new' })
    mockAdd.mockResolvedValueOnce(newClip)

    await useArrangementStore.getState().addClip('pat-1', 'track-1', 0, 4)

    expect(mockAdd).toHaveBeenCalledWith('pat-1', 'track-1', 0, 4)
    expect(useArrangementStore.getState().clips['clip-new']).toEqual(newClip)
  })

  it('addClip on IPC error sets error string, does not insert clip', async () => {
    mockAdd.mockRejectedValueOnce(new Error('server rejected'))

    await useArrangementStore.getState().addClip('pat-1', 'track-1', 0, 4)

    expect(useArrangementStore.getState().error).toContain('server rejected')
    expect(Object.keys(useArrangementStore.getState().clips)).toHaveLength(0)
  })

  // ── moveClip ───────────────────────────────────────────────────────────────

  it('moveClip updates startBar and trackId after IPC success', async () => {
    const clip = makeClip({ id: 'clip-move', startBar: 0, trackId: 'track-1' })
    useArrangementStore.setState({ clips: { 'clip-move': clip } })
    mockMove.mockResolvedValueOnce(undefined)

    await useArrangementStore.getState().moveClip('clip-move', 'track-2', 8)

    const updated = useArrangementStore.getState().clips['clip-move']
    expect(updated.trackId).toBe('track-2')
    expect(updated.startBar).toBe(8)
  })

  it('moveClip on IPC error sets error and leaves clip unchanged', async () => {
    const clip = makeClip({ id: 'clip-mv-err', startBar: 2, trackId: 'track-1' })
    useArrangementStore.setState({ clips: { 'clip-mv-err': clip } })
    mockMove.mockRejectedValueOnce(new Error('overlap conflict'))

    await useArrangementStore.getState().moveClip('clip-mv-err', 'track-2', 10)

    const unchanged = useArrangementStore.getState().clips['clip-mv-err']
    expect(unchanged.startBar).toBe(2)
    expect(unchanged.trackId).toBe('track-1')
    expect(useArrangementStore.getState().error).toContain('overlap conflict')
  })

  // ── resizeClip ─────────────────────────────────────────────────────────────

  it('resizeClip updates lengthBars after IPC success', async () => {
    const clip = makeClip({ id: 'clip-resize', lengthBars: 4 })
    useArrangementStore.setState({ clips: { 'clip-resize': clip } })
    mockResize.mockResolvedValueOnce(undefined)

    await useArrangementStore.getState().resizeClip('clip-resize', 8)

    expect(useArrangementStore.getState().clips['clip-resize'].lengthBars).toBe(8)
  })

  it('resizeClip on IPC error sets error and leaves lengthBars unchanged', async () => {
    const clip = makeClip({ id: 'clip-rz-err', lengthBars: 4 })
    useArrangementStore.setState({ clips: { 'clip-rz-err': clip } })
    mockResize.mockRejectedValueOnce(new Error('min length violation'))

    await useArrangementStore.getState().resizeClip('clip-rz-err', 0)

    expect(useArrangementStore.getState().clips['clip-rz-err'].lengthBars).toBe(4)
    expect(useArrangementStore.getState().error).toContain('min length violation')
  })

  // ── deleteClip ─────────────────────────────────────────────────────────────

  it('deleteClip removes the clip from the store after IPC success', async () => {
    const clip = makeClip({ id: 'clip-del' })
    useArrangementStore.setState({ clips: { 'clip-del': clip } })
    mockDelete.mockResolvedValueOnce(undefined)

    await useArrangementStore.getState().deleteClip('clip-del')

    expect(useArrangementStore.getState().clips['clip-del']).toBeUndefined()
  })

  it('deleteClip clears selectedClipId when the deleted clip was selected', async () => {
    const clip = makeClip({ id: 'clip-sel-del' })
    useArrangementStore.setState({
      clips: { 'clip-sel-del': clip },
      selectedClipId: 'clip-sel-del',
    })
    mockDelete.mockResolvedValueOnce(undefined)

    await useArrangementStore.getState().deleteClip('clip-sel-del')

    expect(useArrangementStore.getState().selectedClipId).toBeNull()
  })

  it('deleteClip preserves selectedClipId when a different clip is deleted', async () => {
    const clipA = makeClip({ id: 'clip-a' })
    const clipB = makeClip({ id: 'clip-b' })
    useArrangementStore.setState({
      clips: { 'clip-a': clipA, 'clip-b': clipB },
      selectedClipId: 'clip-a',
    })
    mockDelete.mockResolvedValueOnce(undefined)

    await useArrangementStore.getState().deleteClip('clip-b')

    expect(useArrangementStore.getState().selectedClipId).toBe('clip-a')
  })

  // ── duplicateClip ──────────────────────────────────────────────────────────

  it('duplicateClip inserts the new clip returned by IPC', async () => {
    const original = makeClip({ id: 'clip-orig', startBar: 0 })
    const copy = makeClip({ id: 'clip-copy', startBar: 4 })
    useArrangementStore.setState({ clips: { 'clip-orig': original } })
    mockDuplicate.mockResolvedValueOnce(copy)

    await useArrangementStore.getState().duplicateClip('clip-orig', 4, 'pat-1', 'track-1', 4)

    const state = useArrangementStore.getState()
    expect(state.clips['clip-orig']).toEqual(original)
    expect(state.clips['clip-copy']).toEqual(copy)
  })

  // ── updateClipOptimistic ───────────────────────────────────────────────────

  it('updateClipOptimistic applies a partial update without IPC', () => {
    const clip = makeClip({ id: 'clip-opt', startBar: 0 })
    useArrangementStore.setState({ clips: { 'clip-opt': clip } })

    useArrangementStore.getState().updateClipOptimistic('clip-opt', { startBar: 5 })

    expect(useArrangementStore.getState().clips['clip-opt'].startBar).toBe(5)
    expect(mockMove).not.toHaveBeenCalled()
  })

  it('updateClipOptimistic is a no-op for unknown clip ids', () => {
    useArrangementStore.getState().updateClipOptimistic('nonexistent', { startBar: 99 })
    expect(Object.keys(useArrangementStore.getState().clips)).toHaveLength(0)
  })

  // ── revertClipOptimistic ───────────────────────────────────────────────────

  it('revertClipOptimistic restores the original clip', () => {
    const original = makeClip({ id: 'clip-rev', startBar: 2 })
    const mutated = makeClip({ id: 'clip-rev', startBar: 99 })
    useArrangementStore.setState({ clips: { 'clip-rev': mutated } })

    useArrangementStore.getState().revertClipOptimistic('clip-rev', original)

    expect(useArrangementStore.getState().clips['clip-rev'].startBar).toBe(2)
  })

  // ── loadFromProject ────────────────────────────────────────────────────────

  it('loadFromProject replaces all clips and resets selectedClipId', () => {
    const old = makeClip({ id: 'clip-old' })
    useArrangementStore.setState({ clips: { 'clip-old': old }, selectedClipId: 'clip-old' })

    const incoming: ArrangementClip[] = [
      makeClip({ id: 'clip-new-1', startBar: 0 }),
      makeClip({ id: 'clip-new-2', startBar: 8 }),
    ]
    useArrangementStore.getState().loadFromProject(incoming)

    const s = useArrangementStore.getState()
    expect(s.clips['clip-old']).toBeUndefined()
    expect(s.clips['clip-new-1']).toEqual(incoming[0])
    expect(s.clips['clip-new-2']).toEqual(incoming[1])
    expect(s.selectedClipId).toBeNull()
  })

  it('loadFromProject with empty array clears all clips', () => {
    const clip = makeClip({ id: 'clip-clear' })
    useArrangementStore.setState({ clips: { 'clip-clear': clip } })

    useArrangementStore.getState().loadFromProject([])

    expect(Object.keys(useArrangementStore.getState().clips)).toHaveLength(0)
  })

  // ── setViewport ────────────────────────────────────────────────────────────

  it('setViewport patches only the provided fields', () => {
    useArrangementStore.getState().setViewport({ pixelsPerBar: 160 })

    const vp = useArrangementStore.getState().viewport
    expect(vp.pixelsPerBar).toBe(160)
    expect(vp.scrollLeft).toBe(0)   // unchanged
    expect(vp.trackHeight).toBe(64) // unchanged
  })

  it('setViewport can update scrollLeft without touching other fields', () => {
    useArrangementStore.getState().setViewport({ scrollLeft: 400 })

    const vp = useArrangementStore.getState().viewport
    expect(vp.scrollLeft).toBe(400)
    expect(vp.pixelsPerBar).toBe(80)
  })

  // ── selectClip ────────────────────────────────────────────────────────────

  it('selectClip sets selectedClipId', () => {
    useArrangementStore.getState().selectClip('clip-123')
    expect(useArrangementStore.getState().selectedClipId).toBe('clip-123')
  })

  it('selectClip(null) clears selectedClipId', () => {
    useArrangementStore.setState({ selectedClipId: 'clip-123' })
    useArrangementStore.getState().selectClip(null)
    expect(useArrangementStore.getState().selectedClipId).toBeNull()
  })
})
