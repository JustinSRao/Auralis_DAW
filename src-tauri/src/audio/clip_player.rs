//! Audio clip playback engine for Sprint 37.
//!
//! ## Architecture
//!
//! ```text
//! Main thread                          Audio thread
//! -----------                          ------------
//! load_audio_clip ──► decode_audio_file (blocking thread)
//!                 ──► ClipStore (Arc<SampleBuffer>)
//!
//! trigger_audio_clip ──► ClipCmdTx ──► ClipPlaybackNode::process()
//!                                         reads Arc<SampleBuffer>
//!                                         walks cursor forward
//!                                         adds samples to output
//! ```
//!
//! `ClipPlaybackNode` implements [`AudioNode`] and is added to the audio graph
//! at engine startup.  No heap allocations occur in the hot path:
//! - `Arc<SampleBuffer>` clones happen only when `StartClip` is received (one per clip
//!   start — infrequent compared to the audio callback rate).
//! - The `playing` Vec is pre-allocated to `MAX_PLAYING` at construction.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use atomic_float::AtomicF32;
use crossbeam_channel::{Receiver, Sender};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::task;

use crate::audio::fade::{compute_fade_gain, FadeCurve, FadeTables};
use crate::audio::graph::AudioNode;
use crate::audio_editing::peak_cache::{compute_peaks, PeakData};
use crate::instruments::sampler::decoder::{decode_audio_file, SampleBuffer};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum number of clips that can play simultaneously.
const MAX_PLAYING: usize = 32;
/// Default sample rate used when decoding outside the audio engine context.
const DEFAULT_SR: f32 = 44100.0;

// ─── Clip commands ────────────────────────────────────────────────────────────

/// Commands sent from Tauri command threads to [`ClipPlaybackNode`].
pub enum ClipCmd {
    /// Begin playing a clip from `start_offset` frames into the audio file.
    StartClip {
        clip_id:          String,
        buffer:           Arc<SampleBuffer>,
        gain:             f32,
        start_offset:     usize,
        /// Total frames in the source buffer (= `buffer.frame_count`).
        total_frames:     usize,
        /// Fade-in length in frames (`0` = no fade-in).
        fade_in_frames:   u64,
        /// Fade-out length in frames (`0` = no fade-out).
        fade_out_frames:  u64,
        fade_in_curve:    FadeCurve,
        fade_out_curve:   FadeCurve,
    },
    /// Stop a playing clip immediately.
    StopClip { clip_id: String },
    /// Update gain for a currently playing clip (effective next buffer).
    SetGain { clip_id: String, gain: f32 },
}

/// Sender end of the clip command channel.
pub type ClipCmdTx = Arc<Sender<ClipCmd>>;

// ─── ClipPlaybackNode ────────────────────────────────────────────────────────

struct PlayingClip {
    clip_id:         String,
    buffer:          Arc<SampleBuffer>,
    /// Current read position in frames.
    cursor:          usize,
    gain:            f32,
    total_frames:    usize,
    fade_in_frames:  u64,
    fade_out_frames: u64,
    fade_in_curve:   FadeCurve,
    fade_out_curve:  FadeCurve,
}

/// Real-time audio node that mixes active audio clips into the output buffer.
///
/// All state transitions (start, stop, gain) arrive via a lock-free
/// `crossbeam_channel::Receiver<ClipCmd>` and are drained at the top of each
/// audio callback.
pub struct ClipPlaybackNode {
    cmd_rx:      Receiver<ClipCmd>,
    playing:     Vec<PlayingClip>,
    fade_tables: Arc<FadeTables>,
}

impl ClipPlaybackNode {
    /// Creates a new node and returns (node, sender) pair.
    ///
    /// The sender is stored in Tauri managed state; the node is added to the
    /// audio graph.
    pub fn new_pair() -> (Self, Arc<Sender<ClipCmd>>) {
        Self::new_pair_with_tables(Arc::new(FadeTables::new()))
    }

    /// Creates a new node with a shared `FadeTables` instance and returns (node, sender) pair.
    pub fn new_pair_with_tables(tables: Arc<FadeTables>) -> (Self, Arc<Sender<ClipCmd>>) {
        let (tx, rx) = crossbeam_channel::bounded::<ClipCmd>(128);
        let node = Self::from_receiver_with_tables(rx, tables);
        (node, Arc::new(tx))
    }

