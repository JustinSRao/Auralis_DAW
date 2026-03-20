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
  punch_enabled: boolean;
  punch_in_beats: number;
  punch_out_beats: number;
  pre_roll_bars: number;
  /** Tempo automation points.  Optional — absent in project files before v1.2.0. */
  tempo_map?: TempoPoint[];
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

// ── Pattern types (mirror Rust project::pattern) ──────────────────────────────

/** A single MIDI note inside a pattern (camelCase to match pianoRollTypes.MidiNote). */
export interface PatternMidiNote {
  id: string;
  pitch: number;
  startBeats: number;
  durationBeats: number;
  velocity: number;
  channel: number;
}

/** The content stored inside a pattern. */
export type PatternContent =
  | { type: 'Midi'; notes: PatternMidiNote[] }
  | { type: 'Audio'; filePath: string };

/** Valid pattern length values in bars. */
export type PatternLengthBars = 1 | 2 | 4 | 8 | 16 | 32;

/** A named, reusable musical pattern belonging to a track. */
/** Sprint 14: Automation interpolation mode. Matches Rust `Interp` enum. */
export type AutomationInterp = 'Linear' | 'Exponential' | 'Step';

/** A single automation breakpoint. Matches Rust `ControlPointSnapshot`. */
export interface ControlPointData {
  tick: number;
  value: number;
  interp: AutomationInterp;
}

/** All breakpoints for one parameter in one pattern. Matches Rust `AutomationLaneSnapshot`. */
export interface AutomationLaneData {
  patternId: string;
  parameterId: string;
  enabled: boolean;
  points: ControlPointData[];
}

/** A single timestamped record event. Matches Rust `AutomationRecordEvent`. */
export interface AutomationRecordEvent {
  parameterId: string;
  value: number;
  tick: number;
}

export interface PatternData {
  id: string;
  name: string;
  trackId: string;
  lengthBars: PatternLengthBars;
  content: PatternContent;
  /** Automation lanes keyed by parameterId. Present in project files >= v1.1.0. */
  automation?: Record<string, AutomationLaneData>;
}

// ── Arrangement types (mirror Rust project::arrangement) ─────────────────────

/** A single clip placed on the song timeline. References a Pattern by UUID. */
export interface ArrangementClip {
  id: string;
  patternId: string;
  trackId: string;
  /** 0-indexed bar position. */
  startBar: number;
  /** Clip length in bars. */
  lengthBars: number;
}

