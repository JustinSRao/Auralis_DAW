/// Minimal VST3 COM interface definitions.
///
/// VST3 plugins use a COM-style ABI on Windows. Rather than depend on the `vst3-sys` crate
/// (which may not be available or may have breaking API changes), we define the raw vtable
/// types that match the VST3 SDK ABI directly.
///
/// Safety note: All raw pointer types here are used in `unsafe` blocks only. Callers
/// must ensure the plugin is loaded and not concurrently freed when calling any vtable method.
use std::ffi::c_void;

/// VST3 result codes (HRESULT-like)
pub const K_RESULT_OK: i32 = 0;
pub const K_NOT_IMPLEMENTED: i32 = 0x80004001u32 as i32;
pub const K_RESULT_FALSE: i32 = 1;
pub const K_RESULT_TRUE: i32 = K_RESULT_OK;

/// Process mode: real-time.
pub const K_REALTIME: i32 = 0;
/// Symbolic sample size: 32-bit float.
pub const K_SAMPLE32: i32 = 0;

/// Audio Module Class category prefix.
pub const K_AUDIO_MODULE_CLASS: &[u8] = b"Audio Module Class";

/// GUId / FUID — 16 bytes.
pub type Guid = [u8; 16];

/// FIDString is a const char* (UTF-8) in the VST3 SDK.
pub type FIDString = *const i8;

/// TChar is wchar_t (UTF-16) on Windows.
pub type TChar = u16;

/// IBStream — minimal COM interface for state serialization.
#[repr(C)]
pub struct IBStreamVtbl {
    // IUnknown
    pub query_interface: unsafe extern "system" fn(*mut IBStream, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IBStream) -> u32,
    pub release: unsafe extern "system" fn(*mut IBStream) -> u32,
    // IBStream
    pub read: unsafe extern "system" fn(*mut IBStream, buffer: *mut c_void, num_bytes: i32, num_bytes_read: *mut i32) -> i32,
    pub write: unsafe extern "system" fn(*mut IBStream, buffer: *mut c_void, num_bytes: i32, num_bytes_written: *mut i32) -> i32,
    pub seek: unsafe extern "system" fn(*mut IBStream, pos: i64, mode: i32, result: *mut i64) -> i32,
    pub tell: unsafe extern "system" fn(*mut IBStream, pos: *mut i64) -> i32,
}

#[repr(C)]
pub struct IBStream {
    pub vtbl: *const IBStreamVtbl,
}

/// PClassInfo — returned by IPluginFactory::get_class_info.
#[repr(C)]
pub struct PClassInfo {
    pub cid: Guid,
    pub cardinality: i32,
    pub category: [i8; 32],
    pub name: [i8; 64],
}

/// PClassInfo2 — extended class info with version, vendor, and edit controller class id.
#[repr(C)]
pub struct PClassInfo2 {
    pub cid: Guid,
    pub cardinality: i32,
    pub category: [i8; 32],
    pub name: [i8; 64],
    pub class_flags: u32,
    pub sub_categories: [i8; 128],
    pub vendor: [i8; 64],
    pub version: [i8; 64],
    pub sdk_version: [i8; 64],
    pub edit_controller_class: Guid,
}

/// PFactoryInfo — returned by IPluginFactory::get_factory_info.
#[repr(C)]
pub struct PFactoryInfo {
    pub vendor: [i8; 64],
    pub url: [i8; 256],
    pub email: [i8; 128],
    pub flags: i32,
}

