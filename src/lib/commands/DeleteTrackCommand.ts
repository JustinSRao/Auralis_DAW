import type { Command } from '@/lib/history';
import type { DawTrack } from '@/lib/ipc';

/**
 * Records a track deletion as a single undoable step.
 *
 * The full track object and its original index are captured at construction
 * time so that the track can be restored exactly if the user undoes. Undo
 * re-inserts the track into the local list without a backend call (stateless
 * backend model in Sprint 30).
 */
export class DeleteTrackCommand implements Command {
  /** Human-readable label shown in the History panel. */
  readonly label: string;

  /**
   * @param addTrack    - Inserts a track into the store at a given index (wraps `trackStore.insertTrack`).
   * @param removeTrack - Removes a track from the store by UUID (wraps `trackStore.removeTrackLocal`).
   * @param track       - The track being deleted (full object snapshot for undo restoration).
   * @param index       - Original position of the track, used to restore it in the correct slot.
   */
  constructor(
    private readonly addTrack: (track: DawTrack, index: number) => void,
    private readonly removeTrack: (id: string) => void,
    private readonly track: DawTrack,
    private readonly index: number,
  ) {
    this.label = `Delete track: "${track.name}"`;
  }

  /** Remove the track from the local list. */
  execute(): void {
    this.removeTrack(this.track.id);
  }

  /** Restore the track at its original position. */
  undo(): void {
    this.addTrack(this.track, this.index);
  }
}
