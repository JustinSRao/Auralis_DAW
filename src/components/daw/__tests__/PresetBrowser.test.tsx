import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresetBrowser } from "../PresetBrowser";
import type { PresetMeta } from "@/lib/ipc";

// ---------------------------------------------------------------------------
// Mock usePresets hook
// ---------------------------------------------------------------------------

const mockFetchPresets = vi.fn().mockResolvedValue(undefined);
const mockDeletePreset = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/usePresets", () => ({
  usePresets: vi.fn(),
}));

import { usePresets } from "@/hooks/usePresets";
const mockUsePresets = usePresets as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const factoryPreset: PresetMeta = {
  name: "Bass Sub",
  preset_type: "synth",
  is_factory: true,
};

const userPreset: PresetMeta = {
  name: "My Custom Bass",
  preset_type: "synth",
  is_factory: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsePresetsReturn(overrides: {
  filteredPresets?: PresetMeta[];
  isLoading?: boolean;
  error?: string | null;
}) {
  return {
    presets: overrides.filteredPresets ?? [],
    filteredPresets: overrides.filteredPresets ?? [],
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    fetchPresets: mockFetchPresets,
    captureAndSave: vi.fn(),
    loadAndApply: vi.fn(),
    deletePreset: mockDeletePreset,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockUsePresets.mockReturnValue(makeUsePresetsReturn({ filteredPresets: [] }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PresetBrowser", () => {
  const noop = vi.fn();

  // 1. Renders "No presets" when list is empty
  it('renders "No presets found." when the preset list is empty', () => {
    mockUsePresets.mockReturnValue(makeUsePresetsReturn({ filteredPresets: [] }));
    render(
      <PresetBrowser presetType="synth" onLoad={noop} onClose={noop} />,
    );
    expect(screen.getByText(/no presets found/i)).toBeInTheDocument();
  });

  // 2. Factory preset: shows name + factory badge; Load enabled, Delete absent
  it("renders factory preset with factory badge and enabled Load button, no Delete button", () => {
    mockUsePresets.mockReturnValue(
      makeUsePresetsReturn({ filteredPresets: [factoryPreset] }),
    );
    render(
      <PresetBrowser presetType="synth" onLoad={noop} onClose={noop} />,
    );

    expect(screen.getByText("Bass Sub")).toBeInTheDocument();
    // Factory badge
    expect(screen.getByTitle(/factory preset/i)).toBeInTheDocument();
    // Load button present
    expect(
      screen.getByRole("button", { name: /load preset bass sub/i }),
    ).toBeInTheDocument();
    // Delete button absent for factory presets
    expect(
      screen.queryByRole("button", { name: /delete preset bass sub/i }),
    ).not.toBeInTheDocument();
  });

  // 3. User preset: shows name without factory badge; Delete button present
  it("renders user preset without factory badge and with Delete button", () => {
    mockUsePresets.mockReturnValue(
      makeUsePresetsReturn({ filteredPresets: [userPreset] }),
    );
    render(
      <PresetBrowser presetType="synth" onLoad={noop} onClose={noop} />,
    );

    expect(screen.getByText("My Custom Bass")).toBeInTheDocument();
    // No factory badge
    expect(screen.queryByTitle(/factory preset/i)).not.toBeInTheDocument();
    // Delete button present
    expect(
      screen.getByRole("button", { name: /delete preset my custom bass/i }),
    ).toBeInTheDocument();
  });

  // 4. Search filters list by substring (case-insensitive)
  it("filters preset list by search query (case-insensitive substring match)", async () => {
    // Return all presets when no query, filtered when query provided
    mockUsePresets.mockImplementation(
      (_type: string, _channelId: unknown, searchQuery: string | undefined) => {
        const all = [factoryPreset, userPreset];
        const filtered = searchQuery
          ? all.filter((p) =>
              p.name.toLowerCase().includes(searchQuery.toLowerCase()),
            )
          : all;
        return makeUsePresetsReturn({ filteredPresets: filtered });
      },
    );

    render(
      <PresetBrowser presetType="synth" onLoad={noop} onClose={noop} />,
    );

    // Both visible initially
    expect(screen.getByText("Bass Sub")).toBeInTheDocument();
    expect(screen.getByText("My Custom Bass")).toBeInTheDocument();

    // Type a query that matches only the factory preset
    const searchInput = screen.getByRole("textbox", { name: /search presets/i });
    await userEvent.type(searchInput, "bass sub");

    // Only "Bass Sub" should now be in the filtered list
    expect(screen.getByText("Bass Sub")).toBeInTheDocument();
    expect(screen.queryByText("My Custom Bass")).not.toBeInTheDocument();
  });

  // 5. Clicking Load calls onLoad with the correct PresetMeta
  it("clicking Load calls onLoad with the correct PresetMeta", async () => {
    mockUsePresets.mockReturnValue(
      makeUsePresetsReturn({ filteredPresets: [factoryPreset] }),
    );
    const handleLoad = vi.fn();
    render(
      <PresetBrowser presetType="synth" onLoad={handleLoad} onClose={noop} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /load preset bass sub/i }),
    );
    expect(handleLoad).toHaveBeenCalledOnce();
    expect(handleLoad).toHaveBeenCalledWith(factoryPreset);
  });

  // 6. Clicking Delete on a user preset calls deletePreset from usePresets
  it("clicking Delete on a user preset calls deletePreset", async () => {
    mockUsePresets.mockReturnValue(
      makeUsePresetsReturn({ filteredPresets: [userPreset] }),
    );
    render(
      <PresetBrowser presetType="synth" onLoad={noop} onClose={noop} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /delete preset my custom bass/i }),
    );
    expect(mockDeletePreset).toHaveBeenCalledOnce();
    expect(mockDeletePreset).toHaveBeenCalledWith("My Custom Bass");
  });

  // Close button
  it("clicking close calls onClose", async () => {
    const handleClose = vi.fn();
    render(
      <PresetBrowser presetType="synth" onLoad={noop} onClose={handleClose} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /close preset browser/i }),
    );
    expect(handleClose).toHaveBeenCalledOnce();
  });
});
