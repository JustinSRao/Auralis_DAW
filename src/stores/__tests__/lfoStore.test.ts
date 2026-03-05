import { invoke } from "@tauri-apps/api/core";
import { useLfoStore } from "../lfoStore";
import type { LfoStateSnapshot } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const DEFAULT_LFO = {
  rate: 1.0,
  depth: 0.0,
  waveform: 0,
  bpm_sync: 0,
  division: 1,
  phase_reset: 0,
  destination: 0,
};

function resetStore() {
  useLfoStore.setState({
    lfo1: { ...DEFAULT_LFO },
    lfo2: { ...DEFAULT_LFO },
    error: null,
  });
}

describe("lfoStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    resetStore();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it("has correct default values for lfo1", () => {
    const { lfo1 } = useLfoStore.getState();
    expect(lfo1.rate).toBe(1.0);
    expect(lfo1.depth).toBe(0.0);
    expect(lfo1.waveform).toBe(0);
    expect(lfo1.bpm_sync).toBe(0);
    expect(lfo1.division).toBe(1);
    expect(lfo1.phase_reset).toBe(0);
    expect(lfo1.destination).toBe(0);
  });

  it("has correct default values for lfo2", () => {
    const { lfo2 } = useLfoStore.getState();
    expect(lfo2.rate).toBe(1.0);
    expect(lfo2.depth).toBe(0.0);
    expect(lfo2.waveform).toBe(0);
    expect(lfo2.bpm_sync).toBe(0);
    expect(lfo2.division).toBe(1);
    expect(lfo2.phase_reset).toBe(0);
    expect(lfo2.destination).toBe(0);
  });

  it("starts with error null", () => {
    expect(useLfoStore.getState().error).toBeNull();
  });

  // ── setLfoParam ────────────────────────────────────────────────────────────

  it("setLfoParam(1, rate, 5.0) calls invoke with correct args", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await useLfoStore.getState().setLfoParam(1, "rate", 5.0);

    expect(mockInvoke).toHaveBeenCalledWith("set_lfo_param", {
      slot: 1,
      param: "rate",
      value: 5.0,
    });
  });

  it("setLfoParam(2, depth, 0.8) calls invoke with slot 2", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await useLfoStore.getState().setLfoParam(2, "depth", 0.8);

    expect(mockInvoke).toHaveBeenCalledWith("set_lfo_param", {
      slot: 2,
      param: "depth",
      value: 0.8,
    });
  });

  it("setLfoParam optimistically updates lfo1 before IPC resolves", async () => {
    let resolve!: () => void;
    mockInvoke.mockReturnValueOnce(new Promise<void>((res) => { resolve = res; }));

    const promise = useLfoStore.getState().setLfoParam(1, "rate", 7.5);

    // Optimistic update should be synchronous
    expect(useLfoStore.getState().lfo1.rate).toBe(7.5);

    resolve();
    await promise;
  });

  it("setLfoParam optimistically updates lfo2 before IPC resolves", async () => {
    let resolve!: () => void;
    mockInvoke.mockReturnValueOnce(new Promise<void>((res) => { resolve = res; }));

    const promise = useLfoStore.getState().setLfoParam(2, "waveform", 3);

    expect(useLfoStore.getState().lfo2.waveform).toBe(3);

    resolve();
    await promise;
  });

  it("setLfoParam captures error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("LFO backend error"));

    await useLfoStore.getState().setLfoParam(1, "depth", 0.5);

    expect(useLfoStore.getState().error).toContain("LFO backend error");
  });

  // ── fetchLfoState ──────────────────────────────────────────────────────────

  it("fetchLfoState updates both lfo1 and lfo2 from get_lfo_state", async () => {
    const snapshot: LfoStateSnapshot = {
      lfo1: { ...DEFAULT_LFO, rate: 4.0, waveform: 2 },
      lfo2: { ...DEFAULT_LFO, depth: 0.75, destination: 1 },
    };
    mockInvoke.mockResolvedValueOnce(snapshot);

    await useLfoStore.getState().fetchLfoState();

    expect(mockInvoke).toHaveBeenCalledWith("get_lfo_state");

    const state = useLfoStore.getState();
    expect(state.lfo1.rate).toBe(4.0);
    expect(state.lfo1.waveform).toBe(2);
    expect(state.lfo2.depth).toBe(0.75);
    expect(state.lfo2.destination).toBe(1);
    expect(state.error).toBeNull();
  });

  it("fetchLfoState captures error on IPC failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("get_lfo_state failed"));

    await useLfoStore.getState().fetchLfoState();

    expect(useLfoStore.getState().error).toContain("get_lfo_state failed");
  });

  // ── clearError ─────────────────────────────────────────────────────────────

  it("clearError resets error to null", () => {
    useLfoStore.setState({ error: "something broke" });
    useLfoStore.getState().clearError();
    expect(useLfoStore.getState().error).toBeNull();
  });
});
