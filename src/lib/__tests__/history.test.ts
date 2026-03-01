import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryManager, MacroCommand } from "../history";
import type { Command } from "../history";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCmd(label = "cmd"): Command & {
  executeSpy: ReturnType<typeof vi.fn>;
  undoSpy: ReturnType<typeof vi.fn>;
} {
  const executeSpy = vi.fn();
  const undoSpy = vi.fn();
  return {
    label,
    execute: executeSpy,
    undo: undoSpy,
    executeSpy,
    undoSpy,
  };
}

// ---------------------------------------------------------------------------
// HistoryManager
// ---------------------------------------------------------------------------

describe("HistoryManager", () => {
  let manager: HistoryManager;

  beforeEach(() => {
    manager = new HistoryManager();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("initial state: canUndo=false, canRedo=false, entries=[], pointer=-1", () => {
    expect(manager.canUndo).toBe(false);
    expect(manager.canRedo).toBe(false);
    expect(manager.entries).toHaveLength(0);
    expect(manager.currentPointer).toBe(-1);
  });

  // -------------------------------------------------------------------------
  // push
  // -------------------------------------------------------------------------

  it("push calls execute(), sets canUndo=true, canRedo=false, adds one entry", () => {
    const cmd = makeCmd("Set BPM");
    manager.push(cmd);

    expect(cmd.executeSpy).toHaveBeenCalledTimes(1);
    expect(manager.canUndo).toBe(true);
    expect(manager.canRedo).toBe(false);
    expect(manager.entries).toHaveLength(1);
    expect(manager.entries[0].label).toBe("Set BPM");
  });

  it("push updates currentPointer to the new entry index", () => {
    manager.push(makeCmd("A"));
    expect(manager.currentPointer).toBe(0);
    manager.push(makeCmd("B"));
    expect(manager.currentPointer).toBe(1);
  });

  // -------------------------------------------------------------------------
  // undo
  // -------------------------------------------------------------------------

  it("push + undo: calls undo(), canUndo=false, canRedo=true, pointer=-1", () => {
    const cmd = makeCmd();
    manager.push(cmd);
    manager.undo();

    expect(cmd.undoSpy).toHaveBeenCalledTimes(1);
    expect(manager.canUndo).toBe(false);
    expect(manager.canRedo).toBe(true);
    expect(manager.currentPointer).toBe(-1);
  });

  it("undo is a no-op when canUndo is false", () => {
    const cmd = makeCmd();
    manager.push(cmd);
    manager.undo();
    // Attempt a second undo — should not throw and should not call undo again
    expect(() => manager.undo()).not.toThrow();
    expect(cmd.undoSpy).toHaveBeenCalledTimes(1);
    expect(manager.currentPointer).toBe(-1);
  });

  it("push two commands then undo moves pointer to 0 and keeps canUndo=true", () => {
    const a = makeCmd("A");
    const b = makeCmd("B");
    manager.push(a);
    manager.push(b);
    manager.undo();

    expect(b.undoSpy).toHaveBeenCalledTimes(1);
    expect(manager.currentPointer).toBe(0);
    expect(manager.canUndo).toBe(true);
    expect(manager.canRedo).toBe(true);
  });

  // -------------------------------------------------------------------------
  // redo
  // -------------------------------------------------------------------------

  it("push + undo + redo: canRedo=false, execute called again", () => {
    const cmd = makeCmd();
    manager.push(cmd);
    manager.undo();
    manager.redo();

    expect(cmd.executeSpy).toHaveBeenCalledTimes(2);
    expect(manager.canRedo).toBe(false);
    expect(manager.canUndo).toBe(true);
    expect(manager.currentPointer).toBe(0);
  });

  it("redo is a no-op when canRedo is false", () => {
    const cmd = makeCmd();
    manager.push(cmd);
    // No undo performed — canRedo is false
    expect(() => manager.redo()).not.toThrow();
    expect(cmd.executeSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // push after undo clears redo tail
  // -------------------------------------------------------------------------

  it("push after undo clears redo tail: push 3, undo 1, push new → length=3 not 4", () => {
    const a = makeCmd("A");
    const b = makeCmd("B");
    const c = makeCmd("C");
    const d = makeCmd("D");

    manager.push(a);
    manager.push(b);
    manager.push(c);
    manager.undo(); // pointer now at index 1 (B), C is the redo tail

    manager.push(d); // should clear C and add D

    expect(manager.entries).toHaveLength(3);
    expect(manager.entries.map((e) => e.label)).toEqual(["A", "B", "D"]);
    expect(manager.canRedo).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Max depth enforcement
  // -------------------------------------------------------------------------

  it("max depth: pushing 101 commands keeps entries.length === 100 (oldest dropped)", () => {
    // Use default max depth of 100
    for (let i = 0; i < 101; i++) {
      manager.push(makeCmd(`cmd-${i}`));
    }

    expect(manager.entries).toHaveLength(100);
    // The oldest (cmd-0) should have been dropped; cmd-1 should now be the first
    expect(manager.entries[0].label).toBe("cmd-1");
    expect(manager.entries[99].label).toBe("cmd-100");
  });

  it("custom maxDepth is respected", () => {
    const shallow = new HistoryManager(3);
    for (let i = 0; i < 5; i++) {
      shallow.push(makeCmd(`cmd-${i}`));
    }
    expect(shallow.entries).toHaveLength(3);
    expect(shallow.entries[0].label).toBe("cmd-2");
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  it("clear() resets all state", () => {
    manager.push(makeCmd("A"));
    manager.push(makeCmd("B"));
    manager.clear();

    expect(manager.canUndo).toBe(false);
    expect(manager.canRedo).toBe(false);
    expect(manager.entries).toHaveLength(0);
    expect(manager.currentPointer).toBe(-1);
  });

  // -------------------------------------------------------------------------
  // entries.isCurrent flag
  // -------------------------------------------------------------------------

  it("entries.isCurrent flags the correct entry at each step", () => {
    const a = makeCmd("A");
    const b = makeCmd("B");
    const c = makeCmd("C");

    manager.push(a);
    manager.push(b);
    manager.push(c);

    // pointer at 2 (c)
    expect(manager.entries[0].isCurrent).toBe(false);
    expect(manager.entries[1].isCurrent).toBe(false);
    expect(manager.entries[2].isCurrent).toBe(true);

    manager.undo(); // pointer at 1 (b)
    expect(manager.entries[0].isCurrent).toBe(false);
    expect(manager.entries[1].isCurrent).toBe(true);
    expect(manager.entries[2].isCurrent).toBe(false);

    manager.undo(); // pointer at 0 (a)
    expect(manager.entries[0].isCurrent).toBe(true);
    expect(manager.entries[1].isCurrent).toBe(false);

    manager.undo(); // pointer at -1 (nothing current)
    expect(manager.entries.every((e) => !e.isCurrent)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MacroCommand
// ---------------------------------------------------------------------------

describe("MacroCommand", () => {
  it("has the correct label", () => {
    const macro = new MacroCommand("Group Operation", [makeCmd("A"), makeCmd("B")]);
    expect(macro.label).toBe("Group Operation");
  });

  it("execute() calls sub-commands in order", () => {
    const calls: string[] = [];
    const a: Command = {
      label: "A",
      execute: () => calls.push("A-execute"),
      undo: () => calls.push("A-undo"),
    };
    const b: Command = {
      label: "B",
      execute: () => calls.push("B-execute"),
      undo: () => calls.push("B-undo"),
    };

    const macro = new MacroCommand("Macro", [a, b]);
    macro.execute();

    expect(calls).toEqual(["A-execute", "B-execute"]);
  });

  it("undo() calls sub-commands in REVERSE order", () => {
    const calls: string[] = [];
    const a: Command = {
      label: "A",
      execute: () => calls.push("A-execute"),
      undo: () => calls.push("A-undo"),
    };
    const b: Command = {
      label: "B",
      execute: () => calls.push("B-execute"),
      undo: () => calls.push("B-undo"),
    };

    const macro = new MacroCommand("Macro", [a, b]);
    macro.undo();

    expect(calls).toEqual(["B-undo", "A-undo"]);
  });

  it("empty commands array: execute does not throw", () => {
    const macro = new MacroCommand("Empty", []);
    expect(() => macro.execute()).not.toThrow();
  });

  it("empty commands array: undo does not throw", () => {
    const macro = new MacroCommand("Empty", []);
    expect(() => macro.undo()).not.toThrow();
  });

  it("execute then undo performs full round-trip in correct order", () => {
    const calls: string[] = [];
    const cmds: Command[] = ["A", "B", "C"].map((id) => ({
      label: id,
      execute: () => calls.push(`${id}-exec`),
      undo: () => calls.push(`${id}-undo`),
    }));

    const macro = new MacroCommand("Round-trip", cmds);
    macro.execute();
    macro.undo();

    expect(calls).toEqual([
      "A-exec",
      "B-exec",
      "C-exec",
      "C-undo",
      "B-undo",
      "A-undo",
    ]);
  });
});
