use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;

use tauri::State;

use crate::audio::commands::AudioEngineState;
use crate::audio::engine::AudioCommand;
use crate::instruments::commands::{SynthMidiTxState, TransportAtomicsState};

use super::step::{SequencerSnapshot, SequencerStep, SequencerStepSnapshot};
use super::step_sequencer::{SequencerAtomics, SequencerCommand, StepSequencer};

/// Lock-free sequencer atomics managed by Tauri.
pub type SequencerAtomicsState = Arc<SequencerAtomics>;

/// Sender half of the sequencer command channel.
pub type SequencerCmdTxState = Arc<Mutex<Option<crossbeam_channel::Sender<SequencerCommand>>>>;

/// Shadow copy of the step pattern for `get_sequencer_state` queries.
pub type SequencerStepShadowState = Arc<Mutex<Vec<SequencerStepSnapshot>>>;

/// Creates and registers the step sequencer in the audio graph.
///
/// Spawns a Tokio relay task that drains the step event channel and emits
/// `sequencer-step-changed` Tauri events at ~250 Hz for UI playhead highlighting.
#[tauri::command]
pub async fn create_sequencer(
    app: tauri::AppHandle,
    engine: State<'_, AudioEngineState>,
    atomics: State<'_, SequencerAtomicsState>,
    cmd_tx_state: State<'_, SequencerCmdTxState>,
    transport_atomics: State<'_, TransportAtomicsState>,
    synth_midi_tx: State<'_, SynthMidiTxState>,
) -> Result<(), String> {
    let (cmd_tx, cmd_rx) = crossbeam_channel::bounded::<SequencerCommand>(64);
    let (step_tx, step_rx) = crossbeam_channel::bounded::<u8>(32);

    {
        let mut guard = cmd_tx_state
            .lock()
            .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
        *guard = Some(cmd_tx.clone());
    }

    // Wire the sequencer to the synth by default
    if let Ok(tx_guard) = synth_midi_tx.lock() {
        if let Some(ref midi_tx) = *tx_guard {
            let _ = cmd_tx.try_send(SequencerCommand::SetInstrumentTx { tx: midi_tx.clone() });
        }
    }

    let seq_atomics = Arc::clone(&*atomics);
    let transport = (*transport_atomics).clone();

    let seq = StepSequencer::new(seq_atomics, cmd_rx, step_tx, transport, 44100.0);

    // Use AddNode to append the sequencer to the existing instrument graph
    // rather than replacing it. AudioGraph::new pre-allocates node capacity so
    // Vec::push on the audio thread will not reallocate.
    let eng = engine
        .lock()
        .map_err(|e| format!("Failed to lock audio engine: {}", e))?;
    eng.send_transport_command(AudioCommand::AddNode(Box::new(seq)))
        .map_err(|e| e.to_string())?;

    // Relay task: poll step channel at ~250 Hz and emit Tauri events
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(4));
        loop {
            interval.tick().await;
            while let Ok(step) = step_rx.try_recv() {
                if let Err(e) = tauri::Emitter::emit(&app, "sequencer-step-changed", step) {
                    log::warn!("Failed to emit sequencer-step-changed: {}", e);
                }
            }
        }
    });

    Ok(())
}

/// Updates a single step in the sequencer pattern.
#[tauri::command]
pub fn set_sequencer_step(
    idx: u8,
    enabled: bool,
    note: u8,
    velocity: u8,
    gate: f32,
    probability: u8,
    cmd_tx: State<'_, SequencerCmdTxState>,
    shadow: State<'_, SequencerStepShadowState>,
) -> Result<(), String> {
    let step = SequencerStep { enabled, note, velocity, gate, probability };
    {
        let guard = cmd_tx
            .lock()
            .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
        let tx = guard.as_ref().ok_or("Sequencer not initialized")?;
        tx.try_send(SequencerCommand::SetStep { idx, step })
            .map_err(|e| format!("Failed to send SetStep: {}", e))?;
    }
    {
        let mut steps = shadow
            .lock()
            .map_err(|e| format!("Failed to lock step shadow: {}", e))?;
        if let Some(s) = steps.get_mut(idx as usize) {
            *s = SequencerStepSnapshot { enabled, note, velocity, gate, probability };
        }
    }
    Ok(())
}

/// Sets the number of active steps in the pattern.
#[tauri::command]
pub fn set_sequencer_length(
    length: u8,
    cmd_tx: State<'_, SequencerCmdTxState>,
) -> Result<(), String> {
    let guard = cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Sequencer not initialized")?;
    tx.try_send(SequencerCommand::SetLength { length })
        .map_err(|e| format!("Failed to send SetLength: {}", e))
}

/// Sets the step time division (4, 8, 16, or 32).
#[tauri::command]
pub fn set_sequencer_time_div(
    div: u8,
    cmd_tx: State<'_, SequencerCmdTxState>,
) -> Result<(), String> {
    let guard = cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Sequencer not initialized")?;
    tx.try_send(SequencerCommand::SetTimeDiv { div })
        .map_err(|e| format!("Failed to send SetTimeDiv: {}", e))
}

/// Sets the global transpose offset in semitones.
#[tauri::command]
pub fn set_sequencer_transpose(
    semitones: i8,
    cmd_tx: State<'_, SequencerCmdTxState>,
) -> Result<(), String> {
    let guard = cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Sequencer not initialized")?;
    tx.try_send(SequencerCommand::SetTranspose { semitones })
        .map_err(|e| format!("Failed to send SetTranspose: {}", e))
}

/// Returns a full snapshot of the current sequencer state.
#[tauri::command]
pub fn get_sequencer_state(
    atomics: State<'_, SequencerAtomicsState>,
    shadow: State<'_, SequencerStepShadowState>,
) -> Result<SequencerSnapshot, String> {
    let playing = atomics.is_playing.load(Ordering::Relaxed);
    let current_step = atomics.current_step.load(Ordering::Relaxed);
    let pattern_length = atomics.pattern_length.load(Ordering::Relaxed);
    let time_div = atomics.time_div.load(Ordering::Relaxed);
    let transpose = atomics.transpose.load(Ordering::Relaxed);

    let steps = shadow
        .lock()
        .map_err(|e| format!("Failed to lock step shadow: {}", e))?
        .clone();

    Ok(SequencerSnapshot {
        playing,
        current_step,
        pattern_length,
        time_div,
        transpose,
        steps,
    })
}

/// Starts sequencer playback.
#[tauri::command]
pub fn sequencer_play(cmd_tx: State<'_, SequencerCmdTxState>) -> Result<(), String> {
    let guard = cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Sequencer not initialized")?;
    tx.try_send(SequencerCommand::Play)
        .map_err(|e| format!("Failed to send Play: {}", e))
}

/// Pauses sequencer playback (preserves clock position).
#[tauri::command]
pub fn sequencer_stop(cmd_tx: State<'_, SequencerCmdTxState>) -> Result<(), String> {
    let guard = cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Sequencer not initialized")?;
    tx.try_send(SequencerCommand::Stop)
        .map_err(|e| format!("Failed to send Stop: {}", e))
}

/// Stops playback and resets the clock to step 0.
#[tauri::command]
pub fn sequencer_reset(cmd_tx: State<'_, SequencerCmdTxState>) -> Result<(), String> {
    let guard = cmd_tx
        .lock()
        .map_err(|e| format!("Failed to lock sequencer cmd tx: {}", e))?;
    let tx = guard.as_ref().ok_or("Sequencer not initialized")?;
    tx.try_send(SequencerCommand::Reset)
        .map_err(|e| format!("Failed to send Reset: {}", e))
}
