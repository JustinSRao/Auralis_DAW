---
sprint: 9
title: "Audio Recording (Live Input)"
type: fullstack
epic: 3
status: in-progress
created: 2026-02-22T22:09:57Z
started: 2026-03-04T21:31:08Z
completed: null
hours: null
workflow_version: "3.1.0"

---

# Sprint 9: Audio Recording (Live Input)

## Overview

| Field | Value |
|-------|-------|
| Sprint | 9 |
| Title | Audio Recording (Live Input) |
| Type | fullstack |
| Epic | 3 |
| Status | Planning |
| Created | 2026-02-22 |
| Started | - |
| Completed | - |

## Goal

Implement live audio recording from microphone or line-in using a cpal input stream, capturing audio to a WAV buffer in real time, with input level metering and the ability to place the resulting clip onto an audio track.

## Background

Recording live audio is a core DAW capability — vocalists, guitarists, and other musicians need to capture their performances directly into the project. This sprint adds the cpal input stream alongside the existing output stream and introduces the concept of an audio clip that can be placed on a track in the arrangement (which will be fully built in Sprint 13).

## Requirements

### Functional Requirements

- [ ] Enumerate available audio input devices (microphones, line-in, interface inputs) via cpal
- [ ] Open a cpal input stream on the selected input device and selected sample rate
- [ ] Start recording: capture input audio into a growing `Vec<f32>` ring buffer
- [ ] Stop recording: finalize the buffer and write it to a WAV file using the `hound` crate
- [ ] Place the recorded WAV file as a new audio clip on the active audio track
- [ ] Input monitoring: route input audio to the output in real time with adjustable monitoring latency
- [ ] Input level meter: compute RMS level per buffer and send to UI as a Tauri event
- [ ] Tauri commands: `get_input_devices`, `set_input_device`, `start_recording`, `stop_recording`

### Non-Functional Requirements

- [ ] Recording must not drop samples — use a lock-free ring buffer (`ringbuf` crate) between input callback and disk writer
- [ ] Input and output streams must run independently (separate cpal streams, not a duplex stream)
- [ ] Level meter updates sent to UI at most 30 times per second (every ~33 ms)
- [ ] Recorded WAV file written at the same sample rate as the audio engine (44100 or 48000 Hz)

## Dependencies

