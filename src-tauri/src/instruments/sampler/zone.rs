use std::sync::atomic::Ordering;
use std::sync::Arc;

use atomic_float::AtomicF32;
use serde::{Deserialize, Serialize};

use super::decoder::SampleBuffer;

/// A single mapping zone in the sampler keymap.
///
/// Zones are stored on the audio thread in a fixed-size array. When a note-on
/// arrives, the first zone whose `[min_note, max_note]` range contains the
/// played note is selected.
pub struct SampleZone {
    /// Unique identifier assigned by the sampler at zone load time.
    pub id: u32,
    /// Human-readable name (typically the source filename).
    pub name: String,
    /// MIDI note number that plays the sample at its original pitch.
    pub root_note: u8,
    /// Lowest MIDI note number that triggers this zone.
    pub min_note: u8,
    /// Highest MIDI note number that triggers this zone.
    pub max_note: u8,
    /// Decoded audio data shared with the decoder thread.
    pub buffer: Arc<SampleBuffer>,
    /// Loop start frame index.
    pub loop_start: usize,
    /// Loop end frame index.
    pub loop_end: usize,
    /// Whether looping is enabled for this zone.
    pub loop_enabled: bool,
}

/// Serializable snapshot of a `SampleZone` (no `Arc<SampleBuffer>`).
///
/// Sent over Tauri IPC to the frontend for display in the zone list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleZoneSnapshot {
    /// Unique zone identifier.
    pub id: u32,
    /// Human-readable name.
    pub name: String,
    /// Root MIDI note (pitch reference).
    pub root_note: u8,
    /// Minimum MIDI note in the zone range.
    pub min_note: u8,
    /// Maximum MIDI note in the zone range.
    pub max_note: u8,
    /// Loop start frame.
    pub loop_start: usize,
    /// Loop end frame.
    pub loop_end: usize,
    /// Whether looping is enabled.
    pub loop_enabled: bool,
}

impl SampleZoneSnapshot {
    /// Creates a snapshot from a `SampleZone` (drops the buffer reference).
    pub fn from_zone(zone: &SampleZone) -> Self {
        Self {
            id: zone.id,
            name: zone.name.clone(),
            root_note: zone.root_note,
            min_note: zone.min_note,
            max_note: zone.max_note,
            loop_start: zone.loop_start,
            loop_end: zone.loop_end,
            loop_enabled: zone.loop_enabled,
        }
    }
}

/// Global sampler ADSR and volume parameters stored as atomics.
///
/// All fields are shared via `Arc<AtomicF32>` so the audio thread can read
/// them lock-free at render time, while Tauri commands write from any thread.
pub struct SamplerParams {
    /// Attack time in seconds (0.001–4.0), default 0.01.
    pub attack: Arc<AtomicF32>,
    /// Decay time in seconds (0.001–4.0), default 0.1.
    pub decay: Arc<AtomicF32>,
    /// Sustain level (0.0–1.0), default 1.0.
    pub sustain: Arc<AtomicF32>,
    /// Release time in seconds (0.001–8.0), default 0.3.
    pub release: Arc<AtomicF32>,
    /// Master volume (0.0–1.0), default 0.8.
    pub volume: Arc<AtomicF32>,
}

impl SamplerParams {
    /// Creates a new `SamplerParams` with default values, wrapped in an `Arc`.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            attack: Arc::new(AtomicF32::new(0.01)),
            decay: Arc::new(AtomicF32::new(0.1)),
            sustain: Arc::new(AtomicF32::new(1.0)),
            release: Arc::new(AtomicF32::new(0.3)),
            volume: Arc::new(AtomicF32::new(0.8)),
        })
    }
}

/// Serializable snapshot of `SamplerParams`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplerParamSnapshot {
    /// Attack time in seconds.
    pub attack: f32,
    /// Decay time in seconds.
    pub decay: f32,
    /// Sustain level (0.0–1.0).
    pub sustain: f32,
    /// Release time in seconds.
    pub release: f32,
    /// Master volume (0.0–1.0).
    pub volume: f32,
}

