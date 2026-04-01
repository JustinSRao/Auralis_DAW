/// VST3 IBStream implementation for plugin state serialization.
///
/// `VecIBStream` wraps a `Vec<u8>` and exposes it as an `IBStream` COM interface,
/// allowing plugins to read and write their state to/from memory.
use std::ffi::c_void;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

use super::com::{IBStream, IBStreamVtbl, Guid, K_RESULT_OK, K_RESULT_FALSE};

// ────────────────────────────────────────────────────────────────────────────
// VecIBStream
// ────────────────────────────────────────────────────────────────────────────

/// An in-memory stream over a `Vec<u8>` implementing the VST3 `IBStream` COM interface.
///
/// The layout is `{ vtbl, data, cursor, ref_count }` — the vtbl pointer must be the
/// first field so that casting `*mut VecIBStream` to `*mut IBStream` is safe.
#[repr(C)]
pub struct VecIBStream {
    vtbl: *const IBStreamVtbl,
    data: Vec<u8>,
    cursor: usize,
    ref_count: u32,
}

// Static vtable for VecIBStream.
static VEC_IBSTREAM_VTBL: IBStreamVtbl = IBStreamVtbl {
    query_interface: vec_ibstream_query_interface,
    add_ref: vec_ibstream_add_ref,
    release: vec_ibstream_release,
    read: vec_ibstream_read,
    write: vec_ibstream_write,
    seek: vec_ibstream_seek,
    tell: vec_ibstream_tell,
};

impl VecIBStream {
    /// Creates a new empty `VecIBStream` for writing.
    pub fn new_empty() -> Self {
        Self {
            vtbl: &VEC_IBSTREAM_VTBL,
            data: Vec::new(),
            cursor: 0,
            ref_count: 1,
        }
    }

    /// Creates a `VecIBStream` pre-loaded with `data`, positioned at offset 0 for reading.
    pub fn from_data(data: Vec<u8>) -> Self {
        Self {
            vtbl: &VEC_IBSTREAM_VTBL,
            data,
            cursor: 0,
            ref_count: 1,
        }
    }

    /// Returns a raw `*mut IBStream` pointer for passing into plugin API calls.
    ///
    /// # Safety
    /// The pointer is valid only as long as this `VecIBStream` is alive and not moved.
    pub fn as_ibstream_ptr(&mut self) -> *mut IBStream {
        self as *mut VecIBStream as *mut IBStream
    }

    /// Returns the underlying data bytes.
    pub fn into_data(self) -> Vec<u8> {
        self.data
    }

    /// Encodes the stream contents as a base64 string.
    pub fn to_base64(&self) -> String {
        BASE64.encode(&self.data)
    }

    /// Decodes a base64 string into a new `VecIBStream`.
    pub fn from_base64(s: &str) -> anyhow::Result<Self> {
        let data = BASE64
            .decode(s)
            .map_err(|e| anyhow::anyhow!("base64 decode failed: {e}"))?;
        Ok(Self::from_data(data))
    }
}

// Safety: VecIBStream is only accessed through COM calls while the plugin DLL holds a reference.
// We never share it across threads simultaneously; the mutex in LoadedPlugin serialises access.
unsafe impl Send for VecIBStream {}
unsafe impl Sync for VecIBStream {}

// ────────────────────────────────────────────────────────────────────────────
// COM vtable function implementations
// ────────────────────────────────────────────────────────────────────────────

/// Casts the opaque `*mut IBStream` pointer back to `*mut VecIBStream`.
///
/// # Safety
/// The pointer must have been obtained from `VecIBStream::as_ibstream_ptr`.
#[inline]
unsafe fn as_inner(this: *mut IBStream) -> &'static mut VecIBStream {
    // SAFETY: VecIBStream begins with the vtbl field at offset 0, so the pointer
    // cast is valid when `this` was originally a `VecIBStream`.
    &mut *(this as *mut VecIBStream)
}

unsafe extern "system" fn vec_ibstream_query_interface(
    _this: *mut IBStream,
    _iid: *const Guid,
    _obj: *mut *mut c_void,
) -> i32 {
    K_RESULT_FALSE
}

unsafe extern "system" fn vec_ibstream_add_ref(this: *mut IBStream) -> u32 {
    let inner = as_inner(this);
    inner.ref_count = inner.ref_count.saturating_add(1);
    inner.ref_count
}

unsafe extern "system" fn vec_ibstream_release(this: *mut IBStream) -> u32 {
    let inner = as_inner(this);
    if inner.ref_count > 0 {
        inner.ref_count -= 1;
    }
    inner.ref_count
}

unsafe extern "system" fn vec_ibstream_read(
    this: *mut IBStream,
    buffer: *mut c_void,
    num_bytes: i32,
    num_bytes_read: *mut i32,
) -> i32 {
    let inner = as_inner(this);
    if buffer.is_null() || num_bytes <= 0 {
        if !num_bytes_read.is_null() {
            *num_bytes_read = 0;
        }
        return K_RESULT_FALSE;
    }
    let want = num_bytes as usize;
    let available = inner.data.len().saturating_sub(inner.cursor);
    let actual = want.min(available);
    if actual > 0 {
        std::ptr::copy_nonoverlapping(
            inner.data[inner.cursor..].as_ptr(),
            buffer as *mut u8,
            actual,
        );
        inner.cursor += actual;
    }
    if !num_bytes_read.is_null() {
        *num_bytes_read = actual as i32;
    }
    if actual == want {
        K_RESULT_OK
    } else {
        K_RESULT_FALSE
    }
}

