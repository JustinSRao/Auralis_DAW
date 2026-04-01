/// VST3 instrument node — implements `AudioNode` for the audio graph.
///
/// Pre-allocates all buffers and data structures at construction time so
/// the `process()` call is allocation-free on the audio thread.
use std::sync::{Arc, Mutex};

use crossbeam_channel::Receiver;

use crate::audio::graph::AudioNode;
use super::commands::Vst3Cmd;
use super::com::{
    AudioBusBuffers, Event, EventData, IComponent, IEventList, IEventListVtbl,
    IAudioProcessor, IParameterChanges, IParameterChangesVtbl, IParamValueQueue,
    IParamValueQueueVtbl, NoteOffEvent, NoteOnEvent, ProcessContext, ProcessData,
    K_NOTE_OFF, K_NOTE_ON, K_REALTIME, K_RESULT_OK,
    K_RESULT_FALSE, K_SAMPLE32, Guid,
};
use std::ffi::c_void;

// Maximum number of MIDI events per process block.
const MAX_EVENTS: usize = 64;
// Maximum number of parameter changes per block.
const MAX_PARAMS: usize = 64;

// ────────────────────────────────────────────────────────────────────────────
// SimpleEventList — stack-allocated IEventList implementation
// ────────────────────────────────────────────────────────────────────────────

static EVENT_LIST_VTBL: IEventListVtbl = IEventListVtbl {
    query_interface: el_query_interface,
    add_ref:         el_add_ref,
    release:         el_release,
    get_event_count: el_get_event_count,
    get_event:       el_get_event,
    add_event:       el_add_event,
};

/// Fixed-capacity event list for passing MIDI events to a VST3 plugin.
#[repr(C)]
pub struct SimpleEventList {
    vtbl: *const IEventListVtbl,
    events: [Event; MAX_EVENTS],
    count: usize,
}

impl SimpleEventList {
    fn new() -> Self {
        // SAFETY: Event contains unions initialised to zero bytes.
        let events = unsafe { std::mem::zeroed::<[Event; MAX_EVENTS]>() };
        Self { vtbl: &EVENT_LIST_VTBL, count: 0, events }
    }

    fn clear(&mut self) { self.count = 0; }

    fn push_note_on(&mut self, channel: i16, pitch: i16, velocity: f32) {
        if self.count >= MAX_EVENTS { return; }
        self.events[self.count] = Event {
            bus_index: 0,
            sample_offset: 0,
            ppq_position: 0.0,
            flags: 0,
            event_type: K_NOTE_ON,
            data: EventData {
                note_on: NoteOnEvent {
                    channel,
                    pitch,
                    tuning: 0.0,
                    velocity,
                    length: -1,
                    note_id: -1,
                },
            },
        };
        self.count += 1;
    }

    fn push_note_off(&mut self, channel: i16, pitch: i16, velocity: f32) {
        if self.count >= MAX_EVENTS { return; }
        self.events[self.count] = Event {
            bus_index: 0,
            sample_offset: 0,
            ppq_position: 0.0,
            flags: 0,
            event_type: K_NOTE_OFF,
            data: EventData {
                note_off: NoteOffEvent {
                    channel,
                    pitch,
                    velocity,
                    note_id: -1,
                    tuning: 0.0,
                },
            },
        };
        self.count += 1;
    }

    fn as_ptr(&mut self) -> *mut IEventList {
        self as *mut SimpleEventList as *mut IEventList
    }
}

unsafe extern "system" fn el_query_interface(_: *mut IEventList, _: *const Guid, _: *mut *mut c_void) -> i32 { K_RESULT_FALSE }
unsafe extern "system" fn el_add_ref(_: *mut IEventList) -> u32 { 1 }
unsafe extern "system" fn el_release(_: *mut IEventList) -> u32 { 1 }
unsafe extern "system" fn el_get_event_count(this: *mut IEventList) -> i32 {
    let inner = &*(this as *mut SimpleEventList);
    inner.count as i32
}
unsafe extern "system" fn el_get_event(this: *mut IEventList, index: i32, event: *mut Event) -> i32 {
    let inner = &*(this as *mut SimpleEventList);
    if index < 0 || index as usize >= inner.count || event.is_null() { return K_RESULT_FALSE; }
    std::ptr::copy_nonoverlapping(&inner.events[index as usize], event, 1);
    K_RESULT_OK
}
unsafe extern "system" fn el_add_event(this: *mut IEventList, event: *mut Event) -> i32 {
    let inner = &mut *(this as *mut SimpleEventList);
    if inner.count >= MAX_EVENTS || event.is_null() { return K_RESULT_FALSE; }
    std::ptr::copy_nonoverlapping(event, &mut inner.events[inner.count], 1);
    inner.count += 1;
    K_RESULT_OK
}

// ────────────────────────────────────────────────────────────────────────────
// SimpleParamChanges — stack-allocated IParameterChanges + IParamValueQueue
// ────────────────────────────────────────────────────────────────────────────

