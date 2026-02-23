import { render, screen } from "@testing-library/react";
import { DAWLayout } from "../DAWLayout";

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
});
