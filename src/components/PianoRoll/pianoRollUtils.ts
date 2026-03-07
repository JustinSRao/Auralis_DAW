/**
 * Pure utility functions for the Piano Roll editor.
 *
 * No React imports — safe to use in workers or tests without a DOM.
 */

import type { MidiNote, QuantDiv, Viewport } from './pianoRollTypes';

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

/** Convert a beat position to a canvas X pixel coordinate. */
export function beatToX(beat: number, vp: Viewport): number {
  return beat * vp.pixelsPerBeat - vp.scrollX;
}

/** Convert a canvas X pixel coordinate to a beat position (clamped to ≥ 0). */
export function xToBeat(x: number, vp: Viewport): number {
  return Math.max(0, (x + vp.scrollX) / vp.pixelsPerBeat);
}

/** Convert a MIDI pitch to a canvas Y pixel coordinate (high pitch = low Y). */
export function pitchToY(pitch: number, vp: Viewport): number {
  return (127 - pitch) * vp.pixelsPerSemitone - vp.scrollY;
}

/**
 * Convert a canvas Y pixel coordinate to a MIDI pitch (0–127).
 * Result is clamped to the valid MIDI range.
 */
export function yToPitch(y: number, vp: Viewport): number {
  return Math.min(127, Math.max(0, Math.round(127 - (y + vp.scrollY) / vp.pixelsPerSemitone)));
}

// ---------------------------------------------------------------------------
// Grid snapping
// ---------------------------------------------------------------------------

/**
 * Snap a beat position to the nearest quantization grid division.
 *
 * @param beat     - Raw beat value to snap.
 * @param quantDiv - Grid division: 4=1/4, 8=1/8, 16=1/16, 32=1/32.
 */
export function snapBeat(beat: number, quantDiv: QuantDiv): number {
  const gridSize = 4 / quantDiv; // beats per grid cell
  return Math.round(beat / gridSize) * gridSize;
}

// ---------------------------------------------------------------------------
// Visibility culling
// ---------------------------------------------------------------------------

/**
 * Return only the notes that overlap the visible canvas area.
 *
 * Adds a one-row padding on pitch to avoid clipping artefacts at edges.
 */
export function getVisibleNotes(
  notes: MidiNote[],
  vp: Viewport,
  canvasW: number,
  canvasH: number,
): MidiNote[] {
  const minBeat = xToBeat(0, vp);
  const maxBeat = xToBeat(canvasW, vp);
  const minPitch = yToPitch(canvasH, vp) - 1;
  const maxPitch = yToPitch(0, vp) + 1;

  return notes.filter(
    (n) =>
      n.startBeats + n.durationBeats >= minBeat &&
      n.startBeats <= maxBeat &&
      n.pitch >= minPitch &&
      n.pitch <= maxPitch,
  );
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Determine whether a canvas pointer position lands on a note and, if so,
 * which interaction zone was hit.
 *
 * Returns `'resize'` when the pointer is in the right-hand resize strip,
 * `'move'` when it is over the body of the note, or `null` when it misses.
 */
export function noteHitTest(
  note: MidiNote,
  canvasX: number,
  canvasY: number,
  vp: Viewport,
): 'resize' | 'move' | null {
  const noteX = beatToX(note.startBeats, vp);
  const noteW = note.durationBeats * vp.pixelsPerBeat;
  const noteY = pitchToY(note.pitch, vp);
  const noteH = vp.pixelsPerSemitone;

  if (
    canvasX >= noteX &&
    canvasX <= noteX + noteW &&
    canvasY >= noteY &&
    canvasY <= noteY + noteH
  ) {
    // Resize zone: right 20% of the note width, minimum 4 px.
    const resizeZone = Math.max(4, noteW * 0.2);
    if (canvasX >= noteX + noteW - resizeZone) return 'resize';
    return 'move';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Note name helpers
// ---------------------------------------------------------------------------

/** Chromatic note names (C=0, C#=1, …, B=11). */
export const NOTE_NAMES: ReadonlyArray<string> = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

/** Whether a pitch is a black key (C#, D#, F#, G#, A#). */
export function isBlackKey(pitch: number): boolean {
  const mod = pitch % 12;
  return mod === 1 || mod === 3 || mod === 6 || mod === 8 || mod === 10;
}

/** Human-readable note name including octave, e.g. "C4" for pitch 60. */
export function pitchToName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pitch % 12]}${octave}`;
}