/** Root arrangement data embedded in ProjectFileData. */
export interface ArrangementData {
  clips: ArrangementClip[];
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
  /** All patterns in this project. May be absent in files saved before v1.1.0. */
  patterns?: PatternData[];
  /** Arrangement clip placements. May be absent in files saved before v1.2.0. */
  arrangement?: ArrangementData;
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
  punch_enabled: boolean;
  punch_in_samples: number;
  punch_out_samples: number;
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

// ── Drum Machine ──────────────────────────────────────────────────────────────

/** A single step in the drum pattern grid. */
export interface DrumStepSnapshot {
  active: boolean;
  /** Velocity 1–127. */
  velocity: number;
}

/** State snapshot for a single drum pad. */
export interface DrumPadSnapshot {
  idx: number;
  name: string;
  has_sample: boolean;
  steps: DrumStepSnapshot[];
}

/** Full drum machine state snapshot returned by `get_drum_state`. */
export interface DrumMachineSnapshot {
  bpm: number;
  swing: number;
  pattern_length: number;
  playing: boolean;
  current_step: number;
  pads: DrumPadSnapshot[];
}

/** Creates the drum machine in the audio graph. */
export async function createDrumMachine(): Promise<void> {
  return invoke<void>("create_drum_machine");
}

/** Toggles a step and sets its velocity. */
export async function setDrumStep(
  padIdx: number,
  stepIdx: number,
  active: boolean,
  velocity: number,
): Promise<void> {
  return invoke<void>("set_drum_step", { padIdx, stepIdx, active, velocity });
}

/** Loads an audio file into a drum pad (async decode). */
export async function loadDrumPadSample(
  padIdx: number,
  filePath: string,
): Promise<void> {
  return invoke<void>("load_drum_pad_sample", { padIdx, filePath });
}

/** Sets swing amount (0.0–0.5). */
export async function setDrumSwing(swing: number): Promise<void> {
  return invoke<void>("set_drum_swing", { swing });
}

/** Sets drum machine BPM (1–300). */
export async function setDrumBpm(bpm: number): Promise<void> {
  return invoke<void>("set_drum_bpm", { bpm });
}

/** Sets pattern length (16 or 32). */
export async function setDrumPatternLength(length: number): Promise<void> {
  return invoke<void>("set_drum_pattern_length", { length });
}

/** Starts drum machine playback. */
export async function drumPlay(): Promise<void> {
  return invoke<void>("drum_play");
}

/** Pauses drum machine playback. */
export async function drumStop(): Promise<void> {
  return invoke<void>("drum_stop");
}

/** Stops playback and resets to step 0. */
export async function drumReset(): Promise<void> {
  return invoke<void>("drum_reset");
}

/** Returns a full snapshot of the drum machine state. */
export async function getDrumState(): Promise<DrumMachineSnapshot> {
  return invoke<DrumMachineSnapshot>("get_drum_state");
}

// ── Sprint 9: Audio Recorder ──────────────────────────────────────────────────

export type RecorderState = "idle" | "recording" | "finalizing";

/** Snapshot of the audio recorder state returned from `get_recording_status`. */
export interface RecorderStatus {
  state: RecorderState;
  input_device: string | null;
  output_path: string | null;
  monitoring_enabled: boolean;
  monitoring_gain: number;
}

/** Returns all available audio input devices. */
export async function getInputDevices(): Promise<AudioDeviceInfo[]> {
  return invoke<AudioDeviceInfo[]>("get_input_devices");
}

/** Selects the input device for recording. */
export async function setInputDevice(deviceName: string): Promise<void> {
  return invoke<void>("set_input_device", { deviceName });
}

/** Starts recording. Returns the path of the WAV file being written. */
export async function startRecording(): Promise<string> {
  return invoke<string>("start_recording");
}

/** Stops recording and begins WAV finalization. Returns the file path. */
export async function stopRecording(): Promise<string> {
  return invoke<string>("stop_recording");
}

/** Returns the current recorder status. */
export async function getRecordingStatus(): Promise<RecorderStatus> {
  return invoke<RecorderStatus>("get_recording_status");
}

/** Enables or disables input monitoring pass-through. */
export async function setMonitoringEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_monitoring_enabled", { enabled });
}

/** Sets the monitoring gain (0.0–1.0). */
export async function setMonitoringGain(gain: number): Promise<void> {
  return invoke<void>("set_monitoring_gain", { gain });
}

// ── LFO Modulation ────────────────────────────────────────────────────────────

/** All valid LFO parameter names. */
export type LfoParamName =
  | "rate"
  | "depth"
  | "waveform"
  | "bpm_sync"
  | "division"
  | "phase_reset"
  | "destination";

/**
 * Snapshot of all parameters for a single LFO.
 *
 * - rate: 0.01–20.0 Hz (free-running frequency)
 * - depth: 0.0–1.0 (modulation amount)
 * - waveform: 0=Sine, 1=Triangle, 2=SawUp, 3=SawDown, 4=Square, 5=SampleAndHold
 * - bpm_sync: 0.0=free, 1.0=BPM-synced
 * - division: 0=1/4, 1=1/8, 2=1/16, 3=1/32 (active when bpm_sync=1)
 * - phase_reset: 0.0=free, 1.0=reset phase on note-on
 * - destination: 0=Cutoff, 1=Pitch, 2=Amplitude, 3=Resonance
 */
export interface LfoParams {
  rate: number;
  depth: number;
  waveform: number;
  bpm_sync: number;
  division: number;
  phase_reset: number;
  destination: number;
}

