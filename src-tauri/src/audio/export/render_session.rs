//! Offline renderer that replays `ClipPlaybackNode` behaviour without a real audio device.
//!
//! ## How it works
//!
//! 1. `RenderSession::new` sorts clips by `start_sample`, creates a private
//!    `ClipPlaybackNode` + sender pair, and sends `StartClip` for any clips
//!    whose window overlaps the render start position.
//! 2. `render_block` advances a virtual playhead in steps of `config.block_size`
//!    frames, sending `StartClip` commands just before the block in which each
//!    clip begins, and delegating all mixing to `ClipPlaybackNode::process`.
//! 3. Callers loop until `render_block` returns `false`.

use std::sync::Arc;

use crossbeam_channel::Sender;

use crate::audio::clip_player::{ClipCmd, ClipPlaybackNode};
use crate::audio::fade::{FadeCurve, FadeTables};
use crate::audio::graph::AudioNode;
use crate::instruments::sampler::decoder::SampleBuffer;

// ─── Public types ─────────────────────────────────────────────────────────────

/// All data needed to schedule a single audio clip in the offline renderer.
#[derive(Clone)]
pub struct ExportClipInfo {
    /// Unique clip identifier (used for `ClipCmd::StartClip`).
    pub clip_id: String,
    /// Track the clip belongs to (used for stem splitting).
    pub track_id: String,
    /// Absolute sample position at which the clip should begin playing.
    pub start_sample: u64,
    /// Decoded audio data shared from the live `ClipStore`.
    pub buffer: Arc<SampleBuffer>,
    /// Per-clip gain multiplier (0.0–2.0).
    pub gain: f32,
    /// How many frames to skip at the start of `buffer` (trim-start).
    pub start_offset_frames: usize,
    /// Fade-in length in frames (`0` = no fade).
    pub fade_in_frames: u64,
    /// Fade-out length in frames (`0` = no fade).
    pub fade_out_frames: u64,
    /// Shape of the fade-in ramp.
    pub fade_in_curve: FadeCurve,
    /// Shape of the fade-out ramp.
    pub fade_out_curve: FadeCurve,
}

/// Configuration for a single render pass.
pub struct RenderConfig {
    /// Output sample rate in Hz.
    pub sample_rate: u32,
    /// Number of output channels (1 = mono, 2 = stereo).
    pub channels: u16,
    /// Frames per render block (internal processing granularity).
    pub block_size: usize,
    /// First frame to render (inclusive).
    pub start_sample: u64,
    /// Last frame to render (exclusive — render stops when playhead reaches this).
    pub end_sample: u64,
    /// Clips to include in the render.  Will be sorted by `start_sample`.
    pub clips: Vec<ExportClipInfo>,
    /// Master output gain applied to every rendered sample.
    pub master_gain: f32,
}

// ─── RenderSession ────────────────────────────────────────────────────────────

/// Stateful offline render engine.  Drive it by calling `render_block` in a loop.
pub struct RenderSession {
    config: RenderConfig,
    node: ClipPlaybackNode,
    _tx: Arc<Sender<ClipCmd>>,
    /// Next index into `config.clips` that has not yet been scheduled.
    pending_idx: usize,
    /// Virtual playhead — frame number of the *start* of the next block.
    current_sample: u64,
}

impl RenderSession {
    /// Creates a new render session.
    ///
    /// Clips are sorted by `start_sample`.  Any clip that has already started
    /// before `start_sample` is scheduled immediately with a compensated
    /// `start_offset` so playback begins at the right position.
    pub fn new(mut config: RenderConfig) -> Self {
        // Sort clips so we can dispatch them in order.
        config.clips.sort_by_key(|c| c.start_sample);

        let fade_tables = Arc::new(FadeTables::new());
        let (node, tx) = ClipPlaybackNode::new_pair_with_tables(fade_tables);

        let current_sample = config.start_sample;
        let mut session = Self {
            config,
            node,
            _tx: tx,
            pending_idx: 0,
            current_sample,
        };

        // Pre-schedule clips that started before the render start position.
        session.schedule_clips_up_to(current_sample + 1);

        session
    }

