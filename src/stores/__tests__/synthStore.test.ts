import { invoke } from "@tauri-apps/api/core";
import { useSynthStore } from "../synthStore";
import type { SynthParams } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const DEFAULT_PARAMS: SynthParams = {
  waveform: 0,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.3,
  cutoff: 8000,
  resonance: 0,
  env_amount: 0,
  volume: 0.7,
  detune: 0,
  pulse_width: 0.5,
};

describe("synthStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // Reset store to defaults
    useSynthStore.setState({
      params: { ...DEFAULT_PARAMS },
      isInitialized: false,
      isLoading: false,
      error: null,
    });
  });

  it("has correct initial state", () => {
    const state = useSynthStore.getState();
    expect(state.params.waveform).toBe(0);
    expect(state.params.attack).toBe(0.01);
    expect(state.params.sustain).toBe(0.7);
    expect(state.params.cutoff).toBe(8000);
    expect(state.params.volume).toBe(0.7);
    expect(state.isInitialized).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("initialize calls createSynthInstrument and getSynthState", async () => {
    const serverParams: SynthParams = { ...DEFAULT_PARAMS, attack: 0.5 };
    mockInvoke
      .mockResolvedValueOnce(undefined)   // create_synth_instrument
      .mockResolvedValueOnce(serverParams); // get_synth_state

    await useSynthStore.getState().initialize();

    expect(mockInvoke).toHaveBeenCalledWith("create_synth_instrument");
    expect(mockInvoke).toHaveBeenCalledWith("get_synth_state");

    const state = useSynthStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.params.attack).toBe(0.5);
  });

  it("initialize sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Audio engine not running"));

    await useSynthStore.getState().initialize();

    const state = useSynthStore.getState();
    expect(state.error).toContain("Audio engine not running");
    expect(state.isLoading).toBe(false);
    expect(state.isInitialized).toBe(false);
  });

  it("setParam updates params optimistically before IPC resolves", async () => {
    let resolveSetParam: () => void;
    mockInvoke.mockReturnValueOnce(
      new Promise<void>((res) => {
        resolveSetParam = res;
      }),
    );

    const promise = useSynthStore.getState().setParam("attack", 2.0);

    // Optimistic update should be immediate
    expect(useSynthStore.getState().params.attack).toBe(2.0);

    resolveSetParam!();
    await promise;

    expect(mockInvoke).toHaveBeenCalledWith("set_synth_param", {
      param: "attack",
      value: 2.0,
    });
  });

  it("setParam sets error on IPC failure but keeps optimistic value", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Param out of range"));

    await useSynthStore.getState().setParam("cutoff", 99999);

    const state = useSynthStore.getState();
    // Optimistic value was applied
    expect(state.params.cutoff).toBe(99999);
    // Error is captured
    expect(state.error).toContain("Param out of range");
  });

  it("fetchState updates params from backend", async () => {
    const serverParams: SynthParams = { ...DEFAULT_PARAMS, resonance: 0.8 };
    mockInvoke.mockResolvedValueOnce(serverParams);

    await useSynthStore.getState().fetchState();

    const state = useSynthStore.getState();
    expect(state.params.resonance).toBe(0.8);
    expect(state.error).toBeNull();
  });

  it("clearError resets error to null", () => {
    useSynthStore.setState({ error: "Something failed" });
    useSynthStore.getState().clearError();
    expect(useSynthStore.getState().error).toBeNull();
  });
});
