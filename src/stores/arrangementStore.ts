import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { ArrangementClip, ScheduledNotePayload } from '../lib/ipc'
import {
  ipcAddArrangementClip,
  ipcMoveArrangementClip,
  ipcResizeArrangementClip,
  ipcDeleteArrangementClip,
  ipcDuplicateArrangementClip,
  ipcSetArrangementClips,
} from '../lib/ipc'
import { usePatternStore } from './patternStore'
import { useTransportStore } from './transportStore'

export type { ArrangementClip }

/** Timeline viewport: zoom and horizontal scroll. */
export interface TimelineViewport {
  /** Horizontal scroll offset in pixels. */
  scrollLeft: number
  /** Pixels per bar at the current zoom level. Default 80, range 20–400. */
  pixelsPerBar: number
  /** Height of each track row in pixels. Default 64. */
  trackHeight: number
}

interface ArrangementState {
  clips: Record<string, ArrangementClip>
  viewport: TimelineViewport
  selectedClipId: string | null
  error: string | null
}

interface ArrangementActions {
  /** Calls IPC to create a clip, then inserts the returned clip (with UUID) into the store. */
  addClip(patternId: string, trackId: string, startBar: number, lengthBars: number): Promise<void>
  /** Validates via IPC, then applies the move locally. */
  moveClip(id: string, newTrackId: string, newStartBar: number): Promise<void>
  /** Validates via IPC, then applies the resize locally. */
  resizeClip(id: string, newLengthBars: number): Promise<void>
  /** Validates via IPC, then removes the clip locally. */
  deleteClip(id: string): Promise<void>
  /** Duplicates a clip at a new bar position via IPC. */
  duplicateClip(sourceId: string, newStartBar: number, patternId: string, trackId: string, lengthBars: number): Promise<void>
  /** Applies a partial update immediately (used during drag, no IPC). */
  updateClipOptimistic(id: string, patch: Partial<ArrangementClip>): void
  /** Reverts an optimistic update on IPC error. */
  revertClipOptimistic(id: string, original: ArrangementClip): void
  /** Updates zoom and/or scroll. */
  setViewport(patch: Partial<TimelineViewport>): void
  selectClip(id: string | null): void
  /** Replaces all clips from a loaded project. Called by fileStore.open(). */
  loadFromProject(clips: ArrangementClip[]): void
  clearError(): void
  /**
   * Rebuilds the scheduler's note list from the current clips + pattern MIDI notes
   * + transport BPM. Call after any arrangement or tempo change. Fire-and-forget
   * (errors are logged, not re-thrown).
   */
  syncScheduler(): void
}

export type ArrangementStore = ArrangementState & ArrangementActions

export const useArrangementStore = create<ArrangementStore>()(
  immer((set) => ({
    clips: {},
    viewport: { scrollLeft: 0, pixelsPerBar: 80, trackHeight: 64 },
    selectedClipId: null,
    error: null,

    addClip: async (patternId, trackId, startBar, lengthBars) => {
      try {
        const clip = await ipcAddArrangementClip(patternId, trackId, startBar, lengthBars)
        set((s) => { s.clips[clip.id] = clip })
        useArrangementStore.getState().syncScheduler()
      } catch (e) {
        set((s) => { s.error = String(e) })
      }
    },

    moveClip: async (id, newTrackId, newStartBar) => {
      try {
        await ipcMoveArrangementClip(id, newTrackId, newStartBar)
        set((s) => {
          if (s.clips[id]) {
            s.clips[id].trackId = newTrackId
            s.clips[id].startBar = newStartBar
          }
        })
        useArrangementStore.getState().syncScheduler()
      } catch (e) {
        set((s) => { s.error = String(e) })
      }
    },

    resizeClip: async (id, newLengthBars) => {
      try {
        await ipcResizeArrangementClip(id, newLengthBars)
        set((s) => { if (s.clips[id]) s.clips[id].lengthBars = newLengthBars })
        useArrangementStore.getState().syncScheduler()
      } catch (e) {
        set((s) => { s.error = String(e) })
      }
    },

    deleteClip: async (id) => {
      try {
        await ipcDeleteArrangementClip(id)
        set((s) => {
          delete s.clips[id]
          if (s.selectedClipId === id) s.selectedClipId = null
        })
        useArrangementStore.getState().syncScheduler()
      } catch (e) {
        set((s) => { s.error = String(e) })
      }
    },

    duplicateClip: async (sourceId, newStartBar, patternId, trackId, lengthBars) => {
      try {
        const clip = await ipcDuplicateArrangementClip(sourceId, newStartBar, patternId, trackId, lengthBars)
        set((s) => { s.clips[clip.id] = clip })
        useArrangementStore.getState().syncScheduler()
      } catch (e) {
        set((s) => { s.error = String(e) })
      }
    },

    updateClipOptimistic: (id, patch) =>
      set((s) => { if (s.clips[id]) Object.assign(s.clips[id], patch) }),

    revertClipOptimistic: (id, original) =>
      set((s) => { s.clips[id] = original }),

    setViewport: (patch) =>
      set((s) => { Object.assign(s.viewport, patch) }),

    selectClip: (id) =>
      set((s) => { s.selectedClipId = id }),

    loadFromProject: (clips) => {
      set((s) => {
        s.clips = {}
        for (const c of clips) s.clips[c.id] = c
        s.selectedClipId = null
        s.error = null
      })
      useArrangementStore.getState().syncScheduler()
    },

    clearError: () => set((s) => { s.error = null }),

    syncScheduler: () => {
      // Read current state without subscribing.
      const clips = Object.values(useArrangementStore.getState().clips)
      const patterns = usePatternStore.getState().patterns
      const snap = useTransportStore.getState().snapshot
      const bpm = snap.bpm
      const beatsPerBar = snap.time_sig_numerator
      const sampleRate = 44100

      const samplesPerBeat = (sampleRate * 60) / bpm
      const samplesPerBar = samplesPerBeat * beatsPerBar

      const notes: ScheduledNotePayload[] = []

      for (const clip of clips) {
        const pattern = patterns[clip.patternId]
        if (!pattern) continue
        if (pattern.content.type !== 'Midi') continue

        const clipStartSample = Math.floor(clip.startBar * samplesPerBar)
        const clipEndSample = Math.floor((clip.startBar + clip.lengthBars) * samplesPerBar)

        for (const note of pattern.content.notes) {
          const onSample = clipStartSample + Math.floor(note.startBeats * samplesPerBeat)
          const offSample = Math.min(
            clipStartSample + Math.floor((note.startBeats + note.durationBeats) * samplesPerBeat),
            clipEndSample,
          )
          if (onSample >= clipEndSample) continue
          notes.push({
            onSample,
            offSample,
            pitch: note.pitch,
            velocity: note.velocity,
            channel: note.channel,
            trackId: clip.trackId,
          })
        }
      }

      // Sort ascending by onSample before sending.
      notes.sort((a, b) => a.onSample - b.onSample)

      ipcSetArrangementClips(notes).catch((e) => {
        console.warn('[arrangementStore] syncScheduler failed:', e)
      })
    },
  }))
)
