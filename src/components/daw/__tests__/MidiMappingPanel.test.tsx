import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MidiMappingPanel } from "../MidiMappingPanel";
import type { MidiMapping } from "../../../lib/ipc";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDeleteMapping = vi.fn();

let mockMappings: MidiMapping[] = [];

vi.mock("../../../stores/midiMappingStore", () => ({
  useMidiMappingStore: () => ({
    mappings: mockMappings,
    deleteMapping: mockDeleteMapping,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MidiMappingPanel", () => {
  beforeEach(() => {
    mockMappings = [];
    mockDeleteMapping.mockReset();
  });

  it("shows empty state when no mappings", () => {
    render(<MidiMappingPanel />);
    expect(screen.getByText(/no mappings yet/i)).toBeInTheDocument();
  });

  it("renders a row for each mapping", () => {
    mockMappings = [
      { param_id: "synth.cutoff", cc: 74, channel: null, min_value: 20, max_value: 20000 },
      { param_id: "synth.resonance", cc: 71, channel: 0, min_value: 0, max_value: 1 },
    ];
    render(<MidiMappingPanel />);
    expect(screen.getByText("synth.cutoff")).toBeInTheDocument();
    expect(screen.getByText("synth.resonance")).toBeInTheDocument();
    expect(screen.getByText("74")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
  });

  it("shows 'Any' for channel null", () => {
    mockMappings = [
      { param_id: "synth.cutoff", cc: 74, channel: null, min_value: 0, max_value: 1 },
    ];
    render(<MidiMappingPanel />);
    expect(screen.getByText("Any")).toBeInTheDocument();
  });

  it("shows 1-indexed channel when channel is set", () => {
    mockMappings = [
      { param_id: "synth.cutoff", cc: 74, channel: 0, min_value: 0, max_value: 1 },
    ];
    render(<MidiMappingPanel />);
    // channel 0 → display "1"
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("calls deleteMapping with param_id on delete button click", () => {
    mockMappings = [
      { param_id: "synth.cutoff", cc: 74, channel: null, min_value: 0, max_value: 1 },
    ];
    render(<MidiMappingPanel />);
    fireEvent.click(screen.getByRole("button", { name: /delete mapping for synth.cutoff/i }));
    expect(mockDeleteMapping).toHaveBeenCalledWith("synth.cutoff");
  });
});