    /// Renders one block of audio into `output`.
    ///
    /// `output` must have length `>= block_size * channels`.  The method will
    /// only write `actual_frames * channels` samples (the rest are left zeroed).
    ///
    /// Returns `true` if there are more frames to render, `false` when done.
    pub fn render_block(&mut self, output: &mut [f32]) -> bool {
        let ch = self.config.channels as usize;
        let max_block_frames = output.len() / ch;

        // Clamp to the remaining region.
        let remaining = self.config.end_sample.saturating_sub(self.current_sample);
        if remaining == 0 {
            return false;
        }

        let block_frames = max_block_frames.min(remaining as usize);
        let block_end = self.current_sample + block_frames as u64;

        // Schedule clips that start within this block.
        self.schedule_clips_up_to(block_end);

        // Zero the working slice (clips mix additively).
        let work = &mut output[..block_frames * ch];
        for s in work.iter_mut() {
            *s = 0.0;
        }

        // Mix all active clips into the work slice.
        self.node.process(work, self.config.sample_rate, self.config.channels);

        // Apply master gain.
        let gain = self.config.master_gain;
        if (gain - 1.0).abs() > f32::EPSILON {
            for s in work.iter_mut() {
                *s *= gain;
            }
        }

        self.current_sample = block_end;
        self.current_sample < self.config.end_sample
    }

    /// Total frames to render.
    pub fn total_frames(&self) -> u64 {
        self.config.end_sample.saturating_sub(self.config.start_sample)
    }

