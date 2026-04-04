/**
 * Tests for SettingsPanel (Sprint 27).
 *
 * All IPC and child-component dependencies are mocked so the suite runs in
 * jsdom without a Tauri runtime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";

// ---------------------------------------------------------------------------
// Mock: IPC helpers
// ---------------------------------------------------------------------------

const mockIpcGetAppConfig = vi.fn();
const mockIpcSaveAppConfig = vi.fn();

vi.mock("@/lib/ipc", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...original,
    ipcGetAppConfig: mockIpcGetAppConfig,
    ipcSaveAppConfig: mockIpcSaveAppConfig,
  };
});

// ---------------------------------------------------------------------------
// Mock: AudioSettingsPanel and MidiSettingsPanel (avoid IPC noise)
// ---------------------------------------------------------------------------

vi.mock("@/components/audio/AudioSettingsPanel", () => ({
  AudioSettingsPanel: () => <div data-testid="audio-settings-panel">AudioSettingsPanel</div>,
}));

vi.mock("@/components/midi/MidiSettingsPanel", () => ({
  MidiSettingsPanel: () => <div data-testid="midi-settings-panel">MidiSettingsPanel</div>,
}));

// ---------------------------------------------------------------------------
// Mock: audioStore and midiStore (no Tauri IPC in tabs)
// ---------------------------------------------------------------------------

vi.mock("@/stores/audioStore", () => ({
  useAudioStore: vi.fn(() => ({
    config: {
      sample_rate: 44100,
      buffer_size: 256,
      output_device: null,
      input_device: null,
    },
  })),
}));

vi.mock("@/stores/midiStore", () => ({
  useMidiStore: vi.fn(() => ({
    activeInput: null,
    activeOutput: null,
  })),
}));

// ---------------------------------------------------------------------------
// Default config fixture
// ---------------------------------------------------------------------------

const defaultConfig = {
  audio: { outputDevice: null, inputDevice: null, sampleRate: 44100, bufferSize: 256 },
  midi: { activeInput: null, activeOutput: null },
  general: { autosaveIntervalSecs: 300, recentProjectsLimit: 10 },
  ui: { browserOpen: true, mixerOpen: true, followPlayhead: false, theme: "dark" },
};

// ---------------------------------------------------------------------------
// Import component + store (after mocks are registered)
// ---------------------------------------------------------------------------

// We import dynamically to ensure mocks are set up before module evaluation.
const { SettingsPanel } = await import("../SettingsPanel");
const { useSettingsStore } = await import("@/stores/settingsStore");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Opens the settings panel and waits for the config to load. */
async function openPanel() {
  mockIpcGetAppConfig.mockResolvedValue(structuredClone(defaultConfig));
  await act(async () => {
    useSettingsStore.getState().open();
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset the store to closed, clean state.
  await act(async () => {
    useSettingsStore.setState({
      config: null,
      draft: null,
      isOpen: false,
      isDirty: false,
      isLoading: false,
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsPanel", () => {
  // ── Smoke ─────────────────────────────────────────────────────────────────

  it("renders when isOpen is true and shows all 4 tabs", async () => {
    await openPanel();
    render(<SettingsPanel />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(screen.getByText("MIDI")).toBeInTheDocument();
    expect(screen.getByText("UI")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    useSettingsStore.setState({ isOpen: false });
    render(<SettingsPanel />);
    expect(screen.queryByText("Settings")).toBeNull();
  });

  // ── Save & Apply ──────────────────────────────────────────────────────────

  it("calls ipcSaveAppConfig when Save & Apply is clicked (no engine-restart warning)", async () => {
    mockIpcSaveAppConfig.mockResolvedValue(undefined);
    await openPanel();
    render(<SettingsPanel />);

    const saveBtn = screen.getByRole("button", { name: /save & apply/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockIpcSaveAppConfig).toHaveBeenCalledTimes(1);
    });
  });

  // ── Discard ───────────────────────────────────────────────────────────────

  it("calls discardChanges when Discard button is clicked in footer", async () => {
    await openPanel();
    render(<SettingsPanel />);

    // Make the draft dirty so isDirty is true.
    act(() => {
      useSettingsStore.getState().updateGeneral({ autosaveIntervalSecs: 60 });
    });

    const discardBtn = screen.getByRole("button", { name: /^discard$/i });
    await act(async () => {
      fireEvent.click(discardBtn);
    });

    // After discard the panel closes (store isDirty === false).
    await waitFor(() => {
      expect(useSettingsStore.getState().isDirty).toBe(false);
    });
  });

  // ── Dirty-close guard ─────────────────────────────────────────────────────

  it("shows dirty-close confirmation when X is clicked with unsaved changes", async () => {
    await openPanel();
    render(<SettingsPanel />);

    act(() => {
      useSettingsStore.getState().updateGeneral({ autosaveIntervalSecs: 60 });
    });

    const closeBtn = screen.getByRole("button", { name: /close settings/i });
    fireEvent.click(closeBtn);

    expect(
      screen.getByText(/you have unsaved changes/i),
    ).toBeInTheDocument();
  });

  it("closes immediately when X is clicked with no unsaved changes", async () => {
    await openPanel();
    render(<SettingsPanel />);

    // Do NOT dirty the store.
    const closeBtn = screen.getByRole("button", { name: /close settings/i });
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    await waitFor(() => {
      expect(useSettingsStore.getState().isOpen).toBe(false);
    });
  });

  // ── Engine-restart warning ────────────────────────────────────────────────

  it("shows engine-restart warning when sample rate is changed before saving", async () => {
    mockIpcSaveAppConfig.mockResolvedValue(undefined);
    await openPanel();
    render(<SettingsPanel />);

    // Change the sample rate in the draft directly.
    act(() => {
      useSettingsStore.getState().updateAudio({ sampleRate: 48000 });
    });

    const saveBtn = screen.getByRole("button", { name: /save & apply/i });
    fireEvent.click(saveBtn);

    expect(
      screen.getByText(/requires restarting the audio engine/i),
    ).toBeInTheDocument();
    // ipcSaveAppConfig should NOT have been called yet.
    expect(mockIpcSaveAppConfig).not.toHaveBeenCalled();
  });

  it("shows engine-restart warning when buffer size is changed before saving", async () => {
    mockIpcSaveAppConfig.mockResolvedValue(undefined);
    await openPanel();
    render(<SettingsPanel />);

    act(() => {
      useSettingsStore.getState().updateAudio({ bufferSize: 512 });
    });

    const saveBtn = screen.getByRole("button", { name: /save & apply/i });
    fireEvent.click(saveBtn);

    expect(
      screen.getByText(/requires restarting the audio engine/i),
    ).toBeInTheDocument();
    expect(mockIpcSaveAppConfig).not.toHaveBeenCalled();
  });
});
