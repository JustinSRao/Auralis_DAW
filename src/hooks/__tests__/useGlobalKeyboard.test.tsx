import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useGlobalKeyboard } from "../useGlobalKeyboard";

// ---------------------------------------------------------------------------
// Mock state objects — mutated per-test via beforeEach
// ---------------------------------------------------------------------------

const mockPlay = vi.fn();
const mockStop = vi.fn();
const mockToggleLoop = vi.fn();

let mockTransportState = {
  snapshot: { state: "stopped" as "stopped" | "playing", loop_enabled: false },
  play: mockPlay,
  stop: mockStop,
  toggleLoop: mockToggleLoop,
};

const mockToggleMute = vi.fn();
const mockToggleSolo = vi.fn();
const mockToggleArm = vi.fn();
const mockDeleteTrack = vi.fn();

let mockTrackState = {
  selectedTrackId: null as string | null,
  toggleMute: mockToggleMute,
  toggleSolo: mockToggleSolo,
  toggleArm: mockToggleArm,
  deleteTrack: mockDeleteTrack,
};

const mockToggleFollowPlayhead = vi.fn();

let mockKeyboardState = {
  toggleFollowPlayhead: mockToggleFollowPlayhead,
};

const mockSave = vi.fn();
const mockCreateNewProject = vi.fn();

