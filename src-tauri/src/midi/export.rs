//! MIDI file export: serialize DAW patterns and arrangements to Standard MIDI Files.
//!
//! Supports Type 0 (single-pattern) and Type 1 (full-arrangement) SMF output.
//! Internal PPQ is 480. Export PPQ defaults to 480 (no rescaling needed).

use std::io::BufWriter;
use std::path::Path;

use midly::num::{u15, u24, u28, u4, u7};
use midly::{Format, Header, MetaMessage, MidiMessage, Smf, Timing, Track, TrackEvent, TrackEventKind};
use serde::{Deserialize, Serialize};

use crate::audio::tempo_map::TempoPoint;

/// Internal PPQ used by the DAW (480 PPQN).
const INTERNAL_PPQ: u16 = 480;

/// Export configuration options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// PPQ to use in the exported file. Default 480 matches internal representation.
    /// If set to 960, all tick values are rescaled via `rescale_tick`.
    pub export_ppq: u16,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self { export_ppq: INTERNAL_PPQ }
    }
}

/// A single note to export. Beat positions are pre-computed by the frontend.
/// For arrangement export the frontend adds the clip's `startBar * beatsPerBar` offset.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportNote {
    /// MIDI pitch 0–127.
    pub pitch: u8,
    /// MIDI velocity 1–127.
    pub velocity: u8,
    /// MIDI channel 0–15.
    pub channel: u8,
    /// Start in beats from the beginning of the exported region.
    pub start_beats: f64,
    /// Duration in beats. Clamped to minimum 1 tick after conversion.
    pub duration_beats: f64,
}

/// A single DAW track passed from the frontend for arrangement export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTrack {
    /// Track display name (written as MIDI TrackName meta-event).
    pub name: String,
    /// Notes with absolute beat positions (clips already flattened and offset by the frontend).
    pub notes: Vec<ExportNote>,
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/// Rescales a tick from `src_ppq` to `dst_ppq`, rounding to the nearest output tick.
///
/// This is a pure function, making it straightforward to unit-test in isolation.
pub fn rescale_tick(tick: u64, src_ppq: u16, dst_ppq: u16) -> u64 {
    if src_ppq == dst_ppq {
        return tick;
    }
    // Round to nearest: add (src_ppq / 2) before integer division.
    (tick * dst_ppq as u64 + src_ppq as u64 / 2) / src_ppq as u64
}

/// Converts beats to ticks using the given PPQ, rounding to nearest tick.
fn beats_to_tick(beats: f64, ppq: u16) -> u64 {
    (beats * ppq as f64).round() as u64
}

/// Returns microseconds per beat for `bpm`. Clamped to fit in a MIDI u24.
fn us_per_beat(bpm: f64) -> u32 {
    if bpm <= 0.0 {
        return 500_000; // 120 BPM default
    }
    let us = (60_000_000.0 / bpm).round() as u64;
    us.min(16_777_215) as u32 // u24 max
}

/// Converts denominator (e.g. 4) to the MIDI time-signature power-of-2 encoding.
fn denominator_to_power(denominator: u8) -> u8 {
    match denominator {
        1 => 0,
        2 => 1,
        4 => 2,
        8 => 3,
        16 => 4,
        32 => 5,
        _ => 2, // default to 4
    }
}

// ---------------------------------------------------------------------------
// Internal event building
// ---------------------------------------------------------------------------

/// Converts notes into a sorted list of (absolute_tick, channel, pitch, velocity) tuples.
/// NoteOff is encoded as NoteOn with velocity 0 (universal MIDI convention).
/// Zero-duration notes are clamped to 1 tick.
fn notes_to_absolute_events(notes: &[ExportNote], ppq: u16) -> Vec<(u64, u8, u8, u8)> {
    let mut events: Vec<(u64, u8, u8, u8)> = Vec::with_capacity(notes.len() * 2);

    for note in notes {
        let pitch = note.pitch.min(127);
        let velocity = note.velocity.clamp(1, 127);
        let channel = note.channel.min(15);

        let start_tick = beats_to_tick(note.start_beats.max(0.0), ppq);
        let dur_ticks = beats_to_tick(note.duration_beats, ppq).max(1);

        events.push((start_tick, channel, pitch, velocity)); // NoteOn
        events.push((start_tick + dur_ticks, channel, pitch, 0)); // NoteOff (vel=0)
    }

    // Sort by tick; NoteOff (vel=0) before NoteOn at the same tick to prevent stuck notes.
    events.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.3.cmp(&b.3)));
    events
}

