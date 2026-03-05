import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock Tauri event listener
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock ipc
vi.mock("../../../lib/ipc", () => ({
  getInputDevices: vi.fn().mockResolvedValue([]),
  setInputDevice: vi.fn().mockResolvedValue(undefined),
  startRecording: vi.fn().mockResolvedValue("/tmp/rec_test.wav"),
  stopRecording: vi.fn().mockResolvedValue("/tmp/rec_test.wav"),
  getRecordingStatus: vi.fn().mockResolvedValue({
    state: "idle",
    input_device: null,
    output_path: null,
    monitoring_enabled: false,
    monitoring_gain: 0.7,
  }),
  setMonitoringEnabled: vi.fn().mockResolvedValue(undefined),
  setMonitoringGain: vi.fn().mockResolvedValue(undefined),
}));

import * as ipc from "../../../lib/ipc";
import { useRecorderStore } from "../../../stores/recorderStore";
import { RecordPanel } from "../RecordPanel";

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

describe("RecordPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("renders the recording panel heading", () => {
    render(<RecordPanel />);
    expect(screen.getByText(/record/i)).toBeInTheDocument();
  });

  it("renders the input device selector", () => {
    render(<RecordPanel />);
    expect(screen.getByLabelText("Input device")).toBeInTheDocument();
  });

  it("renders the level meter", () => {
    render(<RecordPanel />);
    expect(screen.getByRole("meter", { name: /input level/i })).toBeInTheDocument();
  });

  it("renders the REC button when not recording", () => {
    render(<RecordPanel />);
    expect(screen.getByLabelText(/start recording/i)).toBeInTheDocument();
  });

  it("renders the STOP button when recording", () => {
    useRecorderStore.setState({ isRecording: true });
    render(<RecordPanel />);
    expect(screen.getByLabelText(/stop recording/i)).toBeInTheDocument();
  });

  it("renders monitoring toggle checkbox", () => {
    render(<RecordPanel />);
    expect(screen.getByLabelText(/enable monitoring/i)).toBeInTheDocument();
  });

  it("clicking REC calls startRecording IPC", async () => {
    render(<RecordPanel />);
    const recBtn = screen.getByLabelText(/start recording/i);
    await act(async () => {
      fireEvent.click(recBtn);
    });
    expect(ipc.startRecording).toHaveBeenCalledTimes(1);
  });

  it("clicking STOP when recording calls stopRecording IPC", async () => {
    useRecorderStore.setState({ isRecording: true });
    render(<RecordPanel />);
    const stopBtn = screen.getByLabelText(/stop recording/i);
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    expect(ipc.stopRecording).toHaveBeenCalledTimes(1);
  });

  it("monitoring checkbox toggle calls setMonitoringEnabled", async () => {
    render(<RecordPanel />);
    const checkbox = screen.getByLabelText(/enable monitoring/i);
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(ipc.setMonitoringEnabled).toHaveBeenCalledWith(true);
  });

  it("shows output path filename after recording", () => {
    useRecorderStore.setState({ outputPath: "/tmp/rec_test.wav" });
    render(<RecordPanel />);
    expect(screen.getByLabelText("Output path")).toBeInTheDocument();
    expect(screen.getByText("rec_test.wav")).toBeInTheDocument();
  });

  it("shows error message when error is set", () => {
    useRecorderStore.setState({ error: "Device not found" });
    render(<RecordPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("Device not found");
  });

  it("clicking error dismisses it", async () => {
    useRecorderStore.setState({ error: "Some error" });
    render(<RecordPanel />);
    const alert = screen.getByRole("alert");
    await act(async () => {
      fireEvent.click(alert);
    });
    expect(useRecorderStore.getState().error).toBeNull();
  });

  it("REC button is disabled when finalizing", () => {
    useRecorderStore.setState({ isFinalizing: true });
    render(<RecordPanel />);
    const btn = screen.getByLabelText(/start recording/i);
    expect(btn).toBeDisabled();
  });

  it("shows finalizing text during finalization", () => {
    useRecorderStore.setState({ isFinalizing: true });
    render(<RecordPanel />);
    expect(screen.getByText(/finalizing/i)).toBeInTheDocument();
  });

  it("input device dropdown shows fetched devices", () => {
    useRecorderStore.setState({
      inputDevices: [
        {
          name: "USB Microphone",
          host_type: "Wasapi",
          is_input: true,
          is_output: false,
          supported_sample_rates: [44100],
          supported_buffer_sizes: [256],
        },
      ],
    });
    render(<RecordPanel />);
    expect(screen.getByText("USB Microphone")).toBeInTheDocument();
  });

  it("selecting a device calls setInputDevice IPC", async () => {
    useRecorderStore.setState({
      inputDevices: [
        {
          name: "USB Mic",
          host_type: "Wasapi",
          is_input: true,
          is_output: false,
          supported_sample_rates: [44100],
          supported_buffer_sizes: [256],
        },
      ],
    });
    render(<RecordPanel />);
    const select = screen.getByLabelText("Input device") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "USB Mic" } });
    });
    expect(ipc.setInputDevice).toHaveBeenCalledWith("USB Mic");
  });

  it("level meter width reflects inputLevel", () => {
    useRecorderStore.setState({ inputLevel: 0.5 });
    render(<RecordPanel />);
    const meter = screen.getByRole("meter", { name: /input level/i });
    const bar = meter.firstElementChild as HTMLElement;
    expect(bar.style.width).toBe("50%");
  });
});
