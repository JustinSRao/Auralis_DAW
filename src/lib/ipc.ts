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

// --- Auth IPC wrappers (ipc-prefixed, used by authStore) ---

/** Attempts to log in with the provided credentials. */
export async function ipcLogin(
  username: string,
  password: string,
): Promise<AuthResponse> {
  return invoke<AuthResponse>("login", { username, password });
}

/** Registers a new user account. */
export async function ipcRegister(
  username: string,
  password: string,
): Promise<AuthResponse> {
  return invoke<AuthResponse>("register", { username, password });
}

/** Signals the backend to clear any server-side session state. */
export async function ipcLogout(): Promise<void> {
  return invoke<void>("logout");
}

/** Lists all registered users. */
export async function ipcListUsers(): Promise<User[]> {
  return invoke<User[]>("list_users");
}

/** Validates a stored user_id against the database. Returns null if the user no longer exists. */
export async function ipcGetCurrentUser(userId: string): Promise<User | null> {
  return invoke<User | null>("get_current_user", { userId });
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

// --- Transport types (mirror Rust audio::transport) ---

/** Transport playback state. */
export type TransportPlaybackState = "stopped" | "playing" | "paused" | "recording";

/** Bars:beats:ticks position. bar and beat are 1-indexed; tick is 0-indexed. */
export interface BbtPosition {
  bar: number;
  beat: number;
  tick: number;
}

/** Snapshot of all transport state. Payload of the "transport-state" Tauri event. */
export interface TransportSnapshot {
  state: TransportPlaybackState;
  position_samples: number;
  bbt: BbtPosition;
  bpm: number;
  time_sig_numerator: number;
  time_sig_denominator: number;
  loop_enabled: boolean;
  loop_start_samples: number;
  loop_end_samples: number;
  metronome_enabled: boolean;
  metronome_volume: number;
  metronome_pitch_hz: number;
  record_armed: boolean;
}

// --- Transport commands ---

/** Returns the current transport state snapshot. */
export async function getTransportState(): Promise<TransportSnapshot> {
  return invoke<TransportSnapshot>("get_transport_state");
}

/** Starts playback from the current position. Engine must be running. */
export async function transportPlay(): Promise<void> {
  return invoke<void>("transport_play");
}

/** Stops playback and resets the playhead. Engine must be running. */
export async function transportStop(): Promise<void> {
  return invoke<void>("transport_stop");
}

/** Pauses playback, holding the current position. Engine must be running. */
export async function transportPause(): Promise<void> {
  return invoke<void>("transport_pause");
}

/** Sets the BPM (20–300). Takes effect within one audio buffer period. */
export async function setBpm(bpm: number): Promise<void> {
  return invoke<void>("set_bpm", { bpm });
}

/** Sets the time signature (e.g. 4/4 = numerator 4, denominator 4). */
export async function setTimeSignature(
  numerator: number,
  denominator: number,
): Promise<void> {
  return invoke<void>("set_time_signature", { numerator, denominator });
}

/** Sets the loop region in beats. start must be less than end, both ≥ 0. */
export async function setLoopRegion(
  startBeats: number,
  endBeats: number,
): Promise<void> {
  return invoke<void>("set_loop_region", {
    startBeats,
    endBeats,
  });
}

/** Enables or disables loop mode. */
export async function toggleLoop(enabled: boolean): Promise<void> {
  return invoke<void>("toggle_loop", { enabled });
}

/** Enables or disables the metronome click track. */
export async function toggleMetronome(enabled: boolean): Promise<void> {
  return invoke<void>("toggle_metronome", { enabled });
}

/** Sets metronome click volume (0.0–1.0). */
export async function setMetronomeVolume(volume: number): Promise<void> {
  return invoke<void>("set_metronome_volume", { volume });
}

/** Sets metronome click pitch in Hz (200–5000). */
export async function setMetronomePitch(pitchHz: number): Promise<void> {
  return invoke<void>("set_metronome_pitch", { pitchHz });
}

/** Arms or disarms a track for recording. */
export async function setRecordArmed(armed: boolean): Promise<void> {
  return invoke<void>("set_record_armed", { armed });
}

/** Starts recording. Track must already be armed via `setRecordArmed`. */
export async function transportRecord(): Promise<void> {
  return invoke<void>("transport_record");
}

/** Seeks the playhead to a specific sample position. Only valid while paused or stopped. */
export async function transportSeek(positionSamples: number): Promise<void> {
  return invoke<void>("transport_seek", { positionSamples });
}

// ── Track Management ──────────────────────────────────────────────────

/** Runtime classification of a DAW track (distinct from the on-disk TrackType). */
export type DawTrackKind = "Midi" | "Audio" | "Instrument";

/** Lightweight runtime track model returned by the track management commands. */
export interface DawTrack {
  id: string;
  name: string;
  kind: DawTrackKind;
  color: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  instrumentId: string | null;
}

/** Creates a new track with the given kind and name. Returns the created track with a server-assigned UUID. */
export async function ipcCreateTrack(kind: DawTrackKind, name: string): Promise<DawTrack> {
  return invoke<DawTrack>("create_track", { kind, name });
}

/** Renames an existing track by its UUID. */
export async function ipcRenameTrack(id: string, name: string): Promise<void> {
  return invoke<void>("rename_track", { id, name });
}

/** Deletes a track by its UUID. */
export async function ipcDeleteTrack(id: string): Promise<void> {
  return invoke<void>("delete_track", { id });
}

/** Persists the new display order for all tracks. `ids` must be a permutation of all existing track UUIDs. */
export async function ipcReorderTracks(ids: string[]): Promise<void> {
  return invoke<void>("reorder_tracks", { ids });
}

/** Updates the display color of a track by its UUID. `color` is a CSS hex string (e.g. "#ff0000"). */
export async function ipcSetTrackColor(id: string, color: string): Promise<void> {
  return invoke<void>("set_track_color", { id, color });
}

// ── Synth instrument ───────────────────────────────────────────────────────

/** All valid synthesizer parameter names. */
export type SynthParamName =
  | "waveform"
  | "attack"
  | "decay"
  | "sustain"
  | "release"
  | "cutoff"
  | "resonance"
  | "env_amount"
  | "volume"
  | "detune"
  | "pulse_width";

/** Snapshot of all synthesizer parameters (mirrors Rust `SynthParamSnapshot`). */
export interface SynthParams {
  waveform: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
  env_amount: number;
  volume: number;
  detune: number;
  pulse_width: number;
}

/** Creates and registers the synthesizer instrument in the audio graph. */
export async function createSynthInstrument(): Promise<void> {
  return invoke<void>("create_synth_instrument");
}

/** Sets a single synthesizer parameter by name. Value must be in the parameter's valid range. */
export async function setSynthParam(
  param: SynthParamName,
  value: number,
): Promise<void> {
  return invoke<void>("set_synth_param", { param, value });
}

/** Returns a snapshot of all current synthesizer parameters. */
export async function getSynthState(): Promise<SynthParams> {
  return invoke<SynthParams>("get_synth_state");
}

// ── Sampler instrument ─────────────────────────────────────────────────────

/** All valid sampler parameter names. */
export type SamplerParamName = "attack" | "decay" | "sustain" | "release" | "volume";

/** Snapshot of sampler ADSR + volume parameters (mirrors Rust `SamplerParamSnapshot`). */
export interface SamplerParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  volume: number;
}

