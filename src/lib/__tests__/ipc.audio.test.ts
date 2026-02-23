import { invoke } from "@tauri-apps/api/core";
import {
  getAudioDevices,
  getEngineStatus,
  startEngine,
  stopEngine,
  setAudioDevice,
  setEngineConfig,
  setTestTone,
} from "../ipc";
import type { AudioDeviceInfo, EngineStatus } from "../ipc";

const mockInvoke = vi.mocked(invoke);

const mockDevice: AudioDeviceInfo = {
  name: "Speakers",
  host_type: "Wasapi",
  is_input: false,
  is_output: true,
  supported_sample_rates: [44100, 48000],
  supported_buffer_sizes: [256, 512],
};

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

describe("ipc.ts audio wrappers", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("getAudioDevices calls invoke with get_audio_devices", async () => {
    mockInvoke.mockResolvedValue([mockDevice]);
    const result = await getAudioDevices();
    expect(mockInvoke).toHaveBeenCalledWith("get_audio_devices");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Speakers");
  });

  it("getEngineStatus calls invoke with get_engine_status", async () => {
    mockInvoke.mockResolvedValue(mockStatus);
    const result = await getEngineStatus();
    expect(mockInvoke).toHaveBeenCalledWith("get_engine_status");
    expect(result.state).toBe("stopped");
  });

  it("startEngine calls invoke with start_engine", async () => {
    const running = { ...mockStatus, state: "running" as const };
    mockInvoke.mockResolvedValue(running);
    const result = await startEngine();
    expect(mockInvoke).toHaveBeenCalledWith("start_engine");
    expect(result.state).toBe("running");
  });

  it("stopEngine calls invoke with stop_engine", async () => {
    mockInvoke.mockResolvedValue(mockStatus);
    const result = await stopEngine();
    expect(mockInvoke).toHaveBeenCalledWith("stop_engine");
    expect(result.state).toBe("stopped");
  });

  it("setAudioDevice passes deviceName and isInput", async () => {
    mockInvoke.mockResolvedValue(mockStatus);
    await setAudioDevice("ASIO Device", false);
    expect(mockInvoke).toHaveBeenCalledWith("set_audio_device", {
      deviceName: "ASIO Device",
      isInput: false,
    });
  });

  it("setEngineConfig passes sampleRate and bufferSize", async () => {
    mockInvoke.mockResolvedValue(mockStatus);
    await setEngineConfig(48000, 512);
    expect(mockInvoke).toHaveBeenCalledWith("set_engine_config", {
      sampleRate: 48000,
      bufferSize: 512,
    });
  });

  it("setEngineConfig sends null for omitted params", async () => {
    mockInvoke.mockResolvedValue(mockStatus);
    await setEngineConfig(48000);
    expect(mockInvoke).toHaveBeenCalledWith("set_engine_config", {
      sampleRate: 48000,
      bufferSize: null,
    });
  });

  it("setTestTone calls invoke with enabled flag", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setTestTone(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_test_tone", { enabled: true });
  });
});
