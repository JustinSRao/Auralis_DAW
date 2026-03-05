import { invoke } from "@tauri-apps/api/core";
import { useDrumMachineStore } from "../drumMachineStore";
import type { DrumMachineSnapshot } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

function makeSnapshot(overrides?: Partial<DrumMachineSnapshot>): DrumMachineSnapshot {
  return {
    bpm: 120,
    swing: 0,
    pattern_length: 16,
    playing: false,
    current_step: 0,
    pads: Array.from({ length: 16 }, (_, i) => ({
      idx: i,
      name: `Pad ${i + 1}`,
      has_sample: false,
      steps: Array.from({ length: 16 }, () => ({ active: false, velocity: 100 })),
    })),
    ...overrides,
  };
}

describe("drumMachineStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useDrumMachineStore.setState({
      snapshot: makeSnapshot(),
      isInitialized: false,
      isLoading: false,
      error: null,
    });
  });

  it("has correct initial state", () => {
    const state = useDrumMachineStore.getState();
    expect(state.snapshot.bpm).toBe(120);
    expect(state.snapshot.pattern_length).toBe(16);
    expect(state.snapshot.playing).toBe(false);
    expect(state.snapshot.pads).toHaveLength(16);
    expect(state.snapshot.pads[0].steps).toHaveLength(16);
    expect(state.isInitialized).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("initialize calls create_drum_machine and get_drum_state", async () => {
    const snap = makeSnapshot();
    mockInvoke
      .mockResolvedValueOnce(undefined)  // create_drum_machine
      .mockResolvedValueOnce(snap);       // get_drum_state

    await useDrumMachineStore.getState().initialize();

    expect(mockInvoke).toHaveBeenCalledWith("create_drum_machine");
    expect(mockInvoke).toHaveBeenCalledWith("get_drum_state");

    const state = useDrumMachineStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("initialize is idempotent when already initialized", async () => {
    useDrumMachineStore.setState({ isInitialized: true });
    await useDrumMachineStore.getState().initialize();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("initialize sets error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("audio engine not running"));
    await useDrumMachineStore.getState().initialize();

    const state = useDrumMachineStore.getState();
    expect(state.isInitialized).toBe(false);
    expect(state.error).toContain("audio engine not running");
  });

  it("toggleStep toggles the step and calls set_drum_step", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().toggleStep(0, 0);

    // Optimistic update
    expect(useDrumMachineStore.getState().snapshot.pads[0].steps[0].active).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith(
      "set_drum_step",
      expect.objectContaining({ padIdx: 0, stepIdx: 0, active: true }),
    );
  });

  it("toggleStep rolls back on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("device error"));
    await useDrumMachineStore.getState().toggleStep(0, 0);

    // Should have rolled back to false
    expect(useDrumMachineStore.getState().snapshot.pads[0].steps[0].active).toBe(false);
    expect(useDrumMachineStore.getState().error).toContain("device error");
  });

  it("setStepVelocity updates velocity and calls set_drum_step", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().setStepVelocity(2, 5, 80);

    expect(useDrumMachineStore.getState().snapshot.pads[2].steps[5].velocity).toBe(80);
    expect(mockInvoke).toHaveBeenCalledWith(
      "set_drum_step",
      expect.objectContaining({ padIdx: 2, stepIdx: 5, velocity: 80 }),
    );
  });

  it("loadPadSample updates pad name and has_sample", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().loadPadSample(0, "/samples/kick.wav");

    expect(mockInvoke).toHaveBeenCalledWith(
      "load_drum_pad_sample",
      expect.objectContaining({ padIdx: 0, filePath: "/samples/kick.wav" }),
    );
    const pad = useDrumMachineStore.getState().snapshot.pads[0];
    expect(pad.has_sample).toBe(true);
    expect(pad.name).toBe("kick.wav");
  });

  it("loadPadSample sets error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("unsupported format"));
    await useDrumMachineStore.getState().loadPadSample(0, "/bad.xyz");
    expect(useDrumMachineStore.getState().error).toContain("unsupported format");
  });

  it("setSwing updates optimistically and calls set_drum_swing", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().setSwing(0.25);

    expect(useDrumMachineStore.getState().snapshot.swing).toBe(0.25);
    expect(mockInvoke).toHaveBeenCalledWith("set_drum_swing", { swing: 0.25 });
  });

  it("setBpm updates optimistically and calls set_drum_bpm", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().setBpm(140);

    expect(useDrumMachineStore.getState().snapshot.bpm).toBe(140);
    expect(mockInvoke).toHaveBeenCalledWith("set_drum_bpm", { bpm: 140 });
  });

  it("setPatternLength updates snapshot steps and calls set_drum_pattern_length", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().setPatternLength(32);

    expect(useDrumMachineStore.getState().snapshot.pattern_length).toBe(32);
    expect(useDrumMachineStore.getState().snapshot.pads[0].steps).toHaveLength(32);
    expect(mockInvoke).toHaveBeenCalledWith("set_drum_pattern_length", { length: 32 });
  });

  it("play updates playing flag and calls drum_play", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().play();

    expect(useDrumMachineStore.getState().snapshot.playing).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("drum_play");
  });

  it("stop updates playing flag and calls drum_stop", async () => {
    useDrumMachineStore.setState((s) => ({ snapshot: { ...s.snapshot, playing: true } }));
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().stop();

    expect(useDrumMachineStore.getState().snapshot.playing).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("drum_stop");
  });

  it("reset updates playing and current_step and calls drum_reset", async () => {
    useDrumMachineStore.setState((s) => ({
      snapshot: { ...s.snapshot, playing: true, current_step: 7 },
    }));
    mockInvoke.mockResolvedValueOnce(undefined);
    await useDrumMachineStore.getState().reset();

    const state = useDrumMachineStore.getState();
    expect(state.snapshot.playing).toBe(false);
    expect(state.snapshot.current_step).toBe(0);
    expect(mockInvoke).toHaveBeenCalledWith("drum_reset");
  });

  it("setCurrentStep updates current_step in snapshot", () => {
    useDrumMachineStore.getState().setCurrentStep(5);
    expect(useDrumMachineStore.getState().snapshot.current_step).toBe(5);
  });

  it("fetchState updates snapshot from backend", async () => {
    const snap = makeSnapshot({ bpm: 160, swing: 0.25 });
    mockInvoke.mockResolvedValueOnce(snap);
    await useDrumMachineStore.getState().fetchState();

    const state = useDrumMachineStore.getState();
    expect(state.snapshot.bpm).toBe(160);
    expect(state.snapshot.swing).toBe(0.25);
    expect(state.error).toBeNull();
  });

  it("clearError resets the error field", () => {
    useDrumMachineStore.setState({ error: "something went wrong" });
    useDrumMachineStore.getState().clearError();
    expect(useDrumMachineStore.getState().error).toBeNull();
  });
});
