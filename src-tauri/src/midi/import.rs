//! MIDI file import: parse standard `.mid` files into DAW patterns.
//!
//! Supports MIDI Type 0 (single track) and Type 1 (multi-track) files.
//! Type 2 (sequential) files return an error.
//!
//! # Beat-position conversion
//!
//! Beat position is simply `tick / ticks_per_quarter` — tempo events do not
//! affect the beat grid, only wall-clock timing.  The tempo is extracted only
//! to provide a `suggested_bpm` hint for the user interface.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A single MIDI note after tick-to-beat conversion.
///
/// Field names are camelCase on the wire to match `PatternMidiNote` on the
/// TypeScript side — enabling a zero-transform round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedNote {
    /// MIDI pitch `[0, 127]`.
    pub pitch: u8,
    /// MIDI velocity `[1, 127]`.
    pub velocity: u8,
    /// MIDI channel `[0, 15]` (0-indexed).
    pub channel: u8,
    /// Note start in beats from the beginning of the MIDI track.
    pub start_beats: f64,
    /// Note duration in beats.  Minimum value: `1 / ticks_per_quarter` beats.
    pub duration_beats: f64,
}

/// One MIDI track parsed from a `.mid` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTrack {
    /// 0-based MIDI track index within the file.
    pub midi_track_index: usize,
    /// Human-readable name from the MIDI track-name meta-event.
    /// Falls back to `"Track N"` when absent.
    pub name: String,
    /// All notes in this track, converted to beat positions.
    pub notes: Vec<ImportedNote>,
    /// `true` if the track contains no NoteOn events with velocity > 0.
    pub is_empty: bool,
}

/// Top-level result of parsing a `.mid` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiFileInfo {
    /// MIDI format: `0` = Type 0 (single track), `1` = Type 1 (multi-track).
    pub format: u8,
    /// BPM extracted from the first tempo meta-event.
    /// Defaults to `120.0` when no tempo event is present.
    pub suggested_bpm: f64,
    /// All parsed tracks (one for Type 0, multiple for Type 1).
    pub tracks: Vec<ImportedTrack>,
}

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

/// Stateless MIDI file parser.
pub struct MidiImporter;