/** Full LFO state snapshot for both LFO slots. */
export interface LfoStateSnapshot {
  lfo1: LfoParams;
  lfo2: LfoParams;
}

/** Sets a single LFO parameter by name. slot must be 1 or 2. */
export async function setLfoParam(
  slot: 1 | 2,
  param: LfoParamName,
  value: number,
): Promise<void> {
  return invoke<void>("set_lfo_param", { slot, param, value });
}

/** Returns a snapshot of both LFO states. */
export async function getLfoState(): Promise<LfoStateSnapshot> {
  return invoke<LfoStateSnapshot>("get_lfo_state");
}

// ── Step Sequencer ────────────────────────────────────────────────────────────

/** A single step in the sequencer pattern (mirrors Rust `SequencerStepSnapshot`). */
export interface SequencerStep {
  enabled: boolean;
  /** MIDI note number 0–127. */
  note: number;
  /** Velocity 1–127. */
  velocity: number;
  /** Gate time 0.1–1.0. */
  gate: number;
  /** Trigger probability 0–100. */
  probability: number;
}

/** Full step sequencer state snapshot returned by `get_sequencer_state`. */
export interface SequencerSnapshot {
  playing: boolean;
  current_step: number;
  /** Active pattern length: 16, 32, or 64. */
  pattern_length: number;
  /** Time division: 4=1/4, 8=1/8, 16=1/16, 32=1/32. */
  time_div: number;
  /** Semitone transpose -24..+24. */
  transpose: number;
  steps: SequencerStep[];
}

/** Creates the step sequencer in the audio graph. */
export async function createSequencer(): Promise<void> {
  return invoke<void>("create_sequencer");
}

/**
 * Sets all parameters for a single sequencer step.
 *
 * @param idx         - Step index 0–63.
 * @param enabled     - Whether the step fires.
 * @param note        - MIDI note 0–127.
 * @param velocity    - Velocity 1–127.
 * @param gate        - Gate time 0.1–1.0.
 * @param probability - Trigger probability 0–100.
 */
export async function setSequencerStep(
  idx: number,
  enabled: boolean,
  note: number,
  velocity: number,
  gate: number,
  probability: number,
): Promise<void> {
  return invoke<void>("set_sequencer_step", {
    idx,
    enabled,
    note,
    velocity,
    gate,
    probability,
  });
}

/** Sets the active pattern length (16, 32, or 64 steps). */
export async function setSequencerLength(length: number): Promise<void> {
  return invoke<void>("set_sequencer_length", { length });
}

/** Sets the time division (4=1/4, 8=1/8, 16=1/16, 32=1/32). */
export async function setSequencerTimeDiv(div: number): Promise<void> {
  return invoke<void>("set_sequencer_time_div", { div });
}

/** Sets the transpose offset in semitones (-24..+24). */
export async function setSequencerTranspose(semitones: number): Promise<void> {
  return invoke<void>("set_sequencer_transpose", { semitones });
}

/** Returns a full snapshot of the step sequencer state. */
export async function getSequencerState(): Promise<SequencerSnapshot> {
  return invoke<SequencerSnapshot>("get_sequencer_state");
}

/** Starts step sequencer playback. */
export async function sequencerPlay(): Promise<void> {
  return invoke<void>("sequencer_play");
}

/** Stops step sequencer playback. */
export async function sequencerStop(): Promise<void> {
  return invoke<void>("sequencer_stop");
}

/** Stops playback and resets to step 0. */
export async function sequencerReset(): Promise<void> {
  return invoke<void>("sequencer_reset");
}

// ── Piano Roll ────────────────────────────────────────────────────────────────

/**
 * Triggers a brief preview note on the active synth instrument.
 *
 * Silent no-op when no instrument has been loaded. Used by the on-screen
 * piano keyboard in the Piano Roll editor.
 *
 * @param note       - MIDI note number 0–127.
 * @param velocity   - MIDI velocity 1–127.
 * @param durationMs - How long the note sounds, in milliseconds (default 200 ms).
 */
