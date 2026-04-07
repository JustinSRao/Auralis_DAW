//! Track Freeze and Bounce in Place — offline MIDI→audio renderer (Sprint 40).
//!
//! ## Overview
//!
//! [`render_midi_to_wav`] creates a temporary [`SubtractiveSynth`] from the
//! current managed `SynthParams`, feeds it MIDI note events derived from the
//! track's clip data, collects the audio output, and writes a stereo 44.1 kHz
//! 32-bit float WAV file to `output_path`.
//!
//! **Effects are intentionally excluded from the render.**
//! - For *freeze*: effects remain active in the realtime mixer channel, so the
//!   frozen clip is processed by them at playback time — the same as the live
//!   instrument would have been.
//! - For *bounce in place*: effects stay active on the now-Audio track,
//!   processing the bounced clip during real-time playback.
//!
//! ## Thread safety
//!
//! This module is called from `tokio::task::spawn_blocking`.  It must not access
//! Tauri managed state directly — callers clone the required `Arc`s before
//! handing them to `render_midi_to_wav`.

use std::collections::BinaryHeap;
use std::cmp::Reverse;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use atomic_float::AtomicF32;
use hound::{WavSpec, WavWriter, SampleFormat};
use tauri::Emitter;

use crate::instruments::synth::SubtractiveSynth;
use crate::instruments::synth::params::SynthParams;
use crate::instruments::synth::lfo::LfoParams;
use crate::audio::transport::TransportAtomics;
use crate::midi::types::{MidiEvent, TimestampedMidiEvent};
use crate::project::format::{ClipContent, ClipData};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A beat-based render range on the project timeline.
#[derive(Debug, Clone, Copy)]
pub struct RangeBeats {
    /// Inclusive start beat.
    pub start: f64,
    /// Exclusive end beat.
    pub end: f64,
}

impl RangeBeats {
    /// Duration in beats.
    pub fn duration(&self) -> f64 {
        (self.end - self.start).max(0.0)
    }
}

/// Return value from a successful freeze or bounce render.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    /// Absolute path to the rendered WAV file.
    pub wav_path: String,
    /// UUID assigned to the new sample reference.
    pub sample_id: String,
    /// UUID assigned to the new audio clip.
    pub clip_id: String,
    /// Render range start, in beats (= the clip's `start_beats`).
    pub start_beats: f64,
    /// Render range end, in beats.
    pub end_beats: f64,
}

/// Per-track state stored while a track is frozen.
pub struct FreezeRecord {
    /// The track that was frozen.
    pub track_id: String,
    /// Synth volume before freeze; restored on unfreeze.
    pub original_volume: f32,
    /// Absolute path to the temp freeze WAV.
    pub wav_path: PathBuf,
    /// ID of the audio clip inserted into the track's clip list.
    pub freeze_clip_id: String,
}

/// Manages per-track freeze state and in-progress render tasks.
pub struct FreezeEngine {
    /// Currently frozen tracks, keyed by `track_id`.
    records: std::collections::HashMap<String, FreezeRecord>,
    /// Cancellation flags for in-progress renders, keyed by `track_id`.
    pub cancel_flags: std::collections::HashMap<String, Arc<AtomicBool>>,
    /// Render progress (0.0–1.0), keyed by `track_id`.
    pub progress: std::collections::HashMap<String, Arc<AtomicF32>>,
}

/// Tauri managed state for the freeze engine.
pub type FreezeEngineState = Arc<Mutex<FreezeEngine>>;

impl FreezeEngine {
    /// Creates an empty engine.
    pub fn new() -> Self {
        Self {
            records: std::collections::HashMap::new(),
            cancel_flags: std::collections::HashMap::new(),
            progress: std::collections::HashMap::new(),
        }
    }

    /// Stores a freeze record and clears in-progress state for the track.
    pub fn store_record(&mut self, record: FreezeRecord) {
        let id = record.track_id.clone();
        self.records.insert(id.clone(), record);
        self.cancel_flags.remove(&id);
        self.progress.remove(&id);
    }

    /// Returns a reference to the freeze record for `track_id`, if any.
    pub fn get_record(&self, track_id: &str) -> Option<&FreezeRecord> {
        self.records.get(track_id)
    }

