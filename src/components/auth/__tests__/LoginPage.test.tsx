import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginPage } from "../LoginPage";

// ---------------------------------------------------------------------------
// Mock authStore
// ---------------------------------------------------------------------------

const mockLogin = vi.fn();
const mockClearError = vi.fn();

let mockAuthState = {
  login: mockLogin,
  isLoading: false,
  error: null as string | null,
  clearError: mockClearError,
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: vi.fn(() => mockAuthState),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderLoginPage(onNavigate = vi.fn()) {
  return render(<LoginPage onNavigate={onNavigate} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockClearError.mockReset();
    mockAuthState = {
      login: mockLogin,
      isLoading: false,
      error: null,
      clearError: mockClearError,
    };
  });

  it("renders username and password inputs", () => {
    renderLoginPage();
    // Inputs are associated via <label for="login-username"> and <label for="login-password">
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders sign-in button", () => {
    renderLoginPage();
    expect(
      screen.getByRole("button", { name: /sign.?in|log.?in/i }),
    ).toBeInTheDocument();
  });

  it("submit calls login with username and password", async () => {
    mockLogin.mockResolvedValue(undefined);
    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "hunter2" },
    });

    fireEvent.click(screen.getByRole("button", { name: /sign.?in|log.?in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("alice", "hunter2");
    });
  });

  it("displays error message when error is set", () => {
    mockAuthState = { ...mockAuthState, error: "Invalid credentials" };
    renderLoginPage();
    expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it("button is disabled when isLoading=true and shows loading label", () => {
    mockAuthState = { ...mockAuthState, isLoading: true };
    renderLoginPage();
    // When loading, the only submit-area button text changes to "Signing in..."
    const btn = screen.getByRole("button", { name: /signing.?in/i });
    expect(btn).toBeDisabled();
  });

  it("clicking Create new profile calls onNavigate('register')", () => {
    const onNavigate = vi.fn();
    renderLoginPage(onNavigate);
    const createBtn = screen.getByRole("button", {
      name: /create.*profile|new.*profile|register|create.*account/i,
    });
    fireEvent.click(createBtn);
    expect(onNavigate).toHaveBeenCalledWith("register");
  });

  it("clicking Switch profile calls onNavigate('profile-switcher')", () => {
    const onNavigate = vi.fn();
    renderLoginPage(onNavigate);
    const switchBtn = screen.getByRole("button", {
      name: /switch.*profile|switch.*user/i,
    });
    fireEvent.click(switchBtn);
    expect(onNavigate).toHaveBeenCalledWith("profile-switcher");
  });
});