export async function previewNote(
  note: number,
  velocity: number,
  durationMs: number = 200,
): Promise<void> {
  return invoke<void>("preview_note", { note, velocity, durationMs });
}

// ── Pattern management ────────────────────────────────────────────────────────

/**
 * Creates a new empty MIDI pattern for the given track.
 * Returns the created pattern with a server-assigned UUID.
 */
export async function ipcCreatePattern(
  trackId: string,
  name: string,
): Promise<PatternData> {
  return invoke<PatternData>("create_pattern", { trackId, name });
}

/** Validates a pattern rename. The frontend store applies the rename on success. */
export async function ipcRenamePattern(id: string, name: string): Promise<void> {
  return invoke<void>("rename_pattern", { id, name });
}

/**
 * Duplicates an existing pattern, returning the copy with a new UUID.
 * The copy's name has " (copy)" appended and is truncated to 128 chars.
 */
export async function ipcDuplicatePattern(pattern: PatternData): Promise<PatternData> {
  return invoke<PatternData>("duplicate_pattern", { pattern });
}

/** Validates a pattern deletion. The frontend store removes it on success. */
export async function ipcDeletePattern(id: string): Promise<void> {
  return invoke<void>("delete_pattern", { id });
}

/**
 * Validates a pattern length change. `lengthBars` must be 1, 2, 4, 8, 16, or 32.
 * The frontend store applies the change on success.
 */
export async function ipcSetPatternLength(
  id: string,
  lengthBars: PatternLengthBars,
): Promise<void> {
  return invoke<void>("set_pattern_length", { id, lengthBars });
}

// ── Arrangement clip management ───────────────────────────────────────────────

/**
 * Creates a new arrangement clip placement, assigning a UUID.
 * Returns the full clip with its server-assigned id.
 */
export async function ipcAddArrangementClip(
  patternId: string,
  trackId: string,
  startBar: number,
  lengthBars: number,
): Promise<ArrangementClip> {
  return invoke<ArrangementClip>("add_arrangement_clip", {
    patternId,
    trackId,
    startBar,
    lengthBars,
  });
}

/** Validates a clip move. Frontend applies the update on Ok. */
export async function ipcMoveArrangementClip(
  id: string,
  newTrackId: string,
  newStartBar: number,
): Promise<void> {
  return invoke<void>("move_arrangement_clip", { id, newTrackId, newStartBar });
}

/** Validates a clip resize. Frontend applies the update on Ok. */
export async function ipcResizeArrangementClip(
  id: string,
  newLengthBars: number,
): Promise<void> {
  return invoke<void>("resize_arrangement_clip", { id, newLengthBars });
}

/** Validates a clip deletion. Frontend removes it on Ok. */
export async function ipcDeleteArrangementClip(id: string): Promise<void> {
  return invoke<void>("delete_arrangement_clip", { id });
}

/**
 * Creates a duplicate clip at a new position.
 * Returns the new clip with its server-assigned id.
 */
export async function ipcDuplicateArrangementClip(
  sourceId: string,
  newStartBar: number,
  patternId: string,
  trackId: string,
  lengthBars: number,
): Promise<ArrangementClip> {
  return invoke<ArrangementClip>("duplicate_arrangement_clip", {
    sourceId,
    newStartBar,
    patternId,
    trackId,
    lengthBars,
  });
}

// ── Sprint 14: Automation ─────────────────────────────────────────────────────

/** Adds or updates a control point in a lane. Returns the created/updated point. */
export async function ipcSetAutomationPoint(
  patternId: string,
  parameterId: string,
  tick: number,
  value: number,
  interp: AutomationInterp,
): Promise<ControlPointData> {
  return invoke<ControlPointData>("set_automation_point", {
    patternId, parameterId, tick, value, interp,
  });
}

/** Removes a control point from a lane. */
export async function ipcDeleteAutomationPoint(
  patternId: string,
  parameterId: string,
  tick: number,
): Promise<void> {
  return invoke<void>("delete_automation_point", { patternId, parameterId, tick });
}

