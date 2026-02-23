import { invoke } from "@tauri-apps/api/core";
import { useAudioStore } from "../audioStore";
import type { EngineStatus } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

const mockStatus: EngineStatus = {
  state: "stopped",
  config: {
    sample_rate: 44100,
    buffer_size: 256,
    output_device: null,
    input_device: null,
  },
  active_host: null,
  test_tone_active: false,
};

describe("audioStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // Reset store state
    useAudioStore.setState({
      devices: [],
      engineState: "stopped",
      config: {
        sample_rate: 44100,
        buffer_size: 256,
        output_device: null,
        input_device: null,
      },
      activeHost: null,
      testToneActive: false,
      error: null,
      isLoading: false,
    });
  });

  it("has correct initial state", () => {
    const state = useAudioStore.getState();
    expect(state.engineState).toBe("stopped");
    expect(state.config.sample_rate).toBe(44100);
    expect(state.config.buffer_size).toBe(256);
    expect(state.devices).toEqual([]);
    expect(state.testToneActive).toBe(false);
    expect(state.error).toBeNull();
  });

  it("refreshDevices updates device list", async () => {
    const devices = [
      {
        name: "Speakers",
        host_type: "Wasapi" as const,
        is_input: false,
        is_output: true,
        supported_sample_rates: [44100],
        supported_buffer_sizes: [256],
      },
    ];
    mockInvoke.mockResolvedValue(devices);

    await useAudioStore.getState().refreshDevices();

    const state = useAudioStore.getState();
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0].name).toBe("Speakers");
    expect(state.isLoading).toBe(false);
  });

  it("refreshDevices sets error on failure", async () => {
    mockInvoke.mockRejectedValue("Device error");

    await useAudioStore.getState().refreshDevices();

    const state = useAudioStore.getState();
    expect(state.error).toBe("Device error");
    expect(state.isLoading).toBe(false);
  });

  it("start updates engine state", async () => {
    const running: EngineStatus = {
      ...mockStatus,
      state: "running",
      active_host: "Wasapi",
    };
    mockInvoke.mockResolvedValue(running);

    await useAudioStore.getState().start();

    const state = useAudioStore.getState();
    expect(state.engineState).toBe("running");
    expect(state.activeHost).toBe("Wasapi");
  });

  it("stop updates engine state", async () => {
    // Set running state first
    useAudioStore.setState({ engineState: "running" });
    mockInvoke.mockResolvedValue(mockStatus);

    await useAudioStore.getState().stop();

    const state = useAudioStore.getState();
    expect(state.engineState).toBe("stopped");
  });

  it("toggleTestTone updates testToneActive", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await useAudioStore.getState().toggleTestTone(true);

    expect(useAudioStore.getState().testToneActive).toBe(true);

    await useAudioStore.getState().toggleTestTone(false);

    expect(useAudioStore.getState().testToneActive).toBe(false);
  });

  it("clearError clears error state", () => {
    useAudioStore.setState({ error: "some error" });
    useAudioStore.getState().clearError();
    expect(useAudioStore.getState().error).toBeNull();
  });
});
