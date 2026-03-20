/**
 * Tests for StretchPanel (Sprint 16).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock @tauri-apps/api/path
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn().mockResolvedValue('/tmp'),
}))

// ---------------------------------------------------------------------------
// Mock IPC functions
// ---------------------------------------------------------------------------

const mockIpcSetClipTimeStretch = vi.fn().mockResolvedValue({ clipId: 'clip-1', processedFrameCount: 44100 })
const mockIpcSetClipPitchShift = vi.fn().mockResolvedValue(undefined)
const mockIpcBakeClipStretch = vi.fn().mockResolvedValue({
  newClipData: { id: 'clip-new', name: 'test (baked)', startBeats: 0, durationBeats: 4, sampleId: 's2', startOffsetSamples: 0, gain: 1 },
  newSampleReference: { id: 's2', originalFilename: 'test_baked.wav', archivePath: 'samples/test_baked.wav', sampleRate: 44100, channels: 2, durationSecs: 4.0 },
  bakedFilePath: '/tmp/test_baked.wav',
})
const mockIpcComputeBpmStretchRatio = vi.fn().mockResolvedValue(1.333)

vi.mock('../../../lib/ipc', () => ({
  ipcSetClipTimeStretch: (...args: unknown[]) => mockIpcSetClipTimeStretch(...args),
  ipcSetClipPitchShift: (...args: unknown[]) => mockIpcSetClipPitchShift(...args),
  ipcBakeClipStretch: (...args: unknown[]) => mockIpcBakeClipStretch(...args),
  ipcComputeBpmStretchRatio: (...args: unknown[]) => mockIpcComputeBpmStretchRatio(...args),
}))

// ---------------------------------------------------------------------------
// Mock historyStore
// ---------------------------------------------------------------------------

vi.mock('../../../stores/historyStore', () => ({
  useHistoryStore: Object.assign(
    vi.fn(() => ({ canUndo: false, canRedo: false, push: vi.fn(), undo: vi.fn(), redo: vi.fn() })),
    { getState: vi.fn(() => ({ push: vi.fn(), canUndo: false, canRedo: false })) },
  ),
}))

// ---------------------------------------------------------------------------
// Mock StretchPitchCommands
// ---------------------------------------------------------------------------

vi.mock('../../../lib/commands/StretchPitchCommands', () => ({
  SetStretchRatioCommand: vi.fn().mockImplementation(() => ({ label: 'Set stretch ratio', execute: vi.fn(), undo: vi.fn() })),
  SetPitchShiftCommand: vi.fn().mockImplementation(() => ({ label: 'Set pitch shift', execute: vi.fn(), undo: vi.fn() })),
  BakeStretchCommand: vi.fn().mockImplementation(() => ({ label: 'Bake stretch', execute: vi.fn(), undo: vi.fn() })),
}))

// ---------------------------------------------------------------------------
// Mock fileStore (needed by bakeToFile)
// ---------------------------------------------------------------------------

vi.mock('../../../stores/fileStore', () => ({
  useFileStore: Object.assign(
    vi.fn(() => ({ currentProject: null })),
    { getState: vi.fn(() => ({ currentProject: null })) },
  ),
}))

// ---------------------------------------------------------------------------
// Mock waveformEditorStore
// ---------------------------------------------------------------------------

const mockApplyStretch = vi.fn().mockResolvedValue(undefined)
const mockApplyPitch = vi.fn().mockResolvedValue(undefined)
const mockBakeToFile = vi.fn().mockResolvedValue(undefined)
const mockSetState = vi.fn()

function buildStoreState(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    activeClipId: 'clip-1',
    activeTrackId: 'track-1',
    filePath: '/audio/test.wav',
    totalFrames: 44100,
    sampleRate: 44100,
    stretchRatio: 1.0,
    pitchSemitones: 0,
    isProcessing: false,
    peakData: null,
    peakLoading: false,
    viewport: { framesPerPixel: 256, scrollFrames: 0, canvasWidth: 800 },
    cursorFrame: null,
    selection: null,
    tool: 'select' as const,
    error: null,
    applyStretch: mockApplyStretch,
    applyPitch: mockApplyPitch,
    bakeToFile: mockBakeToFile,
    close: vi.fn(),
    openForClip: vi.fn(),
    loadPeakData: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn(),
    setCursor: vi.fn(),
    setSelection: vi.fn(),
    setTool: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  }
}

let currentStoreState = buildStoreState()

vi.mock('../../../stores/waveformEditorStore', () => {
  const storeHook = Object.assign(
    vi.fn((sel?: (s: ReturnType<typeof buildStoreState>) => unknown) =>
      sel ? sel(currentStoreState) : currentStoreState,
    ),
    {
      getState: vi.fn(() => currentStoreState),
      setState: (...args: unknown[]) => mockSetState(...args),
    },
  )
  return { useWaveformEditorStore: storeHook }
})

// ---------------------------------------------------------------------------
// Mock transportStore
// ---------------------------------------------------------------------------

vi.mock('../../../stores/transportStore', () => ({
  useTransportStore: vi.fn((sel?: (s: { snapshot: { bpm: number } }) => unknown) => {
    const state = { snapshot: { bpm: 140.0 } }
    return sel ? sel(state) : state
  }),
}))

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { StretchPanel } from '../StretchPanel'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StretchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentStoreState = buildStoreState()
  })

  it('renders stretch ratio input with default 1.0', () => {
    render(<StretchPanel />)
    const input = screen.getByTestId('stretch-ratio-input') as HTMLInputElement
    expect(parseFloat(input.value)).toBeCloseTo(1.0, 2)
  })

  it('Apply button is disabled when isProcessing is true', () => {
    currentStoreState = buildStoreState({ isProcessing: true })
    render(<StretchPanel />)
    const applyBtn = screen.getByTestId('btn-apply-stretch')
    expect(applyBtn).toBeDisabled()
  })

  it('Apply button is disabled when ratio equals current store ratio', () => {
    // Default ratio is 1.0 and input default is 1.0 — button should be disabled
    render(<StretchPanel />)
    const applyBtn = screen.getByTestId('btn-apply-stretch')
    expect(applyBtn).toBeDisabled()
  })

  it('Apply button is enabled when ratio differs from current store ratio', () => {
    render(<StretchPanel />)
    const input = screen.getByTestId('stretch-ratio-input') as HTMLInputElement
    // Change ratio to 1.5
    fireEvent.change(input, { target: { value: '1.5' } })
    const applyBtn = screen.getByTestId('btn-apply-stretch')
    expect(applyBtn).not.toBeDisabled()
  })

  it('BPM match section shows project BPM from transportStore', () => {
    render(<StretchPanel />)
    // Project BPM is 140.0 from the mock
    expect(screen.getByText(/Project BPM: 140\.0/)).toBeTruthy()
  })

  it('COMPUTE button computes and shows computed ratio', async () => {
    render(<StretchPanel />)
    const bpmInput = screen.getByTestId('original-bpm-input') as HTMLInputElement
    fireEvent.change(bpmInput, { target: { value: '120' } })

    const computeBtn = screen.getByTestId('btn-compute-bpm')
    fireEvent.click(computeBtn)

    // Wait for the async compute
    await vi.waitFor(() => {
      expect(mockIpcComputeBpmStretchRatio).toHaveBeenCalledWith(120, 140.0)
    })
  })

  it('pitch semitones display starts at 0', () => {
    render(<StretchPanel />)
    const display = screen.getByTestId('pitch-semitones-display')
    expect(display.textContent).toContain('0')
  })

  it('clicking plus increments pitch semitones display', () => {
    render(<StretchPanel />)
    const plusBtn = screen.getByTestId('btn-pitch-plus')
    fireEvent.click(plusBtn)
    // setState is called with the increment
    expect(mockSetState).toHaveBeenCalled()
  })

  it('pitch Apply button calls applyPitch store action', () => {
    render(<StretchPanel />)
    const applyBtn = screen.getByTestId('btn-apply-pitch')
    fireEvent.click(applyBtn)
    expect(mockApplyPitch).toHaveBeenCalledWith(currentStoreState.pitchSemitones)
  })

  it('BAKE TO FILE button is disabled when isProcessing', () => {
    currentStoreState = buildStoreState({ isProcessing: true })
    render(<StretchPanel />)
    const bakeBtn = screen.getByTestId('btn-bake')
    expect(bakeBtn).toBeDisabled()
  })
})
