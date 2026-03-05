import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mock the LFO store ────────────────────────────────────────────────────────

const mockSetLfoParam = vi.fn();
const mockFetchLfoState = vi.fn();
const mockClearError = vi.fn();

const DEFAULT_LFO_PARAMS = {
  rate: 1.0,
  depth: 0.0,
  waveform: 0,
  bpm_sync: 0,
  division: 1,
  phase_reset: 0,
  destination: 0,
};

let mockStoreState = {
  lfo1: { ...DEFAULT_LFO_PARAMS },
  lfo2: { ...DEFAULT_LFO_PARAMS },
  error: null as string | null,
  setLfoParam: mockSetLfoParam,
  fetchLfoState: mockFetchLfoState,
  clearError: mockClearError,
};

vi.mock("../../../stores/lfoStore", () => ({
  useLfoStore: () => mockStoreState,
}));

import { LfoPanel } from "../LfoPanel";

describe("LfoPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      lfo1: { ...DEFAULT_LFO_PARAMS },
      lfo2: { ...DEFAULT_LFO_PARAMS },
      error: null,
      setLfoParam: mockSetLfoParam,
      fetchLfoState: mockFetchLfoState,
      clearError: mockClearError,
    };
  });

  // ── Heading ────────────────────────────────────────────────────────────────

  it("renders LFO 1 heading when slot=1", () => {
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("LFO 1")).toBeTruthy();
  });

  it("renders LFO 2 heading when slot=2", () => {
    render(<LfoPanel slot={2} />);
    expect(screen.getByText("LFO 2")).toBeTruthy();
  });

  // ── Waveform buttons ───────────────────────────────────────────────────────

  it("renders all 6 waveform buttons for slot=1", () => {
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("SINE")).toBeTruthy();
    expect(screen.getByText("TRI")).toBeTruthy();
    // Unicode arrow characters
    expect(screen.getByText("SAW\u2191")).toBeTruthy();
    expect(screen.getByText("SAW\u2193")).toBeTruthy();
    expect(screen.getByText("SQR")).toBeTruthy();
    expect(screen.getByText("S&H")).toBeTruthy();
  });

  it("renders all 6 waveform buttons for slot=2", () => {
    render(<LfoPanel slot={2} />);
    expect(screen.getByText("SINE")).toBeTruthy();
    expect(screen.getByText("TRI")).toBeTruthy();
    expect(screen.getByText("SAW\u2191")).toBeTruthy();
    expect(screen.getByText("SAW\u2193")).toBeTruthy();
    expect(screen.getByText("SQR")).toBeTruthy();
    expect(screen.getByText("S&H")).toBeTruthy();
  });

  // ── Destination buttons ────────────────────────────────────────────────────

  it("renders all 4 destination buttons", () => {
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("CUTOFF")).toBeTruthy();
    expect(screen.getByText("PITCH")).toBeTruthy();
    expect(screen.getByText("AMP")).toBeTruthy();
    expect(screen.getByText("RES")).toBeTruthy();
  });

  // ── Knob labels ────────────────────────────────────────────────────────────

  it("renders RATE knob label", () => {
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("RATE")).toBeTruthy();
  });

  it("renders DEPTH knob label", () => {
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("DEPTH")).toBeTruthy();
  });

  // ── Toggle buttons ─────────────────────────────────────────────────────────

  it("renders BPM SYNC button", () => {
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("BPM SYNC")).toBeTruthy();
  });

  it("renders PHASE RST button", () => {
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("PHASE RST")).toBeTruthy();
  });

  // ── Division selector visibility ───────────────────────────────────────────

  it("does not render division selector when bpm_sync=0", () => {
    mockStoreState = {
      ...mockStoreState,
      lfo1: { ...DEFAULT_LFO_PARAMS, bpm_sync: 0 },
    };
    render(<LfoPanel slot={1} />);
    expect(screen.queryByText("1/4")).toBeNull();
    expect(screen.queryByText("1/8")).toBeNull();
    expect(screen.queryByText("1/16")).toBeNull();
    expect(screen.queryByText("1/32")).toBeNull();
  });

  it("renders division selector when bpm_sync=1", () => {
    mockStoreState = {
      ...mockStoreState,
      lfo1: { ...DEFAULT_LFO_PARAMS, bpm_sync: 1 },
    };
    render(<LfoPanel slot={1} />);
    expect(screen.getByText("1/4")).toBeTruthy();
    expect(screen.getByText("1/8")).toBeTruthy();
    expect(screen.getByText("1/16")).toBeTruthy();
    expect(screen.getByText("1/32")).toBeTruthy();
  });

  it("does not render division selector for slot=2 when bpm_sync=0", () => {
    mockStoreState = {
      ...mockStoreState,
      lfo2: { ...DEFAULT_LFO_PARAMS, bpm_sync: 0 },
    };
    render(<LfoPanel slot={2} />);
    expect(screen.queryByTestId("lfo-division-2")).toBeNull();
  });

  it("renders division selector for slot=2 when bpm_sync=1", () => {
    mockStoreState = {
      ...mockStoreState,
      lfo2: { ...DEFAULT_LFO_PARAMS, bpm_sync: 1 },
    };
    render(<LfoPanel slot={2} />);
    expect(screen.getByTestId("lfo-division-2")).toBeTruthy();
  });

  // ── Button click interactions ───────────────────────────────────────────────

  it("clicking TRI waveform button calls setLfoParam(1, 'waveform', 1)", () => {
    render(<LfoPanel slot={1} />);
    fireEvent.click(screen.getByText("TRI"));
    expect(mockSetLfoParam).toHaveBeenCalledWith(1, "waveform", 1);
  });

  it("clicking PITCH destination button calls setLfoParam(1, 'destination', 1)", () => {
    render(<LfoPanel slot={1} />);
    fireEvent.click(screen.getByText("PITCH"));
    expect(mockSetLfoParam).toHaveBeenCalledWith(1, "destination", 1);
  });

  it("clicking BPM SYNC button calls setLfoParam(1, 'bpm_sync', 1) when currently off", () => {
    // bpm_sync defaults to 0 (off)
    render(<LfoPanel slot={1} />);
    fireEvent.click(screen.getByText("BPM SYNC"));
    expect(mockSetLfoParam).toHaveBeenCalledWith(1, "bpm_sync", 1);
  });

  it("clicking waveform button uses correct slot for slot=2", () => {
    render(<LfoPanel slot={2} />);
    fireEvent.click(screen.getByText("TRI"));
    expect(mockSetLfoParam).toHaveBeenCalledWith(2, "waveform", 1);
  });

  it("calls fetchLfoState once on mount when slot=1", () => {
    render(<LfoPanel slot={1} />);
    expect(mockFetchLfoState).toHaveBeenCalledTimes(1);
  });

  it("does not call fetchLfoState on mount when slot=2", () => {
    render(<LfoPanel slot={2} />);
    expect(mockFetchLfoState).not.toHaveBeenCalled();
  });
});
