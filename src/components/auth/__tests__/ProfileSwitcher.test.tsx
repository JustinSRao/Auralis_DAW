import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProfileSwitcher } from "../ProfileSwitcher";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/lib/ipc";

// ---------------------------------------------------------------------------
// Mock authStore
// ---------------------------------------------------------------------------

const mockLoadUsers = vi.fn();
const mockLogin = vi.fn();
const mockClearError = vi.fn();

const defaultAuthState = {
  users: [] as User[],
  isLoading: false,
  error: null as string | null,
  loadUsers: mockLoadUsers,
  login: mockLogin,
  clearError: mockClearError,
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: vi.fn(() => defaultAuthState),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser1: User = {
  id: "user-1",
  username: "alice",
  created_at: "2026-01-01T00:00:00Z",
};

const mockUser2: User = {
  id: "user-2",
  username: "bob",
  created_at: "2026-01-02T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSwitcher(onNavigate = vi.fn()) {
  return render(<ProfileSwitcher onNavigate={onNavigate} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfileSwitcher", () => {
  beforeEach(() => {
    mockLoadUsers.mockReset();
    mockLogin.mockReset();
    mockClearError.mockReset();
    // Reset the mock to return default state
    vi.mocked(useAuthStore).mockReturnValue({ ...defaultAuthState });
  });

  it("calls loadUsers on mount", () => {
    renderSwitcher();
    expect(mockLoadUsers).toHaveBeenCalledTimes(1);
  });

  it("shows 'No profiles found' when users list is empty", () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...defaultAuthState,
      users: [],
    });
    renderSwitcher();
    expect(
      screen.getByText(/no profiles found|no users|no accounts/i),
    ).toBeInTheDocument();
  });

  it("renders user list items when users are provided", () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...defaultAuthState,
      users: [mockUser1, mockUser2],
    });
    renderSwitcher();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("clicking a user shows password input for that user", () => {
    vi.mocked(useAuthStore).mockReturnValue({
      ...defaultAuthState,
      users: [mockUser1, mockUser2],
    });
    renderSwitcher();

    fireEvent.click(screen.getByText("alice"));

    // A password input should now appear
    const passwordInput = document.querySelector('input[type="password"]');
    expect(passwordInput).toBeTruthy();
  });

  it("submitting password input calls login with username and password", async () => {
    mockLogin.mockResolvedValue(undefined);
    vi.mocked(useAuthStore).mockReturnValue({
      ...defaultAuthState,
      users: [mockUser1, mockUser2],
    });
    renderSwitcher();

    // Select alice
    fireEvent.click(screen.getByText("alice"));

    // Type password
    const passwordInput = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(passwordInput).toBeTruthy();
    fireEvent.change(passwordInput, { target: { value: "mypassword" } });

    // Submit — use the exact button text "Sign In" (not "Back to sign in")
    // getAllByRole and pick the submit-type button to avoid ambiguity
    const allBtns = screen.getAllByRole("button", {
      name: /sign.?in/i,
    });
    const submitBtn =
      allBtns.find((b) => (b as HTMLButtonElement).type === "submit") ??
      allBtns[0];
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("alice", "mypassword");
    });
  });

  it("clicking back button calls onNavigate('login')", () => {
    const onNavigate = vi.fn();
    renderSwitcher(onNavigate);
    const backBtn = screen.getByRole("button", { name: /back|cancel/i });
    fireEvent.click(backBtn);
    expect(onNavigate).toHaveBeenCalledWith("login");
  });
});