    /// Frames rendered so far.
    pub fn frames_rendered(&self) -> u64 {
        self.current_sample.saturating_sub(self.config.start_sample)
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /// Sends `StartClip` for every clip whose `start_sample < end_exclusive`.
    fn schedule_clips_up_to(&mut self, end_exclusive: u64) {
        while self.pending_idx < self.config.clips.len() {
            let clip = &self.config.clips[self.pending_idx];
            if clip.start_sample >= end_exclusive {
                break;
            }

            // Compute how many frames into the clip we should start (compensate
            // for clips that began before the current render window).
            let frames_already_played = if self.current_sample > clip.start_sample {
                (self.current_sample - clip.start_sample) as usize
            } else {
                0
            };
            let start_offset = clip.start_offset_frames + frames_already_played;

            let total_frames = clip.buffer.frame_count;
            // Skip if we're already past the end of this clip.
            if start_offset >= total_frames {
                self.pending_idx += 1;
                continue;
            }

            let cmd = ClipCmd::StartClip {
                clip_id:          clip.clip_id.clone(),
                buffer:           Arc::clone(&clip.buffer),
                gain:             clip.gain,
                start_offset,
                total_frames,
                fade_in_frames:   clip.fade_in_frames,
                fade_out_frames:  clip.fade_out_frames,
                fade_in_curve:    clip.fade_in_curve,
                fade_out_curve:   clip.fade_out_curve,
            };

            // Unbounded channel — never blocks.  If the send fails (impossible
            // here since we own both ends) we just log and continue.
            if let Err(e) = self._tx.send(cmd) {
                log::warn!("RenderSession: failed to send StartClip: {}", e);
            }

            self.pending_idx += 1;
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn silence_buffer(frames: usize, channels: u16) -> Arc<SampleBuffer> {
        Arc::new(SampleBuffer {
            samples:           vec![0.0f32; frames * channels as usize],
            sample_rate:       44100,
            original_channels: channels,
            frame_count:       frames,
        })
    }

    fn tone_buffer(frames: usize, value: f32) -> Arc<SampleBuffer> {
        // Always interleaved stereo (two channels), matching ClipPlaybackNode's assumption.
        Arc::new(SampleBuffer {
            samples:           vec![value; frames * 2],
            sample_rate:       44100,
            original_channels: 2,
            frame_count:       frames,
        })
    }

    fn make_config(clips: Vec<ExportClipInfo>, end_sample: u64) -> RenderConfig {
        RenderConfig {
            sample_rate:  44100,
            channels:     2,
            block_size:   512,
            start_sample: 0,
            end_sample,
            clips,
            master_gain:  1.0,
        }
    }

    // ── Test: empty clip list produces all-silence ──────────────────────────

    #[test]
    fn render_session_empty_produces_silence() {
        let config = make_config(vec![], 1024);
        let mut session = RenderSession::new(config);
        let mut buf = vec![0.0f32; 1024 * 2];
        session.render_block(&mut buf);
        assert!(
            buf.iter().all(|&s| s == 0.0),
            "Expected silence for empty clip list"
        );
    }

    // ── Test: playhead advances each block ──────────────────────────────────

    #[test]
    fn render_session_advances_position() {
        let config = make_config(vec![], 2048);
        let mut session = RenderSession::new(config);

        assert_eq!(session.frames_rendered(), 0);

        let mut buf = vec![0.0f32; 512 * 2];
        session.render_block(&mut buf);
        assert_eq!(session.frames_rendered(), 512);

        session.render_block(&mut buf);
        assert_eq!(session.frames_rendered(), 1024);
    }

    // ── Test: returns false when done ────────────────────────────────────────

    #[test]
    fn render_session_returns_false_when_done() {
        let config = make_config(vec![], 512);
        let mut session = RenderSession::new(config);
        let mut buf = vec![0.0f32; 512 * 2];
        let more = session.render_block(&mut buf);
        assert!(!more, "Should return false after rendering all frames");
    }

    // ── Test: render_block returns true while frames remain ─────────────────

    #[test]
    fn render_session_returns_true_while_more_frames() {
        let config = make_config(vec![], 2048);
        let mut session = RenderSession::new(config);
        let mut buf = vec![0.0f32; 512 * 2];
        let more = session.render_block(&mut buf);
        assert!(more, "Should return true when frames remain");
    }

    // ── Test: clip scheduled at correct block ────────────────────────────────

    #[test]
    fn clip_scheduled_at_correct_block() {
        // Clip starts at sample 1024.  First block [0, 512] should produce silence;
        // second block [512, 1024] should also be silence; third block [1024, 1536] should have audio.
        let buf = tone_buffer(2048, 0.5);
        let clips = vec![ExportClipInfo {
            clip_id:             "c1".to_string(),
            track_id:            "t1".to_string(),
            start_sample:        1024,
            buffer:              buf,
            gain:                1.0,
            start_offset_frames: 0,
            fade_in_frames:      0,
            fade_out_frames:     0,
            fade_in_curve:       FadeCurve::Linear,
            fade_out_curve:      FadeCurve::Linear,
        }];
        let config = make_config(clips, 4096);
        let mut session = RenderSession::new(config);

        // Block 1: [0, 512] — silence
        let mut b1 = vec![0.0f32; 512 * 2];
        session.render_block(&mut b1);
        assert!(b1.iter().all(|&s| s == 0.0), "Block [0,512] should be silent");

        // Block 2: [512, 1024] — still silent
        let mut b2 = vec![0.0f32; 512 * 2];
        session.render_block(&mut b2);
        assert!(b2.iter().all(|&s| s == 0.0), "Block [512,1024] should be silent");

        // Block 3: [1024, 1536] — should have audio
        let mut b3 = vec![0.0f32; 512 * 2];
        session.render_block(&mut b3);
        assert!(
            b3.iter().any(|&s| s != 0.0),
            "Block [1024,1536] should contain audio"
        );
    }

    // ── Test: silence clip produces silence ──────────────────────────────────

    #[test]
    fn silence_clip_produces_silence() {
        let buf = silence_buffer(1024, 2);
        let clips = vec![ExportClipInfo {
            clip_id:             "c1".to_string(),
            track_id:            "t1".to_string(),
            start_sample:        0,
            buffer:              buf,
            gain:                1.0,
            start_offset_frames: 0,
            fade_in_frames:      0,
            fade_out_frames:     0,
            fade_in_curve:       FadeCurve::Linear,
            fade_out_curve:      FadeCurve::Linear,
        }];
        let config = make_config(clips, 1024);
        let mut session = RenderSession::new(config);
        let mut buf = vec![0.0f32; 1024 * 2];
        session.render_block(&mut buf);
        assert!(buf.iter().all(|&s| s == 0.0), "Silent clip should produce silence");
    }

    // ── Test: master gain is applied ─────────────────────────────────────────

    #[test]
    fn master_gain_applied() {
        let buf = tone_buffer(1024, 1.0);
        let clips = vec![ExportClipInfo {
            clip_id:             "c1".to_string(),
            track_id:            "t1".to_string(),
            start_sample:        0,
            buffer:              buf,
            gain:                1.0,
            start_offset_frames: 0,
            fade_in_frames:      0,
            fade_out_frames:     0,
            fade_in_curve:       FadeCurve::Linear,
            fade_out_curve:      FadeCurve::Linear,
        }];
        let mut config = make_config(clips, 1024);
        config.master_gain = 0.5;
        let mut session = RenderSession::new(config);
        let mut buf = vec![0.0f32; 32 * 2]; // just one small block
        session.render_block(&mut buf);
        // All samples should be ~0.5 (gain=1.0, signal=1.0, master=0.5)
        for &s in &buf {
            assert!((s - 0.5).abs() < 1e-4, "Expected 0.5 with master_gain=0.5, got {s}");
        }
    }
}
