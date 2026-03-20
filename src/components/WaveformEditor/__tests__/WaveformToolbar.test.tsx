/**
 * Tests for WaveformToolbar (Sprint 15).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockSetTool = vi.fn()
const mockSetViewport = vi.fn()
const mockLoadPeakData = vi.fn().mockResolvedValue(undefined)

function buildState(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    activeClipId: 'clip-1',
    activeTrackId: 'track-1',
    filePath: '/audio/test.wav',
    totalFrames: 44100,
    sampleRate: 44100,
    peakData: null,
    peakLoading: false,
    viewport: { framesPerPixel: 256, scrollFrames: 0, canvasWidth: 800 },
    cursorFrame: null,
    selection: null,
    tool: 'select' as const,
    error: null,
    stretchRatio: 1.0,
    pitchSemitones: 0,
    isProcessing: false,
    close: vi.fn(),
    openForClip: vi.fn(),
    loadPeakData: mockLoadPeakData,
    setViewport: mockSetViewport,
    setCursor: vi.fn(),
    setSelection: vi.fn(),
    setTool: mockSetTool,
    clearError: vi.fn(),
    applyStretch: vi.fn().mockResolvedValue(undefined),
    applyPitch: vi.fn().mockResolvedValue(undefined),
    bakeToFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

let currentState = buildState()

vi.mock('../../../stores/waveformEditorStore', () => {
  const storeHook = Object.assign(
    vi.fn((sel?: (s: ReturnType<typeof buildState>) => unknown) =>
      sel ? sel(currentState) : currentState,
    ),
    {
      getState: vi.fn(() => currentState),
      setState: vi.fn(),
    },
  )
  return { useWaveformEditorStore: storeHook }
})

vi.mock('../../../stores/historyStore', () => {
  const state = {
    canUndo: true,
    canRedo: false,
    push: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  }
  return {
    useHistoryStore: Object.assign(
      vi.fn((sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state)),
      { getState: vi.fn(() => state) },
    ),
  }
})

vi.mock('../../../stores/fileStore', () => ({
  useFileStore: Object.assign(
    vi.fn(),
    { getState: vi.fn(() => ({ currentProject: null })) },
  ),
}))

vi.mock('../../../stores/transportStore', () => ({
  useTransportStore: Object.assign(
    vi.fn(),
    { getState: vi.fn(() => ({ snapshot: { bpm: 120 } })) },
  ),
}))

vi.mock('../../../lib/ipc', () => ({
  ipcComputeCutClip: vi.fn(),
  ipcComputeTrimStartClip: vi.fn(),
  ipcComputeTrimEndClip: vi.fn(),
  ipcFindZeroCrossing: vi.fn().mockResolvedValue(100),
  ipcReverseClipRegion: vi.fn(),
  ipcInvalidateClipCache: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn().mockResolvedValue('/tmp'),
}))

import { WaveformToolbar } from '../WaveformToolbar'

describe('WaveformToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentState = buildState()
    mockSetTool.mockReset()
    mockSetViewport.mockReset()
  })

  it('cut_disabled_when_no_selection', () => {
    currentState = buildState({ selection: null })
    render(<WaveformToolbar />)
    const cutBtn = screen.getByTestId('btn-cut')
    expect(cutBtn).toBeDisabled()
  })

  it('cut_enabled_when_selection_present', () => {
    currentState = buildState({ selection: { startFrame: 0, endFrame: 100 } })
    render(<WaveformToolbar />)
    const cutBtn = screen.getByTestId('btn-cut')
    expect(cutBtn).not.toBeDisabled()
  })

  it('reverse_disabled_when_no_selection', () => {
    currentState = buildState({ selection: null })
    render(<WaveformToolbar />)
    const revBtn = screen.getByTestId('btn-reverse')
    expect(revBtn).toBeDisabled()
  })

  it('zoom_in_updates_viewport', () => {
    currentState = buildState()
    render(<WaveformToolbar />)
    const zoomInBtn = screen.getByTestId('btn-zoom-in')
    fireEvent.click(zoomInBtn)
    expect(mockSetViewport).toHaveBeenCalledWith(
      expect.objectContaining({ framesPerPixel: expect.any(Number) }),
    )
    expect(mockLoadPeakData).toHaveBeenCalled()
  })
})
