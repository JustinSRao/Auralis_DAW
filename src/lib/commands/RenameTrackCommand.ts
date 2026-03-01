import type { Command } from '@/lib/history';

/**
 * Records a track rename as a single undoable step.
 *
 * The command captures the track ID and both name values at construction time.
 * The actual state mutation is delegated to the caller-supplied rename function
 * so that this class remains store-agnostic.
 */
export class RenameTrackCommand implements Command {
  /** Human-readable label shown in the History panel. */
  readonly label: string;

  /**
   * @param rename    - Function that applies a new name to the given track (wraps `trackStore.renameTrack`).
   * @param trackId   - Stable UUID of the track being renamed.
   * @param prevName  - The track name before this change.
   * @param nextName  - The track name after this change.
   */
  constructor(
    private readonly rename: (id: string, name: string) => Promise<void>,
    private readonly trackId: string,
    private readonly prevName: string,
    private readonly nextName: string,
  ) {
    this.label = `Rename track: "${prevName}" → "${nextName}"`;
  }

  /** Apply the new track name. */
  execute(): void {
    void this.rename(this.trackId, this.nextName);
  }

  /** Restore the previous track name. */
  undo(): void {
    void this.rename(this.trackId, this.prevName);
  }
}
