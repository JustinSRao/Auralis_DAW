/**
 * Zustand store for the Waveform Editor (Sprint 15).
 *
 * Tracks which audio clip is open, waveform peak data, viewport, selection,
 * and cursor state. Not persisted — ephemeral UI state only.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { PeakData } from '../lib/ipc'
import { ipcGetPeakData } from '../lib/ipc'

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface WaveformViewport {
  /** Number of audio frames per horizontal pixel. */
  framesPerPixel: number
  /** Horizontal scroll offset in frames. */
  scrollFrames: number
  /** Canvas width in pixels (updated by ResizeObserver). */
  canvasWidth: number
}

export interface SelectionRange {
  startFrame: number
  endFrame: number
}

export type WaveformTool = 'select' | 'trim-start' | 'trim-end'

// ---------------------------------------------------------------------------
// State / actions interfaces
// ---------------------------------------------------------------------------

interface WaveformEditorState {
  isOpen: boolean
  activeClipId: string | null
  activeTrackId: string | null
  filePath: string | null
  totalFrames: number
  sampleRate: number
  peakData: PeakData | null
  peakLoading: boolean
  viewport: WaveformViewport
  cursorFrame: number | null
  selection: SelectionRange | null
  tool: WaveformTool
  error: string | null
}

interface WaveformEditorActions {
  /**
   * Opens the waveform editor for a specific audio clip.
   * Automatically triggers peak data loading at the current viewport zoom.
   */
  openForClip(
    clipId: string,
    trackId: string,
    filePath: string,
    totalFrames: number,
    sampleRate: number,
  ): void

  /** Closes the editor and resets all state. */
  close(): void

  /** Loads (or reloads) peak data from the backend for the current file + zoom. */
  loadPeakData(): Promise<void>

  /** Updates one or more viewport fields. */
  setViewport(patch: Partial<WaveformViewport>): void

  /** Moves the playhead cursor to a specific frame position. */
  setCursor(frame: number | null): void

  /** Sets the selection range (both edges). */
  setSelection(range: SelectionRange | null): void

  /** Switches the active edit tool. */
  setTool(tool: WaveformTool): void

  /** Clears the last error message. */
  clearError(): void
}

export type WaveformEditorStore = WaveformEditorState & WaveformEditorActions

// ---------------------------------------------------------------------------
// Default viewport
// ---------------------------------------------------------------------------

const DEFAULT_VIEWPORT: WaveformViewport = {
  framesPerPixel: 256,
  scrollFrames: 0,
  canvasWidth: 800,
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: WaveformEditorState = {
  isOpen: false,
  activeClipId: null,
  activeTrackId: null,
  filePath: null,
  totalFrames: 0,
  sampleRate: 44100,
  peakData: null,
  peakLoading: false,
  viewport: { ...DEFAULT_VIEWPORT },
  cursorFrame: null,
  selection: null,
  tool: 'select',
  error: null,
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWaveformEditorStore = create<WaveformEditorStore>()(
  immer((set, get) => ({
    ...INITIAL_STATE,

    openForClip: (clipId, trackId, filePath, totalFrames, sampleRate) => {
      set((s) => {
        s.isOpen = true
        s.activeClipId = clipId
        s.activeTrackId = trackId
        s.filePath = filePath
        s.totalFrames = totalFrames
        s.sampleRate = sampleRate
        s.peakData = null
        s.peakLoading = false
        s.cursorFrame = null
        s.selection = null
        s.tool = 'select'
        s.error = null
        // Keep viewport.canvasWidth but reset zoom/scroll
        s.viewport.framesPerPixel = DEFAULT_VIEWPORT.framesPerPixel
        s.viewport.scrollFrames = 0
      })
      // Kick off peak loading
      void get().loadPeakData()
    },

    close: () => {
      set((s) => {
        Object.assign(s, INITIAL_STATE)
        // Re-apply default viewport separately to avoid readonly conflict
        s.viewport = { ...DEFAULT_VIEWPORT }
      })
    },

    loadPeakData: async () => {
      const { filePath, viewport } = get()
      if (!filePath) return

      set((s) => {
        s.peakLoading = true
        s.error = null
      })

      try {
        const data = await ipcGetPeakData(filePath, viewport.framesPerPixel)
        set((s) => {
          s.peakData = data
          s.peakLoading = false
        })
      } catch (e) {
        set((s) => {
          s.error = String(e)
          s.peakLoading = false
        })
      }
    },

    setViewport: (patch) => {
      set((s) => {
        Object.assign(s.viewport, patch)
      })
    },

    setCursor: (frame) => {
      set((s) => {
        s.cursorFrame = frame
      })
    },

    setSelection: (range) => {
      set((s) => {
        s.selection = range
      })
    },

    setTool: (tool) => {
      set((s) => {
        s.tool = tool
      })
    },

    clearError: () => {
      set((s) => {
        s.error = null
      })
    },
  })),
)