/** Changes the interpolation mode of an existing control point. */
export async function ipcSetAutomationInterp(
  patternId: string,
  parameterId: string,
  tick: number,
  interp: AutomationInterp,
): Promise<void> {
  return invoke<void>("set_automation_interp", { patternId, parameterId, tick, interp });
}

/** Returns the current lane snapshot for a (patternId, parameterId) pair. */
export async function ipcGetAutomationLane(
  patternId: string,
  parameterId: string,
): Promise<AutomationLaneData> {
  return invoke<AutomationLaneData>("get_automation_lane", { patternId, parameterId });
}

/** Enables or disables an automation lane without deleting its breakpoints. */
export async function ipcEnableAutomationLane(
  patternId: string,
  parameterId: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("enable_automation_lane", { patternId, parameterId, enabled });
}

/** Sends a batch of record events to the automation engine. */
export async function ipcRecordAutomationBatch(
  events: AutomationRecordEvent[],
): Promise<void> {
  return invoke<void>("record_automation_batch", { events });
}

// ── Sprint 31: Arrangement Scheduler ─────────────────────────────────────────

/**
 * A single MIDI note pre-expanded from an arrangement clip, with sample-accurate
 * timing. The frontend computes these from clip bar positions + pattern MIDI notes
 * + current BPM before sending to the backend scheduler.
 */
export interface ScheduledNotePayload {
  onSample: number;
  offSample: number;
  pitch: number;
  velocity: number;
  channel: number;
  trackId: string;
}

/**
 * Sends the pre-computed scheduled note list to the arrangement scheduler.
 *
 * Call this whenever: arrangement clips change, BPM changes, project loads.
 * Notes must be sorted ascending by `onSample`.
 */
export async function ipcSetArrangementClips(
  notes: ScheduledNotePayload[],
): Promise<void> {
  return invoke<void>("set_arrangement_clips", { notes });
}

/**
 * Registers the current synth's MIDI sender with the scheduler for a track.
 * Call after `create_synth_instrument` succeeds for a track.
 */
export async function ipcRegisterSchedulerSender(
  trackId: string,
): Promise<void> {
  return invoke<void>("register_scheduler_sender", { trackId });
}

// ── MIDI File Import (Sprint 32) ─────────────────────────────────────────────

/** A single note returned from MIDI file parsing, with timing in beats. */
export interface ImportedNote {
  pitch: number;
  velocity: number;
  channel: number;
  startBeats: number;
  durationBeats: number;
}

/** A single MIDI track parsed from a .mid file. */
export interface ImportedTrack {
  /** 0-based MIDI track index within the file. */
  midiTrackIndex: number;
  /** Human-readable track name from the MIDI TrackName meta-event. */
  name: string;
  /** All notes in this track, converted to beat positions. */
  notes: ImportedNote[];
  /** True if this track contains no NoteOn events. */
  isEmpty: boolean;
}

/** Top-level result of parsing a .mid file. */
export interface MidiFileInfo {
  /** MIDI format: 0 = Type 0 (single track), 1 = Type 1 (multi-track). */
  format: number;
  /** BPM suggestion extracted from the first tempo meta-event (default 120). */
  suggestedBpm: number;
  /** All parsed tracks. */
  tracks: ImportedTrack[];
}

/** Per-track payload the user sends back after confirming the import dialog. */
export interface ImportTrackPayload {
  midiTrackIndex: number;
  patternName: string;
  trackId: string;
  notes: ImportedNote[];
  /** Must be 1, 2, 4, 8, 16, or 32. */
  lengthBars: PatternLengthBars;
}

/**
 * Parses a .mid file at `path` and returns track metadata with notes already
 * converted to beat positions.
 */
export async function ipcImportMidiFile(path: string): Promise<MidiFileInfo> {
  return invoke<MidiFileInfo>("import_midi_file", { path });
}

/**
 * Creates Pattern structs from the user-confirmed import payload.
 * Returns the created patterns for the frontend to inject into patternStore.
 */
export async function ipcCreatePatternsFromImport(
  payloads: ImportTrackPayload[],
): Promise<PatternData[]> {
  return invoke<PatternData[]>("create_patterns_from_import", { payloads });
}

