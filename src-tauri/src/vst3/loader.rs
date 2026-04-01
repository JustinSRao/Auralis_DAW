/// VST3 plugin DLL loader.
///
/// Loads a single plugin DLL, initialises the `IComponent` and `IAudioProcessor`,
/// optionally obtains an `IEditController`, and enumerates parameters.
use std::ffi::c_void;
use std::sync::{Arc, Mutex};

use super::com::{
    guid_to_string, IComponent, IEditController, IAudioProcessor, IPluginFactory,
    IPluginFactory2, ProcessSetup, K_AUDIO, K_EVENT, K_INPUT, K_OUTPUT,
    K_REALTIME, K_RESULT_OK, K_SAMPLE32, K_SPEAKER_STEREO,
};
use super::com::iids::{I_AUDIO_PROCESSOR, I_COMPONENT, I_EDIT_CONTROLLER, I_PLUGIN_FACTORY2};
use super::host::IHostApplication;
use super::params::{enumerate_params, ParamInfo};
use super::scanner::PluginInfo;

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/// Fully initialised VST3 plugin instance ready for audio processing.
pub struct LoadedPlugin {
    /// Discovery metadata (name, path, etc.).
    pub info: PluginInfo,
    /// Unique instance ID (UUID v4 string).
    pub instance_id: String,
    /// Keeps the DLL resident; released when this struct drops.
    pub library: Arc<libloading::Library>,
    /// `IComponent` pointer — wrapped in a `Mutex` for safe cross-thread state access.
    pub component: Arc<Mutex<*mut IComponent>>,
    /// `IAudioProcessor` pointer — exclusively owned by the audio thread after construction.
    pub processor: *mut IAudioProcessor,
    /// Optional `IEditController` pointer (may alias the component or be a separate object).
    pub controller: Option<*mut IEditController>,
    /// Enumerated parameter descriptors.
    pub params: Vec<ParamInfo>,
    /// Whether this plugin is a MIDI instrument.
    pub is_instrument: bool,
}

