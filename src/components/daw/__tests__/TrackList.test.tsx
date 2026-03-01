import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackList } from "../TrackList";
import type { DawTrack } from "@/stores/trackStore";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateTrack = vi.fn();

let mockTrackState = {
  tracks: [] as DawTrack[],
  selectedTrackId: null as string | null,
  isLoading: false,
  error: null as string | null,
  createTrack: mockCreateTrack,
  deleteTrack: vi.fn(),
  renameTrack: vi.fn(),
  reorderTracks: vi.fn(),
  setTrackColor: vi.fn(),
  selectTrack: vi.fn(),
  toggleMute: vi.fn(),
  toggleSolo: vi.fn(),
  toggleArm: vi.fn(),
  clearError: vi.fn(),
};

vi.mock("@/stores/trackStore", () => ({
  useTrackStore: (selector?: (s: typeof mockTrackState) => unknown) => {
    if (typeof selector === "function") {
      return selector(mockTrackState);
    }
    return mockTrackState;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTrack(id: string, name: string, kind: DawTrack["kind"] = "Midi"): DawTrack {
  return {
    id,
    name,
    kind,
    color: "#6c63ff",
    volume: 0.8,
    pan: 0.0,
    muted: false,
    soloed: false,
    armed: false,
    instrumentId: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks(overrides: Partial<typeof mockTrackState> = {}) {
  mockCreateTrack.mockReset();
  mockTrackState = {
    tracks: [],
    selectedTrackId: null,
    isLoading: false,
    error: null,
    createTrack: mockCreateTrack,
    deleteTrack: vi.fn(),
    renameTrack: vi.fn(),
    reorderTracks: vi.fn(),
    setTrackColor: vi.fn(),
    selectTrack: vi.fn(),
    toggleMute: vi.fn(),
    toggleSolo: vi.fn(),
    toggleArm: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TrackList", () => {
  beforeEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('renders "No tracks" empty state when tracks is empty', () => {
    resetMocks({ tracks: [] });
    render(<TrackList />);
    expect(screen.getByText(/no tracks/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Track rendering
  // -------------------------------------------------------------------------

  it("renders one TrackHeader per track", () => {
    resetMocks({
      tracks: [
        makeTrack("t1", "Bass", "Midi"),
        makeTrack("t2", "Guitar", "Audio"),
        makeTrack("t3", "Synth", "Instrument"),
      ],
    });
    render(<TrackList />);
    expect(screen.getByText("Bass")).toBeInTheDocument();
    expect(screen.getByText("Guitar")).toBeInTheDocument();
    expect(screen.getByText("Synth")).toBeInTheDocument();
  });

  it("does not render empty-state text when tracks are present", () => {
    resetMocks({ tracks: [makeTrack("t1", "Piano")] });
    render(<TrackList />);
    expect(screen.queryByText(/no tracks/i)).not.toBeInTheDocument();
  });

  it("renders the correct number of track headers", () => {
    resetMocks({
      tracks: [
        makeTrack("t1", "Kick"),
        makeTrack("t2", "Snare"),
      ],
    });
    render(<TrackList />);
    // Two track names should be visible
    expect(screen.getByText("Kick")).toBeInTheDocument();
    expect(screen.getByText("Snare")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Add track button
  // -------------------------------------------------------------------------

  it('an "add track" button ("+") is present', () => {
    render(<TrackList />);
    const addButton =
      screen.queryByRole("button", { name: /add track/i }) ??
      screen.queryByRole("button", { name: /\+/i }) ??
      screen.queryByText("+");
    expect(addButton).not.toBeNull();
  });

  it('clicking the "+" button opens a track type selection UI', () => {
    render(<TrackList />);

    const addButton =
      screen.queryByRole("button", { name: /add track/i }) ??
      screen.queryByRole("button", { name: /\+/i }) ??
      screen.getByText("+");

    fireEvent.click(addButton as Element);

    // After clicking, the track type options should appear in the DOM.
    // The implementation may show a dropdown, popover, or inline buttons.
    const midiOption =
      screen.queryByText(/midi/i) ??
      screen.queryByRole("option", { name: /midi/i }) ??
      screen.queryByRole("menuitem", { name: /midi/i }) ??
      screen.queryByRole("button", { name: /midi/i });

    const audioOption =
      screen.queryByText(/audio/i) ??
      screen.queryByRole("option", { name: /audio/i }) ??
      screen.queryByRole("menuitem", { name: /audio/i }) ??
      screen.queryByRole("button", { name: /audio/i });

    // At least one track type option must become visible
    expect(midiOption ?? audioOption).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Track type dropdown — createTrack called with correct kind
  // -------------------------------------------------------------------------

  it('clicking "MIDI Track" option calls createTrack("Midi")', async () => {
    mockCreateTrack.mockResolvedValue(undefined);
    render(<TrackList />);

    // Open the dropdown
    const addButton =
      screen.queryByRole("button", { name: /add track/i }) ??
      screen.getByText("+");
    fireEvent.click(addButton as Element);

    // Click the MIDI Track option
    const midiButton = screen.getByRole("button", { name: /midi track/i });
    fireEvent.click(midiButton);

    expect(mockCreateTrack).toHaveBeenCalledWith("Midi");
  });

  it('clicking "Audio Track" option calls createTrack("Audio")', async () => {
    mockCreateTrack.mockResolvedValue(undefined);
    render(<TrackList />);

    const addButton =
      screen.queryByRole("button", { name: /add track/i }) ??
      screen.getByText("+");
    fireEvent.click(addButton as Element);

    const audioButton = screen.getByRole("button", { name: /audio track/i });
    fireEvent.click(audioButton);

    expect(mockCreateTrack).toHaveBeenCalledWith("Audio");
  });

  it('clicking "Instrument Track" option calls createTrack("Instrument")', async () => {
    mockCreateTrack.mockResolvedValue(undefined);
    render(<TrackList />);

    const addButton =
      screen.queryByRole("button", { name: /add track/i }) ??
      screen.getByText("+");
    fireEvent.click(addButton as Element);

    const instrumentButton = screen.getByRole("button", {
      name: /instrument track/i,
    });
    fireEvent.click(instrumentButton);

    expect(mockCreateTrack).toHaveBeenCalledWith("Instrument");
  });
});