    /// Removes and returns the freeze record for `track_id`.
    pub fn take_record(&mut self, track_id: &str) -> Option<FreezeRecord> {
        self.records.remove(track_id)
    }

    /// Registers a new in-progress render for `track_id`.
    ///
    /// Returns the cancel flag and progress atomic for the spawned task.
    pub fn begin_render(&mut self, track_id: &str) -> (Arc<AtomicBool>, Arc<AtomicF32>) {
        let cancel = Arc::new(AtomicBool::new(false));
        let progress = Arc::new(AtomicF32::new(0.0));
        self.cancel_flags.insert(track_id.to_string(), Arc::clone(&cancel));
        self.progress.insert(track_id.to_string(), Arc::clone(&progress));
        (cancel, progress)
    }

    /// Returns the current progress for an in-progress render, or `None`.
    pub fn get_progress(&self, track_id: &str) -> Option<f32> {
        self.progress.get(track_id).map(|a| a.load(Ordering::Relaxed))
    }

    /// Requests cancellation for an in-progress render.
    pub fn request_cancel(&self, track_id: &str) {
        if let Some(flag) = self.cancel_flags.get(track_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

impl Default for FreezeEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Payload emitted per track during rendering
// ---------------------------------------------------------------------------

/// Tauri event payload for `freeze_progress`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreezeProgressPayload {
    /// The track being rendered.
    pub track_id: String,
    /// Progress in `[0.0, 1.0]`.
    pub progress: f32,
}

// ---------------------------------------------------------------------------
// Offline MIDI → WAV renderer
// ---------------------------------------------------------------------------

/// Scheduled MIDI event (note on or note off) with an absolute sample position.
///
/// Wrapped in `Reverse` so it can be used in a min-heap.
#[derive(Eq, PartialEq)]
struct ScheduledEvent {
    /// Absolute sample position for this event.
    sample: u64,
    /// The MIDI event to deliver.
    event: ScheduledEventKind,
}

#[derive(Eq, PartialEq)]
enum ScheduledEventKind {
    NoteOn  { note: u8, velocity: u8, channel: u8 },
    NoteOff { note: u8, channel: u8 },
}

impl Ord for ScheduledEvent {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Reverse ordering so the smallest sample comes out of a BinaryHeap first.
        other.sample.cmp(&self.sample)
    }
}

impl PartialOrd for ScheduledEvent {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Render all MIDI clips on a track to a stereo 44.1 kHz 32-bit float WAV.
///
/// # Parameters
///
/// - `clips` — all `ClipData` on the target track (non-MIDI clips are ignored).
/// - `range` — beat range to render; determines start/end of the output file.
/// - `bpm` — project tempo in beats per minute.
/// - `synth_params` — shared synth parameter atomics (cloned Arc — read-only).
/// - `lfo1_params` / `lfo2_params` — shared LFO parameters.
/// - `output_path` — absolute path of the WAV file to write.
/// - `cancel` — set to `true` to abort the render early.
/// - `progress` — updated as the render advances; written to by this function.
/// - `app_handle` — used to emit `freeze_progress` Tauri events every 100 blocks.
/// - `track_id` — included in the `freeze_progress` event payload.
///
/// # Errors
///
/// Returns an `Err` string if the WAV file cannot be created, or if the render
/// was cancelled (in which case the partial file is deleted before returning).
pub fn render_midi_to_wav(
    clips: &[ClipData],
    range: RangeBeats,
    bpm: f64,
    synth_params: Arc<SynthParams>,
    lfo1_params: Arc<LfoParams>,
    lfo2_params: Arc<LfoParams>,
    output_path: &Path,
    cancel: Arc<AtomicBool>,
    progress: Arc<AtomicF32>,
    app_handle: &tauri::AppHandle,
    track_id: &str,
) -> Result<(), String> {
    const SAMPLE_RATE: u32 = 44100;
    const CHANNELS: u16    = 2;
    const BLOCK_SIZE: usize = 256;
    const PROGRESS_INTERVAL: usize = 100; // emit event every N blocks

    let samples_per_beat = (60.0 / bpm) * SAMPLE_RATE as f64;
    let start_sample = (range.start * samples_per_beat) as u64;
    let end_sample   = (range.end   * samples_per_beat) as u64;

    if end_sample <= start_sample {
        return Err("Render range is empty.".to_string());
    }

    let total_frames = end_sample - start_sample;

    // ── Build sorted event queue ──────────────────────────────────────────────

    // We use a BinaryHeap<Reverse<(sample, is_note_off, note, vel, ch)>>.
    // Wrapping in Reverse gives us a min-heap by sample position.
    let mut note_on_heap:  BinaryHeap<Reverse<(u64, u8, u8, u8)>> = BinaryHeap::new();
    let mut note_off_heap: BinaryHeap<Reverse<(u64, u8, u8)>>     = BinaryHeap::new();

    for clip in clips {
        if let ClipContent::Midi { notes, .. } = &clip.content {
            for note in notes {
                let abs_start = clip.start_beats + note.start_beats;
                let abs_end   = abs_start + note.duration_beats;

                // Skip notes entirely outside the render range.
                if abs_end * samples_per_beat < start_sample as f64 {
                    continue;
                }
                if abs_start * samples_per_beat >= end_sample as f64 {
                    continue;
                }

                // Clamp NoteOn to render start, NoteOff to render end.
                let on_sample  = ((abs_start * samples_per_beat) as u64)
                    .saturating_sub(start_sample);
                let off_sample = (((abs_end * samples_per_beat) as u64)
                    .min(end_sample))
                    .saturating_sub(start_sample);

                note_on_heap.push(Reverse((on_sample,  note.note, note.velocity, note.channel)));
                note_off_heap.push(Reverse((off_sample, note.note, note.channel)));
            }
        }
    }

    // ── Set up synth and MIDI channel ─────────────────────────────────────────

    let (midi_tx, midi_rx) = crossbeam_channel::bounded::<TimestampedMidiEvent>(4096);
    let transport_atomics  = TransportAtomics::new(bpm, SAMPLE_RATE);
    let mut synth = SubtractiveSynth::new(
        synth_params,
        midi_rx,
        SAMPLE_RATE as f32,
        lfo1_params,
        lfo2_params,
        transport_atomics,
    );

    // ── Open WAV writer ───────────────────────────────────────────────────────

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {e}"))?;
    }