/// Converts a list of (absolute_tick, channel, pitch, velocity) events to a midly `Track<'static>`.
/// Inserts an EndOfTrack meta-event at the end.
fn absolute_events_to_track(events: &[(u64, u8, u8, u8)]) -> Track<'static> {
    let mut track: Track<'static> = Vec::with_capacity(events.len() + 1);
    let mut last_tick: u64 = 0;

    for &(abs_tick, channel, pitch, velocity) in events {
        let delta = abs_tick.saturating_sub(last_tick);
        last_tick = abs_tick;

        track.push(TrackEvent {
            delta: u28::new(delta.min((1u64 << 28) - 1) as u32),
            kind: TrackEventKind::Midi {
                channel: u4::new(channel),
                message: MidiMessage::NoteOn {
                    key: u7::new(pitch),
                    vel: u7::new(velocity),
                },
            },
        });
    }

    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });

    track
}

/// Builds the combined meta + note track used for Type 0 export.
/// Meta events (time signature + tempo points) are merged with note events into one sorted list.
fn build_type0_track(
    notes: &[ExportNote],
    tempo_points: &[TempoPoint],
    time_sig_numerator: u8,
    time_sig_denominator: u8,
    export_ppq: u16,
) -> Track<'static> {
    let denom_power = denominator_to_power(time_sig_denominator);

    // Build absolute (tick, kind) list
    let mut abs: Vec<(u64, TrackEventKind<'static>)> = Vec::new();

    // Time signature at tick 0
    abs.push((0, TrackEventKind::Meta(MetaMessage::TimeSignature(
        time_sig_numerator, denom_power, 24, 8,
    ))));

    // Tempo change events
    for tp in tempo_points {
        let tick = rescale_tick(tp.tick, INTERNAL_PPQ, export_ppq);
        abs.push((tick, TrackEventKind::Meta(MetaMessage::Tempo(
            u24::new(us_per_beat(tp.bpm)),
        ))));
    }

    // Note events
    let note_events = notes_to_absolute_events(notes, export_ppq);
    for (tick, channel, pitch, velocity) in note_events {
        abs.push((tick, TrackEventKind::Midi {
            channel: u4::new(channel),
            message: MidiMessage::NoteOn {
                key: u7::new(pitch),
                vel: u7::new(velocity),
            },
        }));
    }

    // Stable sort: meta before MIDI at the same tick
    abs.sort_by(|a, b| {
        a.0.cmp(&b.0).then_with(|| {
            let a_is_meta = matches!(a.1, TrackEventKind::Meta(_));
            let b_is_meta = matches!(b.1, TrackEventKind::Meta(_));
            b_is_meta.cmp(&a_is_meta) // meta (true) first
        })
    });

    // Convert to delta ticks
    let mut track: Track<'static> = Vec::with_capacity(abs.len() + 1);
    let mut last: u64 = 0;
    for (tick, kind) in abs {
        let delta = tick.saturating_sub(last);
        last = tick;
        track.push(TrackEvent {
            delta: u28::new(delta.min((1u64 << 28) - 1) as u32),
            kind,
        });
    }
    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });
    track
}

/// Builds the tempo/time-signature track (MTrk 0 in Type 1 files).
fn build_tempo_track(
    tempo_points: &[TempoPoint],
    time_sig_numerator: u8,
    time_sig_denominator: u8,
    export_ppq: u16,
) -> Track<'static> {
    let denom_power = denominator_to_power(time_sig_denominator);
    let mut track: Track<'static> = Vec::new();
    let mut last_tick: u64 = 0;

    // Time signature at tick 0
    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::TimeSignature(
            time_sig_numerator, denom_power, 24, 8,
        )),
    });

    for tp in tempo_points {
        let abs_tick = rescale_tick(tp.tick, INTERNAL_PPQ, export_ppq);
        let delta = abs_tick.saturating_sub(last_tick);
        last_tick = abs_tick;
        track.push(TrackEvent {
            delta: u28::new(delta.min((1u64 << 28) - 1) as u32),
            kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::new(us_per_beat(tp.bpm)))),
        });
    }

    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });
    track
}

