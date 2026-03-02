use std::sync::{Arc, Mutex};

use tauri::State;

use crate::audio::commands::AudioEngineState;
use crate::audio::engine::AudioCommand;
use crate::audio::graph::AudioGraph;
use crate::midi::commands::MidiManagerState;
use crate::midi::types::TimestampedMidiEvent;

use super::synth::SubtractiveSynth;
use super::synth::params::{set_param_by_name, SynthParamSnapshot, SynthParams};

/// Type alias for the synthesizer parameter state managed by Tauri.
///
/// Shared between the Tauri command thread and the audio thread via atomics.
/// The audio thread reads parameters lock-free; the UI thread writes via atomics.
pub type SynthState = Arc<SynthParams>;

/// Stores the sender end of the synth's dedicated MIDI channel.
///
/// Initially `None`. Populated by [`create_synth_instrument`] and forwarded
/// to `MidiManager::set_secondary_sender` so real-time MIDI input reaches the
/// synth node on the audio thread.
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
        mgr.set_secondary_sender(Some(midi_tx));
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
