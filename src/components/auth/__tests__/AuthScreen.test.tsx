import { render, screen } from "@testing-library/react";
import { AuthScreen } from "../AuthScreen";

describe("AuthScreen", () => {
  it("renders the application title", () => {
    render(<AuthScreen />);
    expect(screen.getByText("Music Application")).toBeInTheDocument();
  });

  it("shows the Sprint 5 placeholder message", () => {
    render(<AuthScreen />);
    expect(
      screen.getByText("Authentication coming in Sprint 5")
    ).toBeInTheDocument();
  });
});
