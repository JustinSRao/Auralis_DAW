import { invoke } from "@tauri-apps/api/core";
import { useSamplerStore } from "../samplerStore";
import type { SamplerParams, SamplerSnapshot } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const DEFAULT_PARAMS: SamplerParams = {
  attack: 0.01,
  decay: 0.1,
  sustain: 1.0,
  release: 0.3,
  volume: 0.8,
};

const EMPTY_SNAPSHOT: SamplerSnapshot = {
  params: { ...DEFAULT_PARAMS },
  zones: [],
};

describe("samplerStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useSamplerStore.setState({
      params: { ...DEFAULT_PARAMS },
      zones: [],
      nextZoneId: 0,
      isInitialized: false,
      isLoading: false,
      error: null,
    });
  });

  it("has correct initial state", () => {
    const state = useSamplerStore.getState();
    expect(state.params.attack).toBe(0.01);
    expect(state.params.sustain).toBe(1.0);
    expect(state.params.volume).toBe(0.8);
    expect(state.zones).toHaveLength(0);
    expect(state.isInitialized).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("initialize calls createSamplerInstrument and getSamplerState", async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined)      // create_sampler_instrument
      .mockResolvedValueOnce(EMPTY_SNAPSHOT); // get_sampler_state

    await useSamplerStore.getState().initialize();

    expect(mockInvoke).toHaveBeenCalledWith("create_sampler_instrument");
    expect(mockInvoke).toHaveBeenCalledWith("get_sampler_state");

    const state = useSamplerStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("initialize sets error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("audio engine not running"));

    await useSamplerStore.getState().initialize();

    const state = useSamplerStore.getState();
    expect(state.isInitialized).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toContain("audio engine not running");
  });

  it("setParam updates params optimistically and calls IPC", async () => {
    mockInvoke.mockResolvedValueOnce(undefined); // set_sampler_param

    await useSamplerStore.getState().setParam("attack", 0.5);

    expect(useSamplerStore.getState().params.attack).toBe(0.5);
    expect(mockInvoke).toHaveBeenCalledWith("set_sampler_param", {
      param: "attack",
      value: 0.5,
    });
  });

  it("setParam stores error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("param out of range"));

    await useSamplerStore.getState().setParam("volume", 99.9);

    const state = useSamplerStore.getState();
    expect(state.error).toContain("param out of range");
  });

  it("loadZone calls load_sample_zone and adds zone to list", async () => {
    const mockZone = {
      id: 0,
      name: "piano.wav",
      root_note: 60,
      min_note: 0,
      max_note: 127,
      loop_start: 0,
      loop_end: 0,
      loop_enabled: false,
    };
    mockInvoke.mockResolvedValueOnce(mockZone);

    const result = await useSamplerStore.getState().loadZone("/samples/piano.wav");

    expect(mockInvoke).toHaveBeenCalledWith(
      "load_sample_zone",
      expect.objectContaining({ filePath: "/samples/piano.wav", zoneId: 0 }),
    );
    expect(result).toEqual(mockZone);
    expect(useSamplerStore.getState().zones).toHaveLength(1);
    expect(useSamplerStore.getState().zones[0].name).toBe("piano.wav");
  });

  it("loadZone increments nextZoneId after each call", async () => {
    const makeZone = (id: number) => ({
      id,
      name: `zone${id}.wav`,
      root_note: 60,
      min_note: 0,
      max_note: 127,
      loop_start: 0,
      loop_end: 0,
      loop_enabled: false,
    });

    mockInvoke
      .mockResolvedValueOnce(makeZone(0))
      .mockResolvedValueOnce(makeZone(1));

    await useSamplerStore.getState().loadZone("/a.wav");
    await useSamplerStore.getState().loadZone("/b.wav");

    expect(useSamplerStore.getState().nextZoneId).toBe(2);
    expect(useSamplerStore.getState().zones).toHaveLength(2);
  });

  it("loadZone returns null and sets error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("unsupported format"));

    const result = await useSamplerStore.getState().loadZone("/bad.xyz");

    expect(result).toBeNull();
    expect(useSamplerStore.getState().error).toContain("unsupported format");
  });

  it("removeZone removes zone optimistically and calls IPC", async () => {
    useSamplerStore.setState({
      zones: [
        { id: 5, name: "kick.wav", root_note: 36, min_note: 36, max_note: 36, loop_start: 0, loop_end: 0, loop_enabled: false },
      ],
    });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useSamplerStore.getState().removeZone(5);

    expect(useSamplerStore.getState().zones).toHaveLength(0);
    expect(mockInvoke).toHaveBeenCalledWith("remove_sample_zone", { zoneId: 5 });
  });

  it("fetchState updates params and zones from backend", async () => {
    const snap: SamplerSnapshot = {
      params: { attack: 0.2, decay: 0.5, sustain: 0.6, release: 1.0, volume: 0.9 },
      zones: [
        { id: 0, name: "str.wav", root_note: 48, min_note: 48, max_note: 72, loop_start: 0, loop_end: 0, loop_enabled: true },
      ],
    };
    mockInvoke.mockResolvedValueOnce(snap);

    await useSamplerStore.getState().fetchState();

    const state = useSamplerStore.getState();
    expect(state.params.attack).toBe(0.2);
    expect(state.zones).toHaveLength(1);
    expect(state.zones[0].name).toBe("str.wav");
    expect(state.error).toBeNull();
  });

  it("clearError resets the error field", () => {
    useSamplerStore.setState({ error: "something went wrong" });
    useSamplerStore.getState().clearError();
    expect(useSamplerStore.getState().error).toBeNull();
  });
});
