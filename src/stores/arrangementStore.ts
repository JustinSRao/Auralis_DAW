import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { ArrangementClip } from '../lib/ipc'
import {
  ipcAddArrangementClip,
  ipcMoveArrangementClip,
  ipcResizeArrangementClip,
  ipcDeleteArrangementClip,
  ipcDuplicateArrangementClip,
} from '../lib/ipc'

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
      } catch (e) {
        set((s) => { s.error = String(e) })
      }
    },

    resizeClip: async (id, newLengthBars) => {
      try {
        await ipcResizeArrangementClip(id, newLengthBars)
        set((s) => { if (s.clips[id]) s.clips[id].lengthBars = newLengthBars })
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
      } catch (e) {
        set((s) => { s.error = String(e) })
      }
    },

    duplicateClip: async (sourceId, newStartBar, patternId, trackId, lengthBars) => {
      try {
        const clip = await ipcDuplicateArrangementClip(sourceId, newStartBar, patternId, trackId, lengthBars)
        set((s) => { s.clips[clip.id] = clip })
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

    loadFromProject: (clips) =>
      set((s) => {
        s.clips = {}
        for (const c of clips) s.clips[c.id] = c
        s.selectedClipId = null
        s.error = null
      }),

    clearError: () => set((s) => { s.error = null }),
  }))
)
