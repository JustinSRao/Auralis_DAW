//! Data structures that make up the `.mapp` project file format.
//!
//! Every struct derives `Debug`, `Clone`, `Serialize`, and `Deserialize` so
//! it can be round-tripped through the ZIP-embedded `project.json` file.
//! `PartialEq` is also derived on all types to facilitate test assertions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::project::pattern::Pattern;
use crate::project::version::{SchemaVersion, CURRENT_SCHEMA};

// ---------------------------------------------------------------------------
// Root document
// ---------------------------------------------------------------------------

/// Root structure of a `.mapp` (Music APPlication) project file.
///
/// This is the top-level object serialized to `project.json` inside the archive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectFile {
    /// Schema version used to detect and apply forward migrations.
    pub schema_version: SchemaVersion,
    /// Universally unique identifier for this project.
    pub id: String,
    /// Human-readable project name.
    pub name: String,
    /// UTC timestamp of when the project was first created.
    pub created_at: DateTime<Utc>,
    /// UTC timestamp of the most recent save.
    pub modified_at: DateTime<Utc>,
    /// Global transport / tempo settings.
    pub transport: TransportSettings,
    /// Ordered list of tracks in the arrangement.
    pub tracks: Vec<TrackData>,
    /// Master bus settings (global volume, pan, and insert effects).
    pub master: MasterBusData,
    /// Table of all audio sample files referenced by clips in this project.
    pub samples: Vec<SampleReference>,
    /// All named patterns belonging to this project, keyed by track.
    pub patterns: Vec<Pattern>,
}

impl Default for ProjectFile {
    fn default() -> Self {
        let now = Utc::now();
        Self {
            schema_version: CURRENT_SCHEMA.clone(),
            id: Uuid::new_v4().to_string(),
            name: "Untitled Project".to_string(),
            created_at: now,
            modified_at: now,
            transport: TransportSettings::default(),
            tracks: Vec::new(),
            master: MasterBusData::default(),
            samples: Vec::new(),
            patterns: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Transport / tempo
// ---------------------------------------------------------------------------

/// Global playback and tempo settings for the project.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransportSettings {
    /// Beats per minute (tempo).
    pub bpm: f64,
    /// Number of beats per measure.
    pub time_sig_numerator: u8,
    /// Note value that represents one beat (e.g. 4 = quarter note).
    pub time_sig_denominator: u8,
    /// Audio engine sample rate in Hz.
    pub sample_rate: u32,
    /// Whether loop playback is active.
    pub loop_enabled: bool,
    /// Loop region start, in beats.
    pub loop_start_beats: f64,
    /// Loop region end, in beats.
    pub loop_end_beats: f64,
}

impl Default for TransportSettings {
    fn default() -> Self {
        Self {
            bpm: 120.0,
            time_sig_numerator: 4,
            time_sig_denominator: 4,
            sample_rate: 44100,
            loop_enabled: false,
            loop_start_beats: 0.0,
            loop_end_beats: 16.0,
        }
    }
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/// Discriminator for the kind of content a track can hold.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrackType {
    /// Holds audio clips recorded from an audio input.
    Audio,
    /// Holds MIDI clips that drive a software instrument.
    Midi,
    /// A submix bus for routing other tracks.
    Bus,
}

/// All data belonging to a single timeline track.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrackData {
    /// Unique identifier for this track.
    pub id: String,
    /// Display name shown in the mixer and arrangement views.
    pub name: String,
    /// Whether this is an audio, MIDI, or bus track.
    pub track_type: TrackType,
    /// CSS-style hex color string (e.g. `"#3B82F6"`).
    pub color: String,
    /// Fader level in the range `[0.0, 2.0]` (1.0 = unity gain).
    pub volume: f64,
    /// Pan position in the range `[-1.0, 1.0]` (0.0 = center).
    pub pan: f64,
    /// When `true` the track produces no audio output.
    pub muted: bool,
    /// When `true` all non-soloed tracks are silenced.
    pub soloed: bool,
    /// When `true` the track is armed for recording.
    pub armed: bool,
    /// ID of the bus track this track routes to, or `None` for the master bus.
    pub output_bus: Option<String>,
    /// Optional software instrument on MIDI tracks.
    pub instrument: Option<InstrumentData>,
    /// Insert effects chain in signal-flow order.
    pub effects: Vec<EffectData>,
    /// Audio or MIDI clips placed on the timeline.
    pub clips: Vec<ClipData>,
    /// Automation lanes for parameters on this track.
    pub automation: Vec<AutomationLane>,
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/// A region on the timeline containing audio, MIDI, or pattern data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClipData {
    /// Unique identifier for this clip.
    pub id: String,
    /// Optional display name.
    pub name: String,
    /// Position of the clip's left edge, in beats.
    pub start_beats: f64,
    /// Length of the clip, in beats.
    pub duration_beats: f64,
    /// The actual content held by the clip.
    pub content: ClipContent,
}

/// The payload stored inside a [`ClipData`].
///
/// Uses Serde's internally-tagged enum representation so the JSON contains a
/// `"type"` field alongside the content fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ClipContent {
    /// References a sample file from the project's sample table.
    Audio {
        /// ID matching a [`SampleReference`] in [`ProjectFile::samples`].
        sample_id: String,
        /// Read position within the sample file, in samples.
        start_offset_samples: u64,
        /// Clip-level gain multiplier (1.0 = unity).
        gain: f64,
    },
    /// Contains inline MIDI note and CC event data.
    Midi {
        /// Recorded or edited MIDI note events.
        notes: Vec<MidiNoteData>,
        /// Recorded or edited MIDI continuous-controller events.
        cc_events: Vec<MidiCcData>,
    },
    /// References a step-sequencer pattern by ID.
    Pattern {
        /// ID of the pattern (managed by the instrument/step-sequencer subsystem).
        pattern_id: String,
    },
}

