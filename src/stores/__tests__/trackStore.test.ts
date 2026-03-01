import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTrackStore } from "../trackStore";
import type { DawTrack } from "../trackStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockInvoke = vi.mocked(invoke);

/** Factory for a minimal DawTrack fixture. */
function makeTrack(overrides: Partial<DawTrack> = {}): DawTrack {
  return {
    id: "track-001",
    name: "Test Track",
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

const initialState = {
  tracks: [] as DawTrack[],
  selectedTrackId: null as string | null,
  isLoading: false,
  error: null as string | null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trackStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTrackStore.setState({ ...initialState });
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("has correct initial state", () => {
    const { tracks, selectedTrackId, isLoading, error } =
      useTrackStore.getState();
    expect(tracks).toEqual([]);
    expect(selectedTrackId).toBeNull();
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // createTrack
  // -------------------------------------------------------------------------

  it("createTrack calls invoke('create_track') and adds returned track to tracks array", async () => {
    const newTrack = makeTrack({ id: "track-abc", name: "MIDI Track" });
    mockInvoke.mockResolvedValueOnce(newTrack);

    await useTrackStore.getState().createTrack("Midi", "MIDI Track");

    expect(mockInvoke).toHaveBeenCalledWith("create_track", {
      kind: "Midi",
      name: "MIDI Track",
    });
    expect(useTrackStore.getState().tracks).toHaveLength(1);
    expect(useTrackStore.getState().tracks[0]).toEqual(newTrack);
  });

  it("createTrack sets isLoading=true during fetch, false after", async () => {
    let loadingDuringCall = false;
    mockInvoke.mockImplementationOnce(async () => {
      loadingDuringCall = useTrackStore.getState().isLoading;
      return makeTrack();
    });

    await useTrackStore.getState().createTrack("Audio");

    expect(loadingDuringCall).toBe(true);
    expect(useTrackStore.getState().isLoading).toBe(false);
  });

  it("createTrack on IPC error sets error string and isLoading=false", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("backend unavailable"));

    await useTrackStore.getState().createTrack("Instrument");

    expect(useTrackStore.getState().error).toContain("backend unavailable");
    expect(useTrackStore.getState().isLoading).toBe(false);
    expect(useTrackStore.getState().tracks).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // deleteTrack
  // -------------------------------------------------------------------------

  it("deleteTrack removes track from tracks array and calls invoke('delete_track')", async () => {
    const track = makeTrack({ id: "track-del-1" });
    useTrackStore.setState({ tracks: [track] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useTrackStore.getState().deleteTrack("track-del-1");

    expect(mockInvoke).toHaveBeenCalledWith("delete_track", {
      id: "track-del-1",
    });
    expect(useTrackStore.getState().tracks).toHaveLength(0);
  });

  it("deleteTrack clears selectedTrackId when the deleted track was selected", async () => {
    const track = makeTrack({ id: "track-sel-1" });
    useTrackStore.setState({ tracks: [track], selectedTrackId: "track-sel-1" });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useTrackStore.getState().deleteTrack("track-sel-1");

    expect(useTrackStore.getState().selectedTrackId).toBeNull();
  });

  it("deleteTrack preserves selectedTrackId when a different track is deleted", async () => {
    const trackA = makeTrack({ id: "track-a" });
    const trackB = makeTrack({ id: "track-b" });
    useTrackStore.setState({
      tracks: [trackA, trackB],
      selectedTrackId: "track-a",
    });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useTrackStore.getState().deleteTrack("track-b");

    expect(useTrackStore.getState().selectedTrackId).toBe("track-a");
  });

  // -------------------------------------------------------------------------
  // renameTrack
  // -------------------------------------------------------------------------

  it("renameTrack updates track name in array and calls invoke('rename_track')", async () => {
    const track = makeTrack({ id: "track-ren-1", name: "Old Name" });
    useTrackStore.setState({ tracks: [track] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useTrackStore.getState().renameTrack("track-ren-1", "New Name");

    expect(mockInvoke).toHaveBeenCalledWith("rename_track", {
      id: "track-ren-1",
      name: "New Name",
    });
    expect(useTrackStore.getState().tracks[0].name).toBe("New Name");
  });

  // -------------------------------------------------------------------------
  // reorderTracks
  // -------------------------------------------------------------------------

  it("reorderTracks updates tracks array to new order (optimistic)", async () => {
    const trackA = makeTrack({ id: "track-a", name: "A" });
    const trackB = makeTrack({ id: "track-b", name: "B" });
    const trackC = makeTrack({ id: "track-c", name: "C" });
    useTrackStore.setState({ tracks: [trackA, trackB, trackC] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useTrackStore
      .getState()
      .reorderTracks(["track-c", "track-a", "track-b"]);

    const ids = useTrackStore.getState().tracks.map((t) => t.id);
    expect(ids).toEqual(["track-c", "track-a", "track-b"]);
    expect(mockInvoke).toHaveBeenCalledWith("reorder_tracks", {
      ids: ["track-c", "track-a", "track-b"],
    });
  });

  // -------------------------------------------------------------------------
  // setTrackColor
  // -------------------------------------------------------------------------

  it("setTrackColor updates track color in array (optimistic)", async () => {
    const track = makeTrack({ id: "track-col-1", color: "#ffffff" });
    useTrackStore.setState({ tracks: [track] });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useTrackStore.getState().setTrackColor("track-col-1", "#ff0000");

    expect(useTrackStore.getState().tracks[0].color).toBe("#ff0000");
    expect(mockInvoke).toHaveBeenCalledWith("set_track_color", {
      id: "track-col-1",
      color: "#ff0000",
    });
  });

  // -------------------------------------------------------------------------
  // selectTrack
  // -------------------------------------------------------------------------

  it("selectTrack sets selectedTrackId to the given id", () => {
    const track = makeTrack({ id: "track-s1" });
    useTrackStore.setState({ tracks: [track] });

    useTrackStore.getState().selectTrack("track-s1");

    expect(useTrackStore.getState().selectedTrackId).toBe("track-s1");
  });

  it("selectTrack(null) clears selectedTrackId", () => {
    useTrackStore.setState({ selectedTrackId: "track-s1" });

    useTrackStore.getState().selectTrack(null);

    expect(useTrackStore.getState().selectedTrackId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // toggleMute
  // -------------------------------------------------------------------------

  it("toggleMute flips muted field from false to true", () => {
    const track = makeTrack({ id: "track-m1", muted: false });
    useTrackStore.setState({ tracks: [track] });

    useTrackStore.getState().toggleMute("track-m1");

    expect(useTrackStore.getState().tracks[0].muted).toBe(true);
  });

  it("toggleMute flips muted field from true to false", () => {
    const track = makeTrack({ id: "track-m2", muted: true });
    useTrackStore.setState({ tracks: [track] });

    useTrackStore.getState().toggleMute("track-m2");

    expect(useTrackStore.getState().tracks[0].muted).toBe(false);
  });

  // -------------------------------------------------------------------------
  // toggleSolo
  // -------------------------------------------------------------------------

  it("toggleSolo flips soloed field from false to true", () => {
    const track = makeTrack({ id: "track-solo1", soloed: false });
    useTrackStore.setState({ tracks: [track] });

    useTrackStore.getState().toggleSolo("track-solo1");

    expect(useTrackStore.getState().tracks[0].soloed).toBe(true);
  });

  it("toggleSolo flips soloed field from true to false", () => {
    const track = makeTrack({ id: "track-solo2", soloed: true });
    useTrackStore.setState({ tracks: [track] });

    useTrackStore.getState().toggleSolo("track-solo2");

    expect(useTrackStore.getState().tracks[0].soloed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // toggleArm
  // -------------------------------------------------------------------------

  it("toggleArm flips armed field from false to true", () => {
    const track = makeTrack({ id: "track-arm1", armed: false });
    useTrackStore.setState({ tracks: [track] });

    useTrackStore.getState().toggleArm("track-arm1");

    expect(useTrackStore.getState().tracks[0].armed).toBe(true);
  });

  it("toggleArm flips armed field from true to false", () => {
    const track = makeTrack({ id: "track-arm2", armed: true });
    useTrackStore.setState({ tracks: [track] });

    useTrackStore.getState().toggleArm("track-arm2");

    expect(useTrackStore.getState().tracks[0].armed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  it("clearError sets error to null", () => {
    useTrackStore.setState({ error: "something went wrong" });

    useTrackStore.getState().clearError();

    expect(useTrackStore.getState().error).toBeNull();
  });
});