/// IPluginFactory vtable.
#[repr(C)]
pub struct IPluginFactoryVtbl {
    // IUnknown
    pub query_interface: unsafe extern "system" fn(*mut IPluginFactory, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IPluginFactory) -> u32,
    pub release: unsafe extern "system" fn(*mut IPluginFactory) -> u32,
    // IPluginFactory
    pub get_factory_info: unsafe extern "system" fn(*mut IPluginFactory, *mut PFactoryInfo) -> i32,
    pub count_classes: unsafe extern "system" fn(*mut IPluginFactory) -> i32,
    pub get_class_info: unsafe extern "system" fn(*mut IPluginFactory, index: i32, *mut PClassInfo) -> i32,
    pub create_instance: unsafe extern "system" fn(*mut IPluginFactory, cid: *const Guid, iid: *const Guid, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IPluginFactory {
    pub vtbl: *const IPluginFactoryVtbl,
}

/// IPluginFactory2 vtable (superset — for PClassInfo2).
#[repr(C)]
pub struct IPluginFactory2Vtbl {
    // IUnknown
    pub query_interface: unsafe extern "system" fn(*mut IPluginFactory2, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IPluginFactory2) -> u32,
    pub release: unsafe extern "system" fn(*mut IPluginFactory2) -> u32,
    // IPluginFactory
    pub get_factory_info: unsafe extern "system" fn(*mut IPluginFactory2, *mut PFactoryInfo) -> i32,
    pub count_classes: unsafe extern "system" fn(*mut IPluginFactory2) -> i32,
    pub get_class_info: unsafe extern "system" fn(*mut IPluginFactory2, index: i32, *mut PClassInfo) -> i32,
    pub create_instance: unsafe extern "system" fn(*mut IPluginFactory2, cid: *const Guid, iid: *const Guid, *mut *mut c_void) -> i32,
    // IPluginFactory2
    pub get_class_info2: unsafe extern "system" fn(*mut IPluginFactory2, index: i32, *mut PClassInfo2) -> i32,
}

#[repr(C)]
pub struct IPluginFactory2 {
    pub vtbl: *const IPluginFactory2Vtbl,
}

/// IPlugBase vtable (base for IComponent and IEditController).
#[repr(C)]
pub struct IPlugBaseVtbl {
    pub query_interface: unsafe extern "system" fn(*mut IPlugBase, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IPlugBase) -> u32,
    pub release: unsafe extern "system" fn(*mut IPlugBase) -> u32,
    pub initialize: unsafe extern "system" fn(*mut IPlugBase, context: *mut c_void) -> i32,
    pub terminate: unsafe extern "system" fn(*mut IPlugBase) -> i32,
}

#[repr(C)]
pub struct IPlugBase {
    pub vtbl: *const IPlugBaseVtbl,
}

/// Bus direction: input = 0, output = 1.
pub const K_INPUT: i32 = 0;
pub const K_OUTPUT: i32 = 1;

/// Bus type: main = 0, aux = 1.
pub const K_MAIN: i32 = 0;

/// Speaker arrangement: stereo = left + right.
/// VST3 speaker arrangement is a bitmask; stereo = 0x3 (kSpeakerL | kSpeakerR).
pub const K_SPEAKER_STEREO: u64 = 0x3;

/// Media type: audio = 0, event/MIDI = 1.
pub const K_AUDIO: i32 = 0;
pub const K_EVENT: i32 = 1;

/// BusInfo — bus description.
#[repr(C)]
pub struct BusInfo {
    pub media_type: i32,
    pub direction: i32,
    pub channel_count: i32,
    pub name: [u16; 128],
    pub bus_type: i32,
    pub flags: u32,
}

/// IComponent vtable (stripped to the methods we use).
/// Full IComponent extends IPlugBase + IConnectionPoint; we define what we need.
#[repr(C)]
pub struct IComponentVtbl {
    // IUnknown
    pub query_interface: unsafe extern "system" fn(*mut IComponent, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IComponent) -> u32,
    pub release: unsafe extern "system" fn(*mut IComponent) -> u32,
    // IPlugBase
    pub initialize: unsafe extern "system" fn(*mut IComponent, context: *mut c_void) -> i32,
    pub terminate: unsafe extern "system" fn(*mut IComponent) -> i32,
    // IComponent
    pub get_controller_class_id: unsafe extern "system" fn(*mut IComponent, class_id: *mut Guid) -> i32,
    pub set_io_mode: unsafe extern "system" fn(*mut IComponent, mode: i32) -> i32,
    pub get_bus_count: unsafe extern "system" fn(*mut IComponent, media_type: i32, dir: i32) -> i32,
    pub get_bus_info: unsafe extern "system" fn(*mut IComponent, media_type: i32, dir: i32, index: i32, *mut BusInfo) -> i32,
    pub get_routing_info: unsafe extern "system" fn(*mut IComponent, in_info: *mut c_void, out_info: *mut c_void) -> i32,
    pub activate_bus: unsafe extern "system" fn(*mut IComponent, media_type: i32, dir: i32, index: i32, state: u8) -> i32,
    pub set_active: unsafe extern "system" fn(*mut IComponent, state: u8) -> i32,
    pub set_state: unsafe extern "system" fn(*mut IComponent, state: *mut IBStream) -> i32,
    pub get_state: unsafe extern "system" fn(*mut IComponent, state: *mut IBStream) -> i32,
}

#[repr(C)]
pub struct IComponent {
    pub vtbl: *const IComponentVtbl,
}

/// ProcessSetup — passed to IAudioProcessor::setup_processing.
#[repr(C)]
pub struct ProcessSetup {
    pub process_mode: i32,
    pub symbolic_sample_size: i32,
    pub max_samples_per_block: i32,
    pub sample_rate: f64,
}

/// AudioBusBuffers — channel buffer pointers for one bus.
#[repr(C)]
pub struct AudioBusBuffers {
    pub num_channels: i32,
    pub silence_flags: u64,
    pub channel_buffers32: *mut *mut f32,
}

impl Default for AudioBusBuffers {
    fn default() -> Self {
        Self {
            num_channels: 2,
            silence_flags: 0,
            channel_buffers32: std::ptr::null_mut(),
        }
    }
}

/// EventTypes — raw MIDI-like event for VST3.
#[repr(C)]
pub struct Event {
    pub bus_index: i32,
    pub sample_offset: i32,
    pub ppq_position: f64,
    pub flags: u16,
    pub event_type: u16,
    pub data: EventData,
}

/// NoteOnEvent (used inside EventData union).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NoteOnEvent {
    pub channel: i16,
    pub pitch: i16,
    pub tuning: f32,
    pub velocity: f32,
    pub length: i32,
    pub note_id: i32,
}

/// NoteOffEvent.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NoteOffEvent {
    pub channel: i16,
    pub pitch: i16,
    pub velocity: f32,
    pub note_id: i32,
    pub tuning: f32,
}

