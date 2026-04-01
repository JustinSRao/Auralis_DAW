/// VST3 parameter enumeration helpers.
///
/// Reads the parameter descriptors exposed by an `IEditController` and converts
/// them into serialisable `ParamInfo` structs.
use serde::{Deserialize, Serialize};

use super::com::{IEditController, u16_array_to_string, K_RESULT_OK};

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/// Serialisable description of a single VST3 parameter.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ParamInfo {
    /// Unique parameter ID (as reported by the plugin).
    pub id: u32,
    /// Human-readable parameter title (e.g. `"Volume"`).
    pub title: String,
    /// Unit label (e.g. `"dB"` or `"%"`).
    pub units: String,
    /// Number of discrete steps (0 = continuous).
    pub step_count: i32,
    /// Default value in normalised [0, 1] range.
    pub default_normalized: f64,
    /// Raw `ParameterInfo::flags` bitmask from the VST3 SDK.
    pub flags: i32,
    /// Current normalised value (populated from `get_param_normalized`).
    pub current_normalized: f64,
}

// ────────────────────────────────────────────────────────────────────────────
// Public functions
// ────────────────────────────────────────────────────────────────────────────

/// Reads all parameters from `controller` and returns them as a `Vec<ParamInfo>`.
///
/// # Safety
/// `controller` must be a valid, initialised `IEditController` pointer.
pub fn enumerate_params(controller: *mut IEditController) -> anyhow::Result<Vec<ParamInfo>> {
    if controller.is_null() {
        anyhow::bail!("enumerate_params: null IEditController pointer");
    }
    let count = unsafe { ((*(*controller).vtbl).get_parameter_count)(controller) };
    let mut params = Vec::with_capacity(count as usize);
    for i in 0..count {
        let mut raw = unsafe { std::mem::zeroed::<super::com::ParameterInfo>() };
        let res = unsafe {
            ((*(*controller).vtbl).get_parameter_info)(controller, i, &mut raw)
        };
        if res != K_RESULT_OK {
            continue;
        }
        let current = unsafe {
            ((*(*controller).vtbl).get_param_normalized)(controller, raw.id)
        };
        params.push(ParamInfo {
            id:                  raw.id,
            title:               u16_array_to_string(&raw.title),
            units:               u16_array_to_string(&raw.units),
            step_count:          raw.step_count,
            default_normalized:  raw.default_normalized_value,
            flags:               raw.flags,
            current_normalized:  current,
        });
    }
    Ok(params)
}