impl SamplerParamSnapshot {
    /// Reads all parameters from a `SamplerParams` into a snapshot.
    pub fn from_params(p: &SamplerParams) -> Self {
        Self {
            attack: p.attack.load(Ordering::Relaxed),
            decay: p.decay.load(Ordering::Relaxed),
            sustain: p.sustain.load(Ordering::Relaxed),
            release: p.release.load(Ordering::Relaxed),
            volume: p.volume.load(Ordering::Relaxed),
        }
    }
}

/// Combined snapshot of sampler state (params + zone list).
///
/// Returned by `get_sampler_state` and sent over IPC to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplerSnapshot {
    /// Current ADSR and volume parameter values.
    pub params: SamplerParamSnapshot,
    /// All currently loaded zones.
    pub zones: Vec<SampleZoneSnapshot>,
}

/// Sets a single sampler parameter by name.
///
/// Returns an error string if the parameter name is unrecognised.
pub fn set_param_by_name(params: &SamplerParams, name: &str, value: f32) -> Result<(), String> {
    match name {
        "attack" => params.attack.store(value.clamp(0.001, 4.0), Ordering::Relaxed),
        "decay" => params.decay.store(value.clamp(0.001, 4.0), Ordering::Relaxed),
        "sustain" => params.sustain.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        "release" => params.release.store(value.clamp(0.001, 8.0), Ordering::Relaxed),
        "volume" => params.volume.store(value.clamp(0.0, 1.0), Ordering::Relaxed),
        _ => return Err(format!("Unknown sampler parameter: '{}'", name)),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::decoder::SampleBuffer;

    fn make_zone(id: u32, min: u8, max: u8, root: u8) -> SampleZone {
        // Build a minimal SampleBuffer — 1 frame of silence
        let buffer = Arc::new(SampleBuffer {
            samples: vec![0.0f32, 0.0f32],
            sample_rate: 44100,
            original_channels: 1,
            frame_count: 1,
        });
        SampleZone {
            id,
            name: format!("zone_{}", id),
            root_note: root,
            min_note: min,
            max_note: max,
            buffer,
            loop_start: 0,
            loop_end: 0,
            loop_enabled: false,
        }
    }

    /// Finds the first zone in the array whose range contains `note`.
    fn find_zone<'a>(zones: &'a [Option<SampleZone>; 32], note: u8) -> Option<&'a SampleZone> {
        zones.iter().filter_map(|opt| opt.as_ref()).find(|z| {
            z.min_note <= note && note <= z.max_note
        })
    }

    #[test]
    fn test_find_zone_by_note() {
        let mut zones: [Option<SampleZone>; 32] = std::array::from_fn(|_| None);
        zones[0] = Some(make_zone(0, 36, 59, 48)); // C2–B3
        zones[1] = Some(make_zone(1, 60, 83, 72)); // C4–B5

        let z = find_zone(&zones, 60);
        assert!(z.is_some(), "Note 60 should match zone 1");
        assert_eq!(z.unwrap().id, 1);
    }

    #[test]
    fn test_find_zone_no_match() {
        let mut zones: [Option<SampleZone>; 32] = std::array::from_fn(|_| None);
        zones[0] = Some(make_zone(0, 36, 59, 48));

        let z = find_zone(&zones, 100);
        assert!(z.is_none(), "Note 100 should not match zone [36,59]");
    }

    #[test]
    fn test_find_zone_first_wins() {
        let mut zones: [Option<SampleZone>; 32] = std::array::from_fn(|_| None);
        zones[0] = Some(make_zone(0, 40, 80, 60)); // overlapping range
        zones[1] = Some(make_zone(1, 50, 70, 60)); // also covers note 60

        let z = find_zone(&zones, 60);
        assert!(z.is_some());
        assert_eq!(z.unwrap().id, 0, "First zone should win on overlap");
    }

    #[test]
    fn test_set_param_by_name_valid() {
        let params = SamplerParams::new();
        assert!(set_param_by_name(&params, "attack", 0.5).is_ok());
        assert!((params.attack.load(Ordering::Relaxed) - 0.5).abs() < 1e-6);

        assert!(set_param_by_name(&params, "volume", 0.8).is_ok());
        assert!((params.volume.load(Ordering::Relaxed) - 0.8).abs() < 1e-6);
    }

    #[test]
    fn test_set_param_by_name_invalid() {
        let params = SamplerParams::new();
        let result = set_param_by_name(&params, "nonexistent_param", 1.0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("nonexistent_param"));
    }
}
