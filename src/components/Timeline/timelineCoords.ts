/**
 * Pure coordinate utility functions for the song Timeline canvas.
 *
 * All functions are stateless and dependency-free — they can be unit-tested
 * without a DOM or React environment.
 */

import type { ArrangementClip, TimelineViewport } from '../../stores/arrangementStore'

// ---------------------------------------------------------------------------
// Bar ↔ pixel conversions
// ---------------------------------------------------------------------------

/**
 * Converts a bar position to a canvas X coordinate.
 *
 * @param bar - 0-indexed bar position (float).
 * @param vp  - Current timeline viewport.
 * @returns Canvas X in pixels (can be negative when scrolled past the position).
 */
export function barToX(bar: number, vp: TimelineViewport): number {
  return bar * vp.pixelsPerBar - vp.scrollLeft
}

/**
 * Converts a canvas X coordinate back to a raw (unsnapped) bar position.
 *
 * @param x  - Canvas X in pixels.
 * @param vp - Current timeline viewport.
 * @returns Bar position >= 0 (clamped at 0).
 */
export function xToBar(x: number, vp: TimelineViewport): number {
  return Math.max(0, (x + vp.scrollLeft) / vp.pixelsPerBar)
}

/**
 * Snaps a bar position to the nearest whole bar boundary.
 *
 * @param bar - Raw bar position (float).
 * @returns Integer bar position (floor).
 */
export function snapToBar(bar: number): number {
  return Math.floor(bar)
}

// ---------------------------------------------------------------------------
// Track index ↔ pixel conversions
// ---------------------------------------------------------------------------

/**
 * Converts a track index to the canvas Y coordinate of the top of that row.
 *
 * @param index - 0-indexed track index.
 * @param vp    - Current timeline viewport.
 */
export function trackIndexToY(index: number, vp: TimelineViewport): number {
  return index * vp.trackHeight
}

/**
 * Converts a canvas Y coordinate to a track index.
 *
 * @param y  - Canvas Y in pixels.
 * @param vp - Current timeline viewport.
 * @returns Track index >= 0 (clamped at 0).
 */
export function yToTrackIndex(y: number, vp: TimelineViewport): number {
  return Math.max(0, Math.floor(y / vp.trackHeight))
}

// ---------------------------------------------------------------------------
// Sample ↔ bar conversions
// ---------------------------------------------------------------------------

/**
 * Converts a bar position to a sample offset.
 *
 * @param bar              - 0-indexed bar position.
 * @param bpm              - Beats per minute.
 * @param timeSigNumerator - Number of beats per bar.
 * @param sampleRate       - Audio sample rate in Hz.
 */
export function barToSamples(
  bar: number,
  bpm: number,
  timeSigNumerator: number,
  sampleRate: number,
): number {
  const beatsPerBar = timeSigNumerator
  const secondsPerBeat = 60 / bpm
  const secondsPerBar = secondsPerBeat * beatsPerBar
  return bar * secondsPerBar * sampleRate
}

/**
 * Converts a sample offset to a bar position.
 *
 * @param samples          - Sample offset from project start.
 * @param bpm              - Beats per minute.
 * @param timeSigNumerator - Number of beats per bar.
 * @param sampleRate       - Audio sample rate in Hz.
 */
export function samplesToBar(
  samples: number,
  bpm: number,
  timeSigNumerator: number,
  sampleRate: number,
): number {
  const beatsPerBar = timeSigNumerator
  const secondsPerBeat = 60 / bpm
  const secondsPerBar = secondsPerBeat * beatsPerBar
  return samples / (secondsPerBar * sampleRate)
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

const RESIZE_HANDLE_PX = 8

/**
 * Determines whether a canvas (x, y) point hits a clip, and which part.
 *
 * @param clip       - The arrangement clip to test.
 * @param trackIndex - The track index this clip lives on (from trackStore lookup).
 * @param x          - Canvas X coordinate.
 * @param y          - Canvas Y coordinate.
 * @param vp         - Current timeline viewport.
 * @returns `'resize'` if within the right-edge resize handle, `'move'` if within the clip body, `null` otherwise.
 */
export function clipHitTest(
  clip: ArrangementClip,
  trackIndex: number,
  x: number,
  y: number,
  vp: TimelineViewport,
): 'resize' | 'move' | null {
  const clipX = barToX(clip.startBar, vp)
  const clipW = clip.lengthBars * vp.pixelsPerBar
  const clipY = trackIndexToY(trackIndex, vp)
  const clipH = vp.trackHeight

  // Vertical bounds check
  if (y < clipY || y >= clipY + clipH) return null

  // Horizontal bounds check
  if (x < clipX || x >= clipX + clipW) return null

  // Right-edge resize handle
  if (x >= clipX + clipW - RESIZE_HANDLE_PX) return 'resize'

  return 'move'
}
