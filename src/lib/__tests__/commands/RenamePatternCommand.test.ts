import { describe, it, expect, vi, beforeEach } from "vitest";
import { RenamePatternCommand } from "../../commands/RenamePatternCommand";

// ---------------------------------------------------------------------------
// RenamePatternCommand
// ---------------------------------------------------------------------------

describe("RenamePatternCommand", () => {
  let rename: ReturnType<typeof vi.fn>;
  const patternId = "pattern-abc-123";

  beforeEach(() => {
    rename = vi.fn();
  });

  // -------------------------------------------------------------------------
  // label
  // -------------------------------------------------------------------------

  it('label includes both names formatted as Rename: "{prev}" → "{next}"', () => {
    const cmd = new RenamePatternCommand(rename, patternId, "Verse", "Chorus");
    expect(cmd.label).toBe('Rename: "Verse" → "Chorus"');
  });

  it("label uses the exact name strings provided", () => {
    const cmd = new RenamePatternCommand(rename, patternId, "Loop A", "Main Riff");
    expect(cmd.label).toBe('Rename: "Loop A" → "Main Riff"');
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  it("execute() calls rename with (patternId, nextName)", () => {
    const cmd = new RenamePatternCommand(rename, patternId, "Old", "New");
    cmd.execute();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(patternId, "New");
  });

  it("execute() does NOT call rename with prevName", () => {
    const cmd = new RenamePatternCommand(rename, patternId, "Old", "New");
    cmd.execute();
    expect(rename).not.toHaveBeenCalledWith(patternId, "Old");
  });

  // -------------------------------------------------------------------------
  // undo
  // -------------------------------------------------------------------------

  it("undo() calls rename with (patternId, prevName)", () => {
    const cmd = new RenamePatternCommand(rename, patternId, "Old", "New");
    cmd.undo();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(patternId, "Old");
  });

  it("undo() does NOT call rename with nextName", () => {
    const cmd = new RenamePatternCommand(rename, patternId, "Old", "New");
    cmd.undo();
    expect(rename).not.toHaveBeenCalledWith(patternId, "New");
  });

  // -------------------------------------------------------------------------
  // execute + undo round-trip
  // -------------------------------------------------------------------------

  it("execute then undo produces the correct call sequence", () => {
    const cmd = new RenamePatternCommand(rename, patternId, "Intro", "Bridge");
    cmd.execute();
    cmd.undo();

    expect(rename).toHaveBeenCalledTimes(2);
    expect(rename.mock.calls[0]).toEqual([patternId, "Bridge"]);
    expect(rename.mock.calls[1]).toEqual([patternId, "Intro"]);
  });

  // -------------------------------------------------------------------------
  // patternId forwarded correctly
  // -------------------------------------------------------------------------

  it("uses the patternId from constructor — not a default value", () => {
    const specificId = "track-42-pattern-7";
    const cmd = new RenamePatternCommand(rename, specificId, "A", "B");
    cmd.execute();
    expect(rename).toHaveBeenCalledWith(specificId, "B");
  });
});
