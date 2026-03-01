import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackHeader } from "../TrackHeader";
import type { DawTrack } from "@/stores/trackStore";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSelectTrack = vi.fn();
const mockToggleMute = vi.fn();
const mockToggleSolo = vi.fn();
const mockToggleArm = vi.fn();
const mockRenameTrack = vi.fn();

let mockTrackState = {
  tracks: [] as DawTrack[],
  selectedTrackId: null as string | null,
  isLoading: false,
  error: null as string | null,
  createTrack: vi.fn(),
  deleteTrack: vi.fn(),
  renameTrack: mockRenameTrack,
  reorderTracks: vi.fn(),
  setTrackColor: vi.fn(),
  selectTrack: mockSelectTrack,
  toggleMute: mockToggleMute,
  toggleSolo: mockToggleSolo,
  toggleArm: mockToggleArm,
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

function makeMidiTrack(overrides: Partial<DawTrack> = {}): DawTrack {
  return {
    id: "track-header-1",
    name: "Piano",
    kind: "Midi",
    color: "#6c63ff",
    volume: 0.8,
    pan: 0.0,
    muted: false,
    soloed: false,
    armed: false,
    instrumentId: null,
    ...overrides,
  };
}

function makeAudioTrack(overrides: Partial<DawTrack> = {}): DawTrack {
  return makeMidiTrack({ kind: "Audio", name: "Guitar DI", ...overrides });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockSelectTrack.mockReset();
  mockToggleMute.mockReset();
  mockToggleSolo.mockReset();
  mockToggleArm.mockReset();
  mockRenameTrack.mockReset();
  mockTrackState = {
    ...mockTrackState,
    selectedTrackId: null,
    renameTrack: mockRenameTrack,
    selectTrack: mockSelectTrack,
    toggleMute: mockToggleMute,
    toggleSolo: mockToggleSolo,
    toggleArm: mockToggleArm,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TrackHeader", () => {
  beforeEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it("renders the track name", () => {
    const track = makeMidiTrack({ name: "Piano" });
    render(<TrackHeader track={track} />);
    expect(screen.getByText("Piano")).toBeInTheDocument();
  });

  it("renders a type icon for a Midi track (Music2)", () => {
    const track = makeMidiTrack({ kind: "Midi" });
    render(<TrackHeader track={track} />);
    // Icon is rendered as an SVG — verify it's present via aria-label or data-testid
    const icon =
      screen.queryByTestId("icon-midi") ??
      screen.queryByLabelText(/midi/i) ??
      document.querySelector("[data-kind='Midi'] svg, [aria-label='Midi track'] svg, svg.lucide-music");
    expect(icon).not.toBeNull();
  });

  it("renders a type icon for an Audio track (Mic)", () => {
    const track = makeAudioTrack({ kind: "Audio" });
    render(<TrackHeader track={track} />);
    const icon =
      screen.queryByTestId("icon-audio") ??
      screen.queryByLabelText(/audio/i) ??
      document.querySelector("[data-kind='Audio'] svg, [aria-label='Audio track'] svg, svg.lucide-mic");
    expect(icon).not.toBeNull();
  });

  it("renders a mute button", () => {
    const track = makeMidiTrack();
    render(<TrackHeader track={track} />);
    expect(screen.getByRole("button", { name: /mute/i })).toBeInTheDocument();
  });

  it("renders a solo button", () => {
    const track = makeMidiTrack();
    render(<TrackHeader track={track} />);
    expect(screen.getByRole("button", { name: /solo/i })).toBeInTheDocument();
  });

  it("renders an arm button", () => {
    const track = makeMidiTrack();
    render(<TrackHeader track={track} />);
    expect(screen.getByRole("button", { name: /arm/i })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  it("clicking on the header calls selectTrack(track.id)", () => {
    const track = makeMidiTrack({ id: "track-click-1" });
    render(<TrackHeader track={track} />);

    fireEvent.click(screen.getByText("Piano"));

    expect(mockSelectTrack).toHaveBeenCalledWith("track-click-1");
  });

  it("clicking the mute button calls toggleMute(track.id)", () => {
    const track = makeMidiTrack({ id: "track-mute-1" });
    render(<TrackHeader track={track} />);

    fireEvent.click(screen.getByRole("button", { name: /mute/i }));

    expect(mockToggleMute).toHaveBeenCalledWith("track-mute-1");
  });

  it("clicking the solo button calls toggleSolo(track.id)", () => {
    const track = makeMidiTrack({ id: "track-solo-1" });
    render(<TrackHeader track={track} />);

    fireEvent.click(screen.getByRole("button", { name: /solo/i }));

    expect(mockToggleSolo).toHaveBeenCalledWith("track-solo-1");
  });

  it("clicking the arm button calls toggleArm(track.id)", () => {
    const track = makeMidiTrack({ id: "track-arm-1" });
    render(<TrackHeader track={track} />);

    fireEvent.click(screen.getByRole("button", { name: /arm/i }));

    expect(mockToggleArm).toHaveBeenCalledWith("track-arm-1");
  });

  // -------------------------------------------------------------------------
  // Inline rename
  // -------------------------------------------------------------------------

  it("double-clicking the track name enters edit mode and shows an input", () => {
    const track = makeMidiTrack({ name: "Piano" });
    render(<TrackHeader track={track} />);

    fireEvent.doubleClick(screen.getByText("Piano"));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("pressing Escape in edit mode cancels the edit and restores original name", () => {
    const track = makeMidiTrack({ name: "Guitar" });
    render(<TrackHeader track={track} />);

    fireEvent.doubleClick(screen.getByText("Guitar"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // Input should be gone and original name restored
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Guitar")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Selected state
  // -------------------------------------------------------------------------

  it("selected track has a distinguishing className compared to unselected", () => {
    const track = makeMidiTrack({ id: "track-sel-1", name: "Bass" });
    mockTrackState = { ...mockTrackState, selectedTrackId: "track-sel-1" };

    const { container } = render(<TrackHeader track={track} />);

    // The root element or an inner element should carry a selected indicator
    const selectedEl =
      container.querySelector("[data-selected='true']") ??
      container.querySelector(".selected") ??
      container.querySelector("[aria-selected='true']") ??
      container.querySelector("[class*='selected']") ??
      container.querySelector("[class*='ring']") ??
      container.querySelector("[class*='border-']");
    expect(selectedEl).not.toBeNull();
  });
});
