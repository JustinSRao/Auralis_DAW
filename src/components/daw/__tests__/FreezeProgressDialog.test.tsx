import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FreezeProgressDialog } from "../FreezeProgressDialog";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const mockCancelFreeze = vi.fn().mockResolvedValue(undefined);
const mockGetProgress = vi.fn().mockReturnValue(0);
const mockGetStatus = vi.fn().mockReturnValue("rendering");
const mockOnProgress = vi.fn();

vi.mock("@/stores/freezeStore", () => ({
  useFreezeStore: () => ({
    onProgress: mockOnProgress,
    getProgress: mockGetProgress,
    cancelFreeze: mockCancelFreeze,
    getStatus: mockGetStatus,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FreezeProgressDialog", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    mockCancelFreeze.mockReset();
    mockCancelFreeze.mockResolvedValue(undefined);
    mockGetProgress.mockReturnValue(0);
    mockGetStatus.mockReturnValue("rendering");
  });

  it("renders the operation label and track name", () => {
    render(
      <FreezeProgressDialog
        trackId="t1"
        trackName="Piano"
        operation="Freeze"
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/freeze track/i)).toBeInTheDocument();
    expect(screen.getByText("Piano")).toBeInTheDocument();
  });

  it("renders Bounce label when operation is Bounce", () => {
    render(
      <FreezeProgressDialog
        trackId="t1"
        trackName="Synth"
        operation="Bounce"
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/bounce track/i)).toBeInTheDocument();
  });

  it("renders a progressbar with correct aria attributes", () => {
    mockGetProgress.mockReturnValue(0.5);
    render(
      <FreezeProgressDialog
        trackId="t1"
        trackName="Piano"
        operation="Freeze"
        onClose={onClose}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
  });

  it("renders a Cancel button", () => {
    render(
      <FreezeProgressDialog
        trackId="t1"
        trackName="Piano"
        operation="Freeze"
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("clicking Cancel calls cancelFreeze and onClose", async () => {
    render(
      <FreezeProgressDialog
        trackId="t1"
        trackName="Piano"
        operation="Freeze"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Wait for async cancelFreeze to resolve
    await vi.waitFor(() => {
      expect(mockCancelFreeze).toHaveBeenCalledWith("t1");
      expect(onClose).toHaveBeenCalled();
    });
  });
});
