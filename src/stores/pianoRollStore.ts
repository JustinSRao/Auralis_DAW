/**
 * Zustand store for the Piano Roll editor.
 *
 * Notes are ephemeral (not persisted) until Sprint 12 wires them into the
 * project clip data. All mutations are immutable via the immer middleware.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  EditMode,
  MidiNote,
  NoteId,
  QuantDiv,
  Viewport,
} from '../components/PianoRoll/pianoRollTypes';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface PianoRollState {
  notes: MidiNote[];
  selectedNoteIds: NoteId[];
  viewport: Viewport;
  mode: EditMode;
  quantDiv: QuantDiv;
  clipboardNotes: MidiNote[];
  isOpen: boolean;
  activeTrackId: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface PianoRollActions {
  /** Open the editor and load the clip notes for the given track. */
  openForTrack(trackId: string): void;
  /** Close the editor. */
  close(): void;
  /** Switch between draw and select modes. */
  setMode(mode: EditMode): void;
  /** Change the quantization grid division. */
  setQuantDiv(div: QuantDiv): void;
  /** Merge partial viewport changes (scroll, zoom). */
  setViewport(partial: Partial<Viewport>): void;
  /** Replace the entire note array (e.g. after loading a clip). */
  setNotes(notes: MidiNote[]): void;
  /** Append a single note. */
  addNote(note: MidiNote): void;
  /** Remove notes by id. Also clears them from selectedNoteIds. */
  removeNotes(ids: NoteId[]): void;
  /** Batch-move notes to new positions. */
  moveNotes(moves: Array<{ id: NoteId; startBeats: number; pitch: number }>): void;
  /** Resize a single note's duration (clamped to minimum 1/960 beat). */
  resizeNote(id: NoteId, durationBeats: number): void;
  /** Set velocity on a single note (clamped 1–127). */
  setVelocity(id: NoteId, velocity: number): void;
  /** Replace the entire selection set. */
  selectNotes(ids: NoteId[]): void;
  /** Clear all selection. */
  clearSelection(): void;
  /** Copy selected notes to the internal clipboard. */
  copySelection(): void;
  /**
   * Paste clipboard notes starting at the given beat.
   * Each pasted note gets a new UUID. The selection is updated to the pasted notes.
   */
  pasteAtBeat(beat: number): void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_VIEWPORT: Viewport = {
  scrollX: 0,
  scrollY: 600, // approximately centres around C3/C4 area
  pixelsPerBeat: 80,
  pixelsPerSemitone: 12,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePianoRollStore = create<PianoRollState & PianoRollActions>()(
  immer((set, _get) => ({
    notes: [],
    selectedNoteIds: [],
    viewport: DEFAULT_VIEWPORT,
    mode: 'draw',
    quantDiv: 16,
    clipboardNotes: [],
    isOpen: false,
    activeTrackId: null,

    openForTrack: (trackId) =>
      set((s) => {
        s.isOpen = true;
        s.activeTrackId = trackId;
        s.notes = [];
        s.selectedNoteIds = [];
      }),

    close: () =>
      set((s) => {
        s.isOpen = false;
        s.activeTrackId = null;
      }),

    setMode: (mode) => set((s) => { s.mode = mode; }),

    setQuantDiv: (div) => set((s) => { s.quantDiv = div; }),

    setViewport: (partial) =>
      set((s) => {
        Object.assign(s.viewport, partial);
      }),

    setNotes: (notes) => set((s) => { s.notes = notes; }),

    addNote: (note) => set((s) => { s.notes.push(note); }),

    removeNotes: (ids) =>
      set((s) => {
        s.notes = s.notes.filter((n) => !ids.includes(n.id));
        s.selectedNoteIds = s.selectedNoteIds.filter((id) => !ids.includes(id));
      }),

    moveNotes: (moves) =>
      set((s) => {
        for (const mv of moves) {
          const note = s.notes.find((n) => n.id === mv.id);
          if (note) {
            note.startBeats = mv.startBeats;
            note.pitch = Math.min(127, Math.max(0, mv.pitch));
          }
        }
      }),

    resizeNote: (id, durationBeats) =>
      set((s) => {
        const note = s.notes.find((n) => n.id === id);
        if (note) {
          // Minimum duration: 1/960 of a beat
          note.durationBeats = Math.max(4 / 960, durationBeats);
        }
      }),

    setVelocity: (id, velocity) =>
      set((s) => {
        const note = s.notes.find((n) => n.id === id);
        if (note) {
          note.velocity = Math.max(1, Math.min(127, velocity));
        }
      }),

    selectNotes: (ids) => set((s) => { s.selectedNoteIds = ids; }),

    clearSelection: () => set((s) => { s.selectedNoteIds = []; }),

    copySelection: () =>
      set((s) => {
        s.clipboardNotes = s.notes.filter((n) =>
          s.selectedNoteIds.includes(n.id),
        );
      }),

    pasteAtBeat: (beat) =>
      set((s) => {
        if (s.clipboardNotes.length === 0) return;
        const minBeat = Math.min(...s.clipboardNotes.map((n) => n.startBeats));
        const pasted = s.clipboardNotes.map((n) => ({
          ...n,
          id: crypto.randomUUID(),
          startBeats: n.startBeats - minBeat + beat,
        }));
        s.notes.push(...pasted);
        s.selectedNoteIds = pasted.map((n) => n.id);
      }),

    // Expose read-only access for commands that need to snapshot before mutating.
    // Callers use `usePianoRollStore.getState()` directly; these are store actions.
  })),
);

// ---------------------------------------------------------------------------
// Typed selector helpers (used in usePianoRollState.ts)
// ---------------------------------------------------------------------------

/** Return a stable reference to the viewport — used in canvas draw loops. */
export function selectViewport(s: PianoRollState & PianoRollActions): Viewport {
  return s.viewport;
}
