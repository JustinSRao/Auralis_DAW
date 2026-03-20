import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TransportBar } from "../TransportBar";
import { useTransportStore } from "@/stores/transportStore";
import { usePunchStore } from "@/stores/punchStore";
import type { TransportSnapshot } from "@/lib/ipc";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockListen = listen as ReturnType<typeof vi.fn>;

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
  punch_enabled: false,
  punch_in_samples: 0,
  punch_out_samples: 0,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset transport store to clean state
  useTransportStore.setState({
    snapshot: defaultSnapshot,
    isLoading: false,
    error: null,
  });
  // Reset punch store to clean state
  usePunchStore.setState({
    punchEnabled: false,
    punchInBeats: 0,
    punchOutBeats: 4,
    preRollBars: 2,
    isLoading: false,
    error: null,
  });
  // Default: listen returns an unlisten stub
  mockListen.mockResolvedValue(() => {});
  // Route invoke calls by command name so get_transport_state always succeeds
  // even when individual tests override specific commands.
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_transport_state") return Promise.resolve(defaultSnapshot);
    return Promise.resolve(undefined);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TransportBar", () => {
  // -------------------------------------------------------------------------
  // Render: basic elements present
  // -------------------------------------------------------------------------

  it("renders play button", () => {
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });

  it("renders stop button", () => {
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("renders pause button", () => {
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("renders BPM input with current value", () => {
    render(<TransportBar />);
    const bpmInput = screen.getByLabelText(/bpm/i);
    expect(bpmInput).toBeInTheDocument();
    expect((bpmInput as HTMLInputElement).value).toBe("120.0");
  });

  it("renders time signature numerator input", () => {
    render(<TransportBar />);
    const numInput = screen.getByLabelText(/time signature numerator/i);
    expect(numInput).toBeInTheDocument();
    expect((numInput as HTMLInputElement).value).toBe("4");
  });

  it("renders time signature denominator select", () => {
    render(<TransportBar />);
    const denSel = screen.getByLabelText(/time signature denominator/i);
    expect(denSel).toBeInTheDocument();
    expect((denSel as HTMLSelectElement).value).toBe("4");
  });

  it("renders loop toggle button", () => {
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /loop/i })).toBeInTheDocument();
  });

  it("renders metronome toggle button", () => {
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /metronome/i })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Render: position display
  // -------------------------------------------------------------------------

  it("shows bar.beat.tick position at start", () => {
    render(<TransportBar />);
    // bar 1, beat 1, tick 000 → "1.1.000"
    expect(screen.getByLabelText(/playhead position/i)).toHaveTextContent(
      "1.1.000",
    );
  });

  it("shows updated position from store snapshot", () => {
    useTransportStore.setState({
      snapshot: {
        ...defaultSnapshot,
        bbt: { bar: 3, beat: 2, tick: 120 },
      },
    });
    render(<TransportBar />);
    expect(screen.getByLabelText(/playhead position/i)).toHaveTextContent(
      "3.2.120",
    );
  });

  // -------------------------------------------------------------------------
  // Button states
  // -------------------------------------------------------------------------

  it("play button is disabled when transport is playing", () => {
    useTransportStore.setState({
      snapshot: { ...defaultSnapshot, state: "playing" },
    });
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /play/i })).toBeDisabled();
  });

  it("stop button is disabled when transport is stopped", () => {
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeDisabled();
  });

  it("pause button is disabled when transport is stopped", () => {
    render(<TransportBar />);
    expect(screen.getByRole("button", { name: /pause/i })).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // Button interactions
  // -------------------------------------------------------------------------

  it("clicking play calls store.play()", async () => {
    render(<TransportBar />);
    await userEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(mockInvoke).toHaveBeenCalledWith("transport_play");
  });

  it("clicking stop calls store.stop()", async () => {
    const playingSnap = { ...defaultSnapshot, state: "playing" } as const;
    // Make transport playing so Stop is enabled; also return playing state from refreshState()
    useTransportStore.setState({ snapshot: playingSnap });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transport_state") return Promise.resolve(playingSnap);
      return Promise.resolve(undefined);
    });
    render(<TransportBar />);
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(mockInvoke).toHaveBeenCalledWith("transport_stop");
  });

  it("clicking pause calls store.pause()", async () => {
    const playingSnap = { ...defaultSnapshot, state: "playing" } as const;
    useTransportStore.setState({ snapshot: playingSnap });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_transport_state") return Promise.resolve(playingSnap);
      return Promise.resolve(undefined);
    });
    render(<TransportBar />);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(mockInvoke).toHaveBeenCalledWith("transport_pause");
  });

  // -------------------------------------------------------------------------
  // BPM input
  // -------------------------------------------------------------------------

  it("pressing Enter on BPM input commits a valid value", async () => {
    render(<TransportBar />);
    const bpmInput = screen.getByLabelText(/bpm/i);
    await userEvent.clear(bpmInput);
    await userEvent.type(bpmInput, "140");
    fireEvent.keyDown(bpmInput, { key: "Enter" });
    expect(mockInvoke).toHaveBeenCalledWith("set_tempo_map", {
      points: [{ tick: 0, bpm: 140, interp: "Step" }],
    });
  });

  it("BPM out of range reverts to current BPM on blur", async () => {
    render(<TransportBar />);
    const bpmInput = screen.getByLabelText(/bpm/i) as HTMLInputElement;
    await userEvent.clear(bpmInput);
    await userEvent.type(bpmInput, "999");
    fireEvent.blur(bpmInput);
    await waitFor(() => {
      expect(bpmInput.value).toBe("120.0");
    });
  });

  it("pressing Escape reverts BPM input without calling setBpm", async () => {
    render(<TransportBar />);
    const bpmInput = screen.getByLabelText(/bpm/i) as HTMLInputElement;
    await userEvent.clear(bpmInput);
    await userEvent.type(bpmInput, "200");
    fireEvent.keyDown(bpmInput, { key: "Escape" });
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "set_bpm",
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // Loop toggle
  // -------------------------------------------------------------------------

  it("clicking loop button calls toggleLoop with toggled value", async () => {
    render(<TransportBar />);
    await userEvent.click(screen.getByRole("button", { name: /loop/i }));
    expect(mockInvoke).toHaveBeenCalledWith("toggle_loop", { enabled: true });
  });

  it("loop button shows as active (aria-pressed) when loop enabled", () => {
    useTransportStore.setState({
      snapshot: { ...defaultSnapshot, loop_enabled: true },
    });
    render(<TransportBar />);
    const loopBtn = screen.getByRole("button", { name: /disable loop/i });
    expect(loopBtn).toHaveAttribute("aria-pressed", "true");
  });

  // -------------------------------------------------------------------------
  // Metronome toggle
  // -------------------------------------------------------------------------

  it("clicking metronome button calls toggleMetronome with toggled value", async () => {
    render(<TransportBar />);
    await userEvent.click(screen.getByRole("button", { name: /metronome/i }));
    expect(mockInvoke).toHaveBeenCalledWith("toggle_metronome", {
      enabled: true,
    });
  });

  // -------------------------------------------------------------------------
  // Tauri event subscription
  // -------------------------------------------------------------------------

  it("subscribes to transport-state event on mount", () => {
    render(<TransportBar />);
    expect(mockListen).toHaveBeenCalledWith(
      "transport-state",
      expect.any(Function),
    );
  });

  // -------------------------------------------------------------------------
  // Error display
  // -------------------------------------------------------------------------

  it("shows error message when store has an error", () => {
    useTransportStore.setState({ error: "engine not running" });
    render(<TransportBar />);
    expect(screen.getByText(/engine not running/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Paused indicator
  // -------------------------------------------------------------------------

  it("shows PAUSED indicator when transport is paused", () => {
    useTransportStore.setState({
      snapshot: { ...defaultSnapshot, state: "paused" },
    });
    render(<TransportBar />);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it("does not show PAUSED indicator when playing", () => {
    useTransportStore.setState({
      snapshot: { ...defaultSnapshot, state: "playing" },
    });
    render(<TransportBar />);
    expect(screen.queryByText(/paused/i)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Record armed indicator
  // -------------------------------------------------------------------------

  it("shows record armed indicator when record_armed is true", () => {
    useTransportStore.setState({
      snapshot: { ...defaultSnapshot, record_armed: true },
    });
    render(<TransportBar />);
    expect(screen.getByLabelText(/record armed/i)).toBeInTheDocument();
  });

  it("does not show record armed indicator when record_armed is false", () => {
    render(<TransportBar />);
    expect(screen.queryByLabelText(/record armed/i)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Punch mode controls
  // -------------------------------------------------------------------------

  it("renders PUNCH button", () => {
    render(<TransportBar />);
    expect(screen.getByTestId("punch-toggle")).toBeInTheDocument();
  });

  it("PUNCH button has correct text", () => {
    render(<TransportBar />);
    expect(screen.getByTestId("punch-toggle")).toHaveTextContent("PUNCH");
  });

  it("clicking PUNCH button calls togglePunchMode with toggled value", async () => {
    // Reset punch store
    usePunchStore.setState({ punchEnabled: false });

    render(<TransportBar />);
    await userEvent.click(screen.getByTestId("punch-toggle"));

    expect(mockInvoke).toHaveBeenCalledWith("toggle_punch_mode", { enabled: true });
  });

  it("clicking PUNCH button when enabled calls togglePunchMode with false", async () => {
    usePunchStore.setState({ punchEnabled: true });

    render(<TransportBar />);
    await userEvent.click(screen.getByTestId("punch-toggle"));

    expect(mockInvoke).toHaveBeenCalledWith("toggle_punch_mode", { enabled: false });
  });

  it("renders PRE-ROLL input", () => {
    render(<TransportBar />);
    expect(screen.getByTestId("pre-roll-input")).toBeInTheDocument();
  });

  it("PRE-ROLL input reflects preRollBars from punchStore", () => {
    usePunchStore.setState({ preRollBars: 3 });
    render(<TransportBar />);
    const input = screen.getByTestId("pre-roll-input") as HTMLInputElement;
    expect(input.value).toBe("3");
  });
});
