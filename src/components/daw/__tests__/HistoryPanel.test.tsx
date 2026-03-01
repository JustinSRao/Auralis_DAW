import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryPanel } from "../HistoryPanel";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// We define the mock state at module scope and mutate it per-test in beforeEach.
// The mock factory captures these references so the component always reads the
// current values at render time.
const mockUndo = vi.fn();
const mockRedo = vi.fn();

let mockState = {
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
  useHistoryStore: (
    selector?: (s: typeof mockState) => unknown,
  ) => {
    // If called with a selector (for partial subscriptions), apply it.
    // If called without, return the whole state (some components do this).
    if (typeof selector === "function") {
      return selector(mockState);
    }
    return mockState;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMockState(
  overrides: Partial<typeof mockState> = {},
) {
  mockUndo.mockReset();
  mockRedo.mockReset();
  mockState = {
    canUndo: false,
    canRedo: false,
    entries: [],
    currentPointer: -1,
    push: vi.fn(),
    undo: mockUndo,
    redo: mockRedo,
    clear: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HistoryPanel", () => {
  beforeEach(() => {
    resetMockState();
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('renders "History Empty" text when entries is empty', () => {
    render(<HistoryPanel />);
    expect(screen.getByText(/history empty/i)).toBeInTheDocument();
  });

  it("does not render entry labels when entries is empty", () => {
    render(<HistoryPanel />);
    // There should be no list items or entry elements
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Entry rendering
  // -------------------------------------------------------------------------

  it("renders entry labels from store", () => {
    resetMockState({
      entries: [
        { label: "Set BPM: 120 → 140", isCurrent: false },
        { label: 'Rename: "Verse" → "Chorus"', isCurrent: true },
      ],
    });
    render(<HistoryPanel />);
    expect(screen.getByText("Set BPM: 120 → 140")).toBeInTheDocument();
    expect(screen.getByText('Rename: "Verse" → "Chorus"')).toBeInTheDocument();
  });

  it("does not render 'History Empty' text when entries exist", () => {
    resetMockState({
      entries: [{ label: "Set BPM: 120 → 140", isCurrent: true }],
    });
    render(<HistoryPanel />);
    expect(screen.queryByText(/history empty/i)).not.toBeInTheDocument();
  });

  it("current entry is visually distinct from non-current entries", () => {
    resetMockState({
      entries: [
        { label: "First Action", isCurrent: false },
        { label: "Current Action", isCurrent: true },
      ],
    });
    render(<HistoryPanel />);
    // The current entry should have a distinct aria or visual marker.
    // We check that exactly one entry carries aria-current="true" or a
    // data-current attribute — the implementation determines exact mechanism.
    const currentEntry = screen.getByText("Current Action").closest("[aria-current]") ??
      screen.getByText("Current Action").closest("[data-current]");
    expect(currentEntry).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Undo button
  // -------------------------------------------------------------------------

  it("Undo button is disabled when canUndo=false", () => {
    resetMockState({ canUndo: false });
    render(<HistoryPanel />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
  });

  it("Undo button is enabled when canUndo=true", () => {
    resetMockState({
      canUndo: true,
      entries: [{ label: "Set BPM", isCurrent: true }],
    });
    render(<HistoryPanel />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeEnabled();
  });

  it("clicking Undo calls store.undo()", () => {
    resetMockState({
      canUndo: true,
      entries: [{ label: "Set BPM", isCurrent: true }],
    });
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(mockUndo).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Redo button
  // -------------------------------------------------------------------------

  it("Redo button is disabled when canRedo=false", () => {
    resetMockState({ canRedo: false });
    render(<HistoryPanel />);
    expect(screen.getByRole("button", { name: /redo/i })).toBeDisabled();
  });

  it("Redo button is enabled when canRedo=true", () => {
    resetMockState({
      canUndo: true,
      canRedo: true,
      entries: [{ label: "Set BPM", isCurrent: false }],
    });
    render(<HistoryPanel />);
    expect(screen.getByRole("button", { name: /redo/i })).toBeEnabled();
  });

  it("clicking Redo calls store.redo()", () => {
    resetMockState({
      canUndo: true,
      canRedo: true,
      entries: [{ label: "Set BPM", isCurrent: false }],
    });
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /redo/i }));
    expect(mockRedo).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Collapsible panel
  // -------------------------------------------------------------------------

  it("panel is expanded by default and shows its content", () => {
    resetMockState({
      entries: [{ label: "Set BPM", isCurrent: true }],
    });
    render(<HistoryPanel />);
    // Content is visible by default
    expect(screen.getByText("Set BPM")).toBeVisible();
  });

  it("clicking the panel header toggle hides the content", () => {
    resetMockState({
      entries: [{ label: "Set BPM", isCurrent: true }],
    });
    render(<HistoryPanel />);
    // Find the toggle button (role=button with expand/collapse semantics or
    // any element that controls collapse — the exact label depends on the
    // implementation, so we look for the header/summary/toggle button).
    const toggle =
      screen.queryByRole("button", { name: /history/i }) ??
      screen.queryByRole("button", { name: /collapse/i }) ??
      screen.getByRole("button", { name: /toggle/i });
    fireEvent.click(toggle!);

    // After collapse the entry text should no longer be visible
    expect(screen.queryByText("Set BPM")).not.toBeVisible();
  });

  it("clicking the toggle a second time re-expands the panel", () => {
    resetMockState({
      entries: [{ label: "Set BPM", isCurrent: true }],
    });
    render(<HistoryPanel />);
    const toggle =
      screen.queryByRole("button", { name: /history/i }) ??
      screen.queryByRole("button", { name: /collapse/i }) ??
      screen.getByRole("button", { name: /toggle/i });
    fireEvent.click(toggle!); // collapse
    fireEvent.click(toggle!); // re-expand
    expect(screen.getByText("Set BPM")).toBeVisible();
  });
});
