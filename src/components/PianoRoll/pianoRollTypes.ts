/**
 * Core domain types for the Piano Roll editor.
 *
 * All types are pure data — no React or store dependencies.
 */

/** Stable string identifier for a MIDI note within the editor. */
export type NoteId = string;

/** A single MIDI note placed on the piano roll grid. */
export interface MidiNote {
  id: NoteId;
  /** MIDI pitch 0–127. Middle C = 60. */
  pitch: number;
  /** Beat position from clip start. 0 = bar 1 beat 1. */
  startBeats: number;
  /** Duration in beats. Minimum: 1/960 of a beat. */
  durationBeats: number;
  /** MIDI velocity 1–127. */
  velocity: number;
  /** MIDI channel 0–15. */
  channel: number;
}

/** Editing mode that determines how pointer events are interpreted. */
export type EditMode = 'draw' | 'select';

/**
 * Quantization grid division.
 * 4 = 1/4 note, 8 = 1/8 note, 16 = 1/16 note, 32 = 1/32 note.
 */
export type QuantDiv = 4 | 8 | 16 | 32;

/** Current scroll position and zoom levels for the note canvas. */
export interface Viewport {
  /** Horizontal scroll offset in pixels. */
  scrollX: number;
  /** Vertical scroll offset in pixels. */
  scrollY: number;
  /** Pixels per beat. Default 80, range 20–400. */
  pixelsPerBeat: number;
  /** Pixels per semitone row. Default 12, range 4–32. */
  pixelsPerSemitone: number;
}

/**
 * Discriminated union describing the current mouse drag operation.
 *
 * Stored in a `useRef` during drag (not state) to avoid re-renders on every
 * pointer-move event.
 */
export type MouseInteractionState =
  | { kind: 'idle' }
  | {
      kind: 'drawing';
      noteId: NoteId;
      startX: number;
      startBeat: number;
      pitch: number;
    }
  | {
      kind: 'resizing';
      noteId: NoteId;
      originalDuration: number;
      startX: number;
    }
  | {
      kind: 'moving';
      noteIds: NoteId[];
      startX: number;
      startY: number;
      originalPositions: Map<NoteId, { startBeats: number; pitch: number }>;
    }
  | {
      kind: 'selecting';
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    };