static PARAM_QUEUE_VTBL: IParamValueQueueVtbl = IParamValueQueueVtbl {
    query_interface: pq_query_interface,
    add_ref:         pq_add_ref,
    release:         pq_release,
    get_parameter_id: pq_get_parameter_id,
    get_point_count:  pq_get_point_count,
    get_point:        pq_get_point,
    add_point:        pq_add_point,
};

/// One parameter queue with a single point.
#[repr(C)]
struct SingleParamQueue {
    vtbl: *const IParamValueQueueVtbl,
    param_id: u32,
    value: f64,
}

static PARAM_CHANGES_VTBL: IParameterChangesVtbl = IParameterChangesVtbl {
    query_interface:    pc_query_interface,
    add_ref:            pc_add_ref,
    release:            pc_release,
    get_parameter_count: pc_get_parameter_count,
    get_parameter_data:  pc_get_parameter_data,
    add_parameter_data:  pc_add_parameter_data,
};

/// Fixed-capacity parameter changes list.
#[repr(C)]
pub struct SimpleParamChanges {
    vtbl: *const IParameterChangesVtbl,
    queues: [SingleParamQueue; MAX_PARAMS],
    count: usize,
}

impl SimpleParamChanges {
    pub fn new() -> Self {
        let queues = [const {
            SingleParamQueue { vtbl: &PARAM_QUEUE_VTBL, param_id: 0, value: 0.0 }
        }; MAX_PARAMS];
        Self { vtbl: &PARAM_CHANGES_VTBL, queues, count: 0 }
    }

    pub fn clear(&mut self) { self.count = 0; }

    pub fn push(&mut self, param_id: u32, value: f64) {
        if self.count >= MAX_PARAMS { return; }
        self.queues[self.count].param_id = param_id;
        self.queues[self.count].value = value;
        self.count += 1;
    }

    pub fn as_ptr(&mut self) -> *mut IParameterChanges {
        self as *mut SimpleParamChanges as *mut IParameterChanges
    }
}

unsafe extern "system" fn pq_query_interface(_: *mut IParamValueQueue, _: *const Guid, _: *mut *mut c_void) -> i32 { K_RESULT_FALSE }
unsafe extern "system" fn pq_add_ref(_: *mut IParamValueQueue) -> u32 { 1 }
unsafe extern "system" fn pq_release(_: *mut IParamValueQueue) -> u32 { 1 }
unsafe extern "system" fn pq_get_parameter_id(this: *mut IParamValueQueue) -> u32 {
    (*(this as *mut SingleParamQueue)).param_id
}
unsafe extern "system" fn pq_get_point_count(_: *mut IParamValueQueue) -> i32 { 1 }
unsafe extern "system" fn pq_get_point(
    this: *mut IParamValueQueue,
    _index: i32,
    sample_offset: *mut i32,
    value: *mut f64,
) -> i32 {
    let inner = &*(this as *mut SingleParamQueue);
    if !sample_offset.is_null() { *sample_offset = 0; }
    if !value.is_null() { *value = inner.value; }
    K_RESULT_OK
}
unsafe extern "system" fn pq_add_point(
    _: *mut IParamValueQueue, _: i32, _: f64, _: *mut i32,
) -> i32 { K_RESULT_FALSE }

unsafe extern "system" fn pc_query_interface(_: *mut IParameterChanges, _: *const Guid, _: *mut *mut c_void) -> i32 { K_RESULT_FALSE }
unsafe extern "system" fn pc_add_ref(_: *mut IParameterChanges) -> u32 { 1 }
unsafe extern "system" fn pc_release(_: *mut IParameterChanges) -> u32 { 1 }
unsafe extern "system" fn pc_get_parameter_count(this: *mut IParameterChanges) -> i32 {
    (*(this as *mut SimpleParamChanges)).count as i32
}
unsafe extern "system" fn pc_get_parameter_data(
    this: *mut IParameterChanges,
    index: i32,
) -> *mut IParamValueQueue {
    let inner = &mut *(this as *mut SimpleParamChanges);
    if index < 0 || index as usize >= inner.count { return std::ptr::null_mut(); }
    &mut inner.queues[index as usize] as *mut SingleParamQueue as *mut IParamValueQueue
}
unsafe extern "system" fn pc_add_parameter_data(
    _: *mut IParameterChanges, _: *const u32, _: *mut i32,
) -> *mut IParamValueQueue { std::ptr::null_mut() }

// ────────────────────────────────────────────────────────────────────────────
// Vst3Instrument — AudioNode implementation
// ────────────────────────────────────────────────────────────────────────────

