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

// --- Audio types (mirror Rust audio::types) ---

export type AudioHostType = "Asio" | "Wasapi";

export interface AudioDeviceInfo {
  name: string;
  host_type: AudioHostType;
  is_input: boolean;
  is_output: boolean;
  supported_sample_rates: number[];
  supported_buffer_sizes: number[];
}

export interface EngineConfig {
  sample_rate: number;
  buffer_size: number;
  output_device: string | null;
  input_device: string | null;
}

export type EngineState = "stopped" | "starting" | "running" | "stopping";

export interface EngineStatus {
  state: EngineState;
  config: EngineConfig;
  active_host: AudioHostType | null;
  test_tone_active: boolean;
}

// --- Audio commands ---

/** Enumerates all available ASIO and WASAPI audio devices. */
export async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
  return invoke<AudioDeviceInfo[]>("get_audio_devices");
}

/** Returns the current audio engine status. */
export async function getEngineStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>("get_engine_status");
}

/** Starts the audio engine with the current configuration. */
export async function startEngine(): Promise<EngineStatus> {
  return invoke<EngineStatus>("start_engine");
}

/** Stops the audio engine. */
export async function stopEngine(): Promise<EngineStatus> {
  return invoke<EngineStatus>("stop_engine");
}

/** Selects an audio input or output device by name. Engine must be stopped. */
export async function setAudioDevice(
  deviceName: string,
  isInput: boolean,
): Promise<EngineStatus> {
  return invoke<EngineStatus>("set_audio_device", {
    deviceName,
    isInput,
  });
}

/** Updates engine sample rate and/or buffer size. Engine must be stopped. */
export async function setEngineConfig(
  sampleRate?: number,
  bufferSize?: number,
): Promise<EngineStatus> {
  return invoke<EngineStatus>("set_engine_config", {
    sampleRate: sampleRate ?? null,
    bufferSize: bufferSize ?? null,
  });
}

/** Toggles the 440 Hz test tone. Can be called while engine is running. */
export async function setTestTone(enabled: boolean): Promise<void> {
  return invoke<void>("set_test_tone", { enabled });
}
