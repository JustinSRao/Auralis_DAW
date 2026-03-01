import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useUndoRedo } from "../useUndoRedo";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// We need stable references to the mock functions so we can assert on them
// after renders. These are declared at module scope and reset in beforeEach.
const mockUndo = vi.fn();
const mockRedo = vi.fn();

vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: (selector: (s: { undo: () => void; redo: () => void }) => unknown) =>
    selector({ undo: mockUndo, redo: mockRedo }),
}));

// ---------------------------------------------------------------------------
// Helper component that mounts the hook
// ---------------------------------------------------------------------------

function HookConsumer() {
  useUndoRedo();
  return (
    <div>
      {/* A real input — used to test focus suppression */}
      <input data-testid="text-input" />
      <textarea data-testid="text-area" />
      <select data-testid="select-el">
        <option value="a">A</option>
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fire a keydown event on document.body simulating a key combo. */
function pressKey(
  key: string,
  options: { ctrlKey?: boolean; shiftKey?: boolean } = {},
) {
  fireEvent.keyDown(document.body, {
    key,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useUndoRedo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Ctrl+Z → undo
  // -------------------------------------------------------------------------

  it("Ctrl+Z fires undo()", () => {
    render(<HookConsumer />);
    pressKey("z", { ctrlKey: true });
    expect(mockUndo).toHaveBeenCalledTimes(1);
    expect(mockRedo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Ctrl+Shift+Z → redo
  // -------------------------------------------------------------------------

  it("Ctrl+Shift+Z fires redo()", () => {
    render(<HookConsumer />);
    pressKey("z", { ctrlKey: true, shiftKey: true });
    expect(mockRedo).toHaveBeenCalledTimes(1);
    expect(mockUndo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Ctrl+Y → redo
  // -------------------------------------------------------------------------

  it("Ctrl+Y fires redo()", () => {
    render(<HookConsumer />);
    pressKey("y", { ctrlKey: true });
    expect(mockRedo).toHaveBeenCalledTimes(1);
    expect(mockUndo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Focus suppression — INPUT
  // -------------------------------------------------------------------------

  it("Ctrl+Z does NOT fire undo() when an INPUT is focused", () => {
    const { getByTestId } = render(<HookConsumer />);
    const input = getByTestId("text-input");
    fireEvent.focus(input);
    // Fire keydown on the input itself (active element)
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    expect(mockUndo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Focus suppression — TEXTAREA
  // -------------------------------------------------------------------------

  it("Ctrl+Z does NOT fire undo() when a TEXTAREA is focused", () => {
    const { getByTestId } = render(<HookConsumer />);
    const textarea = getByTestId("text-area");
    fireEvent.focus(textarea);
    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true });
    expect(mockUndo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Focus suppression — SELECT
  // -------------------------------------------------------------------------

  it("Ctrl+Z does NOT fire undo() when a SELECT is focused", () => {
    const { getByTestId } = render(<HookConsumer />);
    const select = getByTestId("select-el");
    fireEvent.focus(select);
    fireEvent.keyDown(select, { key: "z", ctrlKey: true });
    expect(mockUndo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Non-matching keys are ignored
  // -------------------------------------------------------------------------

  it("non-Ctrl keys are ignored", () => {
    render(<HookConsumer />);
    pressKey("z"); // no ctrlKey
    expect(mockUndo).not.toHaveBeenCalled();
    expect(mockRedo).not.toHaveBeenCalled();
  });

  it("Ctrl+X is ignored", () => {
    render(<HookConsumer />);
    pressKey("x", { ctrlKey: true });
    expect(mockUndo).not.toHaveBeenCalled();
    expect(mockRedo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Event listener removed on unmount
  // -------------------------------------------------------------------------

  it("event listener is removed on unmount — no calls after unmount", () => {
    const { unmount } = render(<HookConsumer />);
    unmount();

    // Fire keys after unmount — should be completely ignored
    pressKey("z", { ctrlKey: true });
    pressKey("y", { ctrlKey: true });

    expect(mockUndo).not.toHaveBeenCalled();
    expect(mockRedo).not.toHaveBeenCalled();
  });
});