// ---------------------------------------------------------------------------
// MidiExporter
// ---------------------------------------------------------------------------

/// Stateless MIDI file serializer.
///
/// All methods are pure data-transformation functions with no audio thread involvement.
/// The frontend passes all required data as arguments (notes, tempo map, time signature).
pub struct MidiExporter;

impl MidiExporter {
    /// Exports a single pattern as a Type 0 MIDI file (one MTrk, all notes + meta events).
    ///
    /// The full tempo map is written as a sequence of Tempo meta-events.
    ///
    /// # Errors
    /// Returns a human-readable error string on file write failure or out-of-range values.
    pub fn export_pattern(
        notes: &[ExportNote],
        path: &Path,
        options: &ExportOptions,
        tempo_points: &[TempoPoint],
        time_sig_numerator: u8,
        time_sig_denominator: u8,
    ) -> Result<(), String> {
        let ppq = options.export_ppq;

        let track = build_type0_track(notes, tempo_points, time_sig_numerator, time_sig_denominator, ppq);

        let smf = Smf {
            header: Header {
                format: Format::SingleTrack,
                timing: Timing::Metrical(u15::new(ppq)),
            },
            tracks: vec![track],
        };

        Self::write_smf(&smf, path)
    }

    /// Exports the full arrangement as a Type 1 MIDI file.
    ///
    /// Track 0 is a dedicated tempo/time-signature track per the MIDI spec.
    /// Each subsequent track corresponds to one DAW track in `tracks`.
    ///
    /// Note positions in `tracks` must already have clip offsets applied by the frontend:
    /// `absolute_start_beats = clip.start_bar * beats_per_bar + note.start_beats`
    ///
    /// # Errors
    /// Returns a human-readable error string on file write failure or out-of-range values.
    pub fn export_arrangement(
        tracks: &[ExportTrack],
        path: &Path,
        options: &ExportOptions,
        tempo_points: &[TempoPoint],
        time_sig_numerator: u8,
        time_sig_denominator: u8,
    ) -> Result<(), String> {
        let ppq = options.export_ppq;
        let mut all_tracks: Vec<Track<'static>> = Vec::with_capacity(tracks.len() + 1);

        // Track 0: tempo + time signature
        all_tracks.push(build_tempo_track(tempo_points, time_sig_numerator, time_sig_denominator, ppq));

        // One track per DAW track
        for export_track in tracks {
            let abs_events = notes_to_absolute_events(&export_track.notes, ppq);
            all_tracks.push(absolute_events_to_track(&abs_events));
        }

        let smf = Smf {
            header: Header {
                format: Format::Parallel,
                timing: Timing::Metrical(u15::new(ppq)),
            },
            tracks: all_tracks,
        };

        Self::write_smf(&smf, path)
    }

    fn write_smf(smf: &Smf<'_>, path: &Path) -> Result<(), String> {
        let file = std::fs::File::create(path)
            .map_err(|e| format!("Failed to create MIDI file at {:?}: {e}", path))?;
        let mut writer = BufWriter::new(file);
        smf.write_std(&mut writer)
            .map_err(|e| format!("Failed to write MIDI data: {e}"))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::tempo_map::{TempoInterp, TempoPoint};

    fn make_note(pitch: u8, start: f64, dur: f64) -> ExportNote {
        ExportNote { pitch, velocity: 100, channel: 0, start_beats: start, duration_beats: dur }
    }

    fn default_tempo_points() -> Vec<TempoPoint> {
        vec![TempoPoint { tick: 0, bpm: 120.0, interp: TempoInterp::Step }]
    }

    fn roundtrip_bytes(bytes: &[u8]) -> midly::Smf<'_> {
        midly::Smf::parse(bytes).expect("roundtrip parse failed")
    }

    // ── rescale_tick ──────────────────────────────────────────────────────

