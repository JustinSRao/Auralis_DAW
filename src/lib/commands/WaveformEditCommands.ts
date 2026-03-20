/**
 * Undoable command implementations for the Waveform Editor (Sprint 15).
 *
 * Each class implements the {@link Command} interface from `src/lib/history.ts`.
 * Commands operate directly on `useFileStore` (modifying currentProject.tracks[].clips
 * and currentProject.samples) and call `markDirty` via the file store.
 *
 * All clip mutations are local — the DAW backend does not hold authoritative
 * clip data; the project file is the source of truth.
 */

import type { Command } from '../history'
import type { ClipEditData, SampleReferenceData, TrimSnapshot } from '../ipc'
import { ipcInvalidateClipCache } from '../ipc'
import { useFileStore } from '../../stores/fileStore'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a `ClipData`-compatible object for insertion into a track's clips array. */
function toClipData(c: ClipEditData) {
  return {
    id: c.id,
    name: c.name,
    start_beats: c.startBeats,
    duration_beats: c.durationBeats,
    content: {
      type: 'Audio' as const,
      sample_id: c.sampleId,
      start_offset_samples: c.startOffsetSamples,
      gain: c.gain,
    },
  }
}

/** Apply a TrimSnapshot to the matching clip in the project. */
function applyTrimToStore(
  trackId: string,
  clipId: string,
  snapshot: TrimSnapshot,
): void {
  const store = useFileStore.getState()
  const project = store.currentProject
  if (!project) return

  const trackIdx = project.tracks.findIndex((t) => t.id === trackId)
  if (trackIdx === -1) return

  const clipIdx = project.tracks[trackIdx].clips.findIndex((c) => c.id === clipId)
  if (clipIdx === -1) return

  const clip = project.tracks[trackIdx].clips[clipIdx]
  if (clip.content.type !== 'Audio') return

  // We use immer via the store's internal set, so mutate via a fresh object.
  const updatedClips = [...project.tracks[trackIdx].clips]
  updatedClips[clipIdx] = {
    ...clip,
    start_beats: snapshot.startBeats,
    duration_beats: snapshot.durationBeats,
    content: {
      ...clip.content,
      start_offset_samples: snapshot.startOffsetSamples,
    },
  }

  const updatedTracks = [...project.tracks]
  updatedTracks[trackIdx] = {
    ...project.tracks[trackIdx],
    clips: updatedClips,
  }

  // Write back through the file store's raw setter
  useFileStore.setState((s) => {
    if (s.currentProject) {
      s.currentProject.tracks = updatedTracks
      s.isDirty = true
    }
  })
}

// ---------------------------------------------------------------------------
// CutClipCommand
// ---------------------------------------------------------------------------

/**
 * Replaces one audio clip with two sub-clips at the cut point.
 *
 * execute: removes original clip, inserts clipA and clipB.
 * undo:    removes clipA and clipB, restores original clip.
 */
export class CutClipCommand implements Command {
  readonly label: string

  constructor(
    private readonly trackId: string,
    private readonly removedClipId: string,
    private readonly originalClip: ClipEditData,
    private readonly clipA: ClipEditData,
    private readonly clipB: ClipEditData,
  ) {
    this.label = `Cut clip "${originalClip.name}"`
  }

  execute(): void {
    const store = useFileStore.getState()
    const project = store.currentProject
    if (!project) return

    const trackIdx = project.tracks.findIndex((t) => t.id === this.trackId)
    if (trackIdx === -1) return

    const filteredClips = project.tracks[trackIdx].clips.filter(
      (c) => c.id !== this.removedClipId,
    )
    const updatedClips = [...filteredClips, toClipData(this.clipA), toClipData(this.clipB)]

    const updatedTracks = [...project.tracks]
    updatedTracks[trackIdx] = { ...project.tracks[trackIdx], clips: updatedClips }

    useFileStore.setState((s) => {
      if (s.currentProject) {
        s.currentProject.tracks = updatedTracks
        s.isDirty = true
      }
    })
  }

