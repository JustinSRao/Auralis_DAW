import { invoke } from "@tauri-apps/api/core";

// --- Shared types (mirror Rust structs in auth/models.rs) ---

export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface AuthResponse {
  success: boolean;
  user: User | null;
  error: string | null;
}

// --- Core commands ---

/** Returns the application version string from Cargo.toml. */
export async function getVersion(): Promise<string> {
  return invoke<string>("get_version");
}

// --- Auth commands ---

/** Attempts to log in with the provided credentials. */
export async function login(
  username: string,
  password: string
): Promise<AuthResponse> {
  return invoke<AuthResponse>("login", { username, password });
}

/** Registers a new user account. */
export async function register(
  username: string,
  password: string
): Promise<AuthResponse> {
  return invoke<AuthResponse>("register", { username, password });
}

/** Signals the backend to clear any server-side session state. */
export async function logout(): Promise<void> {
  return invoke<void>("logout");
}

/** Lists all registered users (debug/admin utility). */
export async function listUsers(): Promise<User[]> {
  return invoke<User[]>("list_users");
}