let mockFileState = {
  filePath: "/project/test.mapp" as string | null,
  save: mockSave,
  createNewProject: mockCreateNewProject,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// useTransportStore is called as both a React hook (unused in this hook) and
// via the static .getState() method. We mock the entire module so that
// useTransportStore.getState() returns our controllable state object.
vi.mock("@/stores/transportStore", () => {
  const useTransportStore = Object.assign(
    // The hook itself is never called directly inside useGlobalKeyboard,
    // so we only need getState to be correct.
    vi.fn(),
    {
      getState: () => mockTransportState,
    },
  );
  return { useTransportStore };
});

vi.mock("@/stores/trackStore", () => {
  const useTrackStore = Object.assign(vi.fn(), {
    getState: () => mockTrackState,
  });
  return { useTrackStore };
});

vi.mock("@/stores/keyboardStore", () => {
  const useKeyboardStore = Object.assign(vi.fn(), {
    getState: () => mockKeyboardState,
  });
  return { useKeyboardStore };
});

vi.mock("@/stores/fileStore", () => {
  const useFileStore = Object.assign(vi.fn(), {
    getState: () => mockFileState,
  });
  return { useFileStore };
});

// ---------------------------------------------------------------------------
// Helper component that mounts the hook
// ---------------------------------------------------------------------------

function HookConsumer() {
  useGlobalKeyboard();
  return (
    <div>
      {/* Real INPUT/TEXTAREA/SELECT elements for focus-guard tests */}
      <input data-testid="text-input" />
      <textarea data-testid="text-area" />
      <select data-testid="select-el">
        <option value="a">A</option>
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key-press helper
// ---------------------------------------------------------------------------

/** Fire a keydown event on document.body (no focused element). */
function pressKey(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
) {
  fireEvent.keyDown(document.body, {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useGlobalKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mutable state to safe defaults
    mockTransportState = {
      snapshot: { state: "stopped", loop_enabled: false },
      play: mockPlay,
      stop: mockStop,
      toggleLoop: mockToggleLoop,
    };

    mockTrackState = {
      selectedTrackId: null,
      toggleMute: mockToggleMute,
      toggleSolo: mockToggleSolo,
      toggleArm: mockToggleArm,
      deleteTrack: mockDeleteTrack,
    };

    mockKeyboardState = {
      toggleFollowPlayhead: mockToggleFollowPlayhead,
    };

    mockFileState = {
      filePath: "/project/test.mapp",
      save: mockSave,
      createNewProject: mockCreateNewProject,
    };
  });

  // -------------------------------------------------------------------------
  // Space key — play / stop toggle
  // -------------------------------------------------------------------------

  it("Space calls transport.play() when transport is stopped", () => {
    render(<HookConsumer />);
    pressKey(" ");
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("Space calls transport.stop() when transport is playing", () => {
    mockTransportState.snapshot.state = "playing";
    render(<HookConsumer />);
    pressKey(" ");
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockPlay).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R key — record arm toggle
  // -------------------------------------------------------------------------

  it("R calls toggleArm(selectedTrackId) when a track is selected", () => {
    mockTrackState.selectedTrackId = "track-1";
    render(<HookConsumer />);
    pressKey("r");
    expect(mockToggleArm).toHaveBeenCalledWith("track-1");
  });

  it("R does nothing when no track is selected", () => {
    mockTrackState.selectedTrackId = null;
    render(<HookConsumer />);
    pressKey("r");
    expect(mockToggleArm).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // M key — mute toggle
  // -------------------------------------------------------------------------

  it("M calls toggleMute(selectedTrackId) when a track is selected", () => {
    mockTrackState.selectedTrackId = "track-2";
    render(<HookConsumer />);
    pressKey("m");
    expect(mockToggleMute).toHaveBeenCalledWith("track-2");
  });

  it("M does nothing when no track is selected", () => {
    mockTrackState.selectedTrackId = null;
    render(<HookConsumer />);
    pressKey("m");
    expect(mockToggleMute).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // S key — solo toggle
  // -------------------------------------------------------------------------

  it("S calls toggleSolo(selectedTrackId) when a track is selected", () => {
    mockTrackState.selectedTrackId = "track-3";
    render(<HookConsumer />);
    pressKey("s");
    expect(mockToggleSolo).toHaveBeenCalledWith("track-3");
  });

  it("S does nothing when no track is selected", () => {
    mockTrackState.selectedTrackId = null;
    render(<HookConsumer />);
    pressKey("s");
    expect(mockToggleSolo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // F key — follow playhead toggle
  // -------------------------------------------------------------------------

  it("F calls keyboard.toggleFollowPlayhead()", () => {
    render(<HookConsumer />);
    pressKey("f");
    expect(mockToggleFollowPlayhead).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Delete / Backspace key — delete selected track
  // -------------------------------------------------------------------------

  it("Delete calls deleteTrack(selectedTrackId) when a track is selected", () => {
    mockTrackState.selectedTrackId = "track-4";
    render(<HookConsumer />);
    pressKey("Delete");
    expect(mockDeleteTrack).toHaveBeenCalledWith("track-4");
  });

  it("Delete does nothing when no track is selected", () => {
    mockTrackState.selectedTrackId = null;
    render(<HookConsumer />);
    pressKey("Delete");
    expect(mockDeleteTrack).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Ctrl+S — save project
  // -------------------------------------------------------------------------

  it("Ctrl+S calls fileStore.save() when a filePath is set", () => {
    mockFileState.filePath = "/path/to/project.mapp";
    render(<HookConsumer />);
    pressKey("s", { ctrlKey: true });
    expect(mockSave).toHaveBeenCalledWith("/path/to/project.mapp");
  });

  it("Ctrl+S does NOT call save() when filePath is null", () => {
    mockFileState.filePath = null;
    render(<HookConsumer />);
    pressKey("s", { ctrlKey: true });
    expect(mockSave).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Ctrl+N — new project
  // -------------------------------------------------------------------------

  it("Ctrl+N calls fileStore.createNewProject()", () => {
    render(<HookConsumer />);
    pressKey("n", { ctrlKey: true });
    expect(mockCreateNewProject).toHaveBeenCalledWith("Untitled Project");
  });

  // -------------------------------------------------------------------------
  // Ctrl+Z — NOT handled (owned by useUndoRedo)
  // -------------------------------------------------------------------------

  it("Ctrl+Z does NOT call any action (owned by useUndoRedo)", () => {
    render(<HookConsumer />);
    pressKey("z", { ctrlKey: true });
    // None of the actions this hook manages should fire
    expect(mockPlay).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockToggleMute).not.toHaveBeenCalled();
    expect(mockToggleSolo).not.toHaveBeenCalled();
    expect(mockToggleArm).not.toHaveBeenCalled();
    expect(mockDeleteTrack).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockCreateNewProject).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Focus guard — INPUT focused
  // -------------------------------------------------------------------------

  it("Space does NOT call transport when an INPUT element is the event target", () => {
    const { getByTestId } = render(<HookConsumer />);
    const input = getByTestId("text-input");
    fireEvent.focus(input);
    // Fire on the input element itself — tagName guard fires
    fireEvent.keyDown(input, { key: " " });
    expect(mockPlay).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("M does NOT call toggleMute when a TEXTAREA element is the event target", () => {
    mockTrackState.selectedTrackId = "track-5";
    const { getByTestId } = render(<HookConsumer />);
    const textarea = getByTestId("text-area");
    fireEvent.focus(textarea);
    fireEvent.keyDown(textarea, { key: "m" });
    expect(mockToggleMute).not.toHaveBeenCalled();
  });

  it("Delete does NOT call deleteTrack when a SELECT element is the event target", () => {
    mockTrackState.selectedTrackId = "track-6";
    const { getByTestId } = render(<HookConsumer />);
    const select = getByTestId("select-el");
    fireEvent.focus(select);
    fireEvent.keyDown(select, { key: "Delete" });
    expect(mockDeleteTrack).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Unmount removes listener
  // -------------------------------------------------------------------------

  it("event listener is removed on unmount — no calls after unmount", () => {
    const { unmount } = render(<HookConsumer />);
    unmount();

    pressKey(" ");
    pressKey("m");
    pressKey("s");
    pressKey("r");
    pressKey("Delete");
    pressKey("f");

    expect(mockPlay).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockToggleMute).not.toHaveBeenCalled();
    expect(mockToggleSolo).not.toHaveBeenCalled();
    expect(mockToggleArm).not.toHaveBeenCalled();
    expect(mockDeleteTrack).not.toHaveBeenCalled();
    expect(mockToggleFollowPlayhead).not.toHaveBeenCalled();
  });
});