// Safety: raw pointers here are either exclusively used on the audio thread
// (processor) or protected by a Mutex (component). We explicitly assert that
// it is safe to move `LoadedPlugin` across thread boundaries.
unsafe impl Send for LoadedPlugin {}
unsafe impl Sync for LoadedPlugin {}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/// Loads a VST3 plugin from disk and fully initialises it for audio processing.
///
/// Steps:
/// 1. Load DLL (wrapped in `catch_unwind`)
/// 2. Call `GetPluginFactory`
/// 3. Find the first `Audio Module Class` component class
/// 4. Create `IComponent` via the factory
/// 5. `QueryInterface` for `IAudioProcessor` (required)
/// 6. `QueryInterface` for `IEditController` — try component first, then separate class
/// 7. Initialise both, set up stereo buses, call `setup_processing`, `set_active`, `set_processing`
/// 8. Enumerate parameters
pub fn load_plugin(
    info: &PluginInfo,
    sample_rate: u32,
    block_size: usize,
    host: *mut IHostApplication,
) -> anyhow::Result<LoadedPlugin> {
    let dll_path = &info.dll_path;

    // 1. Load DLL — wrap in catch_unwind to survive badly written plugins.
    let lib = std::panic::catch_unwind(|| unsafe { libloading::Library::new(dll_path) })
        .map_err(|_| anyhow::anyhow!("panic while loading DLL {:?}", dll_path))?
        .map_err(|e| anyhow::anyhow!("failed to load DLL {:?}: {e}", dll_path))?;
    let lib = Arc::new(lib);

    // 2. GetPluginFactory.
    type GetPluginFactory = unsafe extern "system" fn() -> *mut IPluginFactory;
    let get_factory: libloading::Symbol<GetPluginFactory> = unsafe {
        lib.get(b"GetPluginFactory\0")
            .map_err(|e| anyhow::anyhow!("GetPluginFactory not found: {e}"))?
    };
    let factory_ptr = unsafe { get_factory() };
    anyhow::ensure!(!factory_ptr.is_null(), "GetPluginFactory returned null");

    // Try IPluginFactory2 for extended class info.
    let mut factory2_obj: *mut c_void = std::ptr::null_mut();
    let factory2_ptr: *mut IPluginFactory2 = {
        let res = unsafe {
            ((*(*factory_ptr).vtbl).query_interface)(factory_ptr, &I_PLUGIN_FACTORY2, &mut factory2_obj)
        };
        if res == K_RESULT_OK && !factory2_obj.is_null() {
            factory2_obj as *mut IPluginFactory2
        } else {
            std::ptr::null_mut()
        }
    };

    // 3. Find the target Audio Module Class by ID.
    let class_count = unsafe { ((*(*factory_ptr).vtbl).count_classes)(factory_ptr) };
    let mut target_cid: Option<[u8; 16]> = None;
    let mut controller_class_id: Option<[u8; 16]> = None;

    'outer: for i in 0..class_count {
        // Try PClassInfo2 first.
        if !factory2_ptr.is_null() {
            let mut info2 = unsafe { std::mem::zeroed::<super::com::PClassInfo2>() };
            let res = unsafe { ((*(*factory2_ptr).vtbl).get_class_info2)(factory2_ptr, i, &mut info2) };
            if res == K_RESULT_OK {
                let id_str = guid_to_string(&info2.cid);
                if id_str == info.id {
                    target_cid = Some(info2.cid);
                    // Non-zero edit_controller_class means separate controller.
                    if info2.edit_controller_class != [0u8; 16] {
                        controller_class_id = Some(info2.edit_controller_class);
                    }
                    break 'outer;
                }
                continue;
            }
        }
        // Fallback: PClassInfo.
        let mut pci = unsafe { std::mem::zeroed::<super::com::PClassInfo>() };
        let res = unsafe { ((*(*factory_ptr).vtbl).get_class_info)(factory_ptr, i, &mut pci) };
        if res == K_RESULT_OK && guid_to_string(&pci.cid) == info.id {
            target_cid = Some(pci.cid);
            break;
        }
    }
    let cid = target_cid.ok_or_else(|| anyhow::anyhow!("Plugin CID '{}' not found in factory", info.id))?;

    // 4. Create IComponent.
    let mut component_obj: *mut c_void = std::ptr::null_mut();
    let res = unsafe {
        ((*(*factory_ptr).vtbl).create_instance)(factory_ptr, &cid, &I_COMPONENT, &mut component_obj)
    };
    anyhow::ensure!(res == K_RESULT_OK, "create_instance(IComponent) failed: {res}");
    anyhow::ensure!(!component_obj.is_null(), "create_instance returned null IComponent");
    let component_ptr = component_obj as *mut IComponent;

    // 5. Initialise IComponent.
    let host_void = host as *mut c_void;
    let init_res = unsafe { ((*(*component_ptr).vtbl).initialize)(component_ptr, host_void) };
    anyhow::ensure!(init_res == K_RESULT_OK, "IComponent::initialize failed: {init_res}");

    // 6a. QueryInterface for IAudioProcessor (required).
    let mut proc_obj: *mut c_void = std::ptr::null_mut();
    let res = unsafe {
        ((*(*component_ptr).vtbl).query_interface)(component_ptr, &I_AUDIO_PROCESSOR, &mut proc_obj)
    };
    anyhow::ensure!(res == K_RESULT_OK && !proc_obj.is_null(), "IAudioProcessor not supported");
    let processor_ptr = proc_obj as *mut IAudioProcessor;

    // 6b. QueryInterface for IEditController — try component first (single-object case).
    let mut ctrl_obj: *mut c_void = std::ptr::null_mut();
    let ctrl_from_component = unsafe {
        ((*(*component_ptr).vtbl).query_interface)(component_ptr, &I_EDIT_CONTROLLER, &mut ctrl_obj)
    };
    let controller_ptr: Option<*mut IEditController> = if ctrl_from_component == K_RESULT_OK && !ctrl_obj.is_null() {
        Some(ctrl_obj as *mut IEditController)
    } else if let Some(ctrl_cid) = controller_class_id {
        // Separate controller class — create it via the factory.
        let mut ctrl2_obj: *mut c_void = std::ptr::null_mut();
        let res = unsafe {
            ((*(*factory_ptr).vtbl).create_instance)(factory_ptr, &ctrl_cid, &I_EDIT_CONTROLLER, &mut ctrl2_obj)
        };
        if res == K_RESULT_OK && !ctrl2_obj.is_null() {
            let ctrl2_ptr = ctrl2_obj as *mut IEditController;
            // Initialise the separate controller.
            let _init = unsafe { ((*(*ctrl2_ptr).vtbl).initialize)(ctrl2_ptr, host_void) };
            Some(ctrl2_ptr)
        } else {
            None
        }
    } else {
        None
    };

    // 7a. Set up stereo audio buses.
    let mut stereo = K_SPEAKER_STEREO;
    // Set bus arrangement: 0 inputs (instrument) or 1 stereo in + 1 stereo out.
    unsafe {
        ((*(*processor_ptr).vtbl).set_bus_arrangements)(
            processor_ptr,
            &mut stereo, 1,
            &mut stereo, 1,
        )
    };
    // Activate input & output audio buses.
    unsafe { ((*(*component_ptr).vtbl).activate_bus)(component_ptr, K_AUDIO, K_INPUT, 0, 1) };
    unsafe { ((*(*component_ptr).vtbl).activate_bus)(component_ptr, K_AUDIO, K_OUTPUT, 0, 1) };
    // Activate event input bus (for instruments).
    unsafe { ((*(*component_ptr).vtbl).activate_bus)(component_ptr, K_EVENT, K_INPUT, 0, 1) };

    // 7b. Setup processing.
    let mut setup = ProcessSetup {
        process_mode: K_REALTIME,
        symbolic_sample_size: K_SAMPLE32,
        max_samples_per_block: block_size as i32,
        sample_rate: sample_rate as f64,
    };
    let res = unsafe { ((*(*processor_ptr).vtbl).setup_processing)(processor_ptr, &mut setup) };
    anyhow::ensure!(res == K_RESULT_OK, "setup_processing failed: {res}");

    // 7c. Activate and start processing.
    unsafe { ((*(*component_ptr).vtbl).set_active)(component_ptr, 1) };
    unsafe { ((*(*processor_ptr).vtbl).set_processing)(processor_ptr, 1) };

    // 7d. If we have a controller, wire set_component_state so it syncs with component.
    if let Some(ctrl) = controller_ptr {
        let mut sync_stream = super::state::VecIBStream::new_empty();
        let sync_ptr = sync_stream.as_ibstream_ptr();
        let gs_res = unsafe { ((*(*component_ptr).vtbl).get_state)(component_ptr, sync_ptr) };
        if gs_res == K_RESULT_OK {
            // Seek back to 0 before handing to controller.
            unsafe {
                vec_ibstream_seek_to_start(sync_ptr);
            }
            unsafe { ((*(*ctrl).vtbl).set_component_state)(ctrl, sync_ptr) };
        }
    }

    // 8. Enumerate parameters.
    let params = match controller_ptr {
        Some(ctrl) => enumerate_params(ctrl).unwrap_or_default(),
        None => Vec::new(),
    };

    // Release factory reference.
    unsafe { ((*(*factory_ptr).vtbl).release)(factory_ptr) };

    let instance_id = uuid::Uuid::new_v4().to_string();

    Ok(LoadedPlugin {
        info: info.clone(),
        instance_id,
        library: lib,
        component: Arc::new(Mutex::new(component_ptr)),
        processor: processor_ptr,
        controller: controller_ptr,
        params,
        is_instrument: info.is_instrument,
    })
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/// Seeks a `VecIBStream` back to position 0 without exposing the internal type.
///
/// # Safety
/// `ptr` must point to a valid `VecIBStream`.
unsafe fn vec_ibstream_seek_to_start(ptr: *mut super::com::IBStream) {
    // We call the vtbl directly to avoid importing private internals.
    ((*(*ptr).vtbl).seek)(ptr, 0, 0 /* SEEK_SET */, std::ptr::null_mut());
}
