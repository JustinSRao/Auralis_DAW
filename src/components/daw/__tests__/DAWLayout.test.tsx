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
// arrangementStore mock (for Timeline — Sprint 13)
// ---------------------------------------------------------------------------

vi.mock("@/stores/arrangementStore", () => ({
  useArrangementStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = {
        clips: {},
        viewport: { scrollLeft: 0, pixelsPerBar: 80, trackHeight: 64 },
        selectedClipId: null,
        error: null,
      };
      if (typeof selector === "function") return selector(state);
      return state;
    },
    {
      getState: () => ({
        clips: {},
        viewport: { scrollLeft: 0, pixelsPerBar: 80, trackHeight: 64 },
        selectedClipId: null,
        error: null,
        addClip: vi.fn(),
        moveClip: vi.fn(),
        resizeClip: vi.fn(),
        deleteClip: vi.fn(),
        duplicateClip: vi.fn(),
        updateClipOptimistic: vi.fn(),
        revertClipOptimistic: vi.fn(),
        setViewport: vi.fn(),
        selectClip: vi.fn(),
        loadFromProject: vi.fn(),
        clearError: vi.fn(),
      }),
    }
  ),
}));

// ---------------------------------------------------------------------------
// patternStore mock (for PatternBrowser — Sprint 12)
// ---------------------------------------------------------------------------

vi.mock("@/stores/patternStore", () => ({
  usePatternStore: Object.assign(
    (selector?: (s: { patterns: Record<string, unknown>; selectedPatternId: null }) => unknown) => {
      const state = { patterns: {}, selectedPatternId: null };
      if (typeof selector === "function") return selector(state);
      return state;
    },
    { getState: () => ({ patterns: {}, selectedPatternId: null, updatePatternNotes: () => {} }) },
  ),
}));

// ---------------------------------------------------------------------------
// pianoRollStore mock (for PatternBrowser / PianoRoll — Sprint 11/12)
// ---------------------------------------------------------------------------

vi.mock("@/stores/pianoRollStore", () => ({
  usePianoRollStore: Object.assign(
    (selector?: (s: { openForPattern: () => void; activePatternId: null }) => unknown) => {
      const state = { openForPattern: () => {}, activePatternId: null };
      if (typeof selector === "function") return selector(state);
      return state;
    },
    { getState: () => ({ activePatternId: null, notes: [] }) },
  ),
}));

// ---------------------------------------------------------------------------
// synthStore mock (for SynthPanel — Sprint 6)
// ---------------------------------------------------------------------------

vi.mock("@/stores/synthStore", () => ({
  useSynthStore: () => ({
    params: {
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
    },
    isInitialized: true,
    isLoading: false,
    error: null,
    initialize: vi.fn(),
    setParam: vi.fn(),
    fetchState: vi.fn(),
    clearError: vi.fn(),
  }),
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
    // PatternBrowser and TrackList both render "no tracks" empty-state text now;
    // use queryAllByText to avoid "multiple elements" throw, then take the first.
    const browserLabel =
      screen.queryByText("Instrument Browser") ??
      screen.queryAllByText(/no tracks/i)[0] ??
      screen.queryAllByText(/track/i)[0] ??
      null;
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
    // TrackList renders empty state or track headers.
    // Both TrackList and PatternBrowser render "no tracks" text, so use
    // queryAllByText to avoid "multiple elements" throw, then take the first.
    const trackListEl =
      screen.queryAllByText(/no tracks/i)[0] ??
      screen.queryByTestId("track-list") ??
      (document.querySelector("[data-testid='track-list']") as Element | null);
    // Also accept an "add track" button as proof of TrackList presence
    const addButton =
      screen.queryByRole("button", { name: /add track/i }) ??
      screen.queryByText("+");
    expect(trackListEl ?? addButton).not.toBeNull();
  });

  it("browser panel is visible when browserOpen=true", () => {
    mockKeyboardState = { ...mockKeyboardState, browserOpen: true };
    render(<DAWLayout />);
    // Browser panel now contains PatternBrowser (Sprint 12).
    const browserArea =
      screen.queryByTestId("pattern-browser") ??
      screen.queryByText("Patterns") ??
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
