/**
 * Unit tests for StretchPitchCommands (Sprint 16).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock fileStore
// ---------------------------------------------------------------------------

function makeProject(clipId: string) {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Audio Track',
        clips: [
          {
            id: clipId,
            name: 'kick',
            start_beats: 0.0,
            duration_beats: 4.0,
            content: {
              type: 'Audio' as const,
              sample_id: 'sample-1',
              start_offset_samples: 0,
              gain: 1.0,
            },
            stretch_ratio: null as number | null,
            pitch_shift_semitones: null as number | null,
          },
        ],
      },
    ],
    samples: [] as Array<{
      id: string
      original_filename: string
      archive_path: string
      sample_rate: number
      channels: number
      duration_secs: number
    }>,
  }
}

let projectState = makeProject('clip-orig')

const mockFileStoreState = {
  get currentProject() {
    return projectState
  },
  isDirty: false,
}

vi.mock('../../stores/fileStore', () => ({
  useFileStore: Object.assign(
    vi.fn((sel?: (s: typeof mockFileStoreState) => unknown) =>
      sel ? sel(mockFileStoreState) : mockFileStoreState,
    ),
    {
      getState: vi.fn(() => mockFileStoreState),
      setState: vi.fn((fn: (s: typeof mockFileStoreState) => void) => {
        fn(mockFileStoreState)
      }),
    },
  ),
}))

// ---------------------------------------------------------------------------
// Mock ipc (for ipcInvalidateClipCache used transitively)
// ---------------------------------------------------------------------------

vi.mock('../ipc', () => ({
  ipcInvalidateClipCache: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  SetStretchRatioCommand,
  SetPitchShiftCommand,
  BakeStretchCommand,
} from './StretchPitchCommands'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClip(clipId: string) {
  return projectState.tracks[0].clips.find((c) => c.id === clipId)
}

// ---------------------------------------------------------------------------
// SetStretchRatioCommand
// ---------------------------------------------------------------------------

describe('SetStretchRatioCommand', () => {
  beforeEach(() => {
    projectState = makeProject('clip-orig')
  })

  it('execute sets stretch_ratio to after value', () => {
    const cmd = new SetStretchRatioCommand('track-1', 'clip-orig', null, 1.5)
    cmd.execute()
    expect(getClip('clip-orig')?.stretch_ratio).toBe(1.5)
  })

  it('undo restores stretch_ratio to before value', () => {
    const cmd = new SetStretchRatioCommand('track-1', 'clip-orig', null, 1.5)
    cmd.execute()
    expect(getClip('clip-orig')?.stretch_ratio).toBe(1.5)
    cmd.undo()
    expect(getClip('clip-orig')?.stretch_ratio).toBeNull()
  })

  it('round-trips through execute/undo with a non-null before value', () => {
    // Simulate a second stretch on top of an existing one
    projectState.tracks[0].clips[0].stretch_ratio = 1.25
    const cmd = new SetStretchRatioCommand('track-1', 'clip-orig', 1.25, 0.75)
    cmd.execute()
    expect(getClip('clip-orig')?.stretch_ratio).toBe(0.75)
    cmd.undo()
    expect(getClip('clip-orig')?.stretch_ratio).toBe(1.25)
  })

  it('has a descriptive label', () => {
    const cmd = new SetStretchRatioCommand('t', 'c', null, 1.0)
    expect(cmd.label).toBeTruthy()
    expect(typeof cmd.label).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// SetPitchShiftCommand
// ---------------------------------------------------------------------------

describe('SetPitchShiftCommand', () => {
  beforeEach(() => {
    projectState = makeProject('clip-orig')
  })

  it('execute sets pitch_shift_semitones to after value', () => {
    const cmd = new SetPitchShiftCommand('track-1', 'clip-orig', null, 7)
    cmd.execute()
    expect(getClip('clip-orig')?.pitch_shift_semitones).toBe(7)
  })

  it('undo restores pitch_shift_semitones to before value', () => {
    const cmd = new SetPitchShiftCommand('track-1', 'clip-orig', null, 7)
    cmd.execute()
    cmd.undo()
    expect(getClip('clip-orig')?.pitch_shift_semitones).toBeNull()
  })

  it('round-trips through execute/undo with negative semitones', () => {
    const cmd = new SetPitchShiftCommand('track-1', 'clip-orig', 3, -5)
    cmd.execute()
    expect(getClip('clip-orig')?.pitch_shift_semitones).toBe(-5)
    cmd.undo()
    expect(getClip('clip-orig')?.pitch_shift_semitones).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// BakeStretchCommand
// ---------------------------------------------------------------------------

describe('BakeStretchCommand', () => {
  const originalClipEditData = {
    id: 'clip-orig',
    name: 'kick',
    startBeats: 0.0,
    durationBeats: 4.0,
    sampleId: 'sample-1',
    startOffsetSamples: 0,
    gain: 1.0,
  }

  const newClipEditData = {
    id: 'clip-baked',
    name: 'kick (baked)',
    startBeats: 0.0,
    durationBeats: 4.0,
    sampleId: 'sample-baked',
    startOffsetSamples: 0,
    gain: 1.0,
  }

  const newSampleRef = {
    id: 'sample-baked',
    originalFilename: 'kick_baked_xyz.wav',
    archivePath: 'samples/kick_baked_xyz.wav',
    sampleRate: 44100,
    channels: 2,
    durationSecs: 4.0,
  }

  beforeEach(() => {
    projectState = makeProject('clip-orig')
  })

  it('execute swaps the original clip for the baked clip', () => {
    const cmd = new BakeStretchCommand(
      'track-1',
      'clip-orig',
      originalClipEditData,
      newClipEditData,
      newSampleRef,
      '/tmp/kick_baked_xyz.wav',
    )
    cmd.execute()

    const clips = projectState.tracks[0].clips
    expect(clips.find((c) => c.id === 'clip-orig')).toBeUndefined()
    expect(clips.find((c) => c.id === 'clip-baked')).toBeTruthy()
  })

  it('execute adds the new sample reference to project.samples', () => {
    const cmd = new BakeStretchCommand(
      'track-1',
      'clip-orig',
      originalClipEditData,
      newClipEditData,
      newSampleRef,
      '/tmp/kick_baked_xyz.wav',
    )
    cmd.execute()

    const added = projectState.samples.find((s) => s.id === 'sample-baked')
    expect(added).toBeTruthy()
    expect(added?.original_filename).toBe('kick_baked_xyz.wav')
  })

  it('undo swaps back to the original clip and removes the sample reference', () => {
    const cmd = new BakeStretchCommand(
      'track-1',
      'clip-orig',
      originalClipEditData,
      newClipEditData,
      newSampleRef,
      '/tmp/kick_baked_xyz.wav',
    )
    cmd.execute()
    cmd.undo()

    const clips = projectState.tracks[0].clips
    expect(clips.find((c) => c.id === 'clip-baked')).toBeUndefined()
    expect(clips.find((c) => c.id === 'clip-orig')).toBeTruthy()
    expect(projectState.samples.find((s) => s.id === 'sample-baked')).toBeUndefined()
  })

  it('has a descriptive label', () => {
    const cmd = new BakeStretchCommand(
      't', 'oc', originalClipEditData, newClipEditData, newSampleRef, '/tmp/x.wav',
    )
    expect(cmd.label).toBe('Bake stretch')
  })
})
