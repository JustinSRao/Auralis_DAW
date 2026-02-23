import { render, screen } from "@testing-library/react";
import { MidiSettingsPanel } from "../MidiSettingsPanel";

describe("MidiSettingsPanel", () => {
  it("renders the MIDI Settings heading", () => {
    render(<MidiSettingsPanel />);
    expect(screen.getByText("MIDI Settings")).toBeInTheDocument();
  });

  it("renders MIDI input and output dropdowns", () => {
    render(<MidiSettingsPanel />);
    expect(screen.getByLabelText("MIDI Input")).toBeInTheDocument();
    expect(screen.getByLabelText("MIDI Output")).toBeInTheDocument();
  });

  it("renders None option in input dropdown", () => {
    render(<MidiSettingsPanel />);
    const inputSelect = screen.getByLabelText("MIDI Input");
    const options = inputSelect.querySelectorAll("option");
    expect(options[0].textContent).toBe("None");
  });

  it("renders None option in output dropdown", () => {
    render(<MidiSettingsPanel />);
    const outputSelect = screen.getByLabelText("MIDI Output");
    const options = outputSelect.querySelectorAll("option");
    expect(options[0].textContent).toBe("None");
  });

  it("renders refresh devices button", () => {
    render(<MidiSettingsPanel />);
    expect(screen.getByText("Refresh Devices")).toBeInTheDocument();
  });

  it("shows disconnected status when no ports active", () => {
    render(<MidiSettingsPanel />);
    expect(screen.getByText("disconnected")).toBeInTheDocument();
  });
});