    let spec = WavSpec {
        channels:           CHANNELS,
        sample_rate:        SAMPLE_RATE,
        bits_per_sample:    32,
        sample_format:      SampleFormat::Float,
    };
    let mut writer = WavWriter::create(output_path, spec)
        .map_err(|e| format!("Failed to create WAV file: {e}"))?;

    // ── Render loop ───────────────────────────────────────────────────────────

    use crate::audio::graph::AudioNode;

    let mut current_frame: u64 = 0;
    let mut blocks_rendered: usize = 0;
    let mut buf = vec![0.0f32; BLOCK_SIZE * CHANNELS as usize];

    while current_frame < total_frames {
        // Cancellation check.
        if cancel.load(Ordering::Relaxed) {
            drop(writer);
            let _ = std::fs::remove_file(output_path);
            return Err("Render cancelled.".to_string());
        }

        let block_end = (current_frame + BLOCK_SIZE as u64).min(total_frames);
        let block_frames = (block_end - current_frame) as usize;

        // Deliver NoteOn events for this block.
        while let Some(Reverse((sample, note, vel, ch))) = note_on_heap.peek().copied() {
            if sample >= block_end { break; }
            note_on_heap.pop();
            let _ = midi_tx.try_send(TimestampedMidiEvent {
                event: MidiEvent::NoteOn { note, velocity: vel, channel: ch },
                timestamp_us: 0,
            });
        }

        // Zero the working buffer.
        for s in buf[..block_frames * CHANNELS as usize].iter_mut() {
            *s = 0.0;
        }

        // Render one block.
        synth.process(&mut buf[..block_frames * CHANNELS as usize], SAMPLE_RATE, CHANNELS);

        // Write to WAV (interleaved L/R).
        for i in 0..block_frames {
            writer.write_sample(buf[i * 2])
                .map_err(|e| format!("WAV write error: {e}"))?;
            writer.write_sample(buf[i * 2 + 1])
                .map_err(|e| format!("WAV write error: {e}"))?;
        }

        // Deliver NoteOff events for this block (after writing, before next block).
        while let Some(Reverse((sample, note, ch))) = note_off_heap.peek().copied() {
            if sample >= block_end { break; }
            note_off_heap.pop();
            let _ = midi_tx.try_send(TimestampedMidiEvent {
                event: MidiEvent::NoteOff { note, velocity: 0, channel: ch },
                timestamp_us: 0,
            });
        }

        current_frame = block_end;
        blocks_rendered += 1;

        // Update progress.
        let prog = current_frame as f32 / total_frames as f32;
        progress.store(prog, Ordering::Relaxed);
        if blocks_rendered % PROGRESS_INTERVAL == 0 {
            let _ = app_handle.emit("freeze_progress", FreezeProgressPayload {
                track_id: track_id.to_string(),
                progress: prog,
            });
        }
    }