/// A loaded VST3 instrument exposed as an `AudioNode` in the audio graph.
///
/// All buffers are pre-allocated; no heap allocation occurs in `process()`.
pub struct Vst3Instrument {
    name: String,
    /// Audio processor — exclusively owned by the audio thread.
    processor: *mut IAudioProcessor,
    /// Component pointer for any non-realtime calls (unused in process()).
    _component: Arc<Mutex<*mut IComponent>>,
    /// Command channel — `try_recv` drains pending MIDI/param events.
    receiver: Receiver<Vst3Cmd>,
    /// Pre-allocated left-channel scratch buffer.
    scratch_left: Vec<f32>,
    /// Pre-allocated right-channel scratch buffer.
    scratch_right: Vec<f32>,
    /// Pre-allocated channel-buffer pointer arrays for one output bus.
    channel_ptrs: Vec<*mut f32>,
    /// Pre-allocated AudioBusBuffers for the output bus.
    output_bus: AudioBusBuffers,
    /// Pre-allocated event list.
    event_list: SimpleEventList,
    /// Pre-allocated parameter changes.
    param_changes: SimpleParamChanges,
    /// Pre-allocated ProcessContext.
    proc_context: ProcessContext,
    /// Pre-allocated ProcessData.
    proc_data: ProcessData,
}

// Safety: Vst3Instrument is exclusively used on the audio thread after construction.
// The raw processor pointer is never aliased.
unsafe impl Send for Vst3Instrument {}

impl Vst3Instrument {
    /// Creates a new `Vst3Instrument`.
    ///
    /// `block_size` must match the `setup_processing` value used when loading the plugin.
    pub fn new(
        name: String,
        processor: *mut IAudioProcessor,
        component: Arc<Mutex<*mut IComponent>>,
        receiver: Receiver<Vst3Cmd>,
        block_size: usize,
    ) -> Self {
        let mut scratch_left = vec![0.0f32; block_size];
        let mut scratch_right = vec![0.0f32; block_size];
        let channel_ptrs = vec![scratch_left.as_mut_ptr(), scratch_right.as_mut_ptr()];

        Self {
            name,
            processor,
            _component: component,
            receiver,
            scratch_left,
            scratch_right,
            channel_ptrs,
            output_bus: AudioBusBuffers {
                num_channels: 2,
                silence_flags: 0,
                channel_buffers32: std::ptr::null_mut(),
            },
            event_list: SimpleEventList::new(),
            param_changes: SimpleParamChanges::new(),
            proc_context: ProcessContext::default(),
            proc_data: ProcessData::default(),
        }
    }
}

impl AudioNode for Vst3Instrument {
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        let frames = output.len() / channels as usize;

        // --- Drain command channel (no allocation, no blocking) ---
        self.event_list.clear();
        self.param_changes.clear();
        while let Ok(cmd) = self.receiver.try_recv() {
            match cmd {
                Vst3Cmd::MidiEvent { status, data1, data2 } => {
                    let kind = status & 0xF0;
                    let ch = (status & 0x0F) as i16;
                    let pitch = data1 as i16;
                    let vel = data2 as f32 / 127.0;
                    match kind {
                        0x90 if data2 > 0 => self.event_list.push_note_on(ch, pitch, vel),
                        0x80 | 0x90       => self.event_list.push_note_off(ch, pitch, vel),
                        _ => {}
                    }
                }
                Vst3Cmd::ParamChanged { id, value } => {
                    self.param_changes.push(id, value);
                }
            }
        }

        // --- Zero scratch buffers ---
        let used = frames.min(self.scratch_left.len());
        for s in &mut self.scratch_left[..used] { *s = 0.0; }
        for s in &mut self.scratch_right[..used] { *s = 0.0; }

        // --- Update channel pointers (scratch may have been reallocated if block_size changed) ---
        self.channel_ptrs[0] = self.scratch_left.as_mut_ptr();
        self.channel_ptrs[1] = self.scratch_right.as_mut_ptr();
        self.output_bus.channel_buffers32 = self.channel_ptrs.as_mut_ptr();
        self.output_bus.silence_flags = 0;

        // --- Fill ProcessData ---
        self.proc_context.sample_rate = sample_rate as f64;
        self.proc_data.process_mode = K_REALTIME;
        self.proc_data.symbolic_sample_size = K_SAMPLE32;
        self.proc_data.num_samples = used as i32;
        self.proc_data.num_inputs = 0;
        self.proc_data.num_outputs = 1;
        self.proc_data.inputs = std::ptr::null_mut();
        self.proc_data.outputs = &mut self.output_bus as *mut AudioBusBuffers;
        self.proc_data.input_param_changes = self.param_changes.as_ptr();
        self.proc_data.output_param_changes = std::ptr::null_mut();
        self.proc_data.input_events = self.event_list.as_ptr();
        self.proc_data.output_events = std::ptr::null_mut();
        self.proc_data.context = &mut self.proc_context as *mut ProcessContext;

        // --- Call plugin ---
        unsafe {
            ((*(*self.processor).vtbl).process)(self.processor, &mut self.proc_data);
        }

        // --- Re-interleave L/R scratch into the output buffer ---
        let ch = channels as usize;
        for (frame_idx, frame) in output[..used * ch].chunks_exact_mut(ch).enumerate() {
            if ch >= 1 { frame[0] += self.scratch_left[frame_idx]; }
            if ch >= 2 { frame[1] += self.scratch_right[frame_idx]; }
        }
    }

    fn name(&self) -> &str {
        &self.name
    }
}
