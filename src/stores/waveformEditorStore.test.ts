/**
 * Unit tests for the waveform editor store (Sprint 15).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock IPC
vi.mock('../lib/ipc', () => ({
  ipcGetPeakData: vi.fn().mockResolvedValue({
    framesPerPixel: 256,
    left: [],
    right: [],
    totalFrames: 44100,
    sampleRate: 44100,
  }),
}))

// Import store after mocks
import { useWaveformEditorStore } from './waveformEditorStore'

describe('waveformEditorStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useWaveformEditorStore.getState().close()
  })

  it('openForClip_sets_open_and_clip_fields', () => {
    useWaveformEditorStore
      .getState()
      .openForClip('clip-1', 'track-1', '/audio/kick.wav', 44100, 44100)

    const s = useWaveformEditorStore.getState()
    expect(s.isOpen).toBe(true)
    expect(s.activeClipId).toBe('clip-1')
    expect(s.activeTrackId).toBe('track-1')
    expect(s.filePath).toBe('/audio/kick.wav')
    expect(s.totalFrames).toBe(44100)
    expect(s.sampleRate).toBe(44100)
  })

  it('close_resets_to_initial_state', () => {
    useWaveformEditorStore
      .getState()
      .openForClip('clip-1', 'track-1', '/audio/kick.wav', 44100, 44100)

    useWaveformEditorStore.getState().close()

    const s = useWaveformEditorStore.getState()
    expect(s.isOpen).toBe(false)
    expect(s.activeClipId).toBeNull()
    expect(s.activeTrackId).toBeNull()
    expect(s.filePath).toBeNull()
    expect(s.peakData).toBeNull()
    expect(s.selection).toBeNull()
    expect(s.cursorFrame).toBeNull()
  })

  it('setSelection_stores_range', () => {
    useWaveformEditorStore.getState().setSelection({ startFrame: 100, endFrame: 500 })

    const s = useWaveformEditorStore.getState()
    expect(s.selection).toEqual({ startFrame: 100, endFrame: 500 })
  })

  it('setTool_changes_tool', () => {
    useWaveformEditorStore.getState().setTool('trim-start')
    expect(useWaveformEditorStore.getState().tool).toBe('trim-start')

    useWaveformEditorStore.getState().setTool('trim-end')
    expect(useWaveformEditorStore.getState().tool).toBe('trim-end')

    useWaveformEditorStore.getState().setTool('select')
    expect(useWaveformEditorStore.getState().tool).toBe('select')
  })
})
