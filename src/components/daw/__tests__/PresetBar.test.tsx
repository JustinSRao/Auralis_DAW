import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresetBar } from "../PresetBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderBar(
  currentPresetName: string | null,
  onSave = vi.fn(),
  onBrowse = vi.fn(),
) {
  return render(
    <PresetBar
      presetType="synth"
      currentPresetName={currentPresetName}
      onSave={onSave}
      onBrowse={onBrowse}
    />,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PresetBar", () => {
  // 1. Renders "— no preset —" when currentPresetName is null
  it('renders "— no preset —" when currentPresetName is null', () => {
    renderBar(null);
    expect(screen.getByText(/— no preset —/i)).toBeInTheDocument();
  });

  // 2. Renders the current preset name when provided
  it("renders the current preset name when provided", () => {
    renderBar("Bass Sub");
    expect(screen.getByText("Bass Sub")).toBeInTheDocument();
  });

  // 3. Clicking Save icon shows the inline input
  it("clicking the Save icon shows the preset name input", async () => {
    renderBar("Bass Sub");
    await userEvent.click(screen.getByRole("button", { name: /save preset/i }));
    expect(screen.getByRole("textbox", { name: /preset name/i })).toBeInTheDocument();
  });

  // 4. Pressing Enter with empty input does NOT call onSave
  it("pressing Enter with an empty name does not call onSave", async () => {
    const onSave = vi.fn();
    renderBar(null, onSave);
    await userEvent.click(screen.getByRole("button", { name: /save preset/i }));

    const input = screen.getByRole("textbox", { name: /preset name/i });
    // Clear any pre-filled value and press Enter with nothing
    await userEvent.clear(input);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).not.toHaveBeenCalled();
  });

  // 5. Pressing Enter with a non-empty name calls onSave with that name
  it("pressing Enter with a non-empty name calls onSave with the trimmed name", async () => {
    const onSave = vi.fn();
    renderBar(null, onSave);
    await userEvent.click(screen.getByRole("button", { name: /save preset/i }));

    const input = screen.getByRole("textbox", { name: /preset name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "My New Preset");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith("My New Preset");
  });

  // 6. Pressing Escape dismisses the input without calling onSave
  it("pressing Escape dismisses the input without calling onSave", async () => {
    const onSave = vi.fn();
    renderBar("Bass Sub", onSave);
    await userEvent.click(screen.getByRole("button", { name: /save preset/i }));

    const input = screen.getByRole("textbox", { name: /preset name/i });
    expect(input).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    // Input should be gone
    expect(screen.queryByRole("textbox", { name: /preset name/i })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  // 7. Clicking Browse icon calls onBrowse
  it("clicking the Browse icon calls onBrowse", async () => {
    const onBrowse = vi.fn();
    renderBar(null, vi.fn(), onBrowse);
    await userEvent.click(screen.getByRole("button", { name: /browse presets/i }));
    expect(onBrowse).toHaveBeenCalledOnce();
  });
});
