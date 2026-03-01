import type { Command } from '@/lib/history';

/**
 * Records a pattern rename as a single undoable step.
 *
 * The command captures the pattern ID and both name values at construction
 * time, delegating the actual state mutation to the caller-supplied rename
 * function so that this class remains store-agnostic.
 */
export class RenamePatternCommand implements Command {
  /** Human-readable label shown in the History panel. */
  readonly label: string;

  /**
   * @param rename    - Function that applies a new name to the given pattern.
   * @param patternId - Stable identifier for the pattern being renamed.
   * @param prevName  - The pattern name before this change.
   * @param nextName  - The pattern name after this change.
   */
  constructor(
    private readonly rename: (id: string, name: string) => void,
    private readonly patternId: string,
    private readonly prevName: string,
    private readonly nextName: string,
  ) {
    this.label = `Rename: "${prevName}" → "${nextName}"`;
  }

  /** Apply the new pattern name. */
  execute(): void {
    this.rename(this.patternId, this.nextName);
  }

  /** Restore the previous pattern name. */
  undo(): void {
    this.rename(this.patternId, this.prevName);
  }
}