/** Snapshot of a single loaded zone (mirrors Rust `SampleZoneSnapshot`). */
export interface SampleZoneSnapshot {
  id: number;
  name: string;
  root_note: number;
  min_note: number;
  max_note: number;
  loop_start: number;
  loop_end: number;
  loop_enabled: boolean;
}

/** Full sampler state snapshot (params + zone list). */
export interface SamplerSnapshot {
  params: SamplerParams;
  zones: SampleZoneSnapshot[];
}

/** Creates and registers the sampler instrument in the audio graph. */
export async function createSamplerInstrument(): Promise<void> {
  return invoke<void>("create_sampler_instrument");
}

/**
 * Loads an audio file into the sampler as a new zone.
 * Returns the zone snapshot on success.
 */
export async function loadSampleZone(
  filePath: string,
  zoneId: number,
  rootNote: number,
  minNote: number,
  maxNote: number,
  loopStart: number,
  loopEnd: number,
  loopEnabled: boolean,
): Promise<SampleZoneSnapshot> {
  return invoke<SampleZoneSnapshot>("load_sample_zone", {
    filePath,
    zoneId,
    rootNote,
    minNote,
    maxNote,
    loopStart,
    loopEnd,
    loopEnabled,
  });
}

/** Removes a zone from the sampler by id. */
export async function removeSampleZone(zoneId: number): Promise<void> {
  return invoke<void>("remove_sample_zone", { zoneId });
}

/** Sets a single sampler parameter by name. */
export async function setSamplerParam(
  param: SamplerParamName,
  value: number,
): Promise<void> {
  return invoke<void>("set_sampler_param", { param, value });
}

/** Returns a snapshot of all current sampler state (params + zones). */
export async function getSamplerState(): Promise<SamplerSnapshot> {
  return invoke<SamplerSnapshot>("get_sampler_state");
}