    /// Creates a node from a pre-existing receiver (used by the audio engine
    /// to inject a receiver created in `lib.rs` setup).
    pub fn from_receiver(rx: Receiver<ClipCmd>) -> Self {
        Self::from_receiver_with_tables(rx, Arc::new(FadeTables::new()))
    }

    /// Creates a node from a pre-existing receiver with a shared `FadeTables`.
    pub fn from_receiver_with_tables(rx: Receiver<ClipCmd>, tables: Arc<FadeTables>) -> Self {
        Self {
            cmd_rx:      rx,
            playing:     Vec::with_capacity(MAX_PLAYING),
            fade_tables: tables,
        }
    }
}

impl AudioNode for ClipPlaybackNode {
    fn process(&mut self, output: &mut [f32], _sample_rate: u32, channels: u16) {
        // ── 1. Drain all pending commands ──
        while let Ok(cmd) = self.cmd_rx.try_recv() {
            match cmd {
                ClipCmd::StartClip {
                    clip_id, buffer, gain, start_offset,
                    total_frames, fade_in_frames, fade_out_frames,
                    fade_in_curve, fade_out_curve,
                } => {
                    // Remove any existing clip with the same ID (restart semantics).
                    self.playing.retain(|c| c.clip_id != clip_id);
                    if self.playing.len() < MAX_PLAYING {
                        let cursor = start_offset.min(buffer.frame_count.saturating_sub(1));
                        self.playing.push(PlayingClip {
                            clip_id,
                            buffer,
                            gain,
                            cursor,
                            total_frames,
                            fade_in_frames,
                            fade_out_frames,
                            fade_in_curve,
                            fade_out_curve,
                        });
                    }
                }
                ClipCmd::StopClip { clip_id } => {
                    self.playing.retain(|c| c.clip_id != clip_id);
                }
                ClipCmd::SetGain { clip_id, gain } => {
                    if let Some(c) = self.playing.iter_mut().find(|c| c.clip_id == clip_id) {
                        c.gain = gain;
                    }
                }
            }
        }

        // ── 2. Mix each playing clip into output ──
        let ch = channels as usize;
        let frames_out = output.len() / ch;

        let mut finished = Vec::new();

        for (idx, clip) in self.playing.iter_mut().enumerate() {
            let available = clip.buffer.frame_count.saturating_sub(clip.cursor);
            let frames_to_copy = frames_out.min(available);

            for f in 0..frames_to_copy {
                let frame_idx = clip.cursor + f;
                let pos = frame_idx as u64; // absolute frame position in clip

                // ── Fade gain ──
                let fade_gain = if clip.fade_in_frames > 0 && pos < clip.fade_in_frames {
                    // Inside fade-in region
                    let g_in = compute_fade_gain(pos, clip.fade_in_frames,
                                                  clip.fade_in_curve, &self.fade_tables);
                    // Also check if we're simultaneously in a fade-out (very short clip)
                    if clip.fade_out_frames > 0
                        && pos + clip.fade_out_frames >= clip.total_frames as u64
                    {
                        let total = clip.total_frames as u64;
                        let out_start = total.saturating_sub(clip.fade_out_frames);
                        if pos >= out_start {
                            let pos_in_out = pos - out_start;
                            let remaining = clip.fade_out_frames.saturating_sub(pos_in_out);
                            let g_out = compute_fade_gain(remaining, clip.fade_out_frames,
                                                           clip.fade_out_curve, &self.fade_tables);
                            g_in * g_out
                        } else {
                            g_in
                        }
                    } else {
                        g_in
                    }
                } else if clip.fade_out_frames > 0 {
                    let total = clip.total_frames as u64;
                    let out_start = total.saturating_sub(clip.fade_out_frames);
                    if pos >= out_start {
                        // Inside fade-out region; pos_in_out counts from 0 (full) to fade_out_frames (silent)
                        let pos_in_out = pos - out_start;
                        let remaining = clip.fade_out_frames.saturating_sub(pos_in_out);
                        compute_fade_gain(remaining, clip.fade_out_frames,
                                           clip.fade_out_curve, &self.fade_tables)
                    } else {
                        1.0
                    }
                } else {
                    1.0
                };

                let effective_gain = clip.gain * fade_gain;

                // Buffer is always interleaved stereo (decoder guarantees this).
                let l = clip.buffer.samples[frame_idx * 2];
                let r = clip.buffer.samples[frame_idx * 2 + 1];

                match ch {
                    1 => {
                        output[f] += (l + r) * 0.5 * effective_gain;
                    }
                    _ => {
                        output[f * ch]     += l * effective_gain;
                        output[f * ch + 1] += r * effective_gain;
                        // Any additional channels get silence (already zeroed by graph).
                    }
                }
            }

            clip.cursor += frames_to_copy;

            if clip.cursor >= clip.buffer.frame_count {
                finished.push(idx);
            }
        }

        // Remove finished clips (iterate in reverse to preserve indices).
        for idx in finished.iter().rev() {
            self.playing.swap_remove(*idx);
        }
    }

