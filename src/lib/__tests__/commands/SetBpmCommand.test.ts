import { describe, it, expect, vi, beforeEach } from "vitest";
import { SetBpmCommand } from "../../commands/SetBpmCommand";

// ---------------------------------------------------------------------------
// SetBpmCommand
// ---------------------------------------------------------------------------

describe("SetBpmCommand", () => {
  let setBpm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setBpm = vi.fn();
  });

  // -------------------------------------------------------------------------
  // label
  // -------------------------------------------------------------------------

  it('label includes both BPM values formatted as "Set BPM: {prev} → {next}"', () => {
    const cmd = new SetBpmCommand(setBpm, 120, 140);
    expect(cmd.label).toBe("Set BPM: 120 → 140");
  });

  it("label uses the exact numeric values provided", () => {
    const cmd = new SetBpmCommand(setBpm, 80.5, 200);
    expect(cmd.label).toBe("Set BPM: 80.5 → 200");
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  it("execute() calls setBpm with nextBpm", () => {
    const cmd = new SetBpmCommand(setBpm, 120, 140);
    cmd.execute();
    expect(setBpm).toHaveBeenCalledTimes(1);
    expect(setBpm).toHaveBeenCalledWith(140);
  });

  it("execute() does NOT call setBpm with prevBpm", () => {
    const cmd = new SetBpmCommand(setBpm, 120, 140);
    cmd.execute();
    expect(setBpm).not.toHaveBeenCalledWith(120);
  });

  // -------------------------------------------------------------------------
  // undo
  // -------------------------------------------------------------------------

  it("undo() calls setBpm with prevBpm", () => {
    const cmd = new SetBpmCommand(setBpm, 120, 140);
    cmd.undo();
    expect(setBpm).toHaveBeenCalledTimes(1);
    expect(setBpm).toHaveBeenCalledWith(120);
  });

  it("undo() does NOT call setBpm with nextBpm", () => {
    const cmd = new SetBpmCommand(setBpm, 120, 140);
    cmd.undo();
    expect(setBpm).not.toHaveBeenCalledWith(140);
  });

  // -------------------------------------------------------------------------
  // execute + undo round-trip
  // -------------------------------------------------------------------------

  it("execute then undo produces the correct call sequence", () => {
    const cmd = new SetBpmCommand(setBpm, 100, 160);
    cmd.execute();
    cmd.undo();

    expect(setBpm).toHaveBeenCalledTimes(2);
    expect(setBpm.mock.calls[0]).toEqual([160]);
    expect(setBpm.mock.calls[1]).toEqual([100]);
  });
});