// ---------------------------------------------------------------------------
// Sprint 36: MIDI Recording
// ---------------------------------------------------------------------------

/** Quantize grid applied to recorded note start times. */
export type RecordQuantize = 'off' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtySecond';

/** Recording mode. */
export type RecordMode = 'replace' | 'overdub';

/** Tauri event payload emitted when a note completes recording. */
export interface RecordedNoteEvent {
  patternId: string;
  note: PatternMidiNote;
}

/** Tauri event payload emitted when recording starts. */
export interface RecordingStartedEvent {
  patternId: string;
  trackId: string;
  mode: string;
}

/** Tauri event payload emitted when recording stops. */
export interface RecordingStoppedEvent {
  patternId: string;
}

/** Starts a MIDI recording session into the given pattern. */
export async function ipcStartMidiRecording(
  patternId: string,
  trackId: string,
  overdub: boolean,
  quantize: RecordQuantize,
): Promise<void> {
  return invoke<void>("start_midi_recording", { patternId, trackId, overdub, quantize });
}

/** Stops the active MIDI recording session and flushes pending notes. */
export async function ipcStopMidiRecording(): Promise<void> {
  return invoke<void>("stop_midi_recording");
}

/** Updates the quantize grid for the active recording session. */
export async function ipcSetRecordQuantize(quantize: RecordQuantize): Promise<void> {
  return invoke<void>("set_record_quantize", { quantize });
}

// ---------------------------------------------------------------------------
// Sprint 38: Punch In/Out Recording
// ---------------------------------------------------------------------------

/**
 * Punch marker positions in both beats and samples.
 * Mirrors Rust `PunchMarkers` struct.
 */
export interface PunchMarkers {
  punch_in_beats: number;
  punch_out_beats: number;
  punch_in_samples: number;
  punch_out_samples: number;
}

/** Sets the punch-in point in beats. */
export async function setPunchIn(beats: number): Promise<void> {
  return invoke<void>("set_punch_in", { beats });
}

/** Sets the punch-out point in beats. */
export async function setPunchOut(beats: number): Promise<void> {
  return invoke<void>("set_punch_out", { beats });
}

/** Enables or disables punch mode. */
export async function togglePunchMode(enabled: boolean): Promise<void> {
  return invoke<void>("toggle_punch_mode", { enabled });
}

/** Returns the current punch-in/out marker positions. */
export async function getPunchMarkers(): Promise<PunchMarkers> {
  return invoke<PunchMarkers>("get_punch_markers");
}

// ── Tempo Map (Sprint 41) ─────────────────────────────────────────────

/** A single tempo automation point. */
export interface TempoPoint {
  /** Musical position in ticks (960 PPQ). */
  tick: number;
  /** Tempo at this point in beats per minute. */
  bpm: number;
  /** Interpolation mode to the next point. */
  interp: 'Step' | 'Linear';
}

/** Replaces the project tempo map with the given list of points. */
export async function setTempoMap(points: TempoPoint[]): Promise<void> {
  return invoke<void>('set_tempo_map', { points });
}

/** Returns the current list of tempo points from the backend snapshot. */
export async function getTempoMap(): Promise<TempoPoint[]> {
  return invoke<TempoPoint[]>('get_tempo_map');
}

// ── MIDI Export (Sprint 43) ───────────────────────────────────────────────────

/** A single note payload for MIDI export. Beat positions are pre-computed by the caller. */
export interface ExportNote {
  pitch: number;
  velocity: number;
  channel: number;
  /** Start in beats from the beginning of the exported region. */
  startBeats: number;
  /** Duration in beats. Minimum 1 tick after backend conversion. */
  durationBeats: number;
}

/** A single DAW track payload for arrangement export. */
export interface ExportTrack {
  name: string;
  /** Notes with absolute beat positions (clip offset already applied). */
  notes: ExportNote[];
}

/** Export configuration. */
export interface ExportOptions {
  /** PPQ for the output file. Default 480 matches internal representation. */
  exportPpq: number;
}

