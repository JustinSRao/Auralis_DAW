import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RegisterPage } from "../RegisterPage";

// ---------------------------------------------------------------------------
// Mock authStore
// ---------------------------------------------------------------------------

const mockRegister = vi.fn();
const mockClearError = vi.fn();

let mockAuthState = {
  register: mockRegister,
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

function renderRegisterPage(onNavigate = vi.fn()) {
  return render(<RegisterPage onNavigate={onNavigate} />);
}

/** Fill in a valid registration form. */
function fillValidForm(
  username = "newuser",
  password = "securepass1",
  confirmPassword = "securepass1",
) {
  const usernameInput =
    screen.getByRole("textbox", { name: /username/i }) ??
    screen.getByPlaceholderText(/username/i);

  const passwordInputs = document.querySelectorAll('input[type="password"]');
  const passwordInput = passwordInputs[0] as HTMLInputElement;
  const confirmInput = passwordInputs[1] as HTMLInputElement;

  fireEvent.change(usernameInput, { target: { value: username } });
  fireEvent.change(passwordInput, { target: { value: password } });
  fireEvent.change(confirmInput, { target: { value: confirmPassword } });
}

function clickSubmit() {
  const submitBtn = screen.getByRole("button", {
    name: /create.*profile|create.*account|register|sign.?up/i,
  });
  fireEvent.click(submitBtn);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegisterPage", () => {
  beforeEach(() => {
    mockRegister.mockReset();
    mockClearError.mockReset();
    mockAuthState = {
      register: mockRegister,
      isLoading: false,
      error: null,
      clearError: mockClearError,
    };
  });

  it("renders username, password, and confirm password inputs", () => {
    renderRegisterPage();

    expect(
      screen.getByRole("textbox", { name: /username/i }) ??
        screen.getByPlaceholderText(/username/i),
    ).toBeInTheDocument();

    const passwordInputs = document.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBeGreaterThanOrEqual(2);
  });

  it("shows validation error when password is shorter than 8 characters", async () => {
    renderRegisterPage();
    fillValidForm("newuser", "short", "short");
    clickSubmit();

    await waitFor(() => {
      expect(
        screen.getByText(/at least 8 characters|too short|password.*short/i),
      ).toBeInTheDocument();
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("shows validation error when passwords do not match", async () => {
    renderRegisterPage();
    fillValidForm("newuser", "securepass1", "differentpass");
    clickSubmit();

    await waitFor(() => {
      expect(
        screen.getByText(/passwords.*match|do not match|mismatch/i),
      ).toBeInTheDocument();
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("does NOT call authStore.register when client validation fails", async () => {
    renderRegisterPage();
    // Both validations should fail here
    fillValidForm("u", "abc", "xyz");
    clickSubmit();

    await waitFor(() => {
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  it("calls authStore.register with username and password when form is valid", async () => {
    mockRegister.mockResolvedValue(undefined);
    renderRegisterPage();
    fillValidForm("newuser", "securepass1", "securepass1");
    clickSubmit();

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith("newuser", "securepass1");
    });
  });

  it("displays error from authStore.error", () => {
    mockAuthState = { ...mockAuthState, error: "Username already taken" };
    renderRegisterPage();
    expect(screen.getByText(/username already taken/i)).toBeInTheDocument();
  });

  it("button is disabled and shows Creating... when isLoading=true", () => {
    mockAuthState = { ...mockAuthState, isLoading: true };
    renderRegisterPage();
    const btn = screen.getByRole("button", {
      name: /creating|create.*profile|create.*account|register/i,
    });
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/creating/i);
  });

  it("clicking back button calls onNavigate('login')", () => {
    const onNavigate = vi.fn();
    renderRegisterPage(onNavigate);
    const backBtn = screen.getByRole("button", {
      name: /back|cancel|sign.?in|already.*account/i,
    });
    fireEvent.click(backBtn);
    expect(onNavigate).toHaveBeenCalledWith("login");
  });
});
