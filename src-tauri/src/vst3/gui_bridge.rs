/// VST3 GUI bridge — manages the Win32 child window that hosts a plugin's native GUI.
///
/// All Win32 window operations **must** be dispatched to the main UI thread via
/// `AppHandle::run_on_main_thread` before calling any function in this module,
/// because Win32 requires windows to be created and destroyed on the thread that
/// owns them (VST3 spec compliance).
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::com::IEditController;

// ─────────────────────────────────────────────────────────────────────────────
// ViewRect — returned by IPlugView::get_size
// ─────────────────────────────────────────────────────────────────────────────

/// The bounding rectangle reported by `IPlugView::get_size`.
#[repr(C)]
pub struct ViewRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

// ─────────────────────────────────────────────────────────────────────────────
// IPlugView COM vtable — minimal definition matching the VST3 SDK ABI
// ─────────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct IPlugViewVtbl {
    // IUnknown
    pub query_interface:
        unsafe extern "system" fn(*mut IPlugView, *const [u8; 16], *mut *mut std::ffi::c_void)
            -> i32,
    pub add_ref: unsafe extern "system" fn(*mut IPlugView) -> u32,
    pub release: unsafe extern "system" fn(*mut IPlugView) -> u32,
    // IPlugView
    pub is_platform_type_supported:
        unsafe extern "system" fn(*mut IPlugView, type_: *const i8) -> i32,
    pub attached:
        unsafe extern "system" fn(
            *mut IPlugView,
            parent: *mut std::ffi::c_void,
            type_: *const i8,
        ) -> i32,
    pub removed: unsafe extern "system" fn(*mut IPlugView) -> i32,
    pub on_wheel: unsafe extern "system" fn(*mut IPlugView, distance: f32) -> i32,
    pub on_key_down:
        unsafe extern "system" fn(*mut IPlugView, key: i16, key_code: i16, modifiers: i16) -> i32,
    pub on_key_up:
        unsafe extern "system" fn(*mut IPlugView, key: i16, key_code: i16, modifiers: i16) -> i32,
    pub get_size: unsafe extern "system" fn(*mut IPlugView, size: *mut ViewRect) -> i32,
    pub on_size: unsafe extern "system" fn(*mut IPlugView, new_size: *mut ViewRect) -> i32,
    pub on_focus: unsafe extern "system" fn(*mut IPlugView, state: u8) -> i32,
    pub set_frame:
        unsafe extern "system" fn(*mut IPlugView, frame: *mut std::ffi::c_void) -> i32,
    pub can_resize: unsafe extern "system" fn(*mut IPlugView) -> i32,
    pub check_size_constraint:
        unsafe extern "system" fn(*mut IPlugView, rect: *mut ViewRect) -> i32,
}

#[repr(C)]
pub struct IPlugView {
    pub vtbl: *const IPlugViewVtbl,
}

// ─────────────────────────────────────────────────────────────────────────────
// Managed state type alias
// ─────────────────────────────────────────────────────────────────────────────

/// Tauri managed state: maps instance_id → open GUI bridge.
pub type Vst3GuiState = Arc<Mutex<HashMap<String, Vst3GuiBridge>>>;

// ─────────────────────────────────────────────────────────────────────────────
// Vst3GuiBridge
// ─────────────────────────────────────────────────────────────────────────────

/// Manages the Win32 child window that hosts a VST3 plugin's native GUI.
///
/// # Thread safety
/// All methods that touch `plug_view` or `hwnd_isize` **must** be called from the
/// Win32 main thread (i.e., inside an `AppHandle::run_on_main_thread` closure).
/// The HWND and IPlugView pointer are stored as `isize`/`usize` so the struct
/// satisfies `Send`, allowing it to be stored in the `Mutex<HashMap>` managed state.
pub struct Vst3GuiBridge {
    /// The instance ID this bridge belongs to.
    pub instance_id: String,
    /// `IPlugView` pointer cast to `isize` for `Send`-safe storage.
    ///
    /// # Safety
    /// Only cast back to `*mut IPlugView` on the Win32 main thread while the
    /// plugin DLL is still loaded.
    plug_view_isize: isize,
    /// Win32 child HWND cast to `isize` for `Send`-safe storage.
    ///
    /// # Safety
    /// Only cast back to `HWND` (= `*mut c_void`) on the Win32 main thread.
    hwnd_isize: isize,
    /// Set to `true` after `close()` so that `Drop` skips double-cleanup.
    closed: bool,
}