/// EventData union — we only need note on/off.
#[repr(C)]
pub union EventData {
    pub note_on: NoteOnEvent,
    pub note_off: NoteOffEvent,
    /// Padding to ensure the union is large enough for all VST3 event types.
    _pad: [u8; 48],
}

/// Event types.
pub const K_NOTE_ON: u16 = 0;
pub const K_NOTE_OFF: u16 = 1;

/// IEventList vtable (for passing MIDI events to the plugin).
#[repr(C)]
pub struct IEventListVtbl {
    pub query_interface: unsafe extern "system" fn(*mut IEventList, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IEventList) -> u32,
    pub release: unsafe extern "system" fn(*mut IEventList) -> u32,
    pub get_event_count: unsafe extern "system" fn(*mut IEventList) -> i32,
    pub get_event: unsafe extern "system" fn(*mut IEventList, index: i32, event: *mut Event) -> i32,
    pub add_event: unsafe extern "system" fn(*mut IEventList, event: *mut Event) -> i32,
}

#[repr(C)]
pub struct IEventList {
    pub vtbl: *const IEventListVtbl,
}

/// IParamValueQueue vtable — one parameter's value queue.
#[repr(C)]
pub struct IParamValueQueueVtbl {
    pub query_interface: unsafe extern "system" fn(*mut IParamValueQueue, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IParamValueQueue) -> u32,
    pub release: unsafe extern "system" fn(*mut IParamValueQueue) -> u32,
    pub get_parameter_id: unsafe extern "system" fn(*mut IParamValueQueue) -> u32,
    pub get_point_count: unsafe extern "system" fn(*mut IParamValueQueue) -> i32,
    pub get_point: unsafe extern "system" fn(*mut IParamValueQueue, index: i32, *mut i32, *mut f64) -> i32,
    pub add_point: unsafe extern "system" fn(*mut IParamValueQueue, sample_offset: i32, value: f64, *mut i32) -> i32,
}

#[repr(C)]
pub struct IParamValueQueue {
    pub vtbl: *const IParamValueQueueVtbl,
}

/// IParameterChanges vtable.
#[repr(C)]
pub struct IParameterChangesVtbl {
    pub query_interface: unsafe extern "system" fn(*mut IParameterChanges, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IParameterChanges) -> u32,
    pub release: unsafe extern "system" fn(*mut IParameterChanges) -> u32,
    pub get_parameter_count: unsafe extern "system" fn(*mut IParameterChanges) -> i32,
    pub get_parameter_data: unsafe extern "system" fn(*mut IParameterChanges, index: i32) -> *mut IParamValueQueue,
    pub add_parameter_data: unsafe extern "system" fn(*mut IParameterChanges, id: *const u32, *mut i32) -> *mut IParamValueQueue,
}

#[repr(C)]
pub struct IParameterChanges {
    pub vtbl: *const IParameterChangesVtbl,
}

/// ProcessContext — transport/tempo information passed each buffer.
#[repr(C)]
pub struct ProcessContext {
    pub state: u32,
    pub sample_rate: f64,
    pub project_time_samples: i64,
    pub system_time: i64,
    pub continous_time_samples: i64,
    pub project_time_music: f64,
    pub bar_position_music: f64,
    pub cycle_start_music: f64,
    pub cycle_end_music: f64,
    pub tempo: f64,
    pub time_sig_numerator: i32,
    pub time_sig_denominator: i32,
    pub chord: i32,
    pub smpte_offset_sub_frames: i32,
    pub frame_rate: i32,
    pub samples_to_next_clock: i32,
}

