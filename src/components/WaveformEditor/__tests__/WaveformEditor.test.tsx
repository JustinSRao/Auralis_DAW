/**
 * Smoke tests for the WaveformEditor component (Sprint 15).
 *
 * Canvas drawing is opaque in jsdom — we test DOM structure and
 * keyboard/interaction behaviour.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Canvas stubbing — must be before any component imports
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null as unknown as CanvasRenderingContext2D
})

// ---------------------------------------------------------------------------
// Mock dependencies
// TDZ note: vi.mock factory runs hoisted — reference spies only inside
// nested functions (never at factory outer scope).
// ---------------------------------------------------------------------------

vi.mock('../../../stores/waveformEditorStore', () => {
  // Build spies inside the factory to avoid TDZ issues.
  const closeSpy = vi.fn()
  const setViewportSpy = vi.fn()
  const loadPeakDataSpy = vi.fn().mockResolvedValue(undefined)
  const setCursorSpy = vi.fn()
  const setSelectionSpy = vi.fn()
  const setToolSpy = vi.fn()

  function buildState(isOpen = true) {
    return {
      isOpen,
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
      close: closeSpy,
      openForClip: vi.fn(),
      loadPeakData: loadPeakDataSpy,
      setViewport: setViewportSpy,
      setCursor: setCursorSpy,
      setSelection: setSelectionSpy,
      setTool: setToolSpy,
      clearError: vi.fn(),
    }
  }

  let currentState = buildState(true)

  const storeHook = Object.assign(
    (sel?: (s: ReturnType<typeof buildState>) => unknown) =>
      sel ? sel(currentState) : currentState,
    {
      getState: () => currentState,
      setState: (fn: (s: ReturnType<typeof buildState>) => void) => {
        fn(currentState)
      },
      // Expose internal spies for test access via a non-standard property
      __spies: { closeSpy, setViewportSpy, loadPeakDataSpy },
      __setIsOpen: (v: boolean) => {
        currentState = buildState(v)
      },
    },
  )

  return { useWaveformEditorStore: storeHook }
})

vi.mock('../../../stores/historyStore', () => {
  const undoSpy = vi.fn()
  const redoSpy = vi.fn()
  const state = {
    canUndo: false,
    canRedo: false,
    entries: [],
    currentPointer: -1,
    push: vi.fn(),
    undo: undoSpy,
    redo: redoSpy,
    clear: vi.fn(),
  }
  const storeHook = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    {
      getState: () => state,
      __spies: { undoSpy, redoSpy },
    },
  )
  return { useHistoryStore: storeHook }
})

// Mock WaveformToolbar to isolate WaveformEditor
vi.mock('../WaveformToolbar', () => ({
  WaveformToolbar: () => <div data-testid="waveform-toolbar-stub" />,
}))

// Mock @tauri-apps/api/path
vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn().mockResolvedValue('/tmp'),
}))

// Import component after mocks
import { WaveformEditor } from '../WaveformEditor'
import { useWaveformEditorStore } from '../../../stores/waveformEditorStore'
import { useHistoryStore } from '../../../stores/historyStore'

// Retrieve spies after module loads
const editorSpies = (useWaveformEditorStore as unknown as { __spies: Record<string, ReturnType<typeof vi.fn>>; __setIsOpen: (v: boolean) => void })
const historySpies = (useHistoryStore as unknown as { __spies: Record<string, ReturnType<typeof vi.fn>> })

describe('WaveformEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset isOpen to true before each test
    editorSpies.__setIsOpen(true)
  })

  it('renders_modal_when_open', () => {
    editorSpies.__setIsOpen(true)
    render(<WaveformEditor />)
    expect(screen.getByTestId('waveform-editor')).toBeDefined()
    expect(screen.getByTestId('waveform-canvas')).toBeDefined()
    expect(screen.getByTestId('waveform-toolbar-stub')).toBeDefined()
  })

  it('renders_nothing_when_closed', () => {
    editorSpies.__setIsOpen(false)
    const { container } = render(<WaveformEditor />)
    // When isOpen=false, nothing is rendered
    expect(container.firstChild).toBeNull()
  })

  it('escape_closes_editor', () => {
    editorSpies.__setIsOpen(true)
    render(<WaveformEditor />)
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(editorSpies.__spies.closeSpy).toHaveBeenCalledTimes(1)
  })

  it('ctrl_z_calls_history_undo', () => {
    editorSpies.__setIsOpen(true)
    render(<WaveformEditor />)
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    })
    expect(historySpies.__spies.undoSpy).toHaveBeenCalledTimes(1)
  })
})