  undo(): void {
    const store = useFileStore.getState()
    const project = store.currentProject
    if (!project) return

    const trackIdx = project.tracks.findIndex((t) => t.id === this.trackId)
    if (trackIdx === -1) return

    const filteredClips = project.tracks[trackIdx].clips.filter(
      (c) => c.id !== this.clipA.id && c.id !== this.clipB.id,
    )
    const updatedClips = [...filteredClips, toClipData(this.originalClip)]

    const updatedTracks = [...project.tracks]
    updatedTracks[trackIdx] = { ...project.tracks[trackIdx], clips: updatedClips }

    useFileStore.setState((s) => {
      if (s.currentProject) {
        s.currentProject.tracks = updatedTracks
        s.isDirty = true
      }
    })
  }
}

// ---------------------------------------------------------------------------
// TrimClipCommand
// ---------------------------------------------------------------------------

/**
 * Adjusts a clip's start or end edge.
 *
 * execute: applies the `after` snapshot.
 * undo:    applies the `before` snapshot.
 */
export class TrimClipCommand implements Command {
  readonly label: string

  constructor(
    private readonly trackId: string,
    private readonly clipId: string,
    private readonly before: TrimSnapshot,
    private readonly after: TrimSnapshot,
    private readonly edge: 'start' | 'end',
  ) {
    this.label = `Trim ${edge} of clip`
  }

  execute(): void {
    applyTrimToStore(this.trackId, this.clipId, this.after)
  }

  undo(): void {
    applyTrimToStore(this.trackId, this.clipId, this.before)
  }
}

// ---------------------------------------------------------------------------
// ReverseClipCommand
// ---------------------------------------------------------------------------

/**
 * Replaces a clip with a new clip referencing a reversed WAV file.
 *
 * execute: swaps the original clip for the new reversed clip, adds sample ref.
 * undo:    swaps back, removes the sample ref.
 */
export class ReverseClipCommand implements Command {
  readonly label: string

  constructor(
    private readonly trackId: string,
    private readonly removedClipId: string,
    private readonly originalClip: ClipEditData,
    private readonly newClip: ClipEditData,
    private readonly newSampleRef: SampleReferenceData,
    private readonly reversedFilePath: string,
  ) {
    this.label = `Reverse region of "${originalClip.name}"`
  }

  execute(): void {
    const store = useFileStore.getState()
    const project = store.currentProject
    if (!project) return

    const trackIdx = project.tracks.findIndex((t) => t.id === this.trackId)
    if (trackIdx === -1) return

    const filteredClips = project.tracks[trackIdx].clips.filter(
      (c) => c.id !== this.removedClipId,
    )
    const updatedClips = [...filteredClips, toClipData(this.newClip)]

    // Add new sample reference (convert from camelCase IPC type to snake_case project type)
    const newRef = {
      id: this.newSampleRef.id,
      original_filename: this.newSampleRef.originalFilename,
      archive_path: this.newSampleRef.archivePath,
      sample_rate: this.newSampleRef.sampleRate,
      channels: this.newSampleRef.channels,
      duration_secs: this.newSampleRef.durationSecs,
    }
    const updatedSamples = [...project.samples, newRef]

    const updatedTracks = [...project.tracks]
    updatedTracks[trackIdx] = { ...project.tracks[trackIdx], clips: updatedClips }

    useFileStore.setState((s) => {
      if (s.currentProject) {
        s.currentProject.tracks = updatedTracks
        s.currentProject.samples = updatedSamples
        s.isDirty = true
      }
    })

    // Invalidate backend cache for the new file (fire-and-forget)
    void ipcInvalidateClipCache(this.reversedFilePath)
  }

  undo(): void {
    const store = useFileStore.getState()
    const project = store.currentProject
    if (!project) return

    const trackIdx = project.tracks.findIndex((t) => t.id === this.trackId)
    if (trackIdx === -1) return

    const filteredClips = project.tracks[trackIdx].clips.filter(
      (c) => c.id !== this.newClip.id,
    )
    const updatedClips = [...filteredClips, toClipData(this.originalClip)]

    // Remove the added sample reference
    const updatedSamples = project.samples.filter((s) => s.id !== this.newSampleRef.id)

    const updatedTracks = [...project.tracks]
    updatedTracks[trackIdx] = { ...project.tracks[trackIdx], clips: updatedClips }

    useFileStore.setState((s) => {
      if (s.currentProject) {
        s.currentProject.tracks = updatedTracks
        s.currentProject.samples = updatedSamples
        s.isDirty = true
      }
    })
  }
}
