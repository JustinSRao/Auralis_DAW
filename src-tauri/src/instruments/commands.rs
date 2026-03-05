use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;

use tauri::State;

use crate::audio::commands::AudioEngineState;
use crate::audio::engine::AudioCommand;
use crate::audio::graph::AudioGraph;
use crate::midi::commands::MidiManagerState;
use crate::midi::types::TimestampedMidiEvent;

use super::drum_machine::{
    DrumAtomics, DrumCommand, DrumMachine, DrumMachineSnapshot, DrumPadSnapshot,
};
use super::sampler::Sampler;
use super::sampler::MAX_ZONES;
use super::sampler::decoder::decode_audio_file;
use super::sampler::zone::{
    set_param_by_name as set_sampler_param_by_name, SamplerParamSnapshot, SamplerParams,
    SamplerSnapshot, SampleZoneSnapshot,
};
use super::sampler::SamplerCommand;
use super::synth::SubtractiveSynth;
use super::synth::params::{set_param_by_name, SynthParamSnapshot, SynthParams};

/// Type alias for the synthesizer parameter state managed by Tauri.
///
/// Shared between the Tauri command thread and the audio thread via atomics.
/// The audio thread reads parameters lock-free; the UI thread writes via atomics.
pub type SynthState = Arc<SynthParams>;

/// Stores the sender end of the synth's dedicated MIDI channel.
///
/// Initially `None`. Populated by [`create_synth_instrument`]. Kept in managed
/// state for potential future use (e.g., removing the synth from the graph).
pub type SynthMidiTxState =
    Arc<Mutex<Option<crossbeam_channel::Sender<TimestampedMidiEvent>>>>;

