import type { Command } from '@/lib/history';

/**
 * Records a BPM change as a single undoable step.
 *
 * The command captures both the previous and next BPM values at construction
 * time and delegates the actual state mutation to the caller-supplied setter,
 * keeping this class decoupled from any specific store.
 */
export class SetBpmCommand implements Command {
  /** Human-readable label shown in the History panel. */
  readonly label: string;

  /**
   * @param setBpm    - Function that applies a BPM value to the store.
   * @param prevBpm   - The BPM value before this change.
   * @param nextBpm   - The BPM value after this change.
   */
  constructor(
    private readonly setBpm: (bpm: number) => void,
    private readonly prevBpm: number,
    private readonly nextBpm: number,
  ) {
    this.label = `Set BPM: ${prevBpm} → ${nextBpm}`;
  }

  /** Apply the new BPM. */
  execute(): void {
    this.setBpm(this.nextBpm);
  }

  /** Restore the previous BPM. */
  undo(): void {
    this.setBpm(this.prevBpm);
  }
}