/**
 * Exports a single pattern as a Type 0 MIDI file.
 *
 * @param notes            - Notes from the pattern (beat positions from pattern start).
 * @param path             - Absolute file path from the Tauri save dialog.
 * @param options          - Export options (PPQ).
 * @param tempoPoints      - Full tempo map from tempoMapStore.
 * @param timeSigNumerator - Time signature numerator from transport state.
 * @param timeSigDenominator - Time signature denominator from transport state.
 */
export async function ipcExportMidiPattern(
  notes: ExportNote[],
  path: string,
  options: ExportOptions,
  tempoPoints: TempoPoint[],
  timeSigNumerator: number,
  timeSigDenominator: number,
): Promise<void> {
  return invoke<void>('export_midi_pattern', {
    notes,
    path,
    options,
    tempoPoints,
    timeSigNumerator,
    timeSigDenominator,
  });
}

/**
 * Exports the full arrangement as a Type 1 MIDI file.
 *
 * The caller must compute absolute beat positions for each track's notes by
 * adding `clip.startBar * beatsPerBar` to each note's `startBeats`.
 *
 * @param tracks           - One entry per DAW track, with flattened absolute-beat notes.
 * @param path             - Absolute file path from the Tauri save dialog.
 * @param options          - Export options (PPQ).
 * @param tempoPoints      - Full tempo map from tempoMapStore.
 * @param timeSigNumerator - Time signature numerator.
 * @param timeSigDenominator - Time signature denominator.
 */
export async function ipcExportMidiArrangement(
  tracks: ExportTrack[],
  path: string,
  options: ExportOptions,
  tempoPoints: TempoPoint[],
  timeSigNumerator: number,
  timeSigDenominator: number,
): Promise<void> {
  return invoke<void>('export_midi_arrangement', {
    tracks,
    path,
    options,
    tempoPoints,
    timeSigNumerator,
    timeSigDenominator,
  });
}

// ── Sprint 44: Take Lanes ─────────────────────────────────────────────────────

/** A single recorded loop pass. */
export interface Take {
  id: string;
  patternId: string;
  takeNumber: number;
  trackId: string;
  loopStartBeats: number;
  loopEndBeats: number;
  isActive: boolean;
}

/** A comp region — selects a time sub-range from a specific take. */
export interface CompRegion {
  id: string;
  startBeats: number;
  endBeats: number;
  takeId: string;
}

/** All takes for one track. */
export interface TakeLane {
  trackId: string;
  takes: Take[];
  compRegions: CompRegion[];
  expanded: boolean;
}

/** Payload of the `take-created` Tauri event. */
export interface TakeCreatedEvent {
  take: Take;
  trackId: string;
}

/** Payload of the `take-recording-started` Tauri event. */
export interface TakeRecordingStartedEvent {
  trackId: string;
  patternId: string;
  takeNumber: number;
}

/** Returns the take lane for a track (empty lane if none). */
export async function ipcGetTakeLanes(trackId: string): Promise<TakeLane> {
  return invoke<TakeLane>('get_take_lanes', { trackId });
}

/** Sets the active playback take for a track. */
export async function ipcSetActiveTake(trackId: string, takeId: string): Promise<void> {
  return invoke<void>('set_active_take', { trackId, takeId });
}

/** Deletes a take from a track's lane. */
export async function ipcDeleteTake(trackId: string, takeId: string): Promise<void> {
  return invoke<void>('delete_take', { trackId, takeId });
}

/**
 * Arms a track for loop recording. Pass null to disarm.
 * Loop recording activates automatically when the transport loop is enabled
 * and the transport is recording.
 */
export async function ipcArmLoopRecording(trackId: string | null): Promise<void> {
  return invoke<void>('arm_loop_recording', { trackId });
}

/** Toggles the expanded/collapsed state of a track's take lane panel. */
export async function ipcToggleTakeLaneExpanded(trackId: string): Promise<boolean> {
  return invoke<boolean>('toggle_take_lane_expanded', { trackId });
}
