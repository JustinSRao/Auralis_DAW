import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHistoryStore } from "../historyStore";
import type { Command } from "@/lib/history";

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
// Tests
// ---------------------------------------------------------------------------

describe("historyStore", () => {
  // The HistoryManager is a module-level singleton inside historyStore.
  // clear() must be called before each test to reset it.
  beforeEach(() => {
    useHistoryStore.getState().clear();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("initial state: canUndo=false, canRedo=false, entries=[], currentPointer=-1", () => {
    const { canUndo, canRedo, entries, currentPointer } =
      useHistoryStore.getState();
    expect(canUndo).toBe(false);
    expect(canRedo).toBe(false);
    expect(entries).toHaveLength(0);
    expect(currentPointer).toBe(-1);
  });

  // -------------------------------------------------------------------------
  // push
  // -------------------------------------------------------------------------

  it("push() sets canUndo=true and calls cmd.execute()", () => {
    const cmd = makeCmd("Set BPM");
    useHistoryStore.getState().push(cmd);

    expect(cmd.executeSpy).toHaveBeenCalledTimes(1);
    const { canUndo, canRedo } = useHistoryStore.getState();
    expect(canUndo).toBe(true);
    expect(canRedo).toBe(false);
  });

  it("push() adds the entry label to entries", () => {
    useHistoryStore.getState().push(makeCmd("Rename Pattern"));
    const { entries } = useHistoryStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("Rename Pattern");
  });

  it("push() increments currentPointer to 0 from -1", () => {
    useHistoryStore.getState().push(makeCmd());
    expect(useHistoryStore.getState().currentPointer).toBe(0);
  });

  // -------------------------------------------------------------------------
  // undo
  // -------------------------------------------------------------------------

  it("undo() sets canUndo=false, canRedo=true, and calls cmd.undo()", () => {
    const cmd = makeCmd();
    useHistoryStore.getState().push(cmd);
    useHistoryStore.getState().undo();

    expect(cmd.undoSpy).toHaveBeenCalledTimes(1);
    const { canUndo, canRedo } = useHistoryStore.getState();
    expect(canUndo).toBe(false);
    expect(canRedo).toBe(true);
  });

  it("undo() decrements currentPointer to -1 after single push", () => {
    useHistoryStore.getState().push(makeCmd());
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().currentPointer).toBe(-1);
  });

  // -------------------------------------------------------------------------
  // redo
  // -------------------------------------------------------------------------

  it("redo() sets canRedo=false and calls cmd.execute() again", () => {
    const cmd = makeCmd();
    useHistoryStore.getState().push(cmd);
    useHistoryStore.getState().undo();
    useHistoryStore.getState().redo();

    expect(cmd.executeSpy).toHaveBeenCalledTimes(2);
    const { canRedo, canUndo } = useHistoryStore.getState();
    expect(canRedo).toBe(false);
    expect(canUndo).toBe(true);
  });

  it("redo() restores currentPointer back to 0", () => {
    useHistoryStore.getState().push(makeCmd());
    useHistoryStore.getState().undo();
    useHistoryStore.getState().redo();
    expect(useHistoryStore.getState().currentPointer).toBe(0);
  });

  // -------------------------------------------------------------------------
  // push after undo clears redo tail
  // -------------------------------------------------------------------------

  it("push after undo clears redo: canRedo becomes false", () => {
    const a = makeCmd("A");
    const b = makeCmd("B");
    const c = makeCmd("C");

    useHistoryStore.getState().push(a);
    useHistoryStore.getState().push(b);
    useHistoryStore.getState().push(c);
    useHistoryStore.getState().undo(); // c is now redo tail

    useHistoryStore.getState().push(makeCmd("D")); // D replaces c

    const { canRedo, entries } = useHistoryStore.getState();
    expect(canRedo).toBe(false);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.label)).toEqual(["A", "B", "D"]);
  });

  // -------------------------------------------------------------------------
  // entries array labels and isCurrent flags
  // -------------------------------------------------------------------------

  it("entries have correct labels and isCurrent flags", () => {
    useHistoryStore.getState().push(makeCmd("Alpha"));
    useHistoryStore.getState().push(makeCmd("Beta"));

    const { entries, currentPointer } = useHistoryStore.getState();
    expect(entries[0].label).toBe("Alpha");
    expect(entries[1].label).toBe("Beta");
    expect(currentPointer).toBe(1);
    expect(entries[0].isCurrent).toBe(false);
    expect(entries[1].isCurrent).toBe(true);
  });

  it("isCurrent moves back to first entry after undo from two entries", () => {
    useHistoryStore.getState().push(makeCmd("Alpha"));
    useHistoryStore.getState().push(makeCmd("Beta"));
    useHistoryStore.getState().undo();

    const { entries } = useHistoryStore.getState();
    expect(entries[0].isCurrent).toBe(true);
    expect(entries[1].isCurrent).toBe(false);
  });

  it("no entry is marked isCurrent when pointer is -1", () => {
    useHistoryStore.getState().push(makeCmd("Alpha"));
    useHistoryStore.getState().undo(); // pointer back to -1

    const { entries } = useHistoryStore.getState();
    expect(entries.every((e) => !e.isCurrent)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  it("clear() resets to initial state", () => {
    useHistoryStore.getState().push(makeCmd("A"));
    useHistoryStore.getState().push(makeCmd("B"));
    useHistoryStore.getState().clear();

    const { canUndo, canRedo, entries, currentPointer } =
      useHistoryStore.getState();
    expect(canUndo).toBe(false);
    expect(canRedo).toBe(false);
    expect(entries).toHaveLength(0);
    expect(currentPointer).toBe(-1);
  });
});