/// Creates and registers the synthesizer instrument in the audio graph.
///
/// Steps:
/// 1. Creates a new MIDI channel pair for the synth.
/// 2. Stores the sender in `SynthMidiTxState` and registers it with `MidiManager`
///    so incoming MIDI events are forwarded to the synth.
/// 3. Builds a new `AudioGraph` containing `SubtractiveSynth` and publishes it
///    via `AudioCommand::SwapGraph`.
#[tauri::command]
pub async fn create_synth_instrument(
    engine: State<'_, AudioEngineState>,
    synth_params: State<'_, SynthState>,
    synth_midi_tx: State<'_, SynthMidiTxState>,
    midi_manager: State<'_, MidiManagerState>,
) -> Result<(), String> {
    let params = Arc::clone(&*synth_params);

    // Fresh dedicated MIDI channel for this synth instance
    let (midi_tx, midi_rx) =
        crossbeam_channel::bounded::<TimestampedMidiEvent>(256);

    // Register the sender in managed state (for future reference)
    {
        let mut tx_guard = synth_midi_tx
            .lock()
            .map_err(|e| format!("Failed to lock synth MIDI tx: {}", e))?;
        *tx_guard = Some(midi_tx.clone());
    }

    // Wire the sender into MidiManager's fan-out so MIDI input flows to the synth
    {
        let mut mgr = midi_manager
            .lock()
            .map_err(|e| format!("Failed to lock MIDI manager: {}", e))?;
        mgr.add_instrument_sender(midi_tx);
    }

    // Build the audio graph containing the synth node
    let mut graph = AudioGraph::new(1024, 2);
    let synth = SubtractiveSynth::new(params, midi_rx, 44100.0);
    graph.add_node(Box::new(synth));

    // Swap the new graph into the running engine
    let eng = engine
        .lock()
        .map_err(|e| format!("Failed to lock audio engine: {}", e))?;
    eng.send_transport_command(AudioCommand::SwapGraph(graph))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Sets a single synthesizer parameter by name.
///
/// The atomic write takes effect within the next audio buffer (< 6 ms at default settings).
#[tauri::command]
pub fn set_synth_param(
    synth: State<'_, SynthState>,
    param: String,
    value: f32,
) -> Result<(), String> {
    set_param_by_name(&synth, &param, value)
}

/// Returns a serializable snapshot of all current synthesizer parameters.
#[tauri::command]
pub fn get_synth_state(synth: State<'_, SynthState>) -> Result<SynthParamSnapshot, String> {
    Ok(SynthParamSnapshot::from_params(&synth))
}

// ── Sampler managed-state type aliases ────────────────────────────────────────

/// Type alias for the sampler parameter state managed by Tauri.
///
/// Shared between the Tauri command thread and the audio thread via atomics.
pub type SamplerState = Arc<SamplerParams>;

/// Stores the sender for the sampler's MIDI channel (fan-out from MidiManager).
pub type SamplerMidiTxState =
    Arc<Mutex<Option<crossbeam_channel::Sender<TimestampedMidiEvent>>>>;

/// Stores the sender for sampler lifecycle commands (zone load/remove).
pub type SamplerCmdTxState =
    Arc<Mutex<Option<crossbeam_channel::Sender<SamplerCommand>>>>;

/// In-memory zone list for `get_sampler_state` — keeps zone metadata without
/// holding `Arc<SampleBuffer>` references on the Tauri side.
pub type SamplerZoneListState = Arc<Mutex<Vec<SampleZoneSnapshot>>>;

// ── Sampler Tauri commands ────────────────────────────────────────────────────

/// Creates and registers the sampler instrument in the audio graph.
///
/// Steps:
/// 1. Creates dedicated MIDI and command channel pairs.
/// 2. Stores senders in managed state and registers the MIDI sender with `MidiManager`.
/// 3. Builds a new `AudioGraph` containing the `Sampler` node and publishes it
///    via `AudioCommand::SwapGraph`.
#[tauri::command]
pub async fn create_sampler_instrument(
    engine: State<'_, AudioEngineState>,
    sampler_params: State<'_, SamplerState>,
    sampler_midi_tx: State<'_, SamplerMidiTxState>,
    sampler_cmd_tx: State<'_, SamplerCmdTxState>,
    midi_manager: State<'_, MidiManagerState>,
) -> Result<(), String> {
    let params = Arc::clone(&*sampler_params);

    let (midi_tx, midi_rx) = crossbeam_channel::bounded::<TimestampedMidiEvent>(256);
    let (cmd_tx, cmd_rx) = crossbeam_channel::bounded::<SamplerCommand>(64);

    {
        let mut tx_guard = sampler_midi_tx
            .lock()
            .map_err(|e| format!("Failed to lock sampler MIDI tx: {}", e))?;
        *tx_guard = Some(midi_tx.clone());
    }

    {
        let mut tx_guard = sampler_cmd_tx
            .lock()
            .map_err(|e| format!("Failed to lock sampler cmd tx: {}", e))?;
        *tx_guard = Some(cmd_tx);
    }

    {
        let mut mgr = midi_manager
            .lock()
            .map_err(|e| format!("Failed to lock MIDI manager: {}", e))?;
        mgr.add_instrument_sender(midi_tx);
    }

    let mut graph = AudioGraph::new(1024, 2);
    let sampler = Sampler::new(params, midi_rx, cmd_rx, 44100.0);
    graph.add_node(Box::new(sampler));

    let eng = engine
        .lock()
        .map_err(|e| format!("Failed to lock audio engine: {}", e))?;
    eng.send_transport_command(AudioCommand::SwapGraph(graph))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Loads an audio file into the sampler as a new zone.
///
/// Decoding is performed on a Tokio blocking thread so the audio callback
/// is never blocked. The decoded `Arc<SampleBuffer>` is forwarded to the
/// audio thread via the command channel.
///
/// `root_note`  — MIDI note number at which the sample plays at original pitch.
/// `min_note` / `max_note` — inclusive MIDI note range that triggers this zone.
#[tauri::command]
pub async fn load_sample_zone(
    file_path: String,
    zone_id: u32,
    root_note: u8,
    min_note: u8,
    max_note: u8,
    loop_start: usize,
    loop_end: usize,
    loop_enabled: bool,
    sampler_cmd_tx: State<'_, SamplerCmdTxState>,
    zone_list: State<'_, SamplerZoneListState>,
) -> Result<SampleZoneSnapshot, String> {
    let path = PathBuf::from(&file_path);

    // Validate note range
    if min_note > max_note {
        return Err(format!(
            "min_note ({}) must be <= max_note ({})",
            min_note, max_note
        ));
    }

    // Validate zone capacity before doing expensive decode.
    // If zone_id already exists it will be replaced (not a new slot), so skip
    // the capacity check in that case.
    {
        let list = zone_list
            .lock()
            .map_err(|e| format!("Failed to lock zone list: {}", e))?;
        let is_replacement = list.iter().any(|z| z.id == zone_id);
        if !is_replacement && list.len() >= MAX_ZONES {
            return Err(format!(
                "Sampler zone limit reached ({} zones). Remove a zone before adding another.",
                MAX_ZONES
            ));
        }
    }

    // Decode on a blocking thread — never blocks the async executor
    let buffer = tokio::task::spawn_blocking(move || decode_audio_file(&path))
        .await
        .map_err(|e| format!("Decode task panicked: {}", e))?
        .map_err(|e| e.to_string())?;

    // Memory ceiling warning (512 MB)
    let bytes = buffer.samples.len() * std::mem::size_of::<f32>();
    if bytes > 512 * 1024 * 1024 {
        log::warn!(
            "Loaded sample '{}' is {:.1} MB — exceeds 512 MB warning threshold",
            file_path,
            bytes as f64 / (1024.0 * 1024.0)
        );
    }

    let name = PathBuf::from(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let snapshot = SampleZoneSnapshot {
        id: zone_id,
        name: name.clone(),
        root_note,
        min_note,
        max_note,
        loop_start,
        loop_end,
        loop_enabled,
    };

    // Send to audio thread
    {
        let guard = sampler_cmd_tx
            .lock()
            .map_err(|e| format!("Failed to lock sampler cmd tx: {}", e))?;
        let tx = guard.as_ref().ok_or("Sampler not initialized")?;
        tx.try_send(SamplerCommand::LoadZone {
            id: zone_id,
            name,
            root_note,
            min_note,
            max_note,
            buffer,
            loop_start,
            loop_end,
            loop_enabled,
        })
        .map_err(|e| format!("Failed to send zone to audio thread: {}", e))?;
    }

    // Update the zone list snapshot on the Tauri side
    {
        let mut list = zone_list
            .lock()
            .map_err(|e| format!("Failed to lock zone list: {}", e))?;
        if let Some(existing) = list.iter_mut().find(|z| z.id == zone_id) {
            *existing = snapshot.clone();
        } else {
            list.push(snapshot.clone());
        }
    }

    Ok(snapshot)
}

/// Removes a zone from the sampler by id.
#[tauri::command]
pub fn remove_sample_zone(
    zone_id: u32,
    sampler_cmd_tx: State<'_, SamplerCmdTxState>,
    zone_list: State<'_, SamplerZoneListState>,
) -> Result<(), String> {
    {
        let guard = sampler_cmd_tx
            .lock()
            .map_err(|e| format!("Failed to lock sampler cmd tx: {}", e))?;
        let tx = guard.as_ref().ok_or("Sampler not initialized")?;
        tx.try_send(SamplerCommand::RemoveZone { id: zone_id })
            .map_err(|e| format!("Failed to send remove command: {}", e))?;
    }

    {
        let mut list = zone_list
            .lock()
            .map_err(|e| format!("Failed to lock zone list: {}", e))?;
        list.retain(|z| z.id != zone_id);
    }

    Ok(())
}

/// Sets a single sampler parameter by name.
#[tauri::command]
pub fn set_sampler_param(
    sampler: State<'_, SamplerState>,
    param: String,
    value: f32,
) -> Result<(), String> {
    set_sampler_param_by_name(&sampler, &param, value)
}

/// Returns a serializable snapshot of the current sampler state (params + zone list).
#[tauri::command]
pub fn get_sampler_state(
    sampler: State<'_, SamplerState>,
    zone_list: State<'_, SamplerZoneListState>,
) -> Result<SamplerSnapshot, String> {
    let params = SamplerParamSnapshot::from_params(&sampler);
    let zones = zone_list
        .lock()
        .map_err(|e| format!("Failed to lock zone list: {}", e))?
        .clone();
    Ok(SamplerSnapshot { params, zones })
}

// ── Drum Machine managed-state type aliases ────────────────────────────────────

/// Lock-free drum machine parameter atomics shared across threads.
pub type DrumAtomicsState = Arc<DrumAtomics>;

/// Sender half of the drum machine command channel.
pub type DrumCmdTxState = Arc<Mutex<Option<crossbeam_channel::Sender<DrumCommand>>>>;

/// Shadow copy of the drum pattern grid on the Tauri side.
///
/// Updated by Tauri commands alongside the audio-thread commands so that
/// `get_drum_state` can return the full pattern without querying the audio thread.
pub type DrumPatternShadowState = Arc<Mutex<Vec<DrumPadSnapshot>>>;

// ── Drum Machine Tauri commands ────────────────────────────────────────────────

/// Creates and registers the drum machine in the audio graph.
///
/// Spawns a Tokio relay task that drains the step event channel and emits
/// `drum-step-changed` Tauri events at ~250 Hz for UI playhead highlighting.
#[tauri::command]
pub async fn create_drum_machine(
    app: tauri::AppHandle,
    engine: State<'_, AudioEngineState>,
    atomics: State<'_, DrumAtomicsState>,
    cmd_tx_state: State<'_, DrumCmdTxState>,
) -> Result<(), String> {
    let (cmd_tx, cmd_rx) = crossbeam_channel::bounded::<DrumCommand>(64);
    let (step_tx, step_rx) = crossbeam_channel::bounded::<u8>(32);

    {
        let mut guard = cmd_tx_state
            .lock()
            .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;
        *guard = Some(cmd_tx);
    }

    let drum_atomics = Arc::clone(&*atomics);
    let machine = DrumMachine::new(drum_atomics, cmd_rx, step_tx, 44100.0);

    let mut graph = AudioGraph::new(1024, 2);
    graph.add_node(Box::new(machine));

    let eng = engine
        .lock()
        .map_err(|e| format!("Failed to lock audio engine: {}", e))?;
    eng.send_transport_command(AudioCommand::SwapGraph(graph))
        .map_err(|e| e.to_string())?;

    // Relay task: poll step channel at ~250 Hz and emit Tauri events
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(4));
        loop {
            interval.tick().await;
            while let Ok(step) = step_rx.try_recv() {
                if let Err(e) = tauri::Emitter::emit(&app, "drum-step-changed", step) {
                    log::warn!("Failed to emit drum-step-changed: {}", e);
                }
            }
        }
    });

    Ok(())
}