    #[test]
    fn rescale_tick_identity() {
        assert_eq!(rescale_tick(960, 480, 480), 960);
        assert_eq!(rescale_tick(0, 480, 480), 0);
    }

    #[test]
    fn rescale_tick_halves() {
        // 960 ticks at 480 PPQ → 480 ticks at 240 PPQ
        assert_eq!(rescale_tick(960, 480, 240), 480);
        assert_eq!(rescale_tick(480, 480, 240), 240);
        assert_eq!(rescale_tick(0, 480, 240), 0);
    }

    #[test]
    fn rescale_tick_doubles() {
        assert_eq!(rescale_tick(480, 480, 960), 960);
        assert_eq!(rescale_tick(240, 480, 960), 480);
    }

    #[test]
    fn rescale_tick_half_ppq_export() {
        // rescale_tick(960, 480, 480) = 960 (no change)
        // For doubling: rescale_tick(960, 480, 960) should give 1920
        assert_eq!(rescale_tick(960, 480, 960), 1920);
    }

    // ── us_per_beat ───────────────────────────────────────────────────────

    #[test]
    fn us_per_beat_120_bpm() {
        // 120 BPM = 500,000 µs/beat
        assert_eq!(us_per_beat(120.0), 500_000);
    }

    #[test]
    fn us_per_beat_60_bpm() {
        assert_eq!(us_per_beat(60.0), 1_000_000);
    }

    // ── Pattern export roundtrip ──────────────────────────────────────────

