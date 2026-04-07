import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mock the sampler store ────────────────────────────────────────────────────

const mockInitialize = vi.fn();
const mockSetParam = vi.fn();
const mockLoadZone = vi.fn();
const mockRemoveZone = vi.fn();
const mockFetchState = vi.fn();
const mockClearError = vi.fn();

const DEFAULT_PARAMS = {
  attack: 0.01,
  decay: 0.1,
  sustain: 1.0,
  release: 0.3,
  volume: 0.8,
};

let mockStoreState = {
  params: { ...DEFAULT_PARAMS },
  zones: [] as Array<{
    id: number;
    name: string;
    root_note: number;
    min_note: number;
    max_note: number;
    loop_start: number;
    loop_end: number;
    loop_enabled: boolean;
  }>,
  nextZoneId: 0,
  isInitialized: true,
  isLoading: false,
  error: null as string | null,
  initialize: mockInitialize,
  setParam: mockSetParam,
  loadZone: mockLoadZone,
  removeZone: mockRemoveZone,
  fetchState: mockFetchState,
  clearError: mockClearError,
};

vi.mock("../../../stores/samplerStore", () => ({
  useSamplerStore: () => mockStoreState,
}));

vi.mock("../../../hooks/usePresets", () => ({
  usePresets: () => ({
    presets: [],
    filteredPresets: [],
    isLoading: false,
    error: null,
    fetchPresets: vi.fn(),
    captureAndSave: vi.fn(),
    loadAndApply: vi.fn(),
    deletePreset: vi.fn(),
  }),
}));

import { SamplerPanel } from "../SamplerPanel";

describe("SamplerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      params: { ...DEFAULT_PARAMS },
      zones: [],
      nextZoneId: 0,
      isInitialized: true,
      isLoading: false,
      error: null,
      initialize: mockInitialize,
      setParam: mockSetParam,
      loadZone: mockLoadZone,
      removeZone: mockRemoveZone,
      fetchState: mockFetchState,
      clearError: mockClearError,
    };
  });

  it("renders Load Zone section label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText(/load zone/i)).toBeTruthy();
  });

  it("renders Envelope section label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText(/envelope/i)).toBeTruthy();
  });

  it("renders Output section label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText(/output/i)).toBeTruthy();
  });

  it("renders Attack knob label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText("Attack")).toBeTruthy();
  });

  it("renders Decay knob label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText("Decay")).toBeTruthy();
  });

  it("renders Sustain knob label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText("Sustain")).toBeTruthy();
  });

  it("renders Release knob label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText("Release")).toBeTruthy();
  });

  it("renders Volume knob label", () => {
    render(<SamplerPanel />);
    expect(screen.getByText("Volume")).toBeTruthy();
  });

  it("shows 'No zones' when zones array is empty", () => {
    render(<SamplerPanel />);
    expect(screen.getByText(/no zones/i)).toBeTruthy();
  });

  it("renders drop target with correct aria-label", () => {
    render(<SamplerPanel />);
    expect(
      screen.getByLabelText(/drop audio file to load as zone/i),
    ).toBeTruthy();
  });

  it("shows zone count when zones are loaded", () => {
    mockStoreState = {
      ...mockStoreState,
      zones: [
        {
          id: 0,
          name: "piano.wav",
          root_note: 60,
          min_note: 0,
          max_note: 127,
          loop_start: 0,
          loop_end: 0,
          loop_enabled: false,
        },
      ],
    };
    render(<SamplerPanel />);
    expect(screen.getByText(/1 zone/i)).toBeTruthy();
  });

  it("renders zone name in zone list", () => {
    mockStoreState = {
      ...mockStoreState,
      zones: [
        {
          id: 0,
          name: "piano.wav",
          root_note: 60,
          min_note: 0,
          max_note: 127,
          loop_start: 0,
          loop_end: 0,
          loop_enabled: false,
        },
      ],
    };
    render(<SamplerPanel />);
    expect(screen.getByText("piano.wav")).toBeTruthy();
  });

  it("calls removeZone when zone remove button is clicked", () => {
    mockStoreState = {
      ...mockStoreState,
      zones: [
        {
          id: 42,
          name: "kick.wav",
          root_note: 36,
          min_note: 36,
          max_note: 36,
          loop_start: 0,
          loop_end: 0,
          loop_enabled: false,
        },
      ],
    };
    render(<SamplerPanel />);
    const removeBtn = screen.getByLabelText(/remove zone kick\.wav/i);
    fireEvent.click(removeBtn);
    expect(mockRemoveZone).toHaveBeenCalledWith(42);
  });

  it("shows error message when error is set", () => {
    mockStoreState = { ...mockStoreState, error: "Failed to load sample" };
    render(<SamplerPanel />);
    expect(screen.getByText("Failed to load sample")).toBeTruthy();
  });

  it("shows loading indicator while loading", () => {
    mockStoreState = { ...mockStoreState, isLoading: true, isInitialized: false };
    render(<SamplerPanel />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("calls initialize on mount when not initialized", () => {
    mockStoreState = { ...mockStoreState, isInitialized: false, isLoading: false };
    render(<SamplerPanel />);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("does not call initialize when already initialized", () => {
    mockStoreState = { ...mockStoreState, isInitialized: true };
    render(<SamplerPanel />);
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("renders plural 'zones' for multiple zones", () => {
    mockStoreState = {
      ...mockStoreState,
      zones: [
        { id: 0, name: "a.wav", root_note: 60, min_note: 0, max_note: 63, loop_start: 0, loop_end: 0, loop_enabled: false },
        { id: 1, name: "b.wav", root_note: 60, min_note: 64, max_note: 127, loop_start: 0, loop_end: 0, loop_enabled: false },
      ],
    };
    render(<SamplerPanel />);
    expect(screen.getByText(/2 zones/i)).toBeTruthy();
  });
});
