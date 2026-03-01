import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MenuBar } from "../MenuBar";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// historyStore
const mockUndo = vi.fn();
const mockRedo = vi.fn();

let mockHistoryState = {
  canUndo: false,
  canRedo: false,
  entries: [] as Array<{ label: string; isCurrent: boolean }>,
  currentPointer: -1,
  push: vi.fn(),
  undo: mockUndo,
  redo: mockRedo,
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

// fileStore
const mockCreateNewProject = vi.fn();

let mockFileState = {
  filePath: null as string | null,
  isDirty: false,
  isAutoSaving: false,
  recentProjects: [] as Array<{ name: string; file_path: string; modified_at: string }>,
  lastSavedAt: null as string | null,
  currentProject: null,
  error: null as string | null,
  createNewProject: mockCreateNewProject,
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

// keyboardStore
const mockToggleBrowser = vi.fn();
const mockToggleMixer = vi.fn();
const mockToggleFollowPlayhead = vi.fn();

let mockKeyboardState = {
  browserOpen: true,
  mixerOpen: true,
  followPlayhead: false,
  toggleBrowser: mockToggleBrowser,
  toggleMixer: mockToggleMixer,
  toggleFollowPlayhead: mockToggleFollowPlayhead,
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
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockUndo.mockReset();
  mockRedo.mockReset();
  mockCreateNewProject.mockReset();
  mockToggleBrowser.mockReset();
  mockToggleMixer.mockReset();
  mockToggleFollowPlayhead.mockReset();

  mockHistoryState = {
    ...mockHistoryState,
    canUndo: false,
    canRedo: false,
    entries: [],
    undo: mockUndo,
    redo: mockRedo,
  };

  mockFileState = {
    ...mockFileState,
    filePath: null,
    isDirty: false,
    currentProject: null,
    createNewProject: mockCreateNewProject,
  };

  mockKeyboardState = {
    browserOpen: true,
    mixerOpen: true,
    followPlayhead: false,
    toggleBrowser: mockToggleBrowser,
    toggleMixer: mockToggleMixer,
    toggleFollowPlayhead: mockToggleFollowPlayhead,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MenuBar", () => {
  beforeEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // Top-level menu triggers
  // -------------------------------------------------------------------------

  it("renders a File menu trigger", () => {
    render(<MenuBar />);
    expect(
      screen.getByRole("button", { name: /file/i }) ??
        screen.getByText(/^file$/i),
    ).toBeInTheDocument();
  });

  it("renders an Edit menu trigger", () => {
    render(<MenuBar />);
    expect(
      screen.getByRole("button", { name: /edit/i }) ??
        screen.getByText(/^edit$/i),
    ).toBeInTheDocument();
  });

  it("renders a View menu trigger", () => {
    render(<MenuBar />);
    expect(
      screen.getByRole("button", { name: /view/i }) ??
        screen.getByText(/^view$/i),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // File menu items
  // -------------------------------------------------------------------------

  it('File menu contains a "New Project" menu item', () => {
    render(<MenuBar />);

    // Open the File menu first
    const fileMenuTrigger =
      screen.queryByRole("button", { name: /file/i }) ??
      screen.getByText(/^file$/i);
    fireEvent.click(fileMenuTrigger);

    // After opening, the item should appear
    expect(
      screen.queryByText(/new project/i) ??
        screen.queryByRole("menuitem", { name: /new project/i }),
    ).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edit menu items
  // -------------------------------------------------------------------------

  it('Edit menu contains an "Undo" menu item', () => {
    render(<MenuBar />);

    const editMenuTrigger =
      screen.queryByRole("button", { name: /edit/i }) ??
      screen.getByText(/^edit$/i);
    fireEvent.click(editMenuTrigger);

    expect(
      screen.queryByText(/^undo$/i) ??
        screen.queryByRole("menuitem", { name: /undo/i }),
    ).not.toBeNull();
  });

  it('Edit menu contains a "Redo" menu item', () => {
    render(<MenuBar />);

    const editMenuTrigger =
      screen.queryByRole("button", { name: /edit/i }) ??
      screen.getByText(/^edit$/i);
    fireEvent.click(editMenuTrigger);

    expect(
      screen.queryByText(/^redo$/i) ??
        screen.queryByRole("menuitem", { name: /redo/i }),
    ).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // File menu — action handlers
  // -------------------------------------------------------------------------

  it('clicking "New Project" in File menu calls fileStore.createNewProject()', () => {
    render(<MenuBar />);

    // Open File menu
    const fileMenuTrigger =
      screen.queryByRole("button", { name: /^file$/i }) ??
      screen.getByText(/^file$/i);
    fireEvent.click(fileMenuTrigger);

    // Click the item
    const newProjectItem =
      screen.queryByRole("menuitem", { name: /new project/i }) ??
      screen.getByText(/new project/i);
    fireEvent.click(newProjectItem);

    expect(mockCreateNewProject).toHaveBeenCalledWith("Untitled Project");
  });

  it('clicking "Save" in File menu calls fileStore.save() when filePath is set', () => {
    // Give the store a non-null filePath so the Save button is enabled
    mockFileState = { ...mockFileState, filePath: "/path/project.mapp", save: mockFileState.save };
    render(<MenuBar />);

    const fileMenuTrigger =
      screen.queryByRole("button", { name: /^file$/i }) ??
      screen.getByText(/^file$/i);
    fireEvent.click(fileMenuTrigger);

    // The Save button should be enabled (filePath is set)
    const saveItem =
      screen.queryByRole("menuitem", { name: /^save$/i }) ??
      screen.getByText(/^save$/i);
    fireEvent.click(saveItem);

    expect(mockFileState.save).toHaveBeenCalledWith("/path/project.mapp");
  });

  // -------------------------------------------------------------------------
  // Edit menu — action handlers
  // -------------------------------------------------------------------------

  it('clicking "Undo" in Edit menu calls historyStore.undo()', () => {
    // canUndo must be true so the button is enabled
    mockHistoryState = { ...mockHistoryState, canUndo: true, undo: mockUndo };
    render(<MenuBar />);

    const editMenuTrigger =
      screen.queryByRole("button", { name: /^edit$/i }) ??
      screen.getByText(/^edit$/i);
    fireEvent.click(editMenuTrigger);

    const undoItem =
      screen.queryByRole("menuitem", { name: /^undo$/i }) ??
      screen.getByText(/^undo$/i);
    fireEvent.click(undoItem);

    expect(mockUndo).toHaveBeenCalledTimes(1);
  });

  it('clicking "Redo" in Edit menu calls historyStore.redo()', () => {
    mockHistoryState = { ...mockHistoryState, canRedo: true, redo: mockRedo };
    render(<MenuBar />);

    const editMenuTrigger =
      screen.queryByRole("button", { name: /^edit$/i }) ??
      screen.getByText(/^edit$/i);
    fireEvent.click(editMenuTrigger);

    const redoItem =
      screen.queryByRole("menuitem", { name: /^redo$/i }) ??
      screen.getByText(/^redo$/i);
    fireEvent.click(redoItem);

    expect(mockRedo).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // View menu — action handlers
  // -------------------------------------------------------------------------

  it('clicking "Toggle Browser" in View menu calls keyboardStore.toggleBrowser()', () => {
    render(<MenuBar />);

    const viewMenuTrigger =
      screen.queryByRole("button", { name: /^view$/i }) ??
      screen.getByText(/^view$/i);
    fireEvent.click(viewMenuTrigger);

    // The label may include a check-mark prefix when browserOpen is true
    const browserItem =
      screen.queryByRole("menuitem", { name: /toggle browser/i }) ??
      screen.getByText(/toggle browser/i);
    fireEvent.click(browserItem);

    expect(mockToggleBrowser).toHaveBeenCalledTimes(1);
  });
});
