import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock ipc module before importing store
vi.mock("../../lib/ipc", () => ({
  getInputDevices: vi.fn(),
  setInputDevice: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  getRecordingStatus: vi.fn(),
  setMonitoringEnabled: vi.fn(),
  setMonitoringGain: vi.fn(),
}));

import * as ipc from "../../lib/ipc";
import { useRecorderStore } from "../recorderStore";

// Shorthand to get store state
const store = () => useRecorderStore.getState();

// Reset store state before each test
function resetStore() {
  useRecorderStore.setState({
    inputDevices: [],
    selectedDevice: null,
    isRecording: false,
    isFinalizing: false,
    inputLevel: 0,
    monitoringEnabled: false,
    monitoringGain: 0.7,
    outputPath: null,
    error: null,
  });
}

describe("recorderStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // ── Initial state ────────────────────────────────────────────────────────

  it("starts with empty device list and not recording", () => {
    const s = store();
    expect(s.inputDevices).toHaveLength(0);
    expect(s.isRecording).toBe(false);
    expect(s.isFinalizing).toBe(false);
    expect(s.inputLevel).toBe(0);
    expect(s.error).toBeNull();
  });

  // ── fetchInputDevices ────────────────────────────────────────────────────

  it("fetchInputDevices populates device list on success", async () => {
    const devices = [
      { name: "Mic", host_type: "Wasapi", is_input: true, is_output: false, supported_sample_rates: [44100], supported_buffer_sizes: [256] },
    ];
    vi.mocked(ipc.getInputDevices).mockResolvedValueOnce(devices as never);

    await store().fetchInputDevices();
    expect(store().inputDevices).toEqual(devices);
    expect(store().error).toBeNull();
  });

  it("fetchInputDevices sets error on failure", async () => {
    vi.mocked(ipc.getInputDevices).mockRejectedValueOnce(new Error("No devices"));
    await store().fetchInputDevices();
    expect(store().error).toBe("No devices");
  });

  // ── selectInputDevice ────────────────────────────────────────────────────

  it("selectInputDevice updates selectedDevice and calls IPC", async () => {
    vi.mocked(ipc.setInputDevice).mockResolvedValueOnce(undefined);
    await store().selectInputDevice("USB Mic");
    expect(store().selectedDevice).toBe("USB Mic");
    expect(ipc.setInputDevice).toHaveBeenCalledWith("USB Mic");
  });

  // ── startRecording ───────────────────────────────────────────────────────

  it("startRecording sets isRecording and outputPath on success", async () => {
    vi.mocked(ipc.startRecording).mockResolvedValueOnce("/tmp/rec_abc.wav");
    await store().startRecording();
    expect(store().isRecording).toBe(true);
    expect(store().outputPath).toBe("/tmp/rec_abc.wav");
    expect(store().error).toBeNull();
  });

  it("startRecording sets error and resets isRecording on failure", async () => {
    vi.mocked(ipc.startRecording).mockRejectedValueOnce(new Error("No device"));
    await store().startRecording();
    expect(store().isRecording).toBe(false);
    expect(store().error).toBe("No device");
  });

  it("startRecording is idempotent when already recording", async () => {
    useRecorderStore.setState({ isRecording: true });
    await store().startRecording();
    expect(ipc.startRecording).not.toHaveBeenCalled();
  });

  // ── stopRecording ────────────────────────────────────────────────────────

  it("stopRecording sets isFinalizing and clears isRecording", async () => {
    useRecorderStore.setState({ isRecording: true });
    vi.mocked(ipc.stopRecording).mockResolvedValueOnce("/tmp/rec_abc.wav");
    await store().stopRecording();
    expect(store().isRecording).toBe(false);
    expect(store().isFinalizing).toBe(true);
  });

  it("stopRecording does nothing when not recording", async () => {
    await store().stopRecording();
    expect(ipc.stopRecording).not.toHaveBeenCalled();
  });

  // ── setMonitoring ────────────────────────────────────────────────────────

  it("setMonitoring enables monitoring and calls IPC", async () => {
    vi.mocked(ipc.setMonitoringEnabled).mockResolvedValueOnce(undefined);
    await store().setMonitoring(true);
    expect(store().monitoringEnabled).toBe(true);
    expect(ipc.setMonitoringEnabled).toHaveBeenCalledWith(true);
  });

  it("setMonitoring rolls back on IPC failure", async () => {
    vi.mocked(ipc.setMonitoringEnabled).mockRejectedValueOnce(new Error("fail"));
    await store().setMonitoring(true);
    expect(store().monitoringEnabled).toBe(false); // rolled back
    expect(store().error).toBe("fail");
  });

  // ── setMonitoringGain ────────────────────────────────────────────────────

  it("setMonitoringGain updates gain and calls IPC", async () => {
    vi.mocked(ipc.setMonitoringGain).mockResolvedValueOnce(undefined);
    await store().setMonitoringGain(0.5);
    expect(store().monitoringGain).toBe(0.5);
    expect(ipc.setMonitoringGain).toHaveBeenCalledWith(0.5);
  });

  it("setMonitoringGain rolls back on failure", async () => {
    vi.mocked(ipc.setMonitoringGain).mockRejectedValueOnce(new Error("fail"));
    const prevGain = store().monitoringGain;
    await store().setMonitoringGain(0.3);
    expect(store().monitoringGain).toBe(prevGain);
  });

  // ── setInputLevel ────────────────────────────────────────────────────────

  it("setInputLevel updates inputLevel synchronously", () => {
    store().setInputLevel(0.75);
    expect(store().inputLevel).toBe(0.75);
  });

  // ── setOutputPath ────────────────────────────────────────────────────────

  it("setOutputPath updates outputPath and clears isFinalizing", () => {
    useRecorderStore.setState({ isFinalizing: true });
    store().setOutputPath("/tmp/rec_done.wav");
    expect(store().outputPath).toBe("/tmp/rec_done.wav");
    expect(store().isFinalizing).toBe(false);
  });

  // ── clearError ───────────────────────────────────────────────────────────

  it("clearError resets error to null", () => {
    useRecorderStore.setState({ error: "something" });
    store().clearError();
    expect(store().error).toBeNull();
  });

  // ── fetchStatus ──────────────────────────────────────────────────────────

  it("fetchStatus syncs state from backend", async () => {
    vi.mocked(ipc.getRecordingStatus).mockResolvedValueOnce({
      state: "recording",
      input_device: "Mic",
      output_path: "/tmp/r.wav",
      monitoring_enabled: true,
      monitoring_gain: 0.8,
    });
    await store().fetchStatus();
    expect(store().isRecording).toBe(true);
    expect(store().monitoringEnabled).toBe(true);
    expect(store().monitoringGain).toBe(0.8);
    expect(store().outputPath).toBe("/tmp/r.wav");
  });
});
