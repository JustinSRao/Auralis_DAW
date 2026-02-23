import { render, screen } from "@testing-library/react";
import { AudioSettingsPanel } from "../AudioSettingsPanel";

describe("AudioSettingsPanel", () => {
  it("renders the Audio Settings heading", () => {
    render(<AudioSettingsPanel />);
    expect(screen.getByText("Audio Settings")).toBeInTheDocument();
  });

  it("renders Start Engine button when stopped", () => {
    render(<AudioSettingsPanel />);
    expect(screen.getByText("Start Engine")).toBeInTheDocument();
  });

  it("renders device selectors", () => {
    render(<AudioSettingsPanel />);
    expect(screen.getByLabelText("Output Device")).toBeInTheDocument();
    expect(screen.getByLabelText("Input Device")).toBeInTheDocument();
  });

  it("renders sample rate and buffer size selectors", () => {
    render(<AudioSettingsPanel />);
    expect(screen.getByLabelText("Sample Rate")).toBeInTheDocument();
    expect(screen.getByLabelText("Buffer Size")).toBeInTheDocument();
  });

  it("renders test tone checkbox", () => {
    render(<AudioSettingsPanel />);
    expect(screen.getByLabelText("Test Tone (440 Hz)")).toBeInTheDocument();
  });

  it("renders refresh devices button", () => {
    render(<AudioSettingsPanel />);
    expect(screen.getByText("Refresh Devices")).toBeInTheDocument();
  });
});