impl MidiImporter {
    /// Parses a `.mid` file at `path` and returns [`MidiFileInfo`].
    ///
    /// All parsing is synchronous and does not touch the audio thread.
    ///
    /// # Errors
    ///
    /// Returns a human-readable error string on:
    /// - File read failure.
    /// - Malformed MIDI data (any `midly` parse error).
    /// - MIDI Type 2 (sequential) files (unsupported).
    pub fn parse_file(path: &Path) -> Result<MidiFileInfo, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("Failed to read file: {e}"))?;
        Self::parse_bytes(&bytes)
    }

    /// Parses raw MIDI bytes.  Exposed for unit testing without touching the
    /// filesystem.
    pub fn parse_bytes(bytes: &[u8]) -> Result<MidiFileInfo, String> {
        let smf = midly::Smf::parse(bytes).map_err(|e| format!("Invalid MIDI file: {e}"))?;

        // --- format ---
        let format: u8 = match smf.header.format {
            midly::Format::SingleTrack => 0,
            midly::Format::Parallel => 1,
            midly::Format::Sequential => {
                return Err("Type 2 (sequential) MIDI files are not supported".to_string())
            }
        };

        // --- ticks_per_quarter ---
        let ticks_per_quarter: u16 = match smf.header.timing {
            midly::Timing::Metrical(t) => t.as_int(),
            midly::Timing::Timecode(_, _) => {
                log::warn!("[midi/import] SMPTE timecode timing detected; falling back to 480 tpq");
                480
            }
        };

        // --- suggested BPM (from track 0 for Type 1; from only track for Type 0) ---
        let suggested_bpm = smf
            .tracks
            .first()
            .map(|t| Self::find_suggested_bpm(t))
            .unwrap_or(120.0);

        // --- per-track notes ---
        let tracks: Vec<ImportedTrack> = smf
            .tracks
            .iter()
            .enumerate()
            .map(|(idx, track)| {
                let name = Self::extract_track_name(track)
                    .unwrap_or_else(|| format!("Track {}", idx + 1));
                let notes = Self::collect_notes(track, ticks_per_quarter);
                let is_empty = notes.is_empty();
                ImportedTrack {
                    midi_track_index: idx,
                    name,
                    notes,
                    is_empty,
                }
            })
            .collect();

        Ok(MidiFileInfo {
            format,
            suggested_bpm,
            tracks,
        })
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    /// Extracts the track name from a MIDI `TrackName` meta-event.
    fn extract_track_name(track: &midly::Track<'_>) -> Option<String> {
        for event in track.iter() {
            if let midly::TrackEventKind::Meta(midly::MetaMessage::TrackName(raw)) = event.kind {
                if let Ok(s) = std::str::from_utf8(raw) {
                    let name = s.trim().to_string();
                    if !name.is_empty() {
                        return Some(name);
                    }
                }
            }
        }
        None
    }

    /// Returns the BPM from the first `Tempo` meta-event in the track,
    /// or `120.0` if none is found.
    fn find_suggested_bpm(track: &midly::Track<'_>) -> f64 {
        for event in track.iter() {
            if let midly::TrackEventKind::Meta(midly::MetaMessage::Tempo(us_per_beat)) =
                event.kind
            {
                let us = us_per_beat.as_int();
                if us > 0 {
                    return 60_000_000.0 / us as f64;
                }
            }
        }
        120.0
    }

    /// Collects all NoteOn/NoteOff pairs from `track` and converts tick
    /// positions to beats using `ticks_per_quarter`.
    fn collect_notes(track: &midly::Track<'_>, ticks_per_quarter: u16) -> Vec<ImportedNote> {
        // open_notes[(channel, pitch)] = stack of (start_tick, velocity)
        let mut open_notes: HashMap<(u8, u8), Vec<(u64, u8)>> = HashMap::new();
        let mut finished: Vec<ImportedNote> = Vec::new();
        let mut abs_tick: u64 = 0;
        let mut last_tick: u64 = 0;

        for event in track.iter() {
            abs_tick += event.delta.as_int() as u64;
            last_tick = abs_tick;

            if let midly::TrackEventKind::Midi { channel, message } = event.kind {
                let ch = channel.as_int();
                match message {
                    midly::MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => {
                        let pitch = key.as_int();
                        open_notes
                            .entry((ch, pitch))
                            .or_default()
                            .push((abs_tick, vel.as_int()));
                    }
                    midly::MidiMessage::NoteOff { key, .. }
                    | midly::MidiMessage::NoteOn { key, .. } => {
                        // NoteOn with vel==0 acts as NoteOff
                        let pitch = key.as_int();
                        if let Some(stack) = open_notes.get_mut(&(ch, pitch)) {
                            if let Some((start_tick, velocity)) = stack.pop() {
                                finished.push(Self::make_note(
                                    pitch,
                                    velocity,
                                    ch,
                                    start_tick,
                                    abs_tick,
                                    ticks_per_quarter,
                                ));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        // Close any notes that never received a NoteOff (truncated files).
        let tpq = ticks_per_quarter;
        for ((ch, pitch), stack) in open_notes.drain() {
            for (start_tick, velocity) in stack {
                // Minimum duration: 1 tick.
                let end_tick = (last_tick).max(start_tick + 1);
                finished.push(Self::make_note(
                    pitch, velocity, ch, start_tick, end_tick, tpq,
                ));
            }
        }

        finished.sort_by(|a, b| a.start_beats.partial_cmp(&b.start_beats).unwrap());
        finished
    }

    /// Converts tick-based note positions to an [`ImportedNote`].
    #[inline]
    fn make_note(
        pitch: u8,
        velocity: u8,
        channel: u8,
        start_tick: u64,
        end_tick: u64,
        ticks_per_quarter: u16,
    ) -> ImportedNote {
        let tpq = ticks_per_quarter as f64;
        let start_beats = start_tick as f64 / tpq;
        let raw_dur = (end_tick as f64 - start_tick as f64) / tpq;
        // Minimum 1/tpq beats (one tick) to avoid zero-duration notes.
        let duration_beats = raw_dur.max(1.0 / tpq);
        ImportedNote {
            pitch,
            velocity,
            channel,
            start_beats,
            duration_beats,
        }
    }

    /// Rounds `raw_bars` up to the nearest valid pattern length (1,2,4,8,16,32).
    /// Clamps at 32 if the content exceeds 32 bars.
    pub fn snap_length_bars(raw_bars: f64) -> u8 {
        const VALID: &[u8] = &[1, 2, 4, 8, 16, 32];
        let ceil = raw_bars.ceil() as u64;
        for &v in VALID {
            if v as u64 >= ceil {
                return v;
            }
        }
        32 // clamp to max
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Minimal MIDI byte constructors
    // -----------------------------------------------------------------------

    /// Encodes a variable-length MIDI delta time.
    fn encode_vlq(mut value: u32) -> Vec<u8> {
        let mut bytes = vec![value as u8 & 0x7F];
        value >>= 7;
        while value > 0 {
            bytes.insert(0, (value as u8 & 0x7F) | 0x80);
            value >>= 7;
        }
        bytes
    }

    /// Builds a minimal Type 0 MIDI file with one note (C4, vel=64, 1 beat).
    ///
    /// ticks_per_quarter = 480  →  duration = 480 ticks = 1.0 beat
    fn make_type0_bytes() -> Vec<u8> {
        let tpq: u16 = 480;

        // Track events: NoteOn C4 at tick 0, NoteOff C4 at tick 480, EndOfTrack
        let mut track_data: Vec<u8> = Vec::new();
        // delta=0, NoteOn ch0 C4 vel=64
        track_data.extend(encode_vlq(0));
        track_data.extend_from_slice(&[0x90, 0x3C, 0x40]);
        // delta=480, NoteOff ch0 C4
        track_data.extend(encode_vlq(tpq as u32));
        track_data.extend_from_slice(&[0x80, 0x3C, 0x00]);
        // delta=0, EndOfTrack
        track_data.extend_from_slice(&[0x00, 0xFF, 0x2F, 0x00]);

        let track_len = track_data.len() as u32;

        let mut out: Vec<u8> = Vec::new();
        // MThd
        out.extend_from_slice(b"MThd");
        out.extend_from_slice(&[0x00, 0x00, 0x00, 0x06]); // length = 6
        out.extend_from_slice(&[0x00, 0x00]); // format = 0
        out.extend_from_slice(&[0x00, 0x01]); // ntrks = 1
        out.extend_from_slice(&tpq.to_be_bytes()); // division
        // MTrk
        out.extend_from_slice(b"MTrk");
        out.extend_from_slice(&track_len.to_be_bytes());
        out.extend(track_data);
        out
    }

    /// Builds a minimal Type 1 MIDI file: tempo track + two note tracks.
    fn make_type1_bytes() -> Vec<u8> {
        let tpq: u16 = 480;

        // Track 0: tempo track (120 BPM = 500000 µs/beat)
        let mut tempo_track: Vec<u8> = Vec::new();
        // delta=0, Tempo meta
        tempo_track.extend_from_slice(&[0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20]);
        // delta=0, EndOfTrack
        tempo_track.extend_from_slice(&[0x00, 0xFF, 0x2F, 0x00]);

        // Track 1: one C4 note
        let mut track1: Vec<u8> = Vec::new();
        track1.extend(encode_vlq(0));
        track1.extend_from_slice(&[0x90, 0x3C, 0x64]); // NoteOn C4 vel=100
        track1.extend(encode_vlq(tpq as u32));
        track1.extend_from_slice(&[0x80, 0x3C, 0x00]); // NoteOff C4
        track1.extend_from_slice(&[0x00, 0xFF, 0x2F, 0x00]); // EndOfTrack

        // Track 2: one E4 note
        let mut track2: Vec<u8> = Vec::new();
        track2.extend(encode_vlq(0));
        track2.extend_from_slice(&[0x90, 0x40, 0x64]); // NoteOn E4 vel=100
        track2.extend(encode_vlq(tpq as u32));
        track2.extend_from_slice(&[0x80, 0x40, 0x00]); // NoteOff E4
        track2.extend_from_slice(&[0x00, 0xFF, 0x2F, 0x00]); // EndOfTrack

        let mut out: Vec<u8> = Vec::new();
        // MThd
        out.extend_from_slice(b"MThd");
        out.extend_from_slice(&[0x00, 0x00, 0x00, 0x06]);
        out.extend_from_slice(&[0x00, 0x01]); // format = 1
        out.extend_from_slice(&[0x00, 0x03]); // ntrks = 3
        out.extend_from_slice(&tpq.to_be_bytes());
        for track in &[&tempo_track, &track1, &track2] {
            out.extend_from_slice(b"MTrk");
            out.extend_from_slice(&(track.len() as u32).to_be_bytes());
            out.extend_from_slice(track);
        }
        out
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    #[test]
    fn parse_type0_returns_one_track() {
        let bytes = make_type0_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        assert_eq!(info.format, 0);
        assert_eq!(info.tracks.len(), 1);
    }

    #[test]
    fn parse_type0_note_pitch_and_duration() {
        let bytes = make_type0_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        let notes = &info.tracks[0].notes;
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].pitch, 0x3C); // C4 = 60
        assert!((notes[0].start_beats - 0.0).abs() < 1e-9);
        assert!((notes[0].duration_beats - 1.0).abs() < 1e-9);
    }

    #[test]
    fn parse_type0_is_not_empty() {
        let bytes = make_type0_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        assert!(!info.tracks[0].is_empty);
    }

    #[test]
    fn parse_type1_returns_three_tracks() {
        let bytes = make_type1_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        assert_eq!(info.format, 1);
        assert_eq!(info.tracks.len(), 3);
    }

    #[test]
    fn parse_type1_tempo_track_is_empty() {
        let bytes = make_type1_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        // Track 0 is the tempo track — no NoteOn events.
        assert!(info.tracks[0].is_empty);
    }

    #[test]
    fn parse_type1_note_tracks_have_one_note_each() {
        let bytes = make_type1_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        assert_eq!(info.tracks[1].notes.len(), 1);
        assert_eq!(info.tracks[2].notes.len(), 1);
    }

    #[test]
    fn parse_type1_note_track_pitches() {
        let bytes = make_type1_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        assert_eq!(info.tracks[1].notes[0].pitch, 0x3C); // C4
        assert_eq!(info.tracks[2].notes[0].pitch, 0x40); // E4
    }

    #[test]
    fn parse_type1_suggested_bpm_is_120() {
        let bytes = make_type1_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        // 500000 µs/beat = 120 BPM
        assert!((info.suggested_bpm - 120.0).abs() < 0.01);
    }

    #[test]
    fn malformed_file_returns_err_no_panic() {
        let result = MidiImporter::parse_bytes(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn malformed_file_with_garbage_bytes_returns_err() {
        let result = MidiImporter::parse_bytes(&[0xDE, 0xAD, 0xBE, 0xEF]);
        assert!(result.is_err());
    }

    #[test]
    fn note_on_velocity_zero_acts_as_note_off() {
        // Build a track with NoteOn-vel-0 instead of NoteOff.
        let tpq: u16 = 480;
        let mut track: Vec<u8> = Vec::new();
        // delta=0, NoteOn C4 vel=80
        track.extend(encode_vlq(0));
        track.extend_from_slice(&[0x90, 0x3C, 0x50]);
        // delta=480, NoteOn C4 vel=0 (= NoteOff)
        track.extend(encode_vlq(tpq as u32));
        track.extend_from_slice(&[0x90, 0x3C, 0x00]);
        // EndOfTrack
        track.extend_from_slice(&[0x00, 0xFF, 0x2F, 0x00]);

        let mut bytes: Vec<u8> = Vec::new();
        bytes.extend_from_slice(b"MThd\x00\x00\x00\x06\x00\x00\x00\x01");
        bytes.extend_from_slice(&tpq.to_be_bytes());
        bytes.extend_from_slice(b"MTrk");
        bytes.extend_from_slice(&(track.len() as u32).to_be_bytes());
        bytes.extend(track);

        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        assert_eq!(info.tracks[0].notes.len(), 1);
        assert!((info.tracks[0].notes[0].duration_beats - 1.0).abs() < 1e-9);
    }

    #[test]
    fn snap_length_bars_rounds_up_to_next_valid() {
        assert_eq!(MidiImporter::snap_length_bars(0.5), 1);
        assert_eq!(MidiImporter::snap_length_bars(1.0), 1);
        assert_eq!(MidiImporter::snap_length_bars(1.1), 2);
        assert_eq!(MidiImporter::snap_length_bars(3.0), 4);
        assert_eq!(MidiImporter::snap_length_bars(3.1), 4);
        assert_eq!(MidiImporter::snap_length_bars(4.0), 4);
        assert_eq!(MidiImporter::snap_length_bars(8.0), 8);
        assert_eq!(MidiImporter::snap_length_bars(16.5), 32);
        assert_eq!(MidiImporter::snap_length_bars(33.0), 32); // clamp
    }

    #[test]
    fn tick_to_beat_arithmetic() {
        // Direct verification of the arithmetic used in make_note.
        let tpq = 480_u16;
        let note = MidiImporter::make_note(60, 100, 0, 0, 480, tpq);
        assert!((note.start_beats - 0.0).abs() < 1e-9);
        assert!((note.duration_beats - 1.0).abs() < 1e-9);

        let note2 = MidiImporter::make_note(60, 100, 0, 240, 480, tpq);
        assert!((note2.start_beats - 0.5).abs() < 1e-9);
        assert!((note2.duration_beats - 0.5).abs() < 1e-9);
    }

    #[test]
    fn default_bpm_when_no_tempo_event() {
        // Type 0 with no tempo meta → should default to 120.0.
        let bytes = make_type0_bytes();
        let info = MidiImporter::parse_bytes(&bytes).expect("parse failed");
        // make_type0_bytes has no tempo event in the track.
        assert!((info.suggested_bpm - 120.0).abs() < 0.01);
    }
}
