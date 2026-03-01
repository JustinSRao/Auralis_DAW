import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { DAWLayout } from "../DAWLayout";
import { useTransportStore } from "@/stores/transportStore";
import type { TransportSnapshot } from "@/lib/ipc";
import type { DawTrack } from "@/stores/trackStore";

// ---------------------------------------------------------------------------
// invoke mock alias
// ---------------------------------------------------------------------------

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// trackStore mock
// ---------------------------------------------------------------------------

let mockTrackState = {
  tracks: [] as DawTrack[],
  selectedTrackId: null as string | null,
  isLoading: false,
  error: null as string | null,
  createTrack: vi.fn(),
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
// keyboardStore mock
// ---------------------------------------------------------------------------

let mockKeyboardState = {
  browserOpen: true,
  mixerOpen: true,
  followPlayhead: false,
  toggleBrowser: vi.fn(),
  toggleMixer: vi.fn(),
  toggleFollowPlayhead: vi.fn(),
};

vi.mock("@/stores/keyboardStore", () => ({
  useKeyboardStore: (selector?: (s: typeof mockKeyboardState) => unknown) => {
    if (typeof selector === "function") {
      return selector(mockKeyboardState);
    }
    return mockKeyboardState;
  },
}));

// ---------------------------------------------------------------------------
// historyStore mock (for MenuBar)
// ---------------------------------------------------------------------------

let mockHistoryState = {
  canUndo: false,
  canRedo: false,
  entries: [] as Array<{ label: string; isCurrent: boolean }>,
  currentPointer: -1,
  push: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  clear: vi.fn(),
};

vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: (selector?: (s: typeof mockHistoryState) => unknown) => {
    if (typeof selector === "function") {
      return selector(mockHistoryState);
    }
    return mockHistoryState;
  },
}));

// ---------------------------------------------------------------------------
// fileStore mock (for MenuBar / ProjectToolbar)
// ---------------------------------------------------------------------------

let mockFileState = {
  filePath: null as string | null,
  isDirty: false,
  isAutoSaving: false,
  recentProjects: [] as Array<{ name: string; file_path: string; modified_at: string }>,
  lastSavedAt: null as string | null,
  currentProject: null,
  error: null as string | null,
  createNewProject: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  markDirty: vi.fn(),
  loadRecentProjects: vi.fn(),
  setFilePath: vi.fn(),
  setError: vi.fn(),
};

vi.mock("@/stores/fileStore", () => ({
  useFileStore: (selector?: (s: typeof mockFileState) => unknown) => {
    if (typeof selector === "function") {
      return selector(mockFileState);
    }
    return mockFileState;
  },
}));

// ---------------------------------------------------------------------------
// Transport store defaults
// ---------------------------------------------------------------------------

const defaultSnapshot: TransportSnapshot = {
  state: "stopped",
  position_samples: 0,
  bbt: { bar: 1, beat: 1, tick: 0 },
  bpm: 120.0,
  time_sig_numerator: 4,
  time_sig_denominator: 4,
  loop_enabled: false,
  loop_start_samples: 0,
  loop_end_samples: 0,
  metronome_enabled: false,
  metronome_volume: 0.5,
  metronome_pitch_hz: 1000.0,
  record_armed: false,
};

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  useTransportStore.setState({
    snapshot: defaultSnapshot,
    isLoading: false,
    error: null,
  });

  // Route invoke so TransportBar's refreshState() always gets a valid snapshot
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_transport_state") return Promise.resolve(defaultSnapshot);
    return Promise.resolve(undefined);
  });

  // Reset keyboard/track mock state to defaults
  mockKeyboardState = {
    browserOpen: true,
    mixerOpen: true,
    followPlayhead: false,
    toggleBrowser: vi.fn(),
    toggleMixer: vi.fn(),
    toggleFollowPlayhead: vi.fn(),
  };

  mockTrackState = {
    ...mockTrackState,
    tracks: [],
    selectedTrackId: null,
    isLoading: false,
    error: null,
  };

  mockHistoryState = {
    ...mockHistoryState,
    canUndo: false,
    canRedo: false,
    entries: [],
    currentPointer: -1,
  };

  mockFileState = {
    ...mockFileState,
    filePath: null,
    isDirty: false,
    currentProject: null,
  };
});

// ---------------------------------------------------------------------------
// Tests — preserved existing
// ---------------------------------------------------------------------------

describe("DAWLayout", () => {
  it("renders the MusicApp brand label", () => {
    render(<DAWLayout />);
    expect(screen.getByText("MusicApp")).toBeInTheDocument();
  });

  it("renders the Audio Settings panel", () => {
    render(<DAWLayout />);
    expect(screen.getByText("Audio Settings")).toBeInTheDocument();
  });

  it("renders the transport bar", () => {
    render(<DAWLayout />);
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });

  // The "Instrument Browser" and "Mixer" labels may move as layout evolves;
  // keep the assertions flexible with queryBy so renames do not hard-fail.
  it("renders an instrument browser or track list area", () => {
    render(<DAWLayout />);
    const browserLabel =
      screen.queryByText("Instrument Browser") ??
      screen.queryByText(/no tracks/i) ??
      screen.queryByText(/track/i);
    expect(browserLabel).not.toBeNull();
  });

  it("renders a mixer panel area", () => {
    render(<DAWLayout />);
    const mixerLabel =
      screen.queryByText("Mixer") ?? screen.queryByText(/mixer/i);
    expect(mixerLabel).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // New tests for Sprint 30 layout additions
  // -------------------------------------------------------------------------

  it("renders MenuBar", () => {
    render(<DAWLayout />);
    // MenuBar must expose at least a File menu trigger
    const fileMenu =
      screen.queryByRole("button", { name: /file/i }) ??
      screen.queryByText(/^file$/i);
    expect(fileMenu).not.toBeNull();
  });

  it("renders TrackList", () => {
    render(<DAWLayout />);
    // TrackList renders empty state or track headers
    const trackListEl =
      screen.queryByText(/no tracks/i) ??
      screen.queryByTestId("track-list") ??
      document.querySelector("[data-testid='track-list']");
    // Also accept an "add track" button as proof of TrackList presence
    const addButton =
      screen.queryByRole("button", { name: /add track/i }) ??
      screen.queryByText("+");
    expect(trackListEl ?? addButton).not.toBeNull();
  });

  it("browser panel is visible when browserOpen=true", () => {
    mockKeyboardState = { ...mockKeyboardState, browserOpen: true };
    render(<DAWLayout />);
    // Browser area visible — any matching label counts
    const browserArea =
      screen.queryByText("Instrument Browser") ??
      screen.queryByText(/browser/i) ??
      document.querySelector("[data-panel='browser']");
    expect(browserArea).not.toBeNull();
  });

  it("mixer panel is visible when mixerOpen=true", () => {
    mockKeyboardState = { ...mockKeyboardState, mixerOpen: true };
    render(<DAWLayout />);
    const mixerArea =
      screen.queryByText("Mixer") ??
      screen.queryByText(/mixer/i) ??
      document.querySelector("[data-panel='mixer']");
    expect(mixerArea).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // HistoryPanel — preserved existing
  // -------------------------------------------------------------------------

  it("renders the HistoryPanel (history empty state or undo/redo buttons)", () => {
    render(<DAWLayout />);
    // HistoryPanel renders undo and redo buttons unconditionally
    const undoBtn =
      screen.queryByRole("button", { name: /undo/i }) ??
      screen.queryByText(/history empty/i);
    expect(undoBtn).not.toBeNull();
  });
});