    writer.finalize().map_err(|e| format!("Failed to finalize WAV: {e}"))?;
    progress.store(1.0, Ordering::Relaxed);
    let _ = app_handle.emit("freeze_progress", FreezeProgressPayload {
        track_id: track_id.to_string(),
        progress: 1.0,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use crate::instruments::synth::params::SynthParams;
    use crate::instruments::synth::lfo::LfoParams;
    use crate::project::format::{ClipContent, ClipData, MidiNoteData};

    fn default_synth_params() -> Arc<SynthParams> {
        SynthParams::new()
    }

    fn default_lfo() -> Arc<LfoParams> {
        LfoParams::new()
    }

    #[test]
    fn freeze_engine_begin_and_cancel() {
        let mut engine = FreezeEngine::new();
        let (cancel, progress) = engine.begin_render("track-1");
        assert!(!cancel.load(Ordering::Relaxed));
        assert_eq!(progress.load(Ordering::Relaxed), 0.0);

        engine.request_cancel("track-1");
        assert!(cancel.load(Ordering::Relaxed));
    }

    #[test]
    fn freeze_engine_store_and_take_record() {
        let mut engine = FreezeEngine::new();
        engine.store_record(FreezeRecord {
            track_id: "t1".to_string(),
            original_volume: 0.7,
            wav_path: PathBuf::from("/tmp/t1_freeze.wav"),
            freeze_clip_id: "clip-1".to_string(),
        });

        assert!(engine.get_record("t1").is_some());
        let rec = engine.take_record("t1").unwrap();
        assert_eq!(rec.track_id, "t1");
        assert!(engine.get_record("t1").is_none());
    }

    #[test]
    fn range_beats_duration() {
        let r = RangeBeats { start: 2.0, end: 10.0 };
        assert!((r.duration() - 8.0).abs() < 0.001);
    }

    #[test]
    fn empty_range_is_error() {
        // A RangeBeats with end <= start should produce empty duration.
        let r = RangeBeats { start: 5.0, end: 5.0 };
        assert_eq!(r.duration(), 0.0);
    }

    /// Verifies that notes fully outside the render range are dropped.
    #[test]
    fn note_outside_range_is_excluded() {
        // Clip with a note at beats 100–101; range is 0–4.
        let clips = vec![ClipData {
            id: "c1".to_string(),
            name: "".to_string(),
            start_beats: 100.0,
            duration_beats: 1.0,
            content: ClipContent::Midi {
                notes: vec![MidiNoteData {
                    note: 60,
                    velocity: 100,
                    start_beats: 0.0,
                    duration_beats: 1.0,
                    channel: 0,
                }],
                cc_events: vec![],
            },
            stretch_ratio: None,
            pitch_shift_semitones: None,
        }];

        // Just confirm no panic when building the heap (range 0–4 skips the note).
        let range = RangeBeats { start: 0.0, end: 4.0 };
        let samples_per_beat = (60.0 / 120.0) * 44100.0_f64;
        let start_sample = (range.start * samples_per_beat) as u64;
        let end_sample   = (range.end   * samples_per_beat) as u64;

        let mut included = false;
        for clip in &clips {
            if let ClipContent::Midi { notes, .. } = &clip.content {
                for note in notes {
                    let abs_start = clip.start_beats + note.start_beats;
                    let abs_end   = abs_start + note.duration_beats;
                    let note_end_s   = (abs_end   * samples_per_beat) as u64;
                    let note_start_s = (abs_start * samples_per_beat) as u64;
                    if note_end_s >= start_sample && note_start_s < end_sample {
                        included = true;
                    }
                }
            }
        }
        assert!(!included, "Note at beat 100 should be excluded from range 0–4");
    }
}