    fn name(&self) -> &str {
        "ClipPlaybackNode"
    }
}

// ─── Clip metadata store ──────────────────────────────────────────────────────

/// Per-clip metadata and decoded buffer.
#[derive(Clone)]
pub struct ClipEntry {
    /// Absolute file path.
    pub file_path:    String,
    /// Playback start bar on the arrangement timeline.
    pub start_bar:    f64,
    /// Clip duration in bars.
    pub duration_bars: f64,
    /// Per-clip gain multiplier (0.0–2.0, default 1.0).
    pub gain:          f32,
    /// Start offset in frames (for trimmed clip starts).
    pub start_offset_frames: usize,
    /// Decoded audio buffer (loaded on demand).
    pub buffer:       Option<Arc<SampleBuffer>>,
    /// Fade-in length in frames (`0` = no fade-in).
    pub fade_in_frames:  u64,
    /// Fade-out length in frames (`0` = no fade-out).
    pub fade_out_frames: u64,
    /// Fade-in curve shape.
    pub fade_in_curve:   FadeCurve,
    /// Fade-out curve shape.
    pub fade_out_curve:  FadeCurve,
}

/// Per-clip atomics for thread-safe gain/offset updates without a lock.
pub struct ClipAtomics {
    pub gain: AtomicF32,
}

impl Default for ClipAtomics {
    fn default() -> Self {
        Self { gain: AtomicF32::new(1.0) }
    }
}

/// Thread-safe store mapping `clip_id → ClipEntry`.
pub type ClipStoreInner = HashMap<String, ClipEntry>;
pub type ClipStore = Arc<Mutex<ClipStoreInner>>;

/// Sender for clip commands (held in Tauri state so commands can trigger playback).
pub type ClipCmdSenderState = Arc<Sender<ClipCmd>>;

// ─── Serialisable types ───────────────────────────────────────────────────────

/// Snapshot of a loaded clip returned by `get_clip_state`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClipStateSnapshot {
    pub clip_id:              String,
    pub file_path:            String,
    pub start_bar:            f64,
    pub duration_bars:        f64,
    pub gain:                 f32,
    pub start_offset_frames:  usize,
    pub loaded:               bool,
    pub fade_in_frames:       u64,
    pub fade_out_frames:      u64,
    pub fade_in_curve:        FadeCurve,
    pub fade_out_curve:       FadeCurve,
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Loads an audio clip from disk (decoding runs on a blocking thread).
///
/// Subsequent calls with the same `clip_id` replace the previous entry.
#[tauri::command]
pub async fn load_audio_clip(
    clip_id:      String,
    file_path:    String,
    start_bar:    f64,
    duration_bars: f64,
    clip_store:   State<'_, ClipStore>,
) -> Result<ClipStateSnapshot, String> {
    // Insert metadata immediately so callers can set gain/offset while loading.
    {
        let mut store = clip_store.lock().map_err(|e| e.to_string())?;
        store.insert(clip_id.clone(), ClipEntry {
            file_path: file_path.clone(),
            start_bar,
            duration_bars,
            gain: 1.0,
            start_offset_frames: 0,
            buffer: None,
            fade_in_frames: 0,
            fade_out_frames: 0,
            fade_in_curve: FadeCurve::default(),
            fade_out_curve: FadeCurve::default(),
        });
    }

    // Decode on a blocking thread — never on the audio thread.
    let path_clone = file_path.clone();
    let id_clone   = clip_id.clone();
    let buffer = task::spawn_blocking(move || {
        decode_audio_file(std::path::Path::new(&path_clone))
            .map_err(|e| format!("Failed to decode '{}': {}", path_clone, e))
    })
    .await
    .map_err(|e| format!("Spawn blocking failed: {}", e))??;

    // Store the decoded buffer.
    let mut store = clip_store.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = store.get_mut(&id_clone) {
        entry.buffer = Some(buffer);
    }

    let entry = store.get(&id_clone)
        .ok_or_else(|| format!("Clip '{id_clone}' vanished from store after load"))?;

    Ok(ClipStateSnapshot {
        clip_id:             id_clone,
        file_path:           entry.file_path.clone(),
        start_bar:           entry.start_bar,
        duration_bars:       entry.duration_bars,
        gain:                entry.gain,
        start_offset_frames: entry.start_offset_frames,
        loaded:              entry.buffer.is_some(),
        fade_in_frames:      entry.fade_in_frames,
        fade_out_frames:     entry.fade_out_frames,
        fade_in_curve:       entry.fade_in_curve,
        fade_out_curve:      entry.fade_out_curve,
    })
}