// ---------------------------------------------------------------------------
// MIDI event data
// ---------------------------------------------------------------------------

/// A single MIDI note event stored inside a [`ClipContent::Midi`] clip.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MidiNoteData {
    /// MIDI note number `[0, 127]`.
    pub note: u8,
    /// Note-on velocity `[0, 127]`.
    pub velocity: u8,
    /// Note start position, in beats from the clip's start.
    pub start_beats: f64,
    /// Note duration, in beats.
    pub duration_beats: f64,
    /// MIDI channel `[0, 15]` (0-indexed).
    pub channel: u8,
}

/// A MIDI continuous-controller event stored inside a [`ClipContent::Midi`] clip.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MidiCcData {
    /// MIDI CC controller number `[0, 127]`.
    pub controller: u8,
    /// CC value `[0, 127]`.
    pub value: u8,
    /// Event position, in beats from the clip's start.
    pub position_beats: f64,
    /// MIDI channel `[0, 15]` (0-indexed).
    pub channel: u8,
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/// The software instrument loaded on a MIDI track.
///
/// Parameters for built-in instruments are stored as opaque JSON so that the
/// instrument subsystem owns the schema; VST3 state is stored as a Base64-
/// encoded binary blob.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum InstrumentData {
    /// Built-in polyphonic synthesizer.
    Synth {
        /// Instrument-specific parameter tree (owns its own schema).
        params: serde_json::Value,
    },
    /// Sample-playback instrument.
    Sampler {
        /// Instrument-specific parameter tree.
        params: serde_json::Value,
    },
    /// Step-sequencer drum machine.
    DrumMachine {
        /// Instrument-specific parameter tree.
        params: serde_json::Value,
    },
    /// Third-party VST3 plugin.
    Vst3Plugin {
        /// Unique plugin identifier (usually the vendor + name hash).
        plugin_id: String,
        /// Human-readable plugin name for display.
        plugin_name: String,
        /// Opaque plugin state encoded as Base64.
        state_base64: String,
    },
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/// An insert effect in a track's or master bus's effect chain.
///
/// Same design philosophy as [`InstrumentData`]: built-in effects store params
/// as JSON, VST3 state as Base64.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum EffectData {
    /// Parametric equalizer.
    Eq {
        /// Effect-specific parameter tree.
        params: serde_json::Value,
    },
    /// Algorithmic or convolution reverb.
    Reverb {
        /// Effect-specific parameter tree.
        params: serde_json::Value,
    },
    /// Dynamic range compressor.
    Compressor {
        /// Effect-specific parameter tree.
        params: serde_json::Value,
    },
    /// Stereo delay / echo.
    Delay {
        /// Effect-specific parameter tree.
        params: serde_json::Value,
    },
    /// Third-party VST3 plugin.
    Vst3Plugin {
        /// Unique plugin identifier.
        plugin_id: String,
        /// Human-readable plugin name for display.
        plugin_name: String,
        /// Opaque plugin state encoded as Base64.
        state_base64: String,
    },
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

