/**
 * Tests for usePianoRollState hook logic.
 *
 * Strategy: test via the real usePianoRollStore (Zustand in-memory, no Tauri)
 * and a real useHistoryStore. We reset both stores between tests and exercise
 * the Command pattern directly — AddNoteCommand.execute() mutates the store,
 * undo() reverses it, etc.
 *
 * We do NOT call renderHook for this file because usePianoRollState is just a
 * thin adapter between the store and history; the interesting logic lives in
 * the Command classes and the stores themselves.  Testing the store + commands
 * directly gives us deterministic, fast, React-free tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePianoRollStore } from '../../../stores/pianoRollStore';
import { useHistoryStore } from '../../../stores/historyStore';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  ResizeNoteCommand,
  PasteNotesCommand,
} from '../../../lib/commands/PianoRollCommands';
import type { MidiNote } from '../pianoRollTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: crypto.randomUUID(),
    pitch: 60,
    startBeats: 0,
    durationBeats: 1,
    velocity: 100,
    channel: 0,
    ...overrides,
  };
}

function pianoRollState() {
  return usePianoRollStore.getState();
}

function historyState() {
  return useHistoryStore.getState();
}

/** Reset both stores to a clean slate before each test. */
beforeEach(() => {
  usePianoRollStore.setState({
    notes: [],
    selectedNoteIds: [],
    clipboardNotes: [],
    isOpen: false,
    activeTrackId: null,
  });
  useHistoryStore.getState().clear();
});

// ---------------------------------------------------------------------------
// AddNoteCommand
// ---------------------------------------------------------------------------

