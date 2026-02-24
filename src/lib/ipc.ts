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

// --- MIDI types (mirror Rust midi::types) ---

export interface MidiDeviceInfo {
  name: string;
  is_input: boolean;
  is_output: boolean;
}

export interface MidiStatus {
  active_input: string | null;
  active_output: string | null;
}

// --- MIDI commands ---

/** Enumerates all available MIDI input and output devices. */
export async function getMidiDevices(): Promise<MidiDeviceInfo[]> {
  return invoke<MidiDeviceInfo[]>("get_midi_devices");
}

/** Returns the current MIDI connection status. */
export async function getMidiStatus(): Promise<MidiStatus> {
  return invoke<MidiStatus>("get_midi_status");
}

/** Connects to a MIDI input port by name. */
export async function connectMidiInput(
  portName: string,
): Promise<MidiStatus> {
  return invoke<MidiStatus>("connect_midi_input", { portName });
}

/** Disconnects the active MIDI input port. */
export async function disconnectMidiInput(): Promise<MidiStatus> {
  return invoke<MidiStatus>("disconnect_midi_input");
}

/** Connects to a MIDI output port by name. */
export async function connectMidiOutput(
  portName: string,
): Promise<MidiStatus> {
  return invoke<MidiStatus>("connect_midi_output", { portName });
}

/** Disconnects the active MIDI output port. */
export async function disconnectMidiOutput(): Promise<MidiStatus> {
  return invoke<MidiStatus>("disconnect_midi_output");
}

// --- Project types (mirror Rust project::format) ---

export interface SchemaVersion {
  major: number;
  minor: number;
  patch: number;
}

export type TrackType = "Audio" | "Midi" | "Bus";

export interface TransportSettings {
  bpm: number;
  time_sig_numerator: number;
  time_sig_denominator: number;
  sample_rate: number;
  loop_enabled: boolean;
  loop_start_beats: number;
  loop_end_beats: number;
}

export interface MidiNoteData {
  note: number;
  velocity: number;
  start_beats: number;
  duration_beats: number;
  channel: number;
}

export interface MidiCcData {
  controller: number;
  value: number;
  position_beats: number;
  channel: number;
}

export type ClipContent =
  | { type: "Audio"; sample_id: string; start_offset_samples: number; gain: number }
  | { type: "Midi"; notes: MidiNoteData[]; cc_events: MidiCcData[] }
  | { type: "Pattern"; pattern_id: string };

export interface ClipData {
  id: string;
  name: string;
  start_beats: number;
  duration_beats: number;
  content: ClipContent;
}

export type InstrumentData =
  | { type: "Synth"; params: Record<string, unknown> }
  | { type: "Sampler"; params: Record<string, unknown> }
  | { type: "DrumMachine"; params: Record<string, unknown> }
  | { type: "Vst3Plugin"; plugin_id: string; plugin_name: string; state_base64: string };

export type EffectData =
  | { type: "Eq"; params: Record<string, unknown> }
  | { type: "Reverb"; params: Record<string, unknown> }
  | { type: "Compressor"; params: Record<string, unknown> }
  | { type: "Delay"; params: Record<string, unknown> }
  | { type: "Vst3Plugin"; plugin_id: string; plugin_name: string; state_base64: string };

export interface AutomationPoint {
  position_beats: number;
  value: number;
  curve: "Linear" | "Step" | "Exponential";
}

export interface AutomationLane {
  target: string;
  points: AutomationPoint[];
}

export interface TrackData {
  id: string;
  name: string;
  track_type: TrackType;
  color: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  output_bus: string | null;
  instrument: InstrumentData | null;
  effects: EffectData[];
  clips: ClipData[];
  automation: AutomationLane[];
}

export interface MasterBusData {
  volume: number;
  pan: number;
  effects: EffectData[];
}

export interface SampleReference {
  id: string;
  original_filename: string;
  archive_path: string;
  sample_rate: number;
  channels: number;
  duration_secs: number;
}

export interface ProjectFileData {
  schema_version: SchemaVersion;
  id: string;
  name: string;
  created_at: string;
  modified_at: string;
  transport: TransportSettings;
  tracks: TrackData[];
  master: MasterBusData;
  samples: SampleReference[];
}

export interface RecentProject {
  name: string;
  file_path: string;
  modified_at: string;
}

export interface SaveResult {
  success: boolean;
  file_path: string;
}

// --- Project commands ---

/** Creates a new empty project with the given name. */
export async function newProject(name: string): Promise<ProjectFileData> {
  return invoke<ProjectFileData>("new_project", { name });
}

/** Saves the project to disk as a .mapp archive. */
export async function saveProject(
  project: ProjectFileData,
  filePath: string,
): Promise<SaveResult> {
  return invoke<SaveResult>("save_project", { project, filePath });
}

/** Loads a project from a .mapp file. */
export async function loadProject(filePath: string): Promise<ProjectFileData> {
  return invoke<ProjectFileData>("load_project", { filePath });
}

/** Returns the list of recently opened projects. */
export async function getRecentProjects(): Promise<RecentProject[]> {
  return invoke<RecentProject[]>("get_recent_projects");
}

/** Marks the project as dirty for auto-save tracking. */
export async function markProjectDirty(
  project: ProjectFileData,
  filePath: string,
): Promise<void> {
  return invoke<void>("mark_project_dirty", { project, filePath });
}