/// A collection of time-stamped automation points for a single parameter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutomationLane {
    /// Dotted-path identifier of the target parameter
    /// (e.g. `"track.volume"`, `"instrument.synth.filter_cutoff"`).
    pub target: String,
    /// Ordered list of automation control points.
    pub points: Vec<AutomationPoint>,
}

/// A single automation control point.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutomationPoint {
    /// Position of this control point, in beats from the project start.
    pub position_beats: f64,
    /// Normalized parameter value at this position (range depends on target).
    pub value: f64,
    /// Interpolation style between this point and the next.
    pub curve: AutomationCurve,
}

/// Describes how the value moves between two adjacent [`AutomationPoint`]s.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AutomationCurve {
    /// Straight-line interpolation.
    Linear,
    /// Hold the previous value until the next point (staircase).
    Step,
    /// Smooth exponential curve between points.
    Exponential,
}

// ---------------------------------------------------------------------------
// Master bus
// ---------------------------------------------------------------------------

/// Settings and effects for the master output bus.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MasterBusData {
    /// Master fader level (1.0 = unity gain).
    pub volume: f64,
    /// Master pan (0.0 = center).
    pub pan: f64,
    /// Insert effects on the master bus.
    pub effects: Vec<EffectData>,
}

impl Default for MasterBusData {
    fn default() -> Self {
        Self {
            volume: 0.8,
            pan: 0.0,
            effects: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Sample references
// ---------------------------------------------------------------------------

/// Metadata for an audio sample file bundled inside the project archive.
///
/// Clips reference entries in [`ProjectFile::samples`] via `id`.  The actual
/// audio data lives at `samples/{archive_path}` inside the ZIP.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SampleReference {
    /// Unique identifier referenced by [`ClipContent::Audio::sample_id`].
    pub id: String,
    /// The file name the sample had on disk when it was imported.
    pub original_filename: String,
    /// Relative path inside the archive (under `samples/`).
    pub archive_path: String,
    /// Sample rate of the audio data in Hz.
    pub sample_rate: u32,
    /// Number of audio channels.
    pub channels: u16,
    /// Duration of the sample in seconds.
    pub duration_secs: f64,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_file_default_has_valid_id() {
        let project = ProjectFile::default();
        assert!(!project.id.is_empty());
        // Must be a valid UUID.
        assert!(Uuid::parse_str(&project.id).is_ok());
    }

    #[test]
    fn project_file_default_schema_version_is_current() {
        let project = ProjectFile::default();
        assert_eq!(project.schema_version, CURRENT_SCHEMA);
    }

    #[test]
    fn transport_defaults() {
        let t = TransportSettings::default();
        assert_eq!(t.bpm, 120.0);
        assert_eq!(t.time_sig_numerator, 4);
        assert_eq!(t.time_sig_denominator, 4);
        assert_eq!(t.sample_rate, 44100);
        assert!(!t.loop_enabled);
    }

    #[test]
    fn master_bus_defaults() {
        let m = MasterBusData::default();
        assert_eq!(m.volume, 0.8);
        assert_eq!(m.pan, 0.0);
        assert!(m.effects.is_empty());
    }

    #[test]
    fn project_file_roundtrip_json() {
        let original = ProjectFile::default();
        let json = serde_json::to_string(&original).expect("serialize failed");
        let decoded: ProjectFile = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(original, decoded);
    }

    #[test]
    fn track_roundtrip_json() {
        let track = TrackData {
            id: Uuid::new_v4().to_string(),
            name: "Lead Synth".to_string(),
            track_type: TrackType::Midi,
            color: "#FF0000".to_string(),
            volume: 1.0,
            pan: 0.0,
            muted: false,
            soloed: false,
            armed: true,
            output_bus: None,
            instrument: Some(InstrumentData::Synth {
                params: serde_json::json!({ "osc": "saw", "cutoff": 0.7 }),
            }),
            effects: vec![EffectData::Reverb {
                params: serde_json::json!({ "room_size": 0.5 }),
            }],
            clips: vec![ClipData {
                id: Uuid::new_v4().to_string(),
                name: "Intro riff".to_string(),
                start_beats: 0.0,
                duration_beats: 8.0,
                content: ClipContent::Midi {
                    notes: vec![MidiNoteData {
                        note: 60,
                        velocity: 100,
                        start_beats: 0.0,
                        duration_beats: 1.0,
                        channel: 0,
                    }],
                    cc_events: vec![MidiCcData {
                        controller: 1,
                        value: 64,
                        position_beats: 0.5,
                        channel: 0,
                    }],
                },
            }],
            automation: vec![AutomationLane {
                target: "track.volume".to_string(),
                points: vec![AutomationPoint {
                    position_beats: 0.0,
                    value: 1.0,
                    curve: AutomationCurve::Linear,
                }],
            }],
        };

        let json = serde_json::to_string(&track).expect("serialize failed");
        let decoded: TrackData = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(track, decoded);
    }

    #[test]
    fn audio_clip_roundtrip_json() {
        let clip = ClipData {
            id: Uuid::new_v4().to_string(),
            name: "Drums".to_string(),
            start_beats: 4.0,
            duration_beats: 4.0,
            content: ClipContent::Audio {
                sample_id: "sample-001".to_string(),
                start_offset_samples: 1024,
                gain: 0.9,
            },
        };
        let json = serde_json::to_string(&clip).expect("serialize");
        let decoded: ClipData = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(clip, decoded);
    }

    #[test]
    fn vst3_instrument_roundtrip_json() {
        let inst = InstrumentData::Vst3Plugin {
            plugin_id: "com.vendor.plugin".to_string(),
            plugin_name: "SuperSynth".to_string(),
            state_base64: "dGVzdA==".to_string(),
        };
        let json = serde_json::to_string(&inst).expect("serialize");
        let decoded: InstrumentData = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(inst, decoded);
    }

    #[test]
    fn automation_curve_variants_roundtrip() {
        for curve in [
            AutomationCurve::Linear,
            AutomationCurve::Step,
            AutomationCurve::Exponential,
        ] {
            let json = serde_json::to_string(&curve).expect("serialize");
            let decoded: AutomationCurve = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(curve, decoded);
        }
    }

    #[test]
    fn sample_reference_roundtrip() {
        let sr = SampleReference {
            id: Uuid::new_v4().to_string(),
            original_filename: "kick.wav".to_string(),
            archive_path: "samples/kick.wav".to_string(),
            sample_rate: 44100,
            channels: 2,
            duration_secs: 0.5,
        };
        let json = serde_json::to_string(&sr).expect("serialize");
        let decoded: SampleReference = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(sr, decoded);
    }
}
