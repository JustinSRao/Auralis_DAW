/**
 * Zustand store for the Waveform Editor (Sprint 15).
 *
 * Tracks which audio clip is open, waveform peak data, viewport, selection,
 * and cursor state. Not persisted — ephemeral UI state only.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { PeakData } from '../lib/ipc'
import {
  ipcGetPeakData,
  ipcSetClipTimeStretch,
  ipcSetClipPitchShift,
  ipcBakeClipStretch,
} from '../lib/ipc'
import { useHistoryStore } from './historyStore'
import {
  SetStretchRatioCommand,
  SetPitchShiftCommand,
  BakeStretchCommand,
} from '../lib/commands/StretchPitchCommands'
import type { ClipEditData, SampleReferenceData } from '../lib/ipc'

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
  // Sprint 16: Time Stretch & Pitch Shift
  /** Current time-stretch ratio (0.5–2.0). 1.0 = no stretch. */
  stretchRatio: number
  /** Current pitch shift in semitones (-24..=+24). 0 = no shift. */
  pitchSemitones: number
  /** True while a time-stretch or pitch-shift operation is in progress. */
  isProcessing: boolean
}

interface WaveformEditorActions {
  /**
   * Opens the waveform editor for a specific audio clip.
   * Automatically triggers peak data loading at the current viewport zoom.
   * Reads `stretch_ratio` and `pitch_shift_semitones` from the clip data.
   */
  openForClip(
    clipId: string,
    trackId: string,
    filePath: string,
    totalFrames: number,
    sampleRate: number,
    stretchRatio?: number | null,
    pitchSemitones?: number | null,
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

  // Sprint 16: Time Stretch & Pitch Shift

  /**
   * Applies time-stretch to the current clip.
   * Calls the backend, updates `totalFrames` from the processed frame count,
   * and pushes a `SetStretchRatioCommand` to the history store.
   */
  applyStretch(ratio: number): Promise<void>

  /**
   * Applies pitch-shift to the current clip.
   * Calls the backend and pushes a `SetPitchShiftCommand` to the history store.
   */
  applyPitch(semitones: number): Promise<void>

  /**
   * Bakes the current stretch + pitch settings to a permanent WAV file.
   * Calls the backend, swaps the clip in the project, and pushes a
   * `BakeStretchCommand` to the history store.
   */
  bakeToFile(outputDir: string): Promise<void>
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
  stretchRatio: 1.0,
  pitchSemitones: 0,
  isProcessing: false,
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWaveformEditorStore = create<WaveformEditorStore>()(
  immer((set, get) => ({
    ...INITIAL_STATE,

    openForClip: (clipId, trackId, filePath, totalFrames, sampleRate, stretchRatio, pitchSemitones) => {
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
        s.stretchRatio = stretchRatio ?? 1.0
        s.pitchSemitones = pitchSemitones ?? 0
        s.isProcessing = false
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

    // -------------------------------------------------------------------------
    // Sprint 16: Time Stretch & Pitch Shift
    // -------------------------------------------------------------------------

    applyStretch: async (ratio: number) => {
      const { activeClipId, activeTrackId, filePath, stretchRatio } = get()
      if (!activeClipId || !activeTrackId || !filePath) return

      set((s) => { s.isProcessing = true; s.error = null })
      try {
        const result = await ipcSetClipTimeStretch(activeClipId, filePath, ratio)
        set((s) => {
          s.stretchRatio = ratio
          s.totalFrames = result.processedFrameCount
          s.isProcessing = false
        })
        const cmd = new SetStretchRatioCommand(
          activeTrackId,
          activeClipId,
          stretchRatio === 1.0 ? null : stretchRatio,
          ratio === 1.0 ? null : ratio,
        )
        useHistoryStore.getState().push(cmd)
      } catch (e) {
        set((s) => { s.error = String(e); s.isProcessing = false })
      }
    },

    applyPitch: async (semitones: number) => {
      const { activeClipId, activeTrackId, filePath, pitchSemitones } = get()
      if (!activeClipId || !activeTrackId || !filePath) return

      set((s) => { s.isProcessing = true; s.error = null })
      try {
        await ipcSetClipPitchShift(activeClipId, filePath, semitones)
        set((s) => {
          s.pitchSemitones = semitones
          s.isProcessing = false
        })
        const cmd = new SetPitchShiftCommand(
          activeTrackId,
          activeClipId,
          pitchSemitones === 0 ? null : pitchSemitones,
          semitones === 0 ? null : semitones,
        )
        useHistoryStore.getState().push(cmd)
      } catch (e) {
        set((s) => { s.error = String(e); s.isProcessing = false })
      }
    },

    bakeToFile: async (outputDir: string) => {
      const { activeClipId, activeTrackId, filePath, stretchRatio, pitchSemitones } = get()
      if (!activeClipId || !activeTrackId || !filePath) return

      // Build ClipEditData from the current project state
      const { useFileStore } = await import('./fileStore')
      const project = useFileStore.getState().currentProject
      if (!project) return

      const track = project.tracks.find((t) => t.id === activeTrackId)
      if (!track) return

      const clip = track.clips.find((c) => c.id === activeClipId)
      if (!clip || clip.content.type !== 'Audio') return

      const clipData: ClipEditData = {
        id: clip.id,
        name: clip.name,
        startBeats: clip.start_beats,
        durationBeats: clip.duration_beats,
        sampleId: clip.content.sample_id,
        startOffsetSamples: clip.content.start_offset_samples,
        gain: clip.content.gain,
      }

      set((s) => { s.isProcessing = true; s.error = null })
      try {
        const result = await ipcBakeClipStretch(
          activeClipId,
          clipData,
          filePath,
          stretchRatio,
          pitchSemitones,
          outputDir,
        )

        const newSampleRef: SampleReferenceData = result.newSampleReference
        const cmd = new BakeStretchCommand(
          activeTrackId,
          activeClipId,
          clipData,
          result.newClipData,
          newSampleRef,
          result.bakedFilePath,
        )
        useHistoryStore.getState().push(cmd)

        // Reset stretch/pitch state — the baked clip is identity
        set((s) => {
          s.activeClipId = result.newClipData.id
          s.filePath = result.bakedFilePath
          s.stretchRatio = 1.0
          s.pitchSemitones = 0
          s.isProcessing = false
        })
      } catch (e) {
        set((s) => { s.error = String(e); s.isProcessing = false })
      }
    },
  })),
)
