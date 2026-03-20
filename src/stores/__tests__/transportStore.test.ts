import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTransportStore } from "../transportStore";
import type { TransportSnapshot } from "../../lib/ipc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const defaultSnapshot: TransportSnapshot = {
  state: "stopped",
  position_samples: 0,
  bbt: { bar: 1, beat: 1, tick: 0 },
  bpm: 120.0,
  time_sig_numerator: 4,
  time_sig_denominator: 4,
  loop_enabled: false,
  loop_start_samples: 0,
  loop_end_samples: 0,
  metronome_enabled: false,
  metronome_volume: 0.5,
  metronome_pitch_hz: 1000.0,
  record_armed: false,
};

function playingSnapshot(): TransportSnapshot {
  return { ...defaultSnapshot, state: "playing" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transportStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the store to its initial state between tests
    useTransportStore.setState({
      snapshot: defaultSnapshot,
      isLoading: false,
      error: null,
    });
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("has correct initial state", () => {
    const { snapshot, isLoading, error } = useTransportStore.getState();
    expect(snapshot.state).toBe("stopped");
    expect(snapshot.bpm).toBe(120.0);
    expect(snapshot.time_sig_numerator).toBe(4);
    expect(snapshot.time_sig_denominator).toBe(4);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // applySnapshot (event-driven update — no IPC)
  // -------------------------------------------------------------------------

  it("applySnapshot updates snapshot directly without IPC", () => {
    const { applySnapshot } = useTransportStore.getState();
    applySnapshot(playingSnapshot());

    const { snapshot } = useTransportStore.getState();
    expect(snapshot.state).toBe("playing");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("applySnapshot updates bbt position", () => {
    const { applySnapshot } = useTransportStore.getState();
    const snap: TransportSnapshot = {
      ...defaultSnapshot,
      state: "playing",
      position_samples: 22050,
      bbt: { bar: 1, beat: 2, tick: 0 },
    };
    applySnapshot(snap);
    expect(useTransportStore.getState().snapshot.bbt.beat).toBe(2);
  });

  // -------------------------------------------------------------------------
  // play
  // -------------------------------------------------------------------------

  it("play calls transport_play command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().play();
    expect(mockInvoke).toHaveBeenCalledWith("transport_play");
  });

  it("play sets isLoading true then false on success", async () => {
    let loadingDuringCall = false;
    mockInvoke.mockImplementationOnce(async () => {
      loadingDuringCall = useTransportStore.getState().isLoading;
    });
    await useTransportStore.getState().play();
    expect(loadingDuringCall).toBe(true);
    expect(useTransportStore.getState().isLoading).toBe(false);
  });

  it("play sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("engine not running"));
    await useTransportStore.getState().play();
    expect(useTransportStore.getState().error).toContain("engine not running");
    expect(useTransportStore.getState().isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // stop
  // -------------------------------------------------------------------------

  it("stop calls transport_stop command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().stop();
    expect(mockInvoke).toHaveBeenCalledWith("transport_stop");
  });

  it("stop sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("not running"));
    await useTransportStore.getState().stop();
    expect(useTransportStore.getState().error).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // pause
  // -------------------------------------------------------------------------

  it("pause calls transport_pause command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().pause();
    expect(mockInvoke).toHaveBeenCalledWith("transport_pause");
  });

  // -------------------------------------------------------------------------
  // setBpm
  // -------------------------------------------------------------------------

  it("setBpm calls set_tempo_map command with single-point map", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().setBpm(140.0);
    expect(mockInvoke).toHaveBeenCalledWith("set_tempo_map", {
      points: [{ tick: 0, bpm: 140.0, interp: "Step" }],
    });
  });

  it("setBpm clears error on success", async () => {
    useTransportStore.setState({ error: "previous error" });
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().setBpm(120);
    expect(useTransportStore.getState().error).toBeNull();
  });

  it("setBpm sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("out of range"));
    await useTransportStore.getState().setBpm(500);
    expect(useTransportStore.getState().error).toContain("out of range");
  });

  // -------------------------------------------------------------------------
  // setTimeSignature
  // -------------------------------------------------------------------------

  it("setTimeSignature calls set_time_signature command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().setTimeSignature(3, 4);
    expect(mockInvoke).toHaveBeenCalledWith("set_time_signature", {
      numerator: 3,
      denominator: 4,
    });
  });

  // -------------------------------------------------------------------------
  // setLoopRegion
  // -------------------------------------------------------------------------

  it("setLoopRegion calls set_loop_region command with start and end beats", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().setLoopRegion(0, 4);
    expect(mockInvoke).toHaveBeenCalledWith("set_loop_region", {
      startBeats: 0,
      endBeats: 4,
    });
  });

  // -------------------------------------------------------------------------
  // setRecordArmed
  // -------------------------------------------------------------------------

  it("setRecordArmed calls set_record_armed command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().setRecordArmed(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_record_armed", {
      armed: true,
    });
  });

  // -------------------------------------------------------------------------
  // toggleLoop
  // -------------------------------------------------------------------------

  it("toggleLoop calls toggle_loop command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().toggleLoop(true);
    expect(mockInvoke).toHaveBeenCalledWith("toggle_loop", { enabled: true });
  });

  // -------------------------------------------------------------------------
  // toggleMetronome
  // -------------------------------------------------------------------------

  it("toggleMetronome calls toggle_metronome command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().toggleMetronome(true);
    expect(mockInvoke).toHaveBeenCalledWith("toggle_metronome", {
      enabled: true,
    });
  });

  // -------------------------------------------------------------------------
  // setMetronomeVolume / setMetronomePitch
  // -------------------------------------------------------------------------

  it("setMetronomeVolume calls set_metronome_volume command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().setMetronomeVolume(0.8);
    expect(mockInvoke).toHaveBeenCalledWith("set_metronome_volume", {
      volume: 0.8,
    });
  });

  it("setMetronomePitch calls set_metronome_pitch command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await useTransportStore.getState().setMetronomePitch(880.0);
    expect(mockInvoke).toHaveBeenCalledWith("set_metronome_pitch", {
      pitchHz: 880.0,
    });
  });

  // -------------------------------------------------------------------------
  // refreshState
  // -------------------------------------------------------------------------

  it("refreshState calls get_transport_state and stores result", async () => {
    const snap = playingSnapshot();
    mockInvoke.mockResolvedValueOnce(snap);
    await useTransportStore.getState().refreshState();
    expect(mockInvoke).toHaveBeenCalledWith("get_transport_state");
    expect(useTransportStore.getState().snapshot.state).toBe("playing");
  });

  it("refreshState sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("backend offline"));
    await useTransportStore.getState().refreshState();
    expect(useTransportStore.getState().error).toContain("backend offline");
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  it("clearError sets error to null", () => {
    useTransportStore.setState({ error: "some error" });
    useTransportStore.getState().clearError();
    expect(useTransportStore.getState().error).toBeNull();
  });
});
