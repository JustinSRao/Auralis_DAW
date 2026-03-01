import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthScreen } from "../AuthScreen";

// ---------------------------------------------------------------------------
// Mock child pages so we test routing logic only, not child implementation
// ---------------------------------------------------------------------------

vi.mock("../LoginPage", () => ({
  LoginPage: ({ onNavigate }: { onNavigate: (v: string) => void }) => (
    <div data-testid="login-page">
      <button onClick={() => onNavigate("register")}>go-register</button>
      <button onClick={() => onNavigate("profile-switcher")}>
        go-switcher
      </button>
    </div>
  ),
}));

vi.mock("../RegisterPage", () => ({
  RegisterPage: ({ onNavigate }: { onNavigate: (v: string) => void }) => (
    <div data-testid="register-page">
      <button onClick={() => onNavigate("login")}>go-login</button>
    </div>
  ),
}));

vi.mock("../ProfileSwitcher", () => ({
  ProfileSwitcher: ({ onNavigate }: { onNavigate: (v: string) => void }) => (
    <div data-testid="profile-switcher">
      <button onClick={() => onNavigate("login")}>go-login</button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthScreen", () => {
  it("renders login page by default", () => {
    render(<AuthScreen />);
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("register-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile-switcher")).not.toBeInTheDocument();
  });

  it("clicking register button shows register page", () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText("go-register"));
    expect(screen.getByTestId("register-page")).toBeInTheDocument();
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
  });

  it("clicking profile-switcher button shows profile-switcher", () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText("go-switcher"));
    expect(screen.getByTestId("profile-switcher")).toBeInTheDocument();
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
  });

  it("from register page, clicking back shows login page", () => {
    render(<AuthScreen />);
    // Navigate to register
    fireEvent.click(screen.getByText("go-register"));
    expect(screen.getByTestId("register-page")).toBeInTheDocument();

    // Navigate back to login
    fireEvent.click(screen.getByText("go-login"));
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("register-page")).not.toBeInTheDocument();
  });

  it("from profile-switcher, clicking back shows login page", () => {
    render(<AuthScreen />);
    // Navigate to profile-switcher
    fireEvent.click(screen.getByText("go-switcher"));
    expect(screen.getByTestId("profile-switcher")).toBeInTheDocument();

    // Navigate back to login
    fireEvent.click(screen.getByText("go-login"));
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-switcher")).not.toBeInTheDocument();
  });
});
