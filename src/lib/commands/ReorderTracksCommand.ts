import type { Command } from '@/lib/history';

/**
 * Records a track reorder operation as a single undoable step.
 *
 * Both the previous and next track ID orderings are captured at construction
 * time. Undo/redo call the same reorder action with the appropriate order,
 * letting `trackStore.reorderTracks` handle optimistic update and IPC.
 */
export class ReorderTracksCommand implements Command {
  /** Human-readable label shown in the History panel. */
  readonly label = 'Reorder tracks';

  /**
   * @param reorder    - Async function that reorders tracks to match the given UUID array (wraps `trackStore.reorderTracks`).
   * @param prevOrder  - The track UUID order before the drag-and-drop.
   * @param nextOrder  - The track UUID order after the drag-and-drop.
   */
  constructor(
    private readonly reorder: (ids: string[]) => Promise<void>,
    private readonly prevOrder: string[],
    private readonly nextOrder: string[],
  ) {}

  /** Apply the new track order. */
  execute(): void {
    void this.reorder(this.nextOrder);
  }

  /** Restore the previous track order. */
  undo(): void {
    void this.reorder(this.prevOrder);
  }
}