    #[test]
    fn export_pattern_produces_valid_type0_file() {
        let notes = vec![
            make_note(60, 0.0, 1.0),
            make_note(64, 1.0, 0.5),
            make_note(67, 1.5, 0.5),
        ];
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points();

        let dir = std::env::temp_dir();
        let path = dir.join("test_export_type0.mid");
        MidiExporter::export_pattern(&notes, &path, &opts, &tp, 4, 4)
            .expect("export failed");

        let bytes = std::fs::read(&path).expect("read failed");
        let smf = roundtrip_bytes(&bytes);
        assert!(matches!(smf.header.format, midly::Format::SingleTrack));
        assert_eq!(smf.tracks.len(), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_pattern_note_count_roundtrip() {
        // 3 notes → 6 MIDI events (NoteOn + NoteOff per note) + meta events
        let notes = vec![
            make_note(60, 0.0, 1.0),
            make_note(64, 1.0, 1.0),
            make_note(67, 2.0, 1.0),
        ];
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points();
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_count.mid");
        MidiExporter::export_pattern(&notes, &path, &opts, &tp, 4, 4).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        // Count MIDI (non-meta) events in the track
        let midi_event_count = smf.tracks[0].iter().filter(|e| {
            matches!(e.kind, midly::TrackEventKind::Midi { .. })
        }).count();
        assert_eq!(midi_event_count, 6, "expected 6 MIDI events (3 NoteOn + 3 NoteOff)");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_pattern_tempo_at_120_bpm() {
        let notes = vec![make_note(60, 0.0, 1.0)];
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points(); // 120 BPM
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_tempo.mid");
        MidiExporter::export_pattern(&notes, &path, &opts, &tp, 4, 4).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        let has_500k_tempo = smf.tracks[0].iter().any(|e| {
            matches!(e.kind, midly::TrackEventKind::Meta(midly::MetaMessage::Tempo(t)) if t.as_int() == 500_000)
        });
        assert!(has_500k_tempo, "expected 500,000 µs/beat (120 BPM) tempo event");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_pattern_empty_notes_no_panic() {
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points();
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_empty.mid");
        let result = MidiExporter::export_pattern(&[], &path, &opts, &tp, 4, 4);
        assert!(result.is_ok(), "empty pattern export should not fail");

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        assert_eq!(smf.tracks.len(), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_pattern_zero_duration_note_clamped_to_one_tick() {
        let notes = vec![ExportNote {
            pitch: 60, velocity: 100, channel: 0,
            start_beats: 0.0, duration_beats: 0.0, // zero duration
        }];
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points();
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_zero_dur.mid");
        MidiExporter::export_pattern(&notes, &path, &opts, &tp, 4, 4).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        // Should produce 2 MIDI events (NoteOn + NoteOff), not zero — no panic
        let midi_count = smf.tracks[0].iter().filter(|e| {
            matches!(e.kind, midly::TrackEventKind::Midi { .. })
        }).count();
        assert_eq!(midi_count, 2);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_pattern_ppq_rescaling() {
        // Export at 960 PPQ — a note starting at beat 1 should land at tick 960.
        let notes = vec![make_note(60, 1.0, 1.0)]; // start at beat 1
        let opts = ExportOptions { export_ppq: 960 };
        let tp = default_tempo_points();
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_ppq.mid");
        MidiExporter::export_pattern(&notes, &path, &opts, &tp, 4, 4).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        // PPQ in header should be 960
        match smf.header.timing {
            midly::Timing::Metrical(ppq) => assert_eq!(ppq.as_int(), 960),
            _ => panic!("expected Metrical timing"),
        }
        let _ = std::fs::remove_file(&path);
    }

    // ── Arrangement export ────────────────────────────────────────────────

    #[test]
    fn export_arrangement_type1_track_count() {
        let tracks = vec![
            ExportTrack { name: "Track 1".to_string(), notes: vec![make_note(60, 0.0, 1.0)] },
            ExportTrack { name: "Track 2".to_string(), notes: vec![make_note(64, 0.0, 1.0)] },
        ];
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points();
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_arrangement.mid");
        MidiExporter::export_arrangement(&tracks, &path, &opts, &tp, 4, 4).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        assert!(matches!(smf.header.format, midly::Format::Parallel));
        // tempo track + 2 DAW tracks = 3
        assert_eq!(smf.tracks.len(), 3, "expected 3 MTrk chunks (tempo + 2 tracks)");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_arrangement_empty_tracks_no_panic() {
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points();
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_empty_arrangement.mid");
        let result = MidiExporter::export_arrangement(&[], &path, &opts, &tp, 4, 4);
        assert!(result.is_ok());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_arrangement_clip_offset_notes() {
        // Clip starting at bar 2 (0-indexed) in 4/4 = 8 beats offset.
        // Note at start_beats 8.0 should produce events at tick 8*480=3840.
        let tracks = vec![ExportTrack {
            name: "T".to_string(),
            notes: vec![make_note(60, 8.0, 1.0)], // already offset by frontend
        }];
        let opts = ExportOptions { export_ppq: 480 };
        let tp = default_tempo_points();
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_clip_offset.mid");
        MidiExporter::export_arrangement(&tracks, &path, &opts, &tp, 4, 4).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        // Track 1 (index 1) has the notes. Compute absolute ticks by summing deltas.
        let track = &smf.tracks[1];
        let mut abs: u64 = 0;
        let mut note_on_tick: Option<u64> = None;
        for e in track.iter() {
            abs += e.delta.as_int() as u64;
            if let midly::TrackEventKind::Midi { message: midly::MidiMessage::NoteOn { vel, .. }, .. } = e.kind {
                if vel.as_int() > 0 {
                    note_on_tick = Some(abs);
                }
            }
        }
        assert_eq!(note_on_tick, Some(3840), "expected NoteOn at tick 3840");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_arrangement_tempo_track_has_tempo_event() {
        let tracks = vec![ExportTrack { name: "T".to_string(), notes: vec![] }];
        let tp = vec![
            TempoPoint { tick: 0, bpm: 120.0, interp: TempoInterp::Step },
            TempoPoint { tick: 960, bpm: 90.0, interp: TempoInterp::Step },
        ];
        let dir = std::env::temp_dir();
        let path = dir.join("test_export_tempo_track.mid");
        MidiExporter::export_arrangement(&tracks, &path, &ExportOptions { export_ppq: 480 }, &tp, 4, 4).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let smf = roundtrip_bytes(&bytes);
        let tempo_count = smf.tracks[0].iter().filter(|e| {
            matches!(e.kind, midly::TrackEventKind::Meta(midly::MetaMessage::Tempo(_)))
        }).count();
        assert_eq!(tempo_count, 2, "expected 2 tempo events (one per TempoPoint)");
        let _ = std::fs::remove_file(&path);
    }
}
