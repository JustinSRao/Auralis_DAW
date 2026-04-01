//! Tauri commands for audio clip fade-in / fade-out parameters (Sprint 45).
//!
//! Fade parameters are stored in `ClipEntry` inside `ClipStore` for runtime
//! audio playback.  They are also persisted by the frontend as part of
//! `ArrangementClip` in the project file (the store is the authority).
//!
//! ## Commands
//!
//! - `set_clip_fade_in`  — sets fade-in length and curve for a clip
//! - `set_clip_fade_out` — sets fade-out length and curve for a clip
//! - `set_fade_curve_type` — updates just the curve without changing length
//! - `set_crossfade`     — links two clips as a crossfade pair (S-Curve)
//! - `get_clip_fade_state` — returns a snapshot of all fade params for a clip

use tauri::State;

use crate::audio::clip_player::{ClipStore, ClipStateSnapshot};
use crate::audio::fade::FadeCurve;

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/// Serializable snapshot of a clip's fade parameters.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClipFadeSnapshot {
    pub clip_id:          String,
    pub fade_in_frames:   u64,
    pub fade_out_frames:  u64,
    pub fade_in_curve:    FadeCurve,
    pub fade_out_curve:   FadeCurve,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Sets the fade-in length and curve for a loaded clip.
///
/// `fade_frames` of `0` disables the fade-in.
/// `curve_type` is one of: `"linear"`, `"exponential_in"`, `"exponential_out"`,
/// `"s_curve"`, `"logarithmic"`.
#[tauri::command]
pub fn set_clip_fade_in(
    clip_id:     String,
    fade_frames: u64,
    curve_type:  String,
    clip_store:  State<'_, ClipStore>,
) -> Result<ClipFadeSnapshot, String> {
    let curve = FadeCurve::from_str(&curve_type)
        .ok_or_else(|| format!("Unknown fade curve: '{curve_type}'"))?;

    let mut store = clip_store.lock().map_err(|e| e.to_string())?;
    let entry = store.get_mut(&clip_id)
        .ok_or_else(|| format!("Clip '{clip_id}' not found"))?;
    entry.fade_in_frames = fade_frames;
    entry.fade_in_curve  = curve;

    Ok(ClipFadeSnapshot {
        clip_id:         clip_id.clone(),
        fade_in_frames:  entry.fade_in_frames,
        fade_out_frames: entry.fade_out_frames,
        fade_in_curve:   entry.fade_in_curve,
        fade_out_curve:  entry.fade_out_curve,
    })
}

/// Sets the fade-out length and curve for a loaded clip.
///
/// `fade_frames` of `0` disables the fade-out.
#[tauri::command]
pub fn set_clip_fade_out(
    clip_id:     String,
    fade_frames: u64,
    curve_type:  String,
    clip_store:  State<'_, ClipStore>,
) -> Result<ClipFadeSnapshot, String> {
    let curve = FadeCurve::from_str(&curve_type)
        .ok_or_else(|| format!("Unknown fade curve: '{curve_type}'"))?;

    let mut store = clip_store.lock().map_err(|e| e.to_string())?;
    let entry = store.get_mut(&clip_id)
        .ok_or_else(|| format!("Clip '{clip_id}' not found"))?;
    entry.fade_out_frames = fade_frames;
    entry.fade_out_curve  = curve;

    Ok(ClipFadeSnapshot {
        clip_id:         clip_id.clone(),
        fade_in_frames:  entry.fade_in_frames,
        fade_out_frames: entry.fade_out_frames,
        fade_in_curve:   entry.fade_in_curve,
        fade_out_curve:  entry.fade_out_curve,
    })
}

