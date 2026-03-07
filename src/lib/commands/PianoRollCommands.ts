/**
 * Undoable command implementations for Piano Roll editor operations.
 *
 * Each class implements the {@link Command} interface from `src/lib/history.ts`.
 * Commands operate on the `usePianoRollStore` via `.getState()` so they work
 * outside of the React component tree (history manager calls execute/undo
 * synchronously).
 */

import type { Command } from '../history';
import type { MidiNote, NoteId } from '../../components/PianoRoll/pianoRollTypes';
import { usePianoRollStore } from '../../stores/pianoRollStore';

// ---------------------------------------------------------------------------
// AddNoteCommand
// ---------------------------------------------------------------------------

/** Records the addition of a single note to the grid. */
export class AddNoteCommand implements Command {
  readonly label: string;

  constructor(private readonly note: MidiNote) {
    this.label = `Add note ${note.pitch}`;
  }

  execute(): void {
    usePianoRollStore.getState().addNote(this.note);
  }

  undo(): void {
    usePianoRollStore.getState().removeNotes([this.note.id]);
  }
}

// ---------------------------------------------------------------------------
// DeleteNotesCommand
// ---------------------------------------------------------------------------

/** Records the deletion of one or more notes. */
export class DeleteNotesCommand implements Command {
  readonly label: string;

  constructor(private readonly notes: MidiNote[]) {
    this.label =
      notes.length === 1 ? `Delete note ${notes[0].pitch}` : `Delete ${notes.length} notes`;
  }

  execute(): void {
    usePianoRollStore.getState().removeNotes(this.notes.map((n) => n.id));
  }

  undo(): void {
    const store = usePianoRollStore.getState();
    for (const n of this.notes) store.addNote(n);
  }
}

// ---------------------------------------------------------------------------
// MoveNotesCommand
// ---------------------------------------------------------------------------

/** Records a batch move of one or more notes to new beat/pitch positions. */
export class MoveNotesCommand implements Command {
  readonly label: string;

  constructor(
    private readonly before: Array<{ id: NoteId; startBeats: number; pitch: number }>,
    private readonly after: Array<{ id: NoteId; startBeats: number; pitch: number }>,
  ) {
    this.label = before.length === 1 ? 'Move note' : `Move ${before.length} notes`;
  }

  execute(): void {
    usePianoRollStore.getState().moveNotes(this.after);
  }

  undo(): void {
    usePianoRollStore.getState().moveNotes(this.before);
  }
}

// ---------------------------------------------------------------------------
// ResizeNoteCommand
// ---------------------------------------------------------------------------

/** Records a resize (duration change) of a single note. */
export class ResizeNoteCommand implements Command {
  readonly label = 'Resize note';

  constructor(
    private readonly id: NoteId,
    private readonly beforeDuration: number,
    private readonly afterDuration: number,
  ) {}

  execute(): void {
    usePianoRollStore.getState().resizeNote(this.id, this.afterDuration);
  }

  undo(): void {
    usePianoRollStore.getState().resizeNote(this.id, this.beforeDuration);
  }
}

// ---------------------------------------------------------------------------
// SetVelocityCommand
// ---------------------------------------------------------------------------

/** Records a velocity change on a single note. */
export class SetVelocityCommand implements Command {
  readonly label = 'Set velocity';

  constructor(
    private readonly id: NoteId,
    private readonly before: number,
    private readonly after: number,
  ) {}

  execute(): void {
    usePianoRollStore.getState().setVelocity(this.id, this.after);
  }

  undo(): void {
    usePianoRollStore.getState().setVelocity(this.id, this.before);
  }
}

// ---------------------------------------------------------------------------
// PasteNotesCommand
// ---------------------------------------------------------------------------

/**
 * Records a paste operation.
 *
 * The pasted note IDs are captured in `execute()` by comparing the note list
 * before and after the paste so that `undo()` can remove exactly those notes.
 */
export class PasteNotesCommand implements Command {
  readonly label = 'Paste notes';
  private pastedIds: string[] = [];

  constructor(private readonly beat: number) {}

  execute(): void {
    const store = usePianoRollStore.getState();
    const before = new Set(store.notes.map((n) => n.id));
    store.pasteAtBeat(this.beat);
    const after = usePianoRollStore.getState().notes.map((n) => n.id);
    this.pastedIds = after.filter((id) => !before.has(id));
  }

  undo(): void {
    usePianoRollStore.getState().removeNotes(this.pastedIds);
  }
}
