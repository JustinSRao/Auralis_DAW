/// VST3 host application and component handler implementations.
///
/// `VstHostApplication` presents the host identity to plugins.
/// `VstComponentHandler` forwards parameter changes to the command channel.
use std::ffi::c_void;

use crossbeam_channel::Sender;

use super::commands::Vst3Cmd;
use super::com::{Guid, K_RESULT_OK, K_NOT_IMPLEMENTED};

// ────────────────────────────────────────────────────────────────────────────
// IHostApplication vtable types
// ────────────────────────────────────────────────────────────────────────────

/// Raw vtable for `IHostApplication`.
///
/// VST3 SDK IID: `{58E595CC-DB2D-4969-8B6A-AF8C36A664EA}`
#[repr(C)]
pub struct IHostApplicationVtbl {
    pub query_interface: unsafe extern "system" fn(*mut IHostApplication, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref:         unsafe extern "system" fn(*mut IHostApplication) -> u32,
    pub release:         unsafe extern "system" fn(*mut IHostApplication) -> u32,
    pub get_name:        unsafe extern "system" fn(*mut IHostApplication, name: *mut u16) -> i32,
    pub create_instance: unsafe extern "system" fn(*mut IHostApplication, cid: *const Guid, iid: *const Guid, obj: *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IHostApplication {
    pub vtbl: *const IHostApplicationVtbl,
}

// ────────────────────────────────────────────────────────────────────────────
// IComponentHandler vtable types
// ────────────────────────────────────────────────────────────────────────────

/// Raw vtable for `IComponentHandler`.
///
/// VST3 SDK IID: `{93A0BEA3-0BD0-45DB-8E89-0B0CC1E46AC6}`
#[repr(C)]
pub struct IComponentHandlerVtbl {
    pub query_interface:  unsafe extern "system" fn(*mut IComponentHandler, *const Guid, *mut *mut c_void) -> i32,
    pub add_ref:          unsafe extern "system" fn(*mut IComponentHandler) -> u32,
    pub release:          unsafe extern "system" fn(*mut IComponentHandler) -> u32,
    pub begin_edit:       unsafe extern "system" fn(*mut IComponentHandler, id: u32) -> i32,
    pub perform_edit:     unsafe extern "system" fn(*mut IComponentHandler, id: u32, value: f64) -> i32,
    pub end_edit:         unsafe extern "system" fn(*mut IComponentHandler, id: u32) -> i32,
    pub restart_component: unsafe extern "system" fn(*mut IComponentHandler, flags: i32) -> i32,
}

#[repr(C)]
pub struct IComponentHandler {
    pub vtbl: *const IComponentHandlerVtbl,
}

// ────────────────────────────────────────────────────────────────────────────
// VstHostApplication
// ────────────────────────────────────────────────────────────────────────────

/// Implements `IHostApplication` — reports the host name to plugins.
///
/// The vtbl pointer must be the first field so casting between
/// `*mut VstHostApplication` and `*mut IHostApplication` is valid.
#[repr(C)]
pub struct VstHostApplication {
    vtbl: *const IHostApplicationVtbl,
    ref_count: u32,
}

static HOST_APP_VTBL: IHostApplicationVtbl = IHostApplicationVtbl {
    query_interface:  host_app_query_interface,
    add_ref:          host_app_add_ref,
    release:          host_app_release,
    get_name:         host_app_get_name,
    create_instance:  host_app_create_instance,
};

impl VstHostApplication {
    /// Creates a new `VstHostApplication`.
    pub fn new() -> Self {
        Self { vtbl: &HOST_APP_VTBL, ref_count: 1 }
    }

    /// Returns a raw `*mut IHostApplication` pointer for passing into plugin calls.
    ///
    /// # Safety
    /// The pointer is valid only as long as this `VstHostApplication` is alive.
    pub fn as_host_ptr(&mut self) -> *mut IHostApplication {
        self as *mut VstHostApplication as *mut IHostApplication
    }
}

impl Default for VstHostApplication {
    fn default() -> Self { Self::new() }
}

// Safety: VstHostApplication holds no non-Send data; the vtbl is a static.
unsafe impl Send for VstHostApplication {}
unsafe impl Sync for VstHostApplication {}

/// "Music Application\0" as a UTF-16 array.
static HOST_NAME_UTF16: &[u16] = &[
    b'M' as u16, b'u' as u16, b's' as u16, b'i' as u16, b'c' as u16, b' ' as u16,
    b'A' as u16, b'p' as u16, b'p' as u16, b'l' as u16, b'i' as u16, b'c' as u16,
    b'a' as u16, b't' as u16, b'i' as u16, b'o' as u16, b'n' as u16, 0u16,
];

unsafe extern "system" fn host_app_query_interface(
    _this: *mut IHostApplication,
    _iid: *const Guid,
    _obj: *mut *mut c_void,
) -> i32 {
    K_NOT_IMPLEMENTED
}

unsafe extern "system" fn host_app_add_ref(this: *mut IHostApplication) -> u32 {
    let inner = &mut *(this as *mut VstHostApplication);
    inner.ref_count = inner.ref_count.saturating_add(1);
    inner.ref_count
}

unsafe extern "system" fn host_app_release(this: *mut IHostApplication) -> u32 {
    let inner = &mut *(this as *mut VstHostApplication);
    if inner.ref_count > 0 { inner.ref_count -= 1; }
    inner.ref_count
}

unsafe extern "system" fn host_app_get_name(
    _this: *mut IHostApplication,
    name: *mut u16,
) -> i32 {
    if name.is_null() {
        return K_NOT_IMPLEMENTED;
    }
    // Copy up to 128 UTF-16 code units (SDK buffer size).
    let len = HOST_NAME_UTF16.len().min(128);
    std::ptr::copy_nonoverlapping(HOST_NAME_UTF16.as_ptr(), name, len);
    K_RESULT_OK
}

unsafe extern "system" fn host_app_create_instance(
    _this: *mut IHostApplication,
    _cid: *const Guid,
    _iid: *const Guid,
    _obj: *mut *mut c_void,
) -> i32 {
    K_NOT_IMPLEMENTED
}

// ────────────────────────────────────────────────────────────────────────────
// VstComponentHandler
// ────────────────────────────────────────────────────────────────────────────

/// Implements `IComponentHandler` — forwards parameter changes to the command channel.
///
/// The vtbl pointer must be the first field.
#[repr(C)]
pub struct VstComponentHandler {
    vtbl: *const IComponentHandlerVtbl,
    ref_count: u32,
    /// Sender for the per-plugin command channel. `try_send` is used so this never blocks.
    sender: Sender<Vst3Cmd>,
}

static COMPONENT_HANDLER_VTBL: IComponentHandlerVtbl = IComponentHandlerVtbl {
    query_interface:   comp_handler_query_interface,
    add_ref:           comp_handler_add_ref,
    release:           comp_handler_release,
    begin_edit:        comp_handler_begin_edit,
    perform_edit:      comp_handler_perform_edit,
    end_edit:          comp_handler_end_edit,
    restart_component: comp_handler_restart,
};

impl VstComponentHandler {
    /// Creates a new `VstComponentHandler` that sends events to `sender`.
    pub fn new(sender: Sender<Vst3Cmd>) -> Self {
        Self { vtbl: &COMPONENT_HANDLER_VTBL, ref_count: 1, sender }
    }

    /// Returns a raw `*mut IComponentHandler` pointer.
    ///
    /// # Safety
    /// The pointer is valid only as long as this `VstComponentHandler` is alive.
    pub fn as_handler_ptr(&mut self) -> *mut IComponentHandler {
        self as *mut VstComponentHandler as *mut IComponentHandler
    }
}

// Safety: VstComponentHandler's only non-trivially-Send field is the
// `crossbeam_channel::Sender` which is `Send + Sync` by design.
unsafe impl Send for VstComponentHandler {}
unsafe impl Sync for VstComponentHandler {}

unsafe extern "system" fn comp_handler_query_interface(
    _this: *mut IComponentHandler,
    _iid: *const Guid,
    _obj: *mut *mut c_void,
) -> i32 {
    K_NOT_IMPLEMENTED
}

unsafe extern "system" fn comp_handler_add_ref(this: *mut IComponentHandler) -> u32 {
    let inner = &mut *(this as *mut VstComponentHandler);
    inner.ref_count = inner.ref_count.saturating_add(1);
    inner.ref_count
}

unsafe extern "system" fn comp_handler_release(this: *mut IComponentHandler) -> u32 {
    let inner = &mut *(this as *mut VstComponentHandler);
    if inner.ref_count > 0 { inner.ref_count -= 1; }
    inner.ref_count
}

unsafe extern "system" fn comp_handler_begin_edit(
    _this: *mut IComponentHandler,
    _id: u32,
) -> i32 {
    K_RESULT_OK
}

unsafe extern "system" fn comp_handler_perform_edit(
    this: *mut IComponentHandler,
    id: u32,
    value: f64,
) -> i32 {
    let inner = &*(this as *mut VstComponentHandler);
    // Non-blocking send — if the channel is full, we drop the event rather than block.
    let _ = inner.sender.try_send(Vst3Cmd::ParamChanged { id, value });
    K_RESULT_OK
}

unsafe extern "system" fn comp_handler_end_edit(
    _this: *mut IComponentHandler,
    _id: u32,
) -> i32 {
    K_RESULT_OK
}

unsafe extern "system" fn comp_handler_restart(
    _this: *mut IComponentHandler,
    _flags: i32,
) -> i32 {
    K_RESULT_OK
}
