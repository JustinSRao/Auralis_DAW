/**
 * Core Command pattern types and HistoryManager for global undo/redo.
 *
 * All user-facing mutations that should be undoable must implement {@link Command}
 * and be pushed through {@link HistoryManager.push} rather than applied directly.
 */

/** Default maximum number of commands retained in the undo stack. */
export const DEFAULT_MAX_HISTORY = 100;

/**
 * A single undoable/redoable operation.
 *
 * Implementations must be self-contained: they capture all state needed to
 * execute and reverse the operation at construction time.
 */
export interface Command {
  /** Human-readable label shown in the History panel. */
  readonly label: string;
  /** Apply (or re-apply) the operation. */
  execute(): void;
  /** Reverse the operation, restoring the prior state. */
  undo(): void;
  /**
   * Optional serialisation hook for future persistence of undo history
   * across sessions.
   */
  toJSON?(): Record<string, unknown>;
}

/**
 * Manages a bounded, linear undo/redo stack.
 *
 * The manager is intentionally a plain class rather than a Zustand slice so
 * that Immer never proxies the internal `Command` objects. Callers are
 * responsible for syncing derived state back into the store after each
 * mutation.
 */
export class HistoryManager {
  private readonly stack: Command[] = [];
  private pointer = -1;

  /**
   * @param maxDepth - Maximum number of commands to retain. Oldest commands
   *   are evicted when the stack exceeds this limit. Defaults to
   *   {@link DEFAULT_MAX_HISTORY}.
   */
  constructor(private readonly maxDepth: number = DEFAULT_MAX_HISTORY) {}

  /** `true` when at least one command can be undone. */
  get canUndo(): boolean {
    return this.pointer >= 0;
  }

  /** `true` when at least one command can be redone. */
  get canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  /**
   * A snapshot of the stack entries suitable for rendering a history list.
   * Index 0 is the oldest command; the last index is the most recently pushed
   * command.
   */
  get entries(): ReadonlyArray<{ label: string; isCurrent: boolean }> {
    return this.stack.map((cmd, i) => ({
      label: cmd.label,
      isCurrent: i === this.pointer,
    }));
  }

  /** The index of the command that was most recently executed. `-1` when the stack is empty. */
  get currentPointer(): number {
    return this.pointer;
  }

  /**
   * Execute a command and push it onto the undo stack.
   *
   * Any commands that existed after the current pointer (i.e. the redo stack)
   * are discarded. If the stack exceeds `maxDepth` after insertion, the oldest
   * entry is evicted.
   *
   * @param cmd - The command to execute and record.
   */
  push(cmd: Command): void {
    cmd.execute();
    // Discard the redo stack.
    this.stack.splice(this.pointer + 1);
    this.stack.push(cmd);
    // Evict oldest entries if we've exceeded the depth limit.
    while (this.stack.length > this.maxDepth) {
      this.stack.shift();
    }
    this.pointer = this.stack.length - 1;
  }

  /**
   * Undo the command at the current pointer position.
   * A no-op when {@link canUndo} is `false`.
   */
  undo(): void {
    if (!this.canUndo) return;
    this.stack[this.pointer].undo();
    this.pointer--;
  }

  /**
   * Re-execute the command immediately after the current pointer.
   * A no-op when {@link canRedo} is `false`.
   */
  redo(): void {
    if (!this.canRedo) return;
    this.pointer++;
    this.stack[this.pointer].execute();
  }

  /**
   * Clear the entire undo/redo stack and reset the pointer.
   * Called when a new project is created or an existing project is opened.
   */
  clear(): void {
    this.stack.splice(0);
    this.pointer = -1;
  }
}

/**
 * A composite command that groups multiple {@link Command} instances into a
 * single undoable step.
 *
 * Commands execute in forward order and undo in reverse order, preserving
 * correct state transitions.
 */
export class MacroCommand implements Command {
  /**
   * @param label - Label displayed in the History panel for the group.
   * @param commands - Ordered list of commands to compose.
   */
  constructor(
    readonly label: string,
    private readonly commands: Command[],
  ) {}

  /** Execute all child commands in forward order. */
  execute(): void {
    for (const cmd of this.commands) cmd.execute();
  }

  /** Undo all child commands in reverse order. */
  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}
