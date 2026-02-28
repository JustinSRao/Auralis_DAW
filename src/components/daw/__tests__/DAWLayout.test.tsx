import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { DAWLayout } from "../DAWLayout";
import { useTransportStore } from "@/stores/transportStore";
import type { TransportSnapshot } from "@/lib/ipc";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  vi.clearAllMocks();
  useTransportStore.setState({ snapshot: defaultSnapshot, isLoading: false, error: null });
  // Route invoke by command name so TransportBar's refreshState() always gets a valid snapshot
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_transport_state") return Promise.resolve(defaultSnapshot);
    return Promise.resolve(undefined);
  });
});

describe("DAWLayout", () => {
  it("renders the MusicApp brand label", () => {
    render(<DAWLayout />);
    expect(screen.getByText("MusicApp")).toBeInTheDocument();
  });

  it("renders the Instrument Browser panel", () => {
    render(<DAWLayout />);
    expect(screen.getByText("Instrument Browser")).toBeInTheDocument();
  });

  it("renders the Audio Settings panel", () => {
    render(<DAWLayout />);
    expect(screen.getByText("Audio Settings")).toBeInTheDocument();
  });

  it("renders the Mixer panel", () => {
    render(<DAWLayout />);
    expect(screen.getByText("Mixer")).toBeInTheDocument();
  });

  it("renders the transport bar", () => {
    render(<DAWLayout />);
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });
});