// Safety: `Vst3GuiBridge` is only accessed while holding the `Vst3GuiState`
// mutex.  All Win32 calls are dispatched to the main thread via
// `run_on_main_thread` before the bridge is stored in managed state, so no
// raw-pointer access ever races across threads.  We store pointers as `isize`
// which is `Send`, and we never dereference them off the main thread.
unsafe impl Send for Vst3GuiBridge {}
unsafe impl Sync for Vst3GuiBridge {}

impl Vst3GuiBridge {
    /// Opens a VST3 plugin GUI.
    ///
    /// Queries `IPlugView` from the edit controller, determines the requested
    /// size, creates a Win32 child window, and calls `IPlugView::attached`.
    ///
    /// # Safety preconditions
    /// - `controller` must be a valid, initialised `IEditController` pointer.
    /// - `parent_hwnd_isize` must encode a valid Win32 HWND (`*mut c_void` cast to `isize`).
    /// - **Must be called on the Win32 main thread.**
    #[cfg(target_os = "windows")]
    pub fn open(
        instance_id: String,
        controller: *mut IEditController,
        parent_hwnd_isize: isize,
    ) -> anyhow::Result<Self> {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::Graphics::Gdi::UpdateWindow;
        use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, WS_CHILD, WS_VISIBLE,
        };

        use super::com::K_RESULT_OK;

        anyhow::ensure!(!controller.is_null(), "controller is null");

        // ── 1. Obtain IPlugView from create_view("editor") ──────────────────
        let k_editor: &[u8] = b"editor\0";
        let view_raw = unsafe {
            ((*(*controller).vtbl).create_view)(controller, k_editor.as_ptr() as *const i8)
        };
        anyhow::ensure!(
            !view_raw.is_null(),
            "IEditController::create_view returned null"
        );
        let plug_view = view_raw as *mut IPlugView;

        // ── 2. Get preferred size ────────────────────────────────────────────
        let mut rect = ViewRect {
            left: 0,
            top: 0,
            right: 600,
            bottom: 400,
        };
        unsafe { ((*(*plug_view).vtbl).get_size)(plug_view, &mut rect) };
        let width = (rect.right - rect.left).max(100);
        let height = (rect.bottom - rect.top).max(100);

        // ── 3. Register window class (once) ─────────────────────────────────
        register_vst3_window_class();

        // ── 4. Create child window ───────────────────────────────────────────
        let hinstance = unsafe { GetModuleHandleW(std::ptr::null()) };
        let class_name: Vec<u16> = "Vst3PluginView\0".encode_utf16().collect();
        let window_name: Vec<u16> = "VST3\0".encode_utf16().collect();
        // Decode parent HWND from isize.
        let parent_hwnd: HWND = parent_hwnd_isize as HWND;

        let child_hwnd: HWND = unsafe {
            CreateWindowExW(
                0,
                class_name.as_ptr(),
                window_name.as_ptr(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                width,
                height,
                parent_hwnd,
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null(),
            )
        };
        anyhow::ensure!(
            !child_hwnd.is_null(),
            "CreateWindowExW failed for VST3 plugin view"
        );

        unsafe { UpdateWindow(child_hwnd) };

        // ── 5. Attach the plugin view ────────────────────────────────────────
        let k_hwnd: &[u8] = b"HWND\0";
        let res = unsafe {
            ((*(*plug_view).vtbl).attached)(
                plug_view,
                child_hwnd as *mut std::ffi::c_void,
                k_hwnd.as_ptr() as *const i8,
            )
        };
        if res != K_RESULT_OK {
            unsafe { DestroyWindow(child_hwnd) };
            anyhow::bail!("IPlugView::attached returned {res}");
        }

        Ok(Vst3GuiBridge {
            instance_id,
            plug_view_isize: plug_view as isize,
            hwnd_isize: child_hwnd as isize,
            closed: false,
        })
    }

