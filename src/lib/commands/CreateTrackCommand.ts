import type { Command } from '@/lib/history';
import type { DawTrack } from '@/lib/ipc';

/**
 * Records a track creation as a single undoable step.
 *
 * The track object is captured at construction time (after the IPC call has
 * already returned and the track has a server-assigned UUID). `execute()`
 * appends the track to the store; `undo()` removes it by UUID.
 *
 * Note: because the track was already created on the backend during the
 * original action, undo/redo only manipulate local store state. This is
 * intentional — the backend is stateless for track management in Sprint 30.
 */
export class CreateTrackCommand implements Command {
  /** Human-readable label shown in the History panel. */
  readonly label: string;

  /**
   * @param addTrack    - Appends the track to the store (wraps `trackStore.insertTrack` or a direct push).
   * @param removeTrack - Removes the track from the store by UUID (wraps `trackStore.removeTrackLocal`).
   * @param track       - The created track object (must have a valid server-assigned UUID).
   */
  constructor(
    private readonly addTrack: (track: DawTrack) => void,
    private readonly removeTrack: (id: string) => void,
    private readonly track: DawTrack,
  ) {
    this.label = `Create track: "${track.name}"`;
  }

  /** Append the track to the store. */
  execute(): void {
    this.addTrack(this.track);
  }

  /** Remove the track from the local list. */
  undo(): void {
    this.removeTrack(this.track.id);
  }
}
