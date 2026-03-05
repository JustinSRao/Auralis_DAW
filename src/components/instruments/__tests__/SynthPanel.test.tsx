import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock the synth store ─────────────────────────────────────────────────────
// The mock must be defined at module level with vi.mock (hoisted before imports).
const mockInitialize = vi.fn();
const mockSetParam = vi.fn();
const mockFetchState = vi.fn();
const mockClearError = vi.fn();

const DEFAULT_PARAMS = {
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

// Default store state returned to the component
let mockStoreState = {
  params: { ...DEFAULT_PARAMS },
  isInitialized: true,
  isLoading: false,
  error: null as string | null,
  initialize: mockInitialize,
  setParam: mockSetParam,
  fetchState: mockFetchState,
  clearError: mockClearError,
};

vi.mock("../../../stores/synthStore", () => ({
  useSynthStore: () => mockStoreState,
}));

// ── Mock the LFO store (used by LfoPanel rendered inside SynthPanel) ──────────
const DEFAULT_LFO_PARAMS = {
  rate: 1.0,
  depth: 0.0,
  waveform: 0,
  bpm_sync: 0,
  division: 1,
  phase_reset: 0,
  destination: 0,
};

vi.mock("../../../stores/lfoStore", () => ({
  useLfoStore: () => ({
    lfo1: { ...DEFAULT_LFO_PARAMS },
    lfo2: { ...DEFAULT_LFO_PARAMS },
    error: null,
    setLfoParam: vi.fn(),
    fetchLfoState: vi.fn(),
    clearError: vi.fn(),
  }),
}));

import { SynthPanel } from "../SynthPanel";

describe("SynthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      params: { ...DEFAULT_PARAMS },
      isInitialized: true,
      isLoading: false,
      error: null,
      initialize: mockInitialize,
      setParam: mockSetParam,
      fetchState: mockFetchState,
      clearError: mockClearError,
    };
  });

  it("renders oscillator section label", () => {
    render(<SynthPanel />);
    expect(screen.getByText(/oscillator/i)).toBeTruthy();
  });

  it("renders envelope section label", () => {
    render(<SynthPanel />);
    expect(screen.getByText(/envelope/i)).toBeTruthy();
  });

  it("renders filter section label", () => {
    render(<SynthPanel />);
    expect(screen.getByText(/filter/i)).toBeTruthy();
  });

  it("renders output section label", () => {
    render(<SynthPanel />);
    expect(screen.getByText(/output/i)).toBeTruthy();
  });

  it("renders all 4 waveform buttons", () => {
    render(<SynthPanel />);
    // Use getAllByText because LfoPanel also renders some of the same labels (SQR, TRI)
    expect(screen.getAllByText("SAW").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("SQR").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("SIN")).toBeTruthy();
    expect(screen.getAllByText("TRI").length).toBeGreaterThanOrEqual(1);
  });

  it("renders Attack knob label", () => {
    render(<SynthPanel />);
    expect(screen.getByText("Attack")).toBeTruthy();
  });

  it("renders Decay knob label", () => {
    render(<SynthPanel />);
    expect(screen.getByText("Decay")).toBeTruthy();
  });

  it("renders Sustain knob label", () => {
    render(<SynthPanel />);
    expect(screen.getByText("Sustain")).toBeTruthy();
  });

  it("renders Release knob label", () => {
    render(<SynthPanel />);
    expect(screen.getByText("Release")).toBeTruthy();
  });

  it("renders Cutoff knob label", () => {
    render(<SynthPanel />);
    expect(screen.getByText("Cutoff")).toBeTruthy();
  });

  it("renders Resonance knob label", () => {
    render(<SynthPanel />);
    expect(screen.getByText("Res")).toBeTruthy();
  });

  it("renders Volume knob label", () => {
    render(<SynthPanel />);
    expect(screen.getByText("Volume")).toBeTruthy();
  });

  it("shows error message when error is set", () => {
    mockStoreState = { ...mockStoreState, error: "Synth init failed" };
    render(<SynthPanel />);
    expect(screen.getByText("Synth init failed")).toBeTruthy();
  });

  it("shows loading indicator while initialising", () => {
    mockStoreState = {
      ...mockStoreState,
      isLoading: true,
      isInitialized: false,
    };
    render(<SynthPanel />);
    expect(screen.getByText(/initialising/i)).toBeTruthy();
  });

  it("calls initialize on mount when not initialized", () => {
    mockStoreState = {
      ...mockStoreState,
      isInitialized: false,
      isLoading: false,
    };
    render(<SynthPanel />);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("does not call initialize when already initialized", () => {
    mockStoreState = { ...mockStoreState, isInitialized: true };
    render(<SynthPanel />);
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("renders LFO 1 panel inside SynthPanel", () => {
    render(<SynthPanel />);
    expect(screen.getByText("LFO 1")).toBeTruthy();
  });

  it("renders LFO 2 panel inside SynthPanel", () => {
    render(<SynthPanel />);
    expect(screen.getByText("LFO 2")).toBeTruthy();
  });
});
