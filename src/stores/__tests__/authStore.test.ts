import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../authStore";
import type { User } from "../../lib/ipc";

const mockInvoke = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser: User = {
  id: "user-abc-123",
  username: "testuser",
  created_at: "2026-01-01T00:00:00Z",
};

const mockUser2: User = {
  id: "user-def-456",
  username: "seconduser",
  created_at: "2026-01-02T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useAuthStore.setState({
    isAuthenticated: false,
    isHydrating: false,
    isLoading: false,
    currentUser: null,
    users: [],
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("authStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it("has correct initial state", () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isHydrating).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.currentUser).toBeNull();
    expect(state.users).toEqual([]);
    expect(state.error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------

  it("login success: sets isAuthenticated and currentUser", async () => {
    mockInvoke.mockResolvedValueOnce({
      success: true,
      user: mockUser,
      error: null,
    });

    await useAuthStore.getState().login("testuser", "password123");

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.currentUser).toEqual(mockUser);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("login failure (success=false): sets error from response", async () => {
    mockInvoke.mockResolvedValueOnce({
      success: false,
      user: null,
      error: "Invalid credentials",
    });

    await useAuthStore.getState().login("testuser", "wrongpass");

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.currentUser).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe("Invalid credentials");
  });

  it("login failure (success=false) with no error message: uses fallback", async () => {
    mockInvoke.mockResolvedValueOnce({
      success: false,
      user: null,
      error: null,
    });

    await useAuthStore.getState().login("testuser", "wrongpass");

    const state = useAuthStore.getState();
    expect(state.error).toBe("Login failed");
    expect(state.isLoading).toBe(false);
  });

  it("login IPC rejection: sets error message and clears loading", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Network error"));

    await useAuthStore.getState().login("testuser", "password123");

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe("Network error");
  });

  it("login IPC rejects with non-Error: uses fallback message", async () => {
    mockInvoke.mockRejectedValueOnce("unexpected string error");

    await useAuthStore.getState().login("testuser", "password123");

    const state = useAuthStore.getState();
    expect(state.error).toBe("Login failed");
    expect(state.isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  it("register success: sets isAuthenticated and currentUser", async () => {
    mockInvoke.mockResolvedValueOnce({
      success: true,
      user: mockUser,
      error: null,
    });

    await useAuthStore.getState().register("newuser", "securepass1");

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.currentUser).toEqual(mockUser);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("register failure: sets error and clears loading", async () => {
    mockInvoke.mockResolvedValueOnce({
      success: false,
      user: null,
      error: "Username already taken",
    });

    await useAuthStore.getState().register("existinguser", "password123");

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.currentUser).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe("Username already taken");
  });

  it("register IPC rejection: sets error and clears loading", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("DB write failed"));

    await useAuthStore.getState().register("newuser", "password123");

    const state = useAuthStore.getState();
    expect(state.error).toBe("DB write failed");
    expect(state.isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  it("logout: calls logout IPC and clears isAuthenticated and currentUser", async () => {
    // Set up logged-in state first
    useAuthStore.setState({
      isAuthenticated: true,
      currentUser: mockUser,
    });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useAuthStore.getState().logout();

    expect(mockInvoke).toHaveBeenCalledWith("logout");
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.currentUser).toBeNull();
    expect(state.users).toEqual([]);
    expect(state.error).toBeNull();
  });

  it("logout: clears auth state even when IPC rejects", async () => {
    useAuthStore.setState({ isAuthenticated: true, currentUser: mockUser });
    mockInvoke.mockRejectedValueOnce(new Error("logout IPC failed"));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.currentUser).toBeNull();
  });

  // -------------------------------------------------------------------------
  // hydrateFromStorage
  // -------------------------------------------------------------------------

  it("hydrateFromStorage with no currentUser: returns without calling IPC", async () => {
    // currentUser is null — hydration should be a no-op
    await useAuthStore.getState().hydrateFromStorage();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isHydrating).toBe(false);
  });

  it("hydrateFromStorage when user found: sets isAuthenticated=true", async () => {
    useAuthStore.setState({ currentUser: mockUser });
    mockInvoke.mockResolvedValueOnce(mockUser);

    await useAuthStore.getState().hydrateFromStorage();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isHydrating).toBe(false);
  });

  it("hydrateFromStorage when user not found (null): clears currentUser", async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true });
    // Backend returns null — user was deleted from DB
    mockInvoke.mockResolvedValueOnce(null);

    await useAuthStore.getState().hydrateFromStorage();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.currentUser).toBeNull();
    expect(state.isHydrating).toBe(false);
  });

  it("hydrateFromStorage on IPC error: clears auth state", async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true });
    mockInvoke.mockRejectedValueOnce(new Error("DB unavailable"));

    await useAuthStore.getState().hydrateFromStorage();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.currentUser).toBeNull();
    expect(state.isHydrating).toBe(false);
  });

  // -------------------------------------------------------------------------
  // loadUsers
  // -------------------------------------------------------------------------

  it("loadUsers: sets users array from IPC response", async () => {
    mockInvoke.mockResolvedValueOnce([mockUser, mockUser2]);

    await useAuthStore.getState().loadUsers();

    const state = useAuthStore.getState();
    expect(state.users).toHaveLength(2);
    expect(state.users[0]).toEqual(mockUser);
    expect(state.users[1]).toEqual(mockUser2);
  });

  it("loadUsers on error: silently keeps existing users", async () => {
    useAuthStore.setState({ users: [mockUser] });
    mockInvoke.mockRejectedValueOnce(new Error("list_users failed"));

    await useAuthStore.getState().loadUsers();

    // Should keep the original list unchanged
    expect(useAuthStore.getState().users).toEqual([mockUser]);
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  it("clearError: sets error to null", () => {
    useAuthStore.setState({ error: "Some previous error" });

    useAuthStore.getState().clearError();

    expect(useAuthStore.getState().error).toBeNull();
  });
});