impl Default for ProcessContext {
    fn default() -> Self {
        Self {
            state: 0,
            sample_rate: 44100.0,
            project_time_samples: 0,
            system_time: 0,
            continous_time_samples: 0,
            project_time_music: 0.0,
            bar_position_music: 0.0,
            cycle_start_music: 0.0,
            cycle_end_music: 0.0,
            tempo: 120.0,
            time_sig_numerator: 4,
            time_sig_denominator: 4,
            chord: 0,
            smpte_offset_sub_frames: 0,
            frame_rate: 0,
            samples_to_next_clock: 0,
        }
    }
}

/// ProcessData — main structure passed to IAudioProcessor::process.
#[repr(C)]
pub struct ProcessData {
    pub process_mode: i32,
    pub symbolic_sample_size: i32,
    pub num_samples: i32,
    pub num_inputs: i32,
    pub num_outputs: i32,
    pub inputs: *mut AudioBusBuffers,
    pub outputs: *mut AudioBusBuffers,
    pub input_param_changes: *mut IParameterChanges,
    pub output_param_changes: *mut IParameterChanges,
    pub input_events: *mut IEventList,
    pub output_events: *mut IEventList,
    pub context: *mut ProcessContext,
}

impl Default for ProcessData {
    fn default() -> Self {
        Self {
            process_mode: K_REALTIME,
            symbolic_sample_size: K_SAMPLE32,
            num_samples: 0,
            num_inputs: 0,
            num_outputs: 1,
            inputs: std::ptr::null_mut(),
            outputs: std::ptr::null_mut(),
            input_param_changes: std::ptr::null_mut(),
            output_param_changes: std::ptr::null_mut(),
            input_events: std::ptr::null_mut(),
            output_events: std::ptr::null_mut(),
            context: std::ptr::null_mut(),
        }
    }
}

/// IAudioProcessor vtable.
#[repr(C)]
pub struct IAudioProcessorVtbl {
    // IUnknown
    pub query_interface: unsafe extern "system" fn(*mut IAudioProcessor, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IAudioProcessor) -> u32,
    pub release: unsafe extern "system" fn(*mut IAudioProcessor) -> u32,
    // IAudioProcessor
    pub set_bus_arrangements: unsafe extern "system" fn(*mut IAudioProcessor, inputs: *mut u64, num_ins: i32, outputs: *mut u64, num_outs: i32) -> i32,
    pub get_bus_arrangement: unsafe extern "system" fn(*mut IAudioProcessor, dir: i32, index: i32, arr: *mut u64) -> i32,
    pub can_process_sample_size: unsafe extern "system" fn(*mut IAudioProcessor, symbolic_sample_size: i32) -> i32,
    pub get_latency_samples: unsafe extern "system" fn(*mut IAudioProcessor) -> u32,
    pub setup_processing: unsafe extern "system" fn(*mut IAudioProcessor, setup: *mut ProcessSetup) -> i32,
    pub set_processing: unsafe extern "system" fn(*mut IAudioProcessor, state: u8) -> i32,
    pub process: unsafe extern "system" fn(*mut IAudioProcessor, data: *mut ProcessData) -> i32,
    pub get_tail_samples: unsafe extern "system" fn(*mut IAudioProcessor) -> u32,
}

#[repr(C)]
pub struct IAudioProcessor {
    pub vtbl: *const IAudioProcessorVtbl,
}

/// ParameterInfo — returned by IEditController::get_parameter_info.
#[repr(C)]
pub struct ParameterInfo {
    pub id: u32,
    pub title: [u16; 128],
    pub short_title: [u16; 128],
    pub units: [u16; 128],
    pub step_count: i32,
    pub default_normalized_value: f64,
    pub unit_id: i32,
    pub flags: i32,
}