/// Toggles a single step on/off and sets its velocity.
#[tauri::command]
pub fn set_drum_step(
    pad_idx: u8,
    step_idx: u8,
    active: bool,
    velocity: u8,
    cmd_tx_state: State<'_, DrumCmdTxState>,
    shadow: State<'_, DrumPatternShadowState>,
) -> Result<(), String> {
    {
        let guard = cmd_tx_state
            .lock()
            .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;
        let tx = guard.as_ref().ok_or("Drum machine not initialized")?;
        tx.try_send(DrumCommand::SetStep {
            pad_idx,
            step_idx,
            active,
            velocity: velocity.clamp(1, 127),
        })
        .map_err(|e| format!("Failed to send SetStep: {}", e))?;
    }

    {
        let mut pads = shadow
            .lock()
            .map_err(|e| format!("Failed to lock drum shadow: {}", e))?;
        if let Some(pad) = pads.get_mut(pad_idx as usize) {
            if let Some(step) = pad.steps.get_mut(step_idx as usize) {
                step.active = active;
                step.velocity = velocity.clamp(1, 127);
            }
        }
    }

    Ok(())
}

/// Loads an audio file into a drum pad (decoded on a blocking thread).
#[tauri::command]
pub async fn load_drum_pad_sample(
    pad_idx: u8,
    file_path: String,
    cmd_tx_state: State<'_, DrumCmdTxState>,
    shadow: State<'_, DrumPatternShadowState>,
) -> Result<(), String> {
    if pad_idx as usize >= 16 {
        return Err(format!("pad_idx {} out of range (max 15)", pad_idx));
    }

    let path = PathBuf::from(&file_path);
    let buffer = tokio::task::spawn_blocking(move || decode_audio_file(&path))
        .await
        .map_err(|e| format!("Decode task panicked: {}", e))?
        .map_err(|e| e.to_string())?;

    let name = PathBuf::from(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    {
        let guard = cmd_tx_state
            .lock()
            .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;
        let tx = guard.as_ref().ok_or("Drum machine not initialized")?;
        tx.try_send(DrumCommand::LoadSample {
            pad_idx,
            name: name.clone(),
            buffer,
        })
        .map_err(|e| format!("Failed to send LoadSample: {}", e))?;
    }

    {
        let mut pads = shadow
            .lock()
            .map_err(|e| format!("Failed to lock drum shadow: {}", e))?;
        if let Some(pad) = pads.get_mut(pad_idx as usize) {
            pad.name = name;
            pad.has_sample = true;
        }
    }

    Ok(())
}

/// Sets the swing amount (0.0–0.5).
#[tauri::command]
pub fn set_drum_swing(
    swing: f32,
    atomics: State<'_, DrumAtomicsState>,
) -> Result<(), String> {
    atomics
        .swing
        .store(swing.clamp(0.0, 0.5), Ordering::Relaxed);
    Ok(())
}

/// Sets the drum machine BPM (1.0–300.0).
#[tauri::command]
pub fn set_drum_bpm(
    bpm: f32,
    atomics: State<'_, DrumAtomicsState>,
) -> Result<(), String> {
    atomics.bpm.store(bpm.clamp(1.0, 300.0), Ordering::Relaxed);
    Ok(())
}

/// Sets the active pattern length (16 or 32 steps).
#[tauri::command]
pub fn set_drum_pattern_length(
    length: u8,
    cmd_tx_state: State<'_, DrumCmdTxState>,
    shadow: State<'_, DrumPatternShadowState>,
) -> Result<(), String> {
    let clamped: u8 = if length <= 16 { 16 } else { 32 };

    {
        let guard = cmd_tx_state
            .lock()
            .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;
        let tx = guard.as_ref().ok_or("Drum machine not initialized")?;
        tx.try_send(DrumCommand::SetPatternLength { length: clamped })
            .map_err(|e| format!("Failed to send SetPatternLength: {}", e))?;
    }

    // Extend or trim shadow steps to match the new length
    {
        let mut pads = shadow
            .lock()
            .map_err(|e| format!("Failed to lock drum shadow: {}", e))?;
        for pad in pads.iter_mut() {
            let current = pad.steps.len();
            let target = clamped as usize;
            if target > current {
                pad.steps.extend(
                    (current..target).map(|_| super::drum_machine::DrumStepSnapshot {
                        active: false,
                        velocity: 100,
                    }),
                );
            } else {
                pad.steps.truncate(target);
            }
        }
    }

    Ok(())
}

/// Starts drum machine playback.
#[tauri::command]
pub fn drum_play(cmd_tx_state: State<'_, DrumCmdTxState>) -> Result<(), String> {
    let guard = cmd_tx_state
        .lock()
        .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Drum machine not initialized")?;
    tx.try_send(DrumCommand::Play)
        .map_err(|e| format!("Failed to send Play: {}", e))
}

/// Pauses drum machine playback (preserves clock position).
#[tauri::command]
pub fn drum_stop(cmd_tx_state: State<'_, DrumCmdTxState>) -> Result<(), String> {
    let guard = cmd_tx_state
        .lock()
        .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Drum machine not initialized")?;
    tx.try_send(DrumCommand::Stop)
        .map_err(|e| format!("Failed to send Stop: {}", e))
}

/// Stops playback and resets the clock to step 0.
#[tauri::command]
pub fn drum_reset(cmd_tx_state: State<'_, DrumCmdTxState>) -> Result<(), String> {
    let guard = cmd_tx_state
        .lock()
        .map_err(|e| format!("Failed to lock drum cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Drum machine not initialized")?;
    tx.try_send(DrumCommand::Reset)
        .map_err(|e| format!("Failed to send Reset: {}", e))
}

/// Returns a full serializable snapshot of the drum machine state.
#[tauri::command]
pub fn get_drum_state(
    atomics: State<'_, DrumAtomicsState>,
    shadow: State<'_, DrumPatternShadowState>,
) -> Result<DrumMachineSnapshot, String> {
    let bpm = atomics.bpm.load(Ordering::Relaxed);
    let swing = atomics.swing.load(Ordering::Relaxed);
    let pattern_length = atomics.pattern_length.load(Ordering::Relaxed);
    let playing = atomics.playing.load(Ordering::Relaxed);
    let current_step = atomics.current_step.load(Ordering::Relaxed);

    let pads = shadow
        .lock()
        .map_err(|e| format!("Failed to lock drum shadow: {}", e))?
        .clone();

    Ok(DrumMachineSnapshot {
        bpm,
        swing,
        pattern_length,
        playing,
        current_step,
        pads,
    })
}