- **Sprints**: Sprint 2 (cpal AudioEngine already running output stream; reuse device enumeration patterns), Sprint 4 (project file system — WAV files saved in project's `audio/` folder)
- **External**: `hound` crate for WAV writing, `ringbuf` crate for lock-free input buffer

## Scope

### In Scope

- `src-tauri/src/audio/recorder.rs` — `AudioRecorder` struct managing input stream, ring buffer, and WAV writer
- `src-tauri/src/audio/devices.rs` — extend with input device enumeration
- Input level RMS calculation and Tauri event emission (`input_level_changed`)
- Tauri commands: `get_input_devices`, `set_input_device`, `start_recording`, `stop_recording`, `get_recording_status`
- React `RecordPanel` component: input device selector, record/stop button, level meter bar, monitoring on/off toggle and latency knob

### Out of Scope

- Multi-channel input recording (stereo and mono only)
- Punch-in/out recording (record only between markers)
- ASIO low-latency monitoring (standard WASAPI monitoring only in this sprint)
- Audio clip editing (Sprint 15)

## Technical Approach

`AudioRecorder` opens a separate `cpal::Stream` for the input device. The input callback writes samples into a `ringbuf::Producer` (lock-free). A separate Tokio task reads from the `ringbuf::Consumer` and appends samples to a `hound::WavWriter` that writes to a temp file in the project's `audio/` folder. RMS is computed per buffer in the input callback and sent to the main thread via a `crossbeam_channel` sender, where a periodic Tokio interval task forwards the latest RMS to the frontend as a `input_level_changed` Tauri event. On `stop_recording`, the WavWriter is finalized, the file path is returned to the frontend, and a new `AudioClip` entry is created in the project state pointing to the file.

## Tasks

### Phase 1: Planning
- [ ] Confirm cpal supports separate input and output streams simultaneously on Windows WASAPI
- [ ] Design `AudioRecorder` API and state machine (Idle → Armed → Recording → Stopped)
- [ ] Choose WAV bit depth for recorded files (32-bit float for maximum quality)

### Phase 2: Implementation
- [ ] Extend device enumeration to include input devices
- [ ] Implement `AudioRecorder` with cpal input stream and ringbuf consumer
- [ ] Implement Tokio disk-write task (ringbuf consumer → hound WavWriter)
- [ ] Implement RMS level computation and Tauri event emission
- [ ] Implement monitoring: route input ring buffer samples to the output mix in real time
- [ ] Implement `start_recording` and `stop_recording` Tauri commands
- [ ] Build React `RecordPanel` with device dropdown, level meter, record button
- [ ] Wire recorded clip creation into projectStore (add clip to active track)

### Phase 3: Validation
- [ ] Record a 10-second test with microphone — WAV file is valid and plays back correctly
- [ ] Verify zero dropped samples in a 60-second recording (ringbuf never overflows)
- [ ] Level meter updates in UI in real time during recording
- [ ] Monitoring: input signal heard in headphones with < 20 ms additional latency
- [ ] Stop recording — resulting clip appears on the track timeline

### Phase 4: Documentation
- [ ] Rustdoc on `AudioRecorder`, RMS calculation, ring buffer flow
- [ ] Document WAV file naming convention and storage path in project structure

## Acceptance Criteria

- [ ] Input devices are listed in the `RecordPanel` device selector
- [ ] Clicking record starts capturing audio; clicking stop finalizes the WAV file
- [ ] Recorded WAV file is valid (playable in any media player)
- [ ] Input level meter animates during recording to show incoming signal level
- [ ] Monitoring routes input to output when enabled with no crash
- [ ] Recorded clip is added to the active track's clip list after stop
- [ ] No audio dropouts or glitches on the output stream during recording

## Team Strategy

### Architecture Decisions
- **Input host**: Always use `cpal::default_host()` (WASAPI) for the input stream — ASIO does not support separate input+output streams, so forcing WASAPI for recording avoids conflicts
- **State machine**: `AtomicU8` constants — `REC_IDLE=0`, `REC_RECORDING=1`, `REC_FINALIZING=2`; state stored in `RecorderAtomics`
- **Ring buffers**: Two ring buffers — `rec_ring` (65536×2 samples, ~1.36s at 48kHz) feeds disk task; `mon_ring` (4096 samples, ~46ms) feeds output callback
- **Monitoring**: `HeapCons<f32>` handed to `AudioEngine` via new `AudioCommand::SetMonitoringConsumer`; mixed into output buffer in audio callback
- **RMS metering**: Computed in input callback, sent via `crossbeam_channel::try_send` → Tokio 33ms poller → `input-level-changed` event (≤30 Hz)
- **Finalization signal**: `disk_write_task` emits `recording-finalized` Tauri event when `WavWriter::finalize()` completes
- **WAV format**: 32-bit float, stereo, matching engine sample rate, temp dir with UUID filename
- **Monitoring toggle**: `Arc<AtomicBool>` + `Arc<AtomicF32>` gain — lock-free from input callback

### Module Structure
```
src-tauri/src/audio/
  recorder.rs   AudioRecorder, RecorderAtomics, RecorderStatus, compute_rms, disk_write_task
```

### RecorderCommand Enum (channel-based)
```rust
enum RecorderCommand { Stop }
```

### New AudioCommand Variants (added to engine.rs)
```rust
SetMonitoringConsumer(ringbuf::HeapCons<f32>),
SetMonitoringEnabled(bool),
```

### Tauri Commands
`get_input_devices`, `set_input_device`, `start_recording`, `stop_recording`, `get_recording_status`, `set_monitoring_enabled`, `set_monitoring_gain`

### Tauri Events
- `input-level-changed` — f32 RMS (0.0–1.0), ≤30 Hz
- `recording-finalized` — String file path, emitted once on WAV finalize

### React UI
- `RecordPanel` in right panel alongside AudioSettingsPanel / MidiSettingsPanel
- Device selector, RMS level bar, REC/STOP button, monitoring toggle + gain knob
- Listens to `input-level-changed` and `recording-finalized` events

## Notes

Created: 2026-02-22