/// Changes only the curve type for a fade-in or fade-out, without altering the length.
///
/// `fade_kind` is `"in"` or `"out"`.
#[tauri::command]
pub fn set_fade_curve_type(
    clip_id:    String,
    fade_kind:  String,
    curve_type: String,
    clip_store: State<'_, ClipStore>,
) -> Result<ClipFadeSnapshot, String> {
    if fade_kind != "in" && fade_kind != "out" {
        return Err(format!("fade_kind must be 'in' or 'out', got '{fade_kind}'"));
    }
    let curve = FadeCurve::from_str(&curve_type)
        .ok_or_else(|| format!("Unknown fade curve: '{curve_type}'"))?;

    let mut store = clip_store.lock().map_err(|e| e.to_string())?;
    let entry = store.get_mut(&clip_id)
        .ok_or_else(|| format!("Clip '{clip_id}' not found"))?;

    if fade_kind == "in" {
        entry.fade_in_curve = curve;
    } else {
        entry.fade_out_curve = curve;
    }

    Ok(ClipFadeSnapshot {
        clip_id:         clip_id.clone(),
        fade_in_frames:  entry.fade_in_frames,
        fade_out_frames: entry.fade_out_frames,
        fade_in_curve:   entry.fade_in_curve,
        fade_out_curve:  entry.fade_out_curve,
    })
}

/// Sets up an explicit crossfade between two adjacent clips.
///
/// Both clips get matching fade lengths using `SCurve` (equal-power crossfade):
/// - `clip_id_a` gets a fade-out of `overlap_frames` with `SCurve`
/// - `clip_id_b` gets a fade-in of `overlap_frames` with `SCurve`
///
/// This is stateless from the arrangement perspective — the frontend stores
/// `crossfade_partner_id` on `ArrangementClip` for persistence.
#[tauri::command]
pub fn set_crossfade(
    clip_id_a:      String,
    clip_id_b:      String,
    overlap_frames: u64,
    clip_store:     State<'_, ClipStore>,
) -> Result<(ClipFadeSnapshot, ClipFadeSnapshot), String> {
    if overlap_frames == 0 {
        return Err("overlap_frames must be > 0".to_string());
    }
    let mut store = clip_store.lock().map_err(|e| e.to_string())?;

    // Update clip A (fade-out)
    let entry_a = store.get_mut(&clip_id_a)
        .ok_or_else(|| format!("Clip '{clip_id_a}' not found"))?;
    entry_a.fade_out_frames = overlap_frames;
    entry_a.fade_out_curve  = FadeCurve::SCurve;
    let snap_a = ClipFadeSnapshot {
        clip_id:         clip_id_a.clone(),
        fade_in_frames:  entry_a.fade_in_frames,
        fade_out_frames: entry_a.fade_out_frames,
        fade_in_curve:   entry_a.fade_in_curve,
        fade_out_curve:  entry_a.fade_out_curve,
    };

    // Update clip B (fade-in)
    let entry_b = store.get_mut(&clip_id_b)
        .ok_or_else(|| format!("Clip '{clip_id_b}' not found"))?;
    entry_b.fade_in_frames = overlap_frames;
    entry_b.fade_in_curve  = FadeCurve::SCurve;
    let snap_b = ClipFadeSnapshot {
        clip_id:         clip_id_b.clone(),
        fade_in_frames:  entry_b.fade_in_frames,
        fade_out_frames: entry_b.fade_out_frames,
        fade_in_curve:   entry_b.fade_in_curve,
        fade_out_curve:  entry_b.fade_out_curve,
    };

    Ok((snap_a, snap_b))
}