/// IEditController vtable.
#[repr(C)]
pub struct IEditControllerVtbl {
    // IUnknown
    pub query_interface: unsafe extern "system" fn(*mut IEditController, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IEditController) -> u32,
    pub release: unsafe extern "system" fn(*mut IEditController) -> u32,
    // IPlugBase
    pub initialize: unsafe extern "system" fn(*mut IEditController, context: *mut c_void) -> i32,
    pub terminate: unsafe extern "system" fn(*mut IEditController) -> i32,
    // IEditController
    pub set_component_state: unsafe extern "system" fn(*mut IEditController, state: *mut IBStream) -> i32,
    pub set_state: unsafe extern "system" fn(*mut IEditController, state: *mut IBStream) -> i32,
    pub get_state: unsafe extern "system" fn(*mut IEditController, state: *mut IBStream) -> i32,
    pub get_parameter_count: unsafe extern "system" fn(*mut IEditController) -> i32,
    pub get_parameter_info: unsafe extern "system" fn(*mut IEditController, param_index: i32, info: *mut ParameterInfo) -> i32,
    pub get_param_string_by_value: unsafe extern "system" fn(*mut IEditController, id: u32, value_normalized: f64, string: *mut u16) -> i32,
    pub get_param_value_by_string: unsafe extern "system" fn(*mut IEditController, id: u32, string: *const u16, value_normalized: *mut f64) -> i32,
    pub normalized_param_to_plain: unsafe extern "system" fn(*mut IEditController, id: u32, value_normalized: f64) -> f64,
    pub plain_param_to_normalized: unsafe extern "system" fn(*mut IEditController, id: u32, plain_value: f64) -> f64,
    pub get_param_normalized: unsafe extern "system" fn(*mut IEditController, id: u32) -> f64,
    pub set_param_normalized: unsafe extern "system" fn(*mut IEditController, id: u32, value: f64) -> i32,
    pub set_component_handler: unsafe extern "system" fn(*mut IEditController, handler: *mut c_void) -> i32,
    pub create_view: unsafe extern "system" fn(*mut IEditController, name: FIDString) -> *mut c_void,
}

#[repr(C)]
pub struct IEditController {
    pub vtbl: *const IEditControllerVtbl,
}

/// Well-known IIDs used for QueryInterface calls.
/// These are the standard VST3 SDK interface GUIDs.
pub mod iids {
    use super::Guid;

    /// IComponent IID: {E831FF31-F2D5-4301-928E-BBEE25697802}
    pub const I_COMPONENT: Guid = [
        0xE8, 0x31, 0xFF, 0x31, 0xF2, 0xD5, 0x43, 0x01,
        0x92, 0x8E, 0xBB, 0xEE, 0x25, 0x69, 0x78, 0x02,
    ];

    /// IAudioProcessor IID: {42043F99-B7DA-453C-A569-E79D9AAEC33D}
    pub const I_AUDIO_PROCESSOR: Guid = [
        0x42, 0x04, 0x3F, 0x99, 0xB7, 0xDA, 0x45, 0x3C,
        0xA5, 0x69, 0xE7, 0x9D, 0x9A, 0xAE, 0xC3, 0x3D,
    ];

    /// IEditController IID: {DCD7BBE3-7742-448D-A874-AACC979C759E}
    pub const I_EDIT_CONTROLLER: Guid = [
        0xDC, 0xD7, 0xBB, 0xE3, 0x77, 0x42, 0x44, 0x8D,
        0xA8, 0x74, 0xAA, 0xCC, 0x97, 0x9C, 0x75, 0x9E,
    ];

    /// IPluginFactory IID: {7A4D811C-5211-4A1F-AED9-D2EE0B43BF9F}
    pub const I_PLUGIN_FACTORY: Guid = [
        0x7A, 0x4D, 0x81, 0x1C, 0x52, 0x11, 0x4A, 0x1F,
        0xAE, 0xD9, 0xD2, 0xEE, 0x0B, 0x43, 0xBF, 0x9F,
    ];

    /// IPluginFactory2 IID: {0007B650-F24B-4C0B-A464-EDB9F00B2ABB}
    pub const I_PLUGIN_FACTORY2: Guid = [
        0x00, 0x07, 0xB6, 0x50, 0xF2, 0x4B, 0x4C, 0x0B,
        0xA4, 0x64, 0xED, 0xB9, 0xF0, 0x0B, 0x2A, 0xBB,
    ];
}

/// Converts a null-terminated `[i8; N]` array to a Rust `String`.
pub fn i8_array_to_string(arr: &[i8]) -> String {
    let bytes: Vec<u8> = arr.iter()
        .take_while(|&&b| b != 0)
        .map(|&b| b as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Converts a null-terminated `[u16; N]` UTF-16 array to a Rust `String`.
pub fn u16_array_to_string(arr: &[u16]) -> String {
    let len = arr.iter().position(|&c| c == 0).unwrap_or(arr.len());
    String::from_utf16_lossy(&arr[..len])
}

/// Encodes a GUID as a hyphenated string, e.g. `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`.
pub fn guid_to_string(guid: &Guid) -> String {
    format!(
        "{{{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}}}",
        guid[0], guid[1], guid[2], guid[3],
        guid[4], guid[5],
        guid[6], guid[7],
        guid[8], guid[9],
        guid[10], guid[11], guid[12], guid[13], guid[14], guid[15],
    )
}
