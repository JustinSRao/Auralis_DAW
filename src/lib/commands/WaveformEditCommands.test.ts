/**
 * Unit tests for WaveformEditCommands (Sprint 15).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock fileStore
// ---------------------------------------------------------------------------

import type { ClipEditData, SampleReferenceData, TrimSnapshot } from '../ipc'

// Build a minimal project-file track with one audio clip
function makeProject(clipId: string, startBeats = 0.0, durationBeats = 4.0) {
  return {
    tracks: [
      {
        id: 'track-1',
        name: 'Audio Track',
        clips: [
          {
            id: clipId,
            name: 'kick',
            start_beats: startBeats,
            duration_beats: durationBeats,
            content: {
              type: 'Audio' as const,
              sample_id: 'sample-1',
              start_offset_samples: 0,
              gain: 1.0,
            },
          },
        ],
      },
    ],
    samples: [],
  }
}

let projectState = makeProject('clip-orig')

const mockFileStoreState = {
  get currentProject() {
    return projectState
  },
  isDirty: false,
}

vi.mock('../../stores/fileStore', () => {
  return {
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
  }
})

vi.mock('../ipc', () => ({
  ipcInvalidateClipCache: vi.fn().mockResolvedValue(undefined),
}))

import { CutClipCommand, TrimClipCommand, ReverseClipCommand } from './WaveformEditCommands'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClipEditData(overrides: Partial<ClipEditData> = {}): ClipEditData {
  return {
    id: 'clip-orig',
    name: 'kick',
    startBeats: 0.0,
    durationBeats: 4.0,
    sampleId: 'sample-1',
    startOffsetSamples: 0,
    gain: 1.0,
    ...overrides,
  }
}

function makeClipA(): ClipEditData {
  return {
    id: 'clip-a',
    name: 'kick A',
    startBeats: 0.0,
    durationBeats: 2.0,
    sampleId: 'sample-1',
    startOffsetSamples: 0,
    gain: 1.0,
  }
}

function makeClipB(): ClipEditData {
  return {
    id: 'clip-b',
    name: 'kick B',
    startBeats: 2.0,
    durationBeats: 2.0,
    sampleId: 'sample-1',
    startOffsetSamples: 88200,
    gain: 1.0,
  }
}

function makeSampleRef(): SampleReferenceData {
  return {
    id: 'sample-rev',
    originalFilename: 'kick_rev.wav',
    archivePath: 'samples/kick_rev.wav',
    sampleRate: 44100,
    channels: 2,
    durationSecs: 1.0,
  }
}

// ---------------------------------------------------------------------------
// CutClipCommand
// ---------------------------------------------------------------------------

describe('CutClipCommand', () => {
  beforeEach(() => {
    projectState = makeProject('clip-orig')
  })

  it('CutClipCommand_execute_removes_original_adds_two_clips', () => {
    const cmd = new CutClipCommand(
      'track-1',
      'clip-orig',
      makeClipEditData(),
      makeClipA(),
      makeClipB(),
    )

    cmd.execute()

    const clips = mockFileStoreState.currentProject!.tracks[0].clips
    const ids = clips.map((c) => c.id)
    expect(ids).not.toContain('clip-orig')
    expect(ids).toContain('clip-a')
    expect(ids).toContain('clip-b')
  })

  it('CutClipCommand_undo_restores_original', () => {
    const cmd = new CutClipCommand(
      'track-1',
      'clip-orig',
      makeClipEditData(),
      makeClipA(),
      makeClipB(),
    )

    cmd.execute()
    cmd.undo()

    const clips = mockFileStoreState.currentProject!.tracks[0].clips
    const ids = clips.map((c) => c.id)
    expect(ids).toContain('clip-orig')
    expect(ids).not.toContain('clip-a')
    expect(ids).not.toContain('clip-b')
  })
})

// ---------------------------------------------------------------------------
// TrimClipCommand
// ---------------------------------------------------------------------------

describe('TrimClipCommand', () => {
  beforeEach(() => {
    projectState = makeProject('clip-orig')
  })

  const before: TrimSnapshot = {
    startBeats: 0.0,
    durationBeats: 4.0,
    startOffsetSamples: 0,
  }
  const after: TrimSnapshot = {
    startBeats: 0.5,
    durationBeats: 3.5,
    startOffsetSamples: 22050,
  }

  it('TrimClipCommand_execute_applies_after_snapshot', () => {
    const cmd = new TrimClipCommand('track-1', 'clip-orig', before, after, 'start')
    cmd.execute()

    const clip = mockFileStoreState.currentProject!.tracks[0].clips.find(
      (c) => c.id === 'clip-orig',
    )!
    expect(clip.start_beats).toBeCloseTo(0.5)
    expect(clip.duration_beats).toBeCloseTo(3.5)
  })

  it('TrimClipCommand_undo_restores_before_snapshot', () => {
    const cmd = new TrimClipCommand('track-1', 'clip-orig', before, after, 'start')
    cmd.execute()
    cmd.undo()

    const clip = mockFileStoreState.currentProject!.tracks[0].clips.find(
      (c) => c.id === 'clip-orig',
    )!
    expect(clip.start_beats).toBeCloseTo(0.0)
    expect(clip.duration_beats).toBeCloseTo(4.0)
  })
})

// ---------------------------------------------------------------------------
// ReverseClipCommand
// ---------------------------------------------------------------------------

describe('ReverseClipCommand', () => {
  beforeEach(() => {
    projectState = makeProject('clip-orig')
    projectState.samples = []
  })

  it('ReverseClipCommand_execute_swaps_clips', () => {
    const newClip: ClipEditData = {
      id: 'clip-rev',
      name: 'kick (rev)',
      startBeats: 0.0,
      durationBeats: 4.0,
      sampleId: 'sample-rev',
      startOffsetSamples: 0,
      gain: 1.0,
    }

    const cmd = new ReverseClipCommand(
      'track-1',
      'clip-orig',
      makeClipEditData(),
      newClip,
      makeSampleRef(),
      '/tmp/kick_rev.wav',
    )

    cmd.execute()

    const clips = mockFileStoreState.currentProject!.tracks[0].clips
    const ids = clips.map((c) => c.id)
    expect(ids).not.toContain('clip-orig')
    expect(ids).toContain('clip-rev')

    const samples = mockFileStoreState.currentProject!.samples
    expect(samples.map((s) => s.id)).toContain('sample-rev')
  })

  it('ReverseClipCommand_undo_restores_original', () => {
    const newClip: ClipEditData = {
      id: 'clip-rev',
      name: 'kick (rev)',
      startBeats: 0.0,
      durationBeats: 4.0,
      sampleId: 'sample-rev',
      startOffsetSamples: 0,
      gain: 1.0,
    }

    const cmd = new ReverseClipCommand(
      'track-1',
      'clip-orig',
      makeClipEditData(),
      newClip,
      makeSampleRef(),
      '/tmp/kick_rev.wav',
    )

    cmd.execute()
    cmd.undo()

    const clips = mockFileStoreState.currentProject!.tracks[0].clips
    const ids = clips.map((c) => c.id)
    expect(ids).toContain('clip-orig')
    expect(ids).not.toContain('clip-rev')

    const samples = mockFileStoreState.currentProject!.samples
    expect(samples.map((s) => s.id)).not.toContain('sample-rev')
  })
})
