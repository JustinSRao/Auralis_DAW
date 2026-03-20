/**
 * Undoable command implementations for Time Stretch & Pitch Shift (Sprint 16).
 *
 * Three commands:
 * - `SetStretchRatioCommand` — records a stretch_ratio change on one clip.
 * - `SetPitchShiftCommand`   — records a pitch_shift_semitones change on one clip.
 * - `BakeStretchCommand`     — swaps the original clip for a baked WAV clip.
 *
 * All commands operate on `useFileStore.currentProject.tracks[].clips` and
 * mark the project dirty via `useFileStore.setState`.
 */

import type { Command } from '../history'
import type { ClipEditData, SampleReferenceData } from '../ipc'
import { useFileStore } from '../../stores/fileStore'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Updates `stretch_ratio` on the matching clip in the file store. */
function applyStretchRatioToStore(
  trackId: string,
  clipId: string,
  value: number | null,
): void {
  const project = useFileStore.getState().currentProject
  if (!project) return

  const trackIdx = project.tracks.findIndex((t) => t.id === trackId)
  if (trackIdx === -1) return

  const clipIdx = project.tracks[trackIdx].clips.findIndex((c) => c.id === clipId)
  if (clipIdx === -1) return

  useFileStore.setState((s) => {
    if (!s.currentProject) return
    s.currentProject.tracks[trackIdx].clips[clipIdx] = {
      ...s.currentProject.tracks[trackIdx].clips[clipIdx],
      stretch_ratio: value,
    }
    s.isDirty = true
  })
}

/** Updates `pitch_shift_semitones` on the matching clip in the file store. */
function applyPitchShiftToStore(
  trackId: string,
  clipId: string,
  value: number | null,
): void {
  const project = useFileStore.getState().currentProject
  if (!project) return

  const trackIdx = project.tracks.findIndex((t) => t.id === trackId)
  if (trackIdx === -1) return

  const clipIdx = project.tracks[trackIdx].clips.findIndex((c) => c.id === clipId)
  if (clipIdx === -1) return

  useFileStore.setState((s) => {
    if (!s.currentProject) return
    s.currentProject.tracks[trackIdx].clips[clipIdx] = {
      ...s.currentProject.tracks[trackIdx].clips[clipIdx],
      pitch_shift_semitones: value,
    }
    s.isDirty = true
  })
}

// ---------------------------------------------------------------------------
// SetStretchRatioCommand
// ---------------------------------------------------------------------------

/**
 * Records a time-stretch ratio change on one audio clip.
 *
 * execute: sets `stretch_ratio` to `after`.
 * undo:    restores `stretch_ratio` to `before`.
 */
export class SetStretchRatioCommand implements Command {
  readonly label = 'Set stretch ratio'

  constructor(
    private readonly trackId: string,
    private readonly clipId: string,
    private readonly before: number | null,
    private readonly after: number | null,
  ) {}

  execute(): void {
    applyStretchRatioToStore(this.trackId, this.clipId, this.after)
  }

  undo(): void {
    applyStretchRatioToStore(this.trackId, this.clipId, this.before)
  }
}

// ---------------------------------------------------------------------------
// SetPitchShiftCommand
// ---------------------------------------------------------------------------

/**
 * Records a pitch-shift change on one audio clip.
 *
 * execute: sets `pitch_shift_semitones` to `after`.
 * undo:    restores `pitch_shift_semitones` to `before`.
 */
export class SetPitchShiftCommand implements Command {
  readonly label = 'Set pitch shift'

  constructor(
    private readonly trackId: string,
    private readonly clipId: string,
    private readonly before: number | null,
    private readonly after: number | null,
  ) {}

  execute(): void {
    applyPitchShiftToStore(this.trackId, this.clipId, this.after)
  }

  undo(): void {
    applyPitchShiftToStore(this.trackId, this.clipId, this.before)
  }
}

// ---------------------------------------------------------------------------
// BakeStretchCommand
// ---------------------------------------------------------------------------

/** Minimal sample reference stored by BakeStretchCommand for undo. */
export interface SampleReference {
  id: string
  original_filename: string
  archive_path: string
  sample_rate: number
  channels: number
  duration_secs: number
}

/** Converts a camelCase `SampleReferenceData` (IPC type) to snake_case for the store. */
function toSampleReference(ref: SampleReferenceData): SampleReference {
  return {
    id: ref.id,
    original_filename: ref.originalFilename,
    archive_path: ref.archivePath,
    sample_rate: ref.sampleRate,
    channels: ref.channels,
    duration_secs: ref.durationSecs,
  }
}

/** Converts a `ClipEditData` (IPC / waveform-editor type) to a project `ClipData`-compatible object. */
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
    stretch_ratio: null as number | null,
    pitch_shift_semitones: null as number | null,
  }
}

/**
 * Replaces an audio clip with a baked (rendered) version.
 *
 * execute: swaps the original clip for the baked clip, adds the baked
 *          sample reference to the project sample table.
 * undo:    swaps back to the original clip, removes the baked sample reference.
 */
export class BakeStretchCommand implements Command {
  readonly label = 'Bake stretch'

  private readonly newSampleRef: SampleReference

  constructor(
    private readonly trackId: string,
    private readonly originalClipId: string,
    private readonly originalClip: ClipEditData,
    private readonly newClip: ClipEditData,
    newSampleRef: SampleReferenceData,
    private readonly _bakedFilePath: string,
  ) {
    this.newSampleRef = toSampleReference(newSampleRef)
  }

  execute(): void {
    const project = useFileStore.getState().currentProject
    if (!project) return

    const trackIdx = project.tracks.findIndex((t) => t.id === this.trackId)
    if (trackIdx === -1) return

    // Replace original clip with baked clip
    const filteredClips = project.tracks[trackIdx].clips.filter(
      (c) => c.id !== this.originalClipId,
    )
    const updatedClips = [...filteredClips, toClipData(this.newClip)]

    // Add new sample reference
    const updatedSamples = [...project.samples, this.newSampleRef]

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

  undo(): void {
    const project = useFileStore.getState().currentProject
    if (!project) return

    const trackIdx = project.tracks.findIndex((t) => t.id === this.trackId)
    if (trackIdx === -1) return

    // Remove baked clip, restore original
    const filteredClips = project.tracks[trackIdx].clips.filter(
      (c) => c.id !== this.newClip.id,
    )
    const updatedClips = [...filteredClips, toClipData(this.originalClip)]

    // Remove the baked sample reference
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
