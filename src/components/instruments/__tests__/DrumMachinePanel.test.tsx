import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mock Tauri event listener ─────────────────────────────────────────────────
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// ── Mock drum machine store ───────────────────────────────────────────────────

const mockInitialize = vi.fn();
const mockToggleStep = vi.fn();
const mockSetStepVelocity = vi.fn();
const mockLoadPadSample = vi.fn();
const mockSetSwing = vi.fn();
const mockSetBpm = vi.fn();
const mockSetPatternLength = vi.fn();
const mockPlay = vi.fn();
const mockStop = vi.fn();
const mockReset = vi.fn();
const mockSetCurrentStep = vi.fn();
const mockClearError = vi.fn();

function makeDefaultSnapshot() {
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
  };
}

let mockStoreState = {
  snapshot: makeDefaultSnapshot(),
  isInitialized: true,
  isLoading: false,
  error: null as string | null,
  initialize: mockInitialize,
  fetchState: vi.fn(),
  toggleStep: mockToggleStep,
  setStepVelocity: mockSetStepVelocity,
  loadPadSample: mockLoadPadSample,
  setSwing: mockSetSwing,
  setBpm: mockSetBpm,
  setPatternLength: mockSetPatternLength,
  play: mockPlay,
  stop: mockStop,
  reset: mockReset,
  setCurrentStep: mockSetCurrentStep,
  clearError: mockClearError,
};

vi.mock("../../../stores/drumMachineStore", () => ({
  useDrumMachineStore: () => mockStoreState,
}));

import { DrumMachinePanel } from "../DrumMachinePanel";

describe("DrumMachinePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      snapshot: makeDefaultSnapshot(),
      isInitialized: true,
      isLoading: false,
      error: null,
      initialize: mockInitialize,
      fetchState: vi.fn(),
      toggleStep: mockToggleStep,
      setStepVelocity: mockSetStepVelocity,
      loadPadSample: mockLoadPadSample,
      setSwing: mockSetSwing,
      setBpm: mockSetBpm,
      setPatternLength: mockSetPatternLength,
      play: mockPlay,
      stop: mockStop,
      reset: mockReset,
      setCurrentStep: mockSetCurrentStep,
      clearError: mockClearError,
    };
  });

  it("renders 16 pad rows", () => {
    render(<DrumMachinePanel />);
    const dropTargets = screen.getAllByLabelText(/drop sample onto pad/i);
    expect(dropTargets).toHaveLength(16);
  });

  it("renders play button", () => {
    render(<DrumMachinePanel />);
    expect(screen.getByLabelText("Play")).toBeTruthy();
  });

  it("renders stop button", () => {
    render(<DrumMachinePanel />);
    expect(screen.getByLabelText("Stop")).toBeTruthy();
  });

  it("renders reset button", () => {
    render(<DrumMachinePanel />);
    expect(screen.getByLabelText("Reset")).toBeTruthy();
  });

  it("renders BPM input with default value", () => {
    render(<DrumMachinePanel />);
    const bpmInput = screen.getByLabelText("BPM") as HTMLInputElement;
    expect(bpmInput).toBeTruthy();
    expect(bpmInput.value).toBe("120");
  });

  it("renders pattern length selector", () => {
    render(<DrumMachinePanel />);
    const select = screen.getByLabelText("Pattern length") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("16");
  });

  it("renders swing knob label", () => {
    render(<DrumMachinePanel />);
    expect(screen.getByText("Swing")).toBeTruthy();
  });

  it("clicking play calls play()", () => {
    render(<DrumMachinePanel />);
    fireEvent.click(screen.getByLabelText("Play"));
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("clicking stop calls stop()", () => {
    mockStoreState = { ...mockStoreState, snapshot: { ...mockStoreState.snapshot, playing: true } };
    render(<DrumMachinePanel />);
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("clicking reset calls reset()", () => {
    render(<DrumMachinePanel />);
    fireEvent.click(screen.getByLabelText("Reset"));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("clicking a step button calls toggleStep", () => {
    render(<DrumMachinePanel />);
    // Find the first step button (pad 0, step 0)
    const stepButtons = screen.getAllByRole("button", { name: /step off/i });
    fireEvent.click(stepButtons[0]);
    expect(mockToggleStep).toHaveBeenCalledWith(0, 0);
  });

  it("shows loading indicator while loading", () => {
    mockStoreState = { ...mockStoreState, isLoading: true, isInitialized: false };
    render(<DrumMachinePanel />);
    expect(screen.getByText(/loading drum machine/i)).toBeTruthy();
  });

  it("calls initialize on mount when not initialized", () => {
    mockStoreState = { ...mockStoreState, isInitialized: false, isLoading: false };
    render(<DrumMachinePanel />);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("does not call initialize when already initialized", () => {
    mockStoreState = { ...mockStoreState, isInitialized: true };
    render(<DrumMachinePanel />);
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("shows error message when error is set", () => {
    mockStoreState = { ...mockStoreState, error: "Failed to load sample" };
    render(<DrumMachinePanel />);
    expect(screen.getByText("Failed to load sample")).toBeTruthy();
  });

  it("renders pattern length option 32 in selector", () => {
    render(<DrumMachinePanel />);
    const select = screen.getByLabelText("Pattern length");
    const options = select.querySelectorAll("option");
    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain("32");
  });

  it("changing pattern length calls setPatternLength", () => {
    render(<DrumMachinePanel />);
    const select = screen.getByLabelText("Pattern length");
    fireEvent.change(select, { target: { value: "32" } });
    expect(mockSetPatternLength).toHaveBeenCalledWith(32);
  });

  it("renders pad with loaded sample name", () => {
    mockStoreState = {
      ...mockStoreState,
      snapshot: {
        ...mockStoreState.snapshot,
        pads: mockStoreState.snapshot.pads.map((p, i) =>
          i === 0
            ? { ...p, name: "kick.wav", has_sample: true }
            : p
        ),
      },
    };
    render(<DrumMachinePanel />);
    expect(screen.getByTitle("kick.wav")).toBeTruthy();
  });
});
