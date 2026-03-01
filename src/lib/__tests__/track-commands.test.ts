import { describe, it, expect, vi, beforeEach } from "vitest";
import { RenameTrackCommand } from "../../lib/commands/RenameTrackCommand";
import { CreateTrackCommand } from "../../lib/commands/CreateTrackCommand";
import { DeleteTrackCommand } from "../../lib/commands/DeleteTrackCommand";
import { ReorderTracksCommand } from "../../lib/commands/ReorderTracksCommand";
import type { DawTrack } from "../../stores/trackStore";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTrack(overrides: Partial<DawTrack> = {}): DawTrack {
  return {
    id: "track-001",
    name: "My Track",
    kind: "Midi",
    color: "#6c63ff",
    volume: 0.8,
    pan: 0.0,
    muted: false,
    soloed: false,
    armed: false,
    instrumentId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RenameTrackCommand
// ---------------------------------------------------------------------------

describe("RenameTrackCommand", () => {
  let rename: ReturnType<typeof vi.fn>;
  const trackId = "track-rename-1";

  beforeEach(() => {
    rename = vi.fn();
  });

  it('has label: Rename track: "old" -> "new"', () => {
    const cmd = new RenameTrackCommand(rename, trackId, "old", "new");
    expect(cmd.label).toBe('Rename track: "old" → "new"');
  });

  it("execute calls rename(trackId, nextName)", () => {
    const cmd = new RenameTrackCommand(rename, trackId, "Verse", "Chorus");
    cmd.execute();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(trackId, "Chorus");
  });

  it("undo calls rename(trackId, prevName)", () => {
    const cmd = new RenameTrackCommand(rename, trackId, "Verse", "Chorus");
    cmd.undo();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(trackId, "Verse");
  });

  it("execute then undo calls rename twice with correct args", () => {
    const cmd = new RenameTrackCommand(rename, trackId, "Alpha", "Beta");
    cmd.execute();
    cmd.undo();
    expect(rename).toHaveBeenCalledTimes(2);
    expect(rename.mock.calls[0]).toEqual([trackId, "Beta"]);
    expect(rename.mock.calls[1]).toEqual([trackId, "Alpha"]);
  });

  it("uses the exact trackId from constructor", () => {
    const specificId = "track-42";
    const cmd = new RenameTrackCommand(rename, specificId, "A", "B");
    cmd.execute();
    expect(rename).toHaveBeenCalledWith(specificId, "B");
  });
});

// ---------------------------------------------------------------------------
// CreateTrackCommand
// ---------------------------------------------------------------------------

describe("CreateTrackCommand", () => {
  let addTrack: ReturnType<typeof vi.fn>;
  let removeTrack: ReturnType<typeof vi.fn>;
  let track: DawTrack;

  beforeEach(() => {
    addTrack = vi.fn();
    removeTrack = vi.fn();
    track = makeTrack({ id: "track-create-1", name: "My Track" });
  });

  it('has label: Create track: "My Track"', () => {
    const cmd = new CreateTrackCommand(addTrack, removeTrack, track);
    expect(cmd.label).toBe('Create track: "My Track"');
  });

  it("execute calls addTrack(track)", () => {
    const cmd = new CreateTrackCommand(addTrack, removeTrack, track);
    cmd.execute();
    expect(addTrack).toHaveBeenCalledTimes(1);
    expect(addTrack).toHaveBeenCalledWith(track);
  });

  it("undo calls removeTrack(track.id)", () => {
    const cmd = new CreateTrackCommand(addTrack, removeTrack, track);
    cmd.undo();
    expect(removeTrack).toHaveBeenCalledTimes(1);
    expect(removeTrack).toHaveBeenCalledWith(track.id);
  });

  it("execute does not call removeTrack", () => {
    const cmd = new CreateTrackCommand(addTrack, removeTrack, track);
    cmd.execute();
    expect(removeTrack).not.toHaveBeenCalled();
  });

  it("undo does not call addTrack", () => {
    const cmd = new CreateTrackCommand(addTrack, removeTrack, track);
    cmd.undo();
    expect(addTrack).not.toHaveBeenCalled();
  });

  it("execute then undo: addTrack then removeTrack in order", () => {
    const cmd = new CreateTrackCommand(addTrack, removeTrack, track);
    cmd.execute();
    cmd.undo();
    expect(addTrack).toHaveBeenCalledTimes(1);
    expect(removeTrack).toHaveBeenCalledTimes(1);
    expect(addTrack).toHaveBeenCalledWith(track);
    expect(removeTrack).toHaveBeenCalledWith(track.id);
  });
});

// ---------------------------------------------------------------------------
// DeleteTrackCommand
// ---------------------------------------------------------------------------

describe("DeleteTrackCommand", () => {
  let addTrack: ReturnType<typeof vi.fn>;
  let removeTrack: ReturnType<typeof vi.fn>;
  let track: DawTrack;
  const trackIndex = 2;

  beforeEach(() => {
    addTrack = vi.fn();
    removeTrack = vi.fn();
    track = makeTrack({ id: "track-delete-1", name: "My Track" });
  });

  it('has label: Delete track: "My Track"', () => {
    const cmd = new DeleteTrackCommand(addTrack, removeTrack, track, trackIndex);
    expect(cmd.label).toBe('Delete track: "My Track"');
  });

  it("execute calls removeTrack(track.id)", () => {
    const cmd = new DeleteTrackCommand(addTrack, removeTrack, track, trackIndex);
    cmd.execute();
    expect(removeTrack).toHaveBeenCalledTimes(1);
    expect(removeTrack).toHaveBeenCalledWith(track.id);
  });

  it("undo calls addTrack(track, index)", () => {
    const cmd = new DeleteTrackCommand(addTrack, removeTrack, track, trackIndex);
    cmd.undo();
    expect(addTrack).toHaveBeenCalledTimes(1);
    expect(addTrack).toHaveBeenCalledWith(track, trackIndex);
  });

  it("execute does not call addTrack", () => {
    const cmd = new DeleteTrackCommand(addTrack, removeTrack, track, trackIndex);
    cmd.execute();
    expect(addTrack).not.toHaveBeenCalled();
  });

  it("undo does not call removeTrack", () => {
    const cmd = new DeleteTrackCommand(addTrack, removeTrack, track, trackIndex);
    cmd.undo();
    expect(removeTrack).not.toHaveBeenCalled();
  });

  it("execute then undo: removeTrack then addTrack with index", () => {
    const cmd = new DeleteTrackCommand(addTrack, removeTrack, track, trackIndex);
    cmd.execute();
    cmd.undo();
    expect(removeTrack).toHaveBeenCalledWith(track.id);
    expect(addTrack).toHaveBeenCalledWith(track, trackIndex);
  });

  it("preserves the original index passed at construction time", () => {
    const specificIndex = 7;
    const cmd = new DeleteTrackCommand(addTrack, removeTrack, track, specificIndex);
    cmd.undo();
    expect(addTrack).toHaveBeenCalledWith(track, specificIndex);
  });
});

// ---------------------------------------------------------------------------
// ReorderTracksCommand
// ---------------------------------------------------------------------------

describe("ReorderTracksCommand", () => {
  let reorder: ReturnType<typeof vi.fn>;
  const prevOrder = ["track-a", "track-b", "track-c"];
  const nextOrder = ["track-c", "track-a", "track-b"];

  beforeEach(() => {
    reorder = vi.fn();
  });

  it("has label: Reorder tracks", () => {
    const cmd = new ReorderTracksCommand(reorder, prevOrder, nextOrder);
    expect(cmd.label).toBe("Reorder tracks");
  });

  it("execute calls reorder(nextOrder)", () => {
    const cmd = new ReorderTracksCommand(reorder, prevOrder, nextOrder);
    cmd.execute();
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith(nextOrder);
  });

  it("undo calls reorder(prevOrder)", () => {
    const cmd = new ReorderTracksCommand(reorder, prevOrder, nextOrder);
    cmd.undo();
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith(prevOrder);
  });

  it("execute does not call reorder with prevOrder", () => {
    const cmd = new ReorderTracksCommand(reorder, prevOrder, nextOrder);
    cmd.execute();
    expect(reorder).not.toHaveBeenCalledWith(prevOrder);
  });

  it("undo does not call reorder with nextOrder", () => {
    const cmd = new ReorderTracksCommand(reorder, prevOrder, nextOrder);
    cmd.undo();
    expect(reorder).not.toHaveBeenCalledWith(nextOrder);
  });

  it("execute then undo applies nextOrder then prevOrder", () => {
    const cmd = new ReorderTracksCommand(reorder, prevOrder, nextOrder);
    cmd.execute();
    cmd.undo();
    expect(reorder).toHaveBeenCalledTimes(2);
    expect(reorder.mock.calls[0]).toEqual([nextOrder]);
    expect(reorder.mock.calls[1]).toEqual([prevOrder]);
  });
});