unsafe extern "system" fn vec_ibstream_write(
    this: *mut IBStream,
    buffer: *mut c_void,
    num_bytes: i32,
    num_bytes_written: *mut i32,
) -> i32 {
    let inner = as_inner(this);
    if buffer.is_null() || num_bytes <= 0 {
        if !num_bytes_written.is_null() {
            *num_bytes_written = 0;
        }
        return K_RESULT_FALSE;
    }
    let count = num_bytes as usize;
    let src = std::slice::from_raw_parts(buffer as *const u8, count);
    // Write at cursor position, extending if necessary.
    if inner.cursor + count > inner.data.len() {
        inner.data.resize(inner.cursor + count, 0);
    }
    inner.data[inner.cursor..inner.cursor + count].copy_from_slice(src);
    inner.cursor += count;
    if !num_bytes_written.is_null() {
        *num_bytes_written = count as i32;
    }
    K_RESULT_OK
}

/// Seek modes matching the VST3 SDK enum.
const SEEK_SET: i32 = 0;
const SEEK_CUR: i32 = 1;
const SEEK_END: i32 = 2;

unsafe extern "system" fn vec_ibstream_seek(
    this: *mut IBStream,
    pos: i64,
    mode: i32,
    result: *mut i64,
) -> i32 {
    let inner = as_inner(this);
    let new_cursor: Option<usize> = match mode {
        SEEK_SET => {
            if pos < 0 {
                None
            } else {
                Some(pos as usize)
            }
        }
        SEEK_CUR => {
            let target = inner.cursor as i64 + pos;
            if target < 0 {
                None
            } else {
                Some(target as usize)
            }
        }
        SEEK_END => {
            let target = inner.data.len() as i64 + pos;
            if target < 0 {
                None
            } else {
                Some(target as usize)
            }
        }
        _ => None,
    };
    match new_cursor {
        Some(c) => {
            inner.cursor = c;
            if !result.is_null() {
                *result = c as i64;
            }
            K_RESULT_OK
        }
        None => K_RESULT_FALSE,
    }
}

unsafe extern "system" fn vec_ibstream_tell(this: *mut IBStream, pos: *mut i64) -> i32 {
    let inner = as_inner(this);
    if !pos.is_null() {
        *pos = inner.cursor as i64;
    }
    K_RESULT_OK
}

// ────────────────────────────────────────────────────────────────────────────
// Unit tests
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_roundtrip() {
        let mut stream = VecIBStream::new_empty();
        let ptr = stream.as_ibstream_ptr();
        let data: [u8; 4] = [0xDE, 0xAD, 0xBE, 0xEF];
        let mut written = 0i32;
        unsafe {
            let res = vec_ibstream_write(ptr, data.as_ptr() as *mut c_void, 4, &mut written);
            assert_eq!(res, K_RESULT_OK);
            assert_eq!(written, 4);
        }
        // Seek back to beginning.
        unsafe {
            let res = vec_ibstream_seek(ptr, 0, SEEK_SET, std::ptr::null_mut());
            assert_eq!(res, K_RESULT_OK);
        }
        let mut out = [0u8; 4];
        let mut read_count = 0i32;
        unsafe {
            let res = vec_ibstream_read(ptr, out.as_mut_ptr() as *mut c_void, 4, &mut read_count);
            assert_eq!(res, K_RESULT_OK);
            assert_eq!(read_count, 4);
        }
        assert_eq!(out, data);
    }

    #[test]
    fn seek_and_tell() {
        let mut stream = VecIBStream::from_data(vec![1, 2, 3, 4, 5]);
        let ptr = stream.as_ibstream_ptr();

        // Tell at start should be 0.
        let mut pos = -1i64;
        unsafe {
            let res = vec_ibstream_tell(ptr, &mut pos);
            assert_eq!(res, K_RESULT_OK);
            assert_eq!(pos, 0);
        }

        // Seek to offset 3 (SEEK_SET).
        unsafe {
            let res = vec_ibstream_seek(ptr, 3, SEEK_SET, &mut pos);
            assert_eq!(res, K_RESULT_OK);
            assert_eq!(pos, 3);
        }

        // SEEK_CUR by 1 → should be 4.
        unsafe {
            let res = vec_ibstream_seek(ptr, 1, SEEK_CUR, &mut pos);
            assert_eq!(res, K_RESULT_OK);
            assert_eq!(pos, 4);
        }

        // SEEK_END by 0 → should be length (5).
        unsafe {
            let res = vec_ibstream_seek(ptr, 0, SEEK_END, &mut pos);
            assert_eq!(res, K_RESULT_OK);
            assert_eq!(pos, 5);
        }
    }

    #[test]
    fn base64_roundtrip() {
        let original = vec![0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0xFF];
        let stream = VecIBStream::from_data(original.clone());
        let encoded = stream.to_base64();
        assert!(!encoded.is_empty());
        let decoded = VecIBStream::from_base64(&encoded).expect("decode failed");
        assert_eq!(decoded.data, original);
    }

    #[test]
    fn partial_read_returns_false() {
        let mut stream = VecIBStream::from_data(vec![1, 2]);
        let ptr = stream.as_ibstream_ptr();
        let mut out = [0u8; 4];
        let mut read_count = 0i32;
        unsafe {
            let res = vec_ibstream_read(ptr, out.as_mut_ptr() as *mut c_void, 4, &mut read_count);
            // Only 2 bytes available — should return K_RESULT_FALSE.
            assert_eq!(res, K_RESULT_FALSE);
            assert_eq!(read_count, 2);
        }
    }
}
