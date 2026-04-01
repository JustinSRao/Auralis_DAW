/// VST3 effect node — implements `AudioEffect` for the effect chain.
///
/// Pre-allocates all buffers at construction time so `process_stereo()` is
/// allocation-free on the audio thread.
use std::sync::{Arc, Mutex};

use crossbeam_channel::Receiver;

use crate::effects::AudioEffect;
use super::commands::Vst3Cmd;
use super::com::{
    AudioBusBuffers, IComponent, IAudioProcessor,
    ProcessContext, ProcessData,
    K_REALTIME, K_SAMPLE32,
};
// Re-use the SimpleParamChanges from instrument.rs through the module.
use super::instrument::SimpleParamChanges;

// ────────────────────────────────────────────────────────────────────────────
// Vst3Effect — AudioEffect implementation
// ────────────────────────────────────────────────────────────────────────────

/// A loaded VST3 effect plugin exposed as an `AudioEffect` in the effect chain.
///
/// All buffers are pre-allocated; no heap allocation occurs in `process_stereo()`.
pub struct Vst3Effect {
    /// Human-readable name for debugging.
    name: String,
    /// Audio processor — exclusively owned by the audio thread.
    processor: *mut IAudioProcessor,
    /// Component pointer for non-realtime calls (state save/load, etc.).
    _component: Arc<Mutex<*mut IComponent>>,
    /// Command channel — `try_recv` drains pending param-change events each block.
    receiver: Receiver<Vst3Cmd>,
    /// Current operating sample rate.
    sample_rate: f64,
    /// Pre-allocated left-channel input scratch buffer.
    in_left: Vec<f32>,
    /// Pre-allocated right-channel input scratch buffer.
    in_right: Vec<f32>,
    /// Pre-allocated left-channel output scratch buffer.
    out_left: Vec<f32>,
    /// Pre-allocated right-channel output scratch buffer.
    out_right: Vec<f32>,
    /// Channel pointer arrays for the input bus.
    in_channel_ptrs: Vec<*mut f32>,
    /// Channel pointer arrays for the output bus.
    out_channel_ptrs: Vec<*mut f32>,
    /// Pre-allocated input AudioBusBuffers.
    input_bus: AudioBusBuffers,
    /// Pre-allocated output AudioBusBuffers.
    output_bus: AudioBusBuffers,
    /// Pre-allocated parameter changes.
    param_changes: SimpleParamChanges,
    /// Pre-allocated ProcessContext.
    proc_context: ProcessContext,
    /// Pre-allocated ProcessData.
    proc_data: ProcessData,
}

// Safety: Vst3Effect is exclusively used on the audio thread after construction.
// The raw processor pointer is never aliased.
unsafe impl Send for Vst3Effect {}
unsafe impl Sync for Vst3Effect {}

impl Vst3Effect {
    /// Creates a new `Vst3Effect`.
    ///
    /// `block_size` must match the `setup_processing` value used when loading the plugin.
    pub fn new(
        name: String,
        processor: *mut IAudioProcessor,
        component: Arc<Mutex<*mut IComponent>>,
        receiver: Receiver<Vst3Cmd>,
        block_size: usize,
        sample_rate: f64,
    ) -> Self {
        let mut in_left   = vec![0.0f32; block_size];
        let mut in_right  = vec![0.0f32; block_size];
        let mut out_left  = vec![0.0f32; block_size];
        let mut out_right = vec![0.0f32; block_size];

        let in_channel_ptrs  = vec![in_left.as_mut_ptr(),  in_right.as_mut_ptr()];
        let out_channel_ptrs = vec![out_left.as_mut_ptr(), out_right.as_mut_ptr()];

        Self {
            name,
            processor,
            _component: component,
            receiver,
            sample_rate,
            in_left,
            in_right,
            out_left,
            out_right,
            in_channel_ptrs,
            out_channel_ptrs,
            input_bus: AudioBusBuffers { num_channels: 2, silence_flags: 0, channel_buffers32: std::ptr::null_mut() },
            output_bus: AudioBusBuffers { num_channels: 2, silence_flags: 0, channel_buffers32: std::ptr::null_mut() },
            param_changes: SimpleParamChanges::new(),
            proc_context: ProcessContext::default(),
            proc_data: ProcessData::default(),
        }
    }
}

impl AudioEffect for Vst3Effect {
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]) {
        let frames = left.len().min(right.len());
        let used = frames.min(self.in_left.len());

        // --- Drain command channel (non-blocking) ---
        self.param_changes.clear();
        while let Ok(cmd) = self.receiver.try_recv() {
            if let Vst3Cmd::ParamChanged { id, value } = cmd {
                self.param_changes.push(id, value);
            }
        }

        // --- Copy inputs into scratch ---
        self.in_left[..used].copy_from_slice(&left[..used]);
        self.in_right[..used].copy_from_slice(&right[..used]);
        for s in &mut self.out_left[..used] { *s = 0.0; }
        for s in &mut self.out_right[..used] { *s = 0.0; }

        // --- Update channel pointers ---
        self.in_channel_ptrs[0]  = self.in_left.as_mut_ptr();
        self.in_channel_ptrs[1]  = self.in_right.as_mut_ptr();
        self.out_channel_ptrs[0] = self.out_left.as_mut_ptr();
        self.out_channel_ptrs[1] = self.out_right.as_mut_ptr();
        self.input_bus.channel_buffers32  = self.in_channel_ptrs.as_mut_ptr();
        self.output_bus.channel_buffers32 = self.out_channel_ptrs.as_mut_ptr();
        self.input_bus.silence_flags  = 0;
        self.output_bus.silence_flags = 0;

        // --- Fill ProcessData ---
        self.proc_context.sample_rate = self.sample_rate;
        self.proc_data.process_mode = K_REALTIME;
        self.proc_data.symbolic_sample_size = K_SAMPLE32;
        self.proc_data.num_samples = used as i32;
        self.proc_data.num_inputs  = 1;
        self.proc_data.num_outputs = 1;
        self.proc_data.inputs  = &mut self.input_bus  as *mut AudioBusBuffers;
        self.proc_data.outputs = &mut self.output_bus as *mut AudioBusBuffers;
        self.proc_data.input_param_changes  = self.param_changes.as_ptr();
        self.proc_data.output_param_changes = std::ptr::null_mut();
        self.proc_data.input_events  = std::ptr::null_mut();
        self.proc_data.output_events = std::ptr::null_mut();
        self.proc_data.context = &mut self.proc_context as *mut ProcessContext;

        // --- Call plugin ---
        unsafe {
            ((*(*self.processor).vtbl).process)(self.processor, &mut self.proc_data);
        }

        // --- Copy outputs back in-place ---
        left[..used].copy_from_slice(&self.out_left[..used]);
        right[..used].copy_from_slice(&self.out_right[..used]);
    }

    fn reset(&mut self) {
        // Ask the processor to flush / reset by briefly toggling processing off/on.
        unsafe {
            ((*(*self.processor).vtbl).set_processing)(self.processor, 0);
            ((*(*self.processor).vtbl).set_processing)(self.processor, 1);
        }
    }

    fn get_params(&self) -> serde_json::Value {
        // VST3 state is managed separately via save_vst3_state; return empty object.
        serde_json::Value::Object(serde_json::Map::new())
    }

    fn set_params(&mut self, _params: &serde_json::Value) {
        // VST3 state is loaded via load_vst3_state; nothing to do here.
    }
}