describe('AddNoteCommand', () => {
  it('execute() appends the note to the store', () => {
    const note = makeNote({ pitch: 64 });
    const cmd = new AddNoteCommand(note);
    cmd.execute();
    expect(pianoRollState().notes).toHaveLength(1);
    expect(pianoRollState().notes[0].id).toBe(note.id);
  });

  it('undo() removes the note from the store', () => {
    const note = makeNote();
    const cmd = new AddNoteCommand(note);
    cmd.execute();
    cmd.undo();
    expect(pianoRollState().notes).toHaveLength(0);
  });

  it('label is "Add note <pitch>"', () => {
    const note = makeNote({ pitch: 72 });
    expect(new AddNoteCommand(note).label).toBe('Add note 72');
  });

  it('push() via historyStore executes the command and records canUndo=true', () => {
    const note = makeNote();
    historyState().push(new AddNoteCommand(note));
    expect(pianoRollState().notes).toHaveLength(1);
    expect(historyState().canUndo).toBe(true);
  });

  it('undo via historyStore removes the note', () => {
    const note = makeNote();
    historyState().push(new AddNoteCommand(note));
    historyState().undo();
    expect(pianoRollState().notes).toHaveLength(0);
    expect(historyState().canUndo).toBe(false);
  });

  it('redo after undo re-adds the note', () => {
    const note = makeNote();
    historyState().push(new AddNoteCommand(note));
    historyState().undo();
    historyState().redo();
    expect(pianoRollState().notes).toHaveLength(1);
    expect(historyState().canRedo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DeleteNotesCommand
// ---------------------------------------------------------------------------

describe('DeleteNotesCommand', () => {
  it('execute() removes the specified notes from the store', () => {
    const n1 = makeNote({ pitch: 60 });
    const n2 = makeNote({ pitch: 62 });
    usePianoRollStore.getState().addNote(n1);
    usePianoRollStore.getState().addNote(n2);

    const cmd = new DeleteNotesCommand([n1]);
    cmd.execute();

    const notes = pianoRollState().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(n2.id);
  });

  it('undo() restores deleted notes', () => {
    const note = makeNote();
    usePianoRollStore.getState().addNote(note);

    const cmd = new DeleteNotesCommand([note]);
    cmd.execute();
    expect(pianoRollState().notes).toHaveLength(0);

    cmd.undo();
    expect(pianoRollState().notes).toHaveLength(1);
    expect(pianoRollState().notes[0].id).toBe(note.id);
  });

  it('label is singular for one note', () => {
    const n = makeNote({ pitch: 55 });
    expect(new DeleteNotesCommand([n]).label).toBe('Delete note 55');
  });

  it('label is plural for multiple notes', () => {
    const notes = [makeNote(), makeNote()];
    expect(new DeleteNotesCommand(notes).label).toBe('Delete 2 notes');
  });

  it('push then undo restores via historyStore', () => {
    const note = makeNote();
    usePianoRollStore.getState().addNote(note);

    historyState().push(new DeleteNotesCommand([note]));
    expect(pianoRollState().notes).toHaveLength(0);

    historyState().undo();
    expect(pianoRollState().notes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MoveNotesCommand
// ---------------------------------------------------------------------------

describe('MoveNotesCommand', () => {
  it('execute() updates note positions to the "after" snapshot', () => {
    const note = makeNote({ startBeats: 0, pitch: 60 });
    usePianoRollStore.getState().addNote(note);

    const before = [{ id: note.id, startBeats: 0, pitch: 60 }];
    const after = [{ id: note.id, startBeats: 2, pitch: 64 }];
    const cmd = new MoveNotesCommand(before, after);
    cmd.execute();

    const moved = pianoRollState().notes[0];
    expect(moved.startBeats).toBe(2);
    expect(moved.pitch).toBe(64);
  });

  it('undo() restores the "before" positions', () => {
    const note = makeNote({ startBeats: 0, pitch: 60 });
    usePianoRollStore.getState().addNote(note);

    const before = [{ id: note.id, startBeats: 0, pitch: 60 }];
    const after = [{ id: note.id, startBeats: 4, pitch: 72 }];
    const cmd = new MoveNotesCommand(before, after);
    cmd.execute();
    cmd.undo();

    const restored = pianoRollState().notes[0];
    expect(restored.startBeats).toBe(0);
    expect(restored.pitch).toBe(60);
  });

  it('label is singular for one note', () => {
    const before = [{ id: 'a', startBeats: 0, pitch: 60 }];
    const after = [{ id: 'a', startBeats: 1, pitch: 60 }];
    expect(new MoveNotesCommand(before, after).label).toBe('Move note');
  });

  it('label is plural for multiple notes', () => {
    const before = [{ id: 'a', startBeats: 0, pitch: 60 }, { id: 'b', startBeats: 1, pitch: 62 }];
    const after = [{ id: 'a', startBeats: 1, pitch: 60 }, { id: 'b', startBeats: 2, pitch: 62 }];
    expect(new MoveNotesCommand(before, after).label).toBe('Move 2 notes');
  });

  it('push then undo via historyStore reverts to original positions', () => {
    const note = makeNote({ startBeats: 0, pitch: 60 });
    usePianoRollStore.getState().addNote(note);

    const before = [{ id: note.id, startBeats: 0, pitch: 60 }];
    const after = [{ id: note.id, startBeats: 3, pitch: 60 }];
    historyState().push(new MoveNotesCommand(before, after));
    expect(pianoRollState().notes[0].startBeats).toBe(3);

    historyState().undo();
    expect(pianoRollState().notes[0].startBeats).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ResizeNoteCommand
// ---------------------------------------------------------------------------

describe('ResizeNoteCommand', () => {
  it('execute() sets the note duration to afterDuration', () => {
    const note = makeNote({ durationBeats: 1 });
    usePianoRollStore.getState().addNote(note);

    const cmd = new ResizeNoteCommand(note.id, 1, 3);
    cmd.execute();

    expect(pianoRollState().notes[0].durationBeats).toBe(3);
  });

  it('undo() restores the original duration', () => {
    const note = makeNote({ durationBeats: 1 });
    usePianoRollStore.getState().addNote(note);

    const cmd = new ResizeNoteCommand(note.id, 1, 3);
    cmd.execute();
    cmd.undo();

    expect(pianoRollState().notes[0].durationBeats).toBe(1);
  });

  it('label is "Resize note"', () => {
    expect(new ResizeNoteCommand('id', 1, 2).label).toBe('Resize note');
  });

  it('store clamps minimum duration to 4/960 of a beat', () => {
    const note = makeNote({ durationBeats: 1 });
    usePianoRollStore.getState().addNote(note);

    // Attempt to set duration to 0 — should clamp to minimum
    const cmd = new ResizeNoteCommand(note.id, 1, 0);
    cmd.execute();

    expect(pianoRollState().notes[0].durationBeats).toBeGreaterThan(0);
  });

  it('push then undo via historyStore', () => {
    const note = makeNote({ durationBeats: 2 });
    usePianoRollStore.getState().addNote(note);

    historyState().push(new ResizeNoteCommand(note.id, 2, 4));
    expect(pianoRollState().notes[0].durationBeats).toBe(4);

    historyState().undo();
    expect(pianoRollState().notes[0].durationBeats).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PasteNotesCommand — copySelection + pasteAtBeat flow
// ---------------------------------------------------------------------------

describe('PasteNotesCommand', () => {
  it('execute() creates new notes at the target beat with new IDs', () => {
    const note = makeNote({ id: 'orig', startBeats: 2, pitch: 60 });
    // Put original note into clipboard directly
    usePianoRollStore.setState({ clipboardNotes: [note] });

    const cmd = new PasteNotesCommand(4);
    cmd.execute();

    const notes = pianoRollState().notes;
    expect(notes).toHaveLength(1);
    // New note should start at beat 4 (beat offset = startBeats-minBeat+target = 2-2+4 = 4)
    expect(notes[0].startBeats).toBe(4);
    // ID must be a fresh UUID, not the original
    expect(notes[0].id).not.toBe('orig');
  });

  it('execute() selects the newly pasted notes', () => {
    const note = makeNote({ startBeats: 0, pitch: 62 });
    usePianoRollStore.setState({ clipboardNotes: [note] });

    const cmd = new PasteNotesCommand(2);
    cmd.execute();

    const state = pianoRollState();
    expect(state.selectedNoteIds).toHaveLength(1);
    expect(state.selectedNoteIds[0]).toBe(state.notes[0].id);
  });

  it('undo() removes the pasted notes', () => {
    const note = makeNote({ startBeats: 0 });
    usePianoRollStore.setState({ clipboardNotes: [note] });

    const cmd = new PasteNotesCommand(0);
    cmd.execute();
    expect(pianoRollState().notes).toHaveLength(1);

    cmd.undo();
    expect(pianoRollState().notes).toHaveLength(0);
  });

  it('label is "Paste notes"', () => {
    expect(new PasteNotesCommand(0).label).toBe('Paste notes');
  });

  it('no-op when clipboard is empty', () => {
    usePianoRollStore.setState({ clipboardNotes: [] });
    const cmd = new PasteNotesCommand(0);
    cmd.execute();
    expect(pianoRollState().notes).toHaveLength(0);
  });

  it('preserves relative offsets between pasted notes', () => {
    const n1 = makeNote({ id: 'a', startBeats: 1, pitch: 60 });
    const n2 = makeNote({ id: 'b', startBeats: 3, pitch: 64 });
    usePianoRollStore.setState({ clipboardNotes: [n1, n2] });

    const cmd = new PasteNotesCommand(0);
    cmd.execute();

    const pasted = pianoRollState().notes;
    expect(pasted).toHaveLength(2);
    // minBeat=1; n1→0, n2→2; relative gap of 2 beats preserved
    const beats = pasted.map((n) => n.startBeats).sort((a, b) => a - b);
    expect(beats[1] - beats[0]).toBeCloseTo(2);
  });

  it('push then undo via historyStore removes pasted notes', () => {
    const note = makeNote({ startBeats: 0 });
    usePianoRollStore.setState({ clipboardNotes: [note] });

    historyState().push(new PasteNotesCommand(0));
    expect(pianoRollState().notes).toHaveLength(1);

    historyState().undo();
    expect(pianoRollState().notes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Store direct actions (no history needed)
// ---------------------------------------------------------------------------

describe('usePianoRollStore direct actions', () => {
  it('copySelection captures only selected notes into clipboard', () => {
    const n1 = makeNote({ id: 'sel' });
    const n2 = makeNote({ id: 'unsel' });
    usePianoRollStore.setState({ notes: [n1, n2], selectedNoteIds: ['sel'] });

    pianoRollState().copySelection();

    expect(pianoRollState().clipboardNotes).toHaveLength(1);
    expect(pianoRollState().clipboardNotes[0].id).toBe('sel');
  });

  it('clearSelection empties selectedNoteIds', () => {
    usePianoRollStore.setState({ selectedNoteIds: ['a', 'b'] });
    pianoRollState().clearSelection();
    expect(pianoRollState().selectedNoteIds).toHaveLength(0);
  });

  it('setVelocity clamps to 1–127', () => {
    const note = makeNote({ velocity: 100 });
    usePianoRollStore.getState().addNote(note);

    pianoRollState().setVelocity(note.id, 200);
    expect(pianoRollState().notes[0].velocity).toBe(127);

    pianoRollState().setVelocity(note.id, 0);
    expect(pianoRollState().notes[0].velocity).toBe(1);
  });

  it('moveNotes clamps pitch to 0–127', () => {
    const note = makeNote({ pitch: 60 });
    usePianoRollStore.getState().addNote(note);

    pianoRollState().moveNotes([{ id: note.id, startBeats: 0, pitch: 200 }]);
    expect(pianoRollState().notes[0].pitch).toBe(127);

    pianoRollState().moveNotes([{ id: note.id, startBeats: 0, pitch: -5 }]);
    expect(pianoRollState().notes[0].pitch).toBe(0);
  });

  it('openForTrack sets isOpen=true and clears notes', () => {
    usePianoRollStore.setState({ notes: [makeNote()], isOpen: false });
    pianoRollState().openForTrack('track-123');
    expect(pianoRollState().isOpen).toBe(true);
    expect(pianoRollState().activeTrackId).toBe('track-123');
    expect(pianoRollState().notes).toHaveLength(0);
  });

  it('close sets isOpen=false', () => {
    usePianoRollStore.setState({ isOpen: true, activeTrackId: 'track-abc' });
    pianoRollState().close();
    expect(pianoRollState().isOpen).toBe(false);
    expect(pianoRollState().activeTrackId).toBeNull();
  });
});