    /// No-op stub so the module compiles on non-Windows targets.
    #[cfg(not(target_os = "windows"))]
    pub fn open(
        instance_id: String,
        _controller: *mut IEditController,
        _parent_hwnd_isize: isize,
    ) -> anyhow::Result<Self> {
        anyhow::bail!("VST3 GUI is only supported on Windows");
        #[allow(unreachable_code)]
        Ok(Vst3GuiBridge {
            instance_id,
            plug_view_isize: 0,
            hwnd_isize: 0,
            closed: false,
        })
    }

    /// Closes the plugin GUI: calls `IPlugView::removed` and destroys the child window.
    ///
    /// **Must be called on the Win32 main thread.**
    #[cfg(target_os = "windows")]
    pub fn close(mut self) -> anyhow::Result<()> {
        use windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow;
        self.closed = true;
        if self.plug_view_isize != 0 {
            let plug_view = self.plug_view_isize as *mut IPlugView;
            unsafe { ((*(*plug_view).vtbl).removed)(plug_view) };
            unsafe { ((*(*plug_view).vtbl).release)(plug_view) };
        }
        if self.hwnd_isize != 0 {
            let hwnd = self.hwnd_isize as windows_sys::Win32::Foundation::HWND;
            unsafe { DestroyWindow(hwnd) };
        }
        Ok(())
    }

    /// No-op stub on non-Windows.
    #[cfg(not(target_os = "windows"))]
    pub fn close(mut self) -> anyhow::Result<()> {
        self.closed = true;
        Ok(())
    }

    /// Returns the child HWND encoded as `isize` for dispatch to the main thread.
    pub fn hwnd_isize(&self) -> isize {
        self.hwnd_isize
    }
}

impl Drop for Vst3GuiBridge {
    fn drop(&mut self) {
        if self.closed {
            return;
        }
        // Best-effort cleanup — ignore errors during drop.
        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow;
            if self.plug_view_isize != 0 {
                let plug_view = self.plug_view_isize as *mut IPlugView;
                unsafe { ((*(*plug_view).vtbl).removed)(plug_view) };
                unsafe { ((*(*plug_view).vtbl).release)(plug_view) };
            }
            if self.hwnd_isize != 0 {
                let hwnd = self.hwnd_isize as windows_sys::Win32::Foundation::HWND;
                unsafe { DestroyWindow(hwnd) };
            }
        }
        self.closed = true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Win32 window class registration helper
// ─────────────────────────────────────────────────────────────────────────────

/// Registers the `"Vst3PluginView"` window class exactly once for the process lifetime.
#[cfg(target_os = "windows")]
fn register_vst3_window_class() {
    use std::sync::Once;
    use windows_sys::Win32::Graphics::Gdi::GetStockObject;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, RegisterClassExW, CS_HREDRAW, CS_VREDRAW, WNDCLASSEXW,
    };

    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let class_name: Vec<u16> = "Vst3PluginView\0".encode_utf16().collect();
        let hinstance = unsafe { GetModuleHandleW(std::ptr::null()) };
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(DefWindowProcW),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: unsafe { GetStockObject(0) },
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
            hIconSm: std::ptr::null_mut(),
        };
        unsafe { RegisterClassExW(&wc) };
    });
}

#[cfg(not(target_os = "windows"))]
fn register_vst3_window_class() {}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that a Vst3GuiBridge with zero pointers doesn't panic on drop
    /// when `closed = true`.
    #[test]
    fn bridge_drop_when_already_closed_does_not_panic() {
        let bridge = Vst3GuiBridge {
            instance_id: "test".to_string(),
            plug_view_isize: 0,
            hwnd_isize: 0,
            closed: true, // already closed — drop is a no-op
        };
        drop(bridge); // must not panic
    }
}
