import { invoke } from "@tauri-apps/api/core";
import { useFreezeStore } from "../freezeStore";

const mockInvoke = vi.mocked(invoke);

describe("freezeStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useFreezeStore.setState({
      statusByTrack: {},
      progressByTrack: {},
      frozenInfo: {},
    });
  });

  it("getStatus returns idle for unknown track", () => {
    expect(useFreezeStore.getState().getStatus("unknown")).toBe("idle");
  });

  it("isFrozen returns false for unknown track", () => {
    expect(useFreezeStore.getState().isFrozen("t1")).toBe(false);
  });

  it("getProgress returns 0 for unknown track", () => {
    expect(useFreezeStore.getState().getProgress("t1")).toBe(0);
  });

  it("freezeTrack sets rendering then frozen status on success", async () => {
    const mockResult = {
      wavPath: "/tmp/t1_freeze.wav",
      sampleId: "s-1",
      clipId: "c-1",
      startBeats: 0,
      endBeats: 8,
    };
    mockInvoke.mockResolvedValueOnce(mockResult);

    const result = await useFreezeStore.getState().freezeTrack("t1", [], 120, "/proj");
    expect(result).toEqual(mockResult);
    expect(useFreezeStore.getState().getStatus("t1")).toBe("frozen");
    expect(useFreezeStore.getState().isFrozen("t1")).toBe(true);
    expect(useFreezeStore.getState().frozenInfo["t1"].freezeClipId).toBe("c-1");
  });

  it("freezeTrack sets error status on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("render failed"));
    await expect(
      useFreezeStore.getState().freezeTrack("t1", [], 120, "/proj"),
    ).rejects.toThrow("render failed");
    expect(useFreezeStore.getState().getStatus("t1")).toBe("error");
  });

  it("unfreezeTrack returns clip id and clears frozen state", async () => {
    // Setup frozen state first.
    useFreezeStore.setState({
      statusByTrack: { "t1": "frozen" },
      frozenInfo: { "t1": { freezeClipId: "c-99", wavPath: "/tmp/t1.wav" } },
    });
    mockInvoke.mockResolvedValueOnce("c-99");

    const clipId = await useFreezeStore.getState().unfreezeTrack("t1");
    expect(clipId).toBe("c-99");
    expect(useFreezeStore.getState().isFrozen("t1")).toBe(false);
    expect(useFreezeStore.getState().frozenInfo["t1"]).toBeUndefined();
  });

  it("cancelFreeze calls backend and resets to idle", async () => {
    useFreezeStore.setState({ statusByTrack: { "t1": "rendering" } });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useFreezeStore.getState().cancelFreeze("t1");
    expect(mockInvoke).toHaveBeenCalledWith("cancel_freeze", { trackId: "t1" });
    expect(useFreezeStore.getState().getStatus("t1")).toBe("idle");
  });

  it("onProgress updates progressByTrack", () => {
    useFreezeStore.getState().onProgress("t1", 0.42);
    expect(useFreezeStore.getState().getProgress("t1")).toBeCloseTo(0.42);
  });
});