/// Sets the per-clip gain multiplier (0.0–2.0).
#[tauri::command]
pub fn set_clip_gain(
    clip_id:    String,
    gain:       f32,
    clip_store: State<'_, ClipStore>,
    cmd_tx:     State<'_, ClipCmdSenderState>,
) -> Result<(), String> {
    let gain = gain.clamp(0.0, 2.0);
    {
        let mut store = clip_store.lock().map_err(|e| e.to_string())?;
        if let Some(entry) = store.get_mut(&clip_id) {
            entry.gain = gain;
        }
    }
    // Update live gain if the clip is currently playing.
    cmd_tx.try_send(ClipCmd::SetGain { clip_id, gain })
        .map_err(|e| format!("Clip command channel full: {}", e))?;
    Ok(())
}

/// Sets the start offset (trim start) for a clip in frames.
#[tauri::command]
pub fn set_clip_offset(
    clip_id:             String,
    start_offset_frames: usize,
    clip_store:          State<'_, ClipStore>,
) -> Result<(), String> {
    let mut store = clip_store.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = store.get_mut(&clip_id) {
        entry.start_offset_frames = start_offset_frames;
        Ok(())
    } else {
        Err(format!("Clip '{clip_id}' not found"))
    }
}

/// Triggers immediate playback of a loaded clip.
///
/// Used by tests and manual UI triggering.  Transport-scheduled playback is
/// handled by `schedule_audio_clips` (Sprint 31 scheduler integration).
#[tauri::command]
pub fn trigger_audio_clip(
    clip_id:    String,
    clip_store: State<'_, ClipStore>,
    cmd_tx:     State<'_, ClipCmdSenderState>,
) -> Result<(), String> {
    let (buffer, gain, start_offset, total_frames,
         fade_in_frames, fade_out_frames, fade_in_curve, fade_out_curve) = {
        let store = clip_store.lock().map_err(|e| e.to_string())?;
        let entry = store.get(&clip_id)
            .ok_or_else(|| format!("Clip '{clip_id}' not found"))?;
        let buffer = entry.buffer.clone()
            .ok_or_else(|| format!("Clip '{clip_id}' not yet loaded"))?;
        let total_frames = buffer.frame_count;
        (buffer, entry.gain, entry.start_offset_frames, total_frames,
         entry.fade_in_frames, entry.fade_out_frames,
         entry.fade_in_curve, entry.fade_out_curve)
    };
    cmd_tx.try_send(ClipCmd::StartClip {
        clip_id, buffer, gain, start_offset, total_frames,
        fade_in_frames, fade_out_frames, fade_in_curve, fade_out_curve,
    }).map_err(|e| format!("Clip command channel full: {}", e))?;
    Ok(())
}

/// Stops a playing clip.
#[tauri::command]
pub fn stop_audio_clip(
    clip_id: String,
    cmd_tx:  State<'_, ClipCmdSenderState>,
) -> Result<(), String> {
    cmd_tx.try_send(ClipCmd::StopClip { clip_id })
        .map_err(|e| format!("Clip command channel full: {}", e))?;
    Ok(())
}