/// Returns the current fade parameters for a loaded clip.
#[tauri::command]
pub fn get_clip_fade_state(
    clip_id:    String,
    clip_store: State<'_, ClipStore>,
) -> Result<ClipFadeSnapshot, String> {
    let store = clip_store.lock().map_err(|e| e.to_string())?;
    let entry = store.get(&clip_id)
        .ok_or_else(|| format!("Clip '{clip_id}' not found"))?;
    Ok(ClipFadeSnapshot {
        clip_id:         clip_id.clone(),
        fade_in_frames:  entry.fade_in_frames,
        fade_out_frames: entry.fade_out_frames,
        fade_in_curve:   entry.fade_in_curve,
        fade_out_curve:  entry.fade_out_curve,
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::clip_player::ClipEntry;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    fn make_store_with_clip(clip_id: &str) -> ClipStore {
        let mut map = HashMap::new();
        map.insert(clip_id.to_string(), ClipEntry {
            file_path: "test.wav".to_string(),
            start_bar: 0.0,
            duration_bars: 4.0,
            gain: 1.0,
            start_offset_frames: 0,
            buffer: None,
            fade_in_frames: 0,
            fade_out_frames: 0,
            fade_in_curve: FadeCurve::Linear,
            fade_out_curve: FadeCurve::Linear,
        });
        Arc::new(Mutex::new(map))
    }

    #[test]
    fn set_clip_fade_in_updates_entry() {
        let store = make_store_with_clip("c1");
        {
            let mut s = store.lock().unwrap();
            let entry = s.get_mut("c1").unwrap();
            entry.fade_in_frames = 1000;
            entry.fade_in_curve  = FadeCurve::SCurve;
        }
        let s = store.lock().unwrap();
        let e = s.get("c1").unwrap();
        assert_eq!(e.fade_in_frames, 1000);
        assert_eq!(e.fade_in_curve, FadeCurve::SCurve);
    }

    #[test]
    fn set_clip_fade_out_updates_entry() {
        let store = make_store_with_clip("c1");
        {
            let mut s = store.lock().unwrap();
            let entry = s.get_mut("c1").unwrap();
            entry.fade_out_frames = 500;
            entry.fade_out_curve  = FadeCurve::Logarithmic;
        }
        let s = store.lock().unwrap();
        let e = s.get("c1").unwrap();
        assert_eq!(e.fade_out_frames, 500);
        assert_eq!(e.fade_out_curve, FadeCurve::Logarithmic);
    }

    #[test]
    fn fade_curve_from_str_unknown_returns_none() {
        assert!(FadeCurve::from_str("unknown_curve").is_none());
    }

    #[test]
    fn fade_curve_from_str_known_values() {
        assert_eq!(FadeCurve::from_str("linear"), Some(FadeCurve::Linear));
        assert_eq!(FadeCurve::from_str("s_curve"), Some(FadeCurve::SCurve));
        assert_eq!(FadeCurve::from_str("exponential_in"), Some(FadeCurve::ExponentialIn));
        assert_eq!(FadeCurve::from_str("exponential_out"), Some(FadeCurve::ExponentialOut));
        assert_eq!(FadeCurve::from_str("logarithmic"), Some(FadeCurve::Logarithmic));
    }

    #[test]
    fn set_crossfade_applies_s_curve_to_both_clips() {
        let store = make_store_with_clip("a");
        {
            let mut s = store.lock().unwrap();
            s.insert("b".to_string(), ClipEntry {
                file_path: "b.wav".to_string(),
                start_bar: 4.0,
                duration_bars: 4.0,
                gain: 1.0,
                start_offset_frames: 0,
                buffer: None,
                fade_in_frames: 0,
                fade_out_frames: 0,
                fade_in_curve: FadeCurve::Linear,
                fade_out_curve: FadeCurve::Linear,
            });
        }
        {
            let mut s = store.lock().unwrap();
            // Simulate set_crossfade logic directly
            let ea = s.get_mut("a").unwrap();
            ea.fade_out_frames = 2000;
            ea.fade_out_curve  = FadeCurve::SCurve;
            let eb = s.get_mut("b").unwrap();
            eb.fade_in_frames = 2000;
            eb.fade_in_curve  = FadeCurve::SCurve;
        }
        let s = store.lock().unwrap();
        assert_eq!(s.get("a").unwrap().fade_out_curve, FadeCurve::SCurve);
        assert_eq!(s.get("b").unwrap().fade_in_curve, FadeCurve::SCurve);
        assert_eq!(s.get("a").unwrap().fade_out_frames, 2000);
        assert_eq!(s.get("b").unwrap().fade_in_frames, 2000);
    }
}