/// Returns the current clip state snapshot.
#[tauri::command]
pub fn get_clip_state(
    clip_id:    String,
    clip_store: State<'_, ClipStore>,
) -> Result<ClipStateSnapshot, String> {
    let store = clip_store.lock().map_err(|e| e.to_string())?;
    let entry = store.get(&clip_id)
        .ok_or_else(|| format!("Clip '{clip_id}' not found"))?;
    Ok(ClipStateSnapshot {
        clip_id:             clip_id.clone(),
        file_path:           entry.file_path.clone(),
        start_bar:           entry.start_bar,
        duration_bars:       entry.duration_bars,
        gain:                entry.gain,
        start_offset_frames: entry.start_offset_frames,
        loaded:              entry.buffer.is_some(),
        fade_in_frames:      entry.fade_in_frames,
        fade_out_frames:     entry.fade_out_frames,
        fade_in_curve:       entry.fade_in_curve,
        fade_out_curve:      entry.fade_out_curve,
    })
}

/// Returns waveform peak data for a file at a given zoom level.
///
/// `frames_per_pixel` controls zoom — e.g. 512 for a zoomed-out view, 64 for
/// a close-up view.  Decoding runs on a blocking thread.
#[tauri::command]
pub async fn get_waveform_peaks(
    file_path:       String,
    frames_per_pixel: usize,
    clip_store:      State<'_, ClipStore>,
) -> Result<PeakData, String> {
    // Return peaks from cached buffer if available.
    let maybe_buffer: Option<Arc<SampleBuffer>> = {
        let store = clip_store.lock().map_err(|e| e.to_string())?;
        store.values()
            .find(|e| e.file_path == file_path)
            .and_then(|e| e.buffer.clone())
    };

    let buffer = if let Some(buf) = maybe_buffer {
        buf
    } else {
        let path_clone = file_path.clone();
        task::spawn_blocking(move || {
            decode_audio_file(std::path::Path::new(&path_clone))
                .map_err(|e| format!("Failed to decode '{}': {}", path_clone, e))
        })
        .await
        .map_err(|e| format!("Spawn blocking failed: {}", e))??
    };

    Ok(compute_peaks(&buffer, frames_per_pixel.max(1)))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_buffer(frames: usize, value: f32) -> Arc<SampleBuffer> {
        let samples = vec![value; frames * 2]; // interleaved stereo
        Arc::new(SampleBuffer {
            samples,
            sample_rate: 44100,
            original_channels: 2,
            frame_count: frames,
        })
    }

    /// Helper: build a StartClip command with no fades.
    fn start_no_fade(clip_id: &str, buffer: Arc<SampleBuffer>, gain: f32, start_offset: usize) -> ClipCmd {
        let total_frames = buffer.frame_count;
        ClipCmd::StartClip {
            clip_id: clip_id.to_string(),
            buffer,
            gain,
            start_offset,
            total_frames,
            fade_in_frames: 0,
            fade_out_frames: 0,
            fade_in_curve: FadeCurve::Linear,
            fade_out_curve: FadeCurve::Linear,
        }
    }

    #[test]
    fn start_and_process_clip() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let buf = make_buffer(512, 0.5);
        tx.send(start_no_fade("c1", buf, 1.0, 0)).unwrap();

        let mut output = vec![0.0f32; 512]; // 256 stereo frames
        node.process(&mut output, 44100, 2);
        assert!(output.iter().any(|&s| s != 0.0), "Expected non-zero output after StartClip");
    }

    #[test]
    fn stop_clip_silences_output() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let buf = make_buffer(1024, 0.5);
        tx.send(start_no_fade("c1", buf, 1.0, 0)).unwrap();
        tx.send(ClipCmd::StopClip { clip_id: "c1".to_string() }).unwrap();

        let mut output = vec![0.0f32; 512];
        node.process(&mut output, 44100, 2);
        assert!(output.iter().all(|&s| s == 0.0), "Expected silence after StopClip");
    }

    #[test]
    fn gain_applied_to_output() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let buf = make_buffer(512, 1.0);
        tx.send(start_no_fade("c1", buf, 0.5, 0)).unwrap();

        let mut output = vec![0.0f32; 64]; // 32 frames × 2 ch
        node.process(&mut output, 44100, 2);
        assert!((output[0] - 0.5).abs() < 1e-5, "Expected 0.5 with gain=0.5");
    }

    #[test]
    fn start_offset_skips_frames() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let mut samples = vec![0.0f32; 1024 * 2];
        samples[100 * 2] = 0.8;
        samples[100 * 2 + 1] = 0.8;
        let buf = Arc::new(SampleBuffer { samples, sample_rate: 44100, original_channels: 2, frame_count: 1024 });
        tx.send(start_no_fade("c1", buf, 1.0, 100)).unwrap();

        let mut output = vec![0.0f32; 2]; // 1 frame
        node.process(&mut output, 44100, 2);
        assert!((output[0] - 0.8).abs() < 1e-5, "Expected start offset to skip frames");
    }

    #[test]
    fn clip_finishes_when_buffer_exhausted() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let buf = make_buffer(4, 0.5);
        tx.send(start_no_fade("c1", buf, 1.0, 0)).unwrap();

        let mut output = vec![0.0f32; 64];
        node.process(&mut output, 44100, 2);
        assert_eq!(node.playing.len(), 0, "Clip should be removed after buffer exhausted");
    }

    #[test]
    fn multiple_clips_mix() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let buf1 = make_buffer(512, 0.3);
        let buf2 = make_buffer(512, 0.4);
        tx.send(start_no_fade("c1", buf1, 1.0, 0)).unwrap();
        tx.send(start_no_fade("c2", buf2, 1.0, 0)).unwrap();

        let mut output = vec![0.0f32; 64];
        node.process(&mut output, 44100, 2);
        assert!((output[0] - 0.7).abs() < 1e-4, "Expected sum of two clips");
    }

    #[test]
    fn set_gain_updates_playing_clip() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let buf = make_buffer(1024, 1.0);
        tx.send(start_no_fade("c1", buf, 1.0, 0)).unwrap();
        tx.send(ClipCmd::SetGain { clip_id: "c1".to_string(), gain: 0.25 }).unwrap();

        let mut output = vec![0.0f32; 64];
        node.process(&mut output, 44100, 2);
        assert!((output[0] - 0.25).abs() < 1e-4, "Expected gain 0.25");
    }

    #[test]
    fn fade_in_ramps_from_silence() {
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let frames = 1000usize;
        let buf = make_buffer(frames, 1.0);
        let total_frames = buf.frame_count;
        // Set a 500-frame linear fade-in
        tx.send(ClipCmd::StartClip {
            clip_id: "c1".to_string(),
            buffer: buf,
            gain: 1.0,
            start_offset: 0,
            total_frames,
            fade_in_frames: 500,
            fade_out_frames: 0,
            fade_in_curve: FadeCurve::Linear,
            fade_out_curve: FadeCurve::Linear,
        }).unwrap();

        // Process 1 frame at position 0 — should be near silence
        let mut out0 = vec![0.0f32; 2];
        node.process(&mut out0, 44100, 2);
        assert!(out0[0] < 0.01, "Fade-in frame 0 should be near silence, got {}", out0[0]);
    }

    #[test]
    fn fade_out_ramps_to_silence() {
        // Process all 512 frames of a clip that has a 256-frame linear fade-out.
        // Frames 0-255 are at full gain; frames 256-511 fade from 1→0.
        let (mut node, tx) = ClipPlaybackNode::new_pair();
        let frames = 512usize;
        let buf = make_buffer(frames, 1.0);
        let total_frames = buf.frame_count;
        tx.send(ClipCmd::StartClip {
            clip_id: "c1".to_string(),
            buffer: buf,
            gain: 1.0,
            start_offset: 0,
            total_frames,
            fade_in_frames: 0,
            fade_out_frames: 256,
            fade_in_curve: FadeCurve::Linear,
            fade_out_curve: FadeCurve::Linear,
        }).unwrap();

        // Process all 512 frames at once (1024 stereo samples).
        let mut out = vec![0.0f32; 1024];
        node.process(&mut out, 44100, 2);

        // Frame 0 — before any fade, should be gain 1.0 × signal 1.0 = 1.0
        assert!(out[0] > 0.95, "Frame 0 (pre fade-out) should be ~1.0, got {}", out[0]);
        // Frame 511 (out[1022]) — last frame; fade position = remaining=0 → gain≈0
        let last_val = out[1022];
        assert!(last_val < 0.05, "Frame 511 (end of fade-out) should be near silence, got {last_val}");
    }
}
