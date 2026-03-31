use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use atomic_float::AtomicF32;

use crate::effects::sidechain::SidechainTap;

/// Pre-allocated scratch capacity for the sidechain tap write buffer.
const TAP_SCRATCH_CAPACITY: usize = 4096 * 2; // 4096 stereo frames

/// A single mixer channel strip.
///
/// Holds all per-channel parameters as atomics so the audio thread can read
/// them without locking. Parameter mutations happen from Tauri commands on
/// the command thread.
pub struct MixerChannel {
    pub id: String,
    pub name: String,

    /// Volume fader, range 0.0–2.0, unity at 1.0.
    pub fader: Arc<AtomicF32>,
    /// Stereo pan, range -1.0 (full left) to +1.0 (full right).
    pub pan: Arc<AtomicF32>,
    /// Mute flag. When true, channel output is silenced.
    pub mute: Arc<AtomicBool>,
    /// Solo flag. When any channel is soloed, all non-soloed channels are silenced.
    pub solo: Arc<AtomicBool>,
    /// Send levels for each of the 4 aux buses, range 0.0–1.0.
    pub sends: [Arc<AtomicF32>; 4],

    /// Latest peak level for the left channel (updated each audio buffer).
    pub peak_l: Arc<AtomicF32>,
    /// Latest peak level for the right channel (updated each audio buffer).
    pub peak_r: Arc<AtomicF32>,

    /// Sidechain tap: post-fader output written here each callback so that
    /// downstream compressors can use this channel as a sidechain source.
    pub sidechain_tap: Option<Arc<SidechainTap>>,
    /// Pre-allocated scratch buffer for building the tap write data.
    /// Capacity = TAP_SCRATCH_CAPACITY; no allocation on the audio thread.
    tap_scratch: Vec<f32>,
}

impl MixerChannel {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            fader: Arc::new(AtomicF32::new(1.0)),
            pan: Arc::new(AtomicF32::new(0.0)),
            mute: Arc::new(AtomicBool::new(false)),
            solo: Arc::new(AtomicBool::new(false)),
            sends: [
                Arc::new(AtomicF32::new(0.0)),
                Arc::new(AtomicF32::new(0.0)),
                Arc::new(AtomicF32::new(0.0)),
                Arc::new(AtomicF32::new(0.0)),
            ],
            peak_l: Arc::new(AtomicF32::new(0.0)),
            peak_r: Arc::new(AtomicF32::new(0.0)),
            sidechain_tap: None,
            tap_scratch: vec![0.0; TAP_SCRATCH_CAPACITY],
        }
    }

    /// Process this channel into `output` (stereo interleaved) and accumulate
    /// send signals into `send_bufs`.
    ///
    /// `source` is stereo interleaved PCM from the instrument. If silent/empty
    /// (Sprint 17: no instrument audio wired yet), pass a zero-filled slice.
    ///
    /// `solo_any` — true if any channel in the mixer has solo enabled.
    pub fn process_into(
        &mut self,
        source: &[f32],
        output: &mut [f32],
        send_bufs: &mut [Vec<f32>],
        solo_any: bool,
    ) {
        let frame_count = output.len() / 2;
        let muted = self.mute.load(Ordering::Relaxed);
        let soloed = self.solo.load(Ordering::Relaxed);
        let silent = muted || (solo_any && !soloed);

        if silent {
            self.peak_l.store(0.0, Ordering::Relaxed);
            self.peak_r.store(0.0, Ordering::Relaxed);
            // Write zeros to sidechain tap so downstream compressors see silence.
            if let Some(tap) = &self.sidechain_tap {
                let n = (frame_count * 2).min(self.tap_scratch.len());
                for s in &mut self.tap_scratch[..n] { *s = 0.0; }
                // SAFETY: single-threaded audio callback; source channel processed
                // before any destination compressor in the same callback.
                unsafe { tap.write(&self.tap_scratch[..n]); }
            }
            return;
        }

        let fader = self.fader.load(Ordering::Relaxed);
        let pan = self.pan.load(Ordering::Relaxed);

        // Equal-power pan law: map pan -1..+1 → angle 0..π/2
        let angle = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
        let gain_l = angle.cos() * fader;
        let gain_r = angle.sin() * fader;

        let mut peak_l = 0.0f32;
        let mut peak_r = 0.0f32;
        let write_tap = self.sidechain_tap.is_some();

        for i in 0..frame_count {
            let src_l = if source.len() > i * 2 { source[i * 2] } else { 0.0 };
            let src_r = if source.len() > i * 2 + 1 { source[i * 2 + 1] } else { 0.0 };

            let out_l = src_l * gain_l;
            let out_r = src_r * gain_r;

            output[i * 2] += out_l;
            output[i * 2 + 1] += out_r;

            peak_l = peak_l.max(out_l.abs());
            peak_r = peak_r.max(out_r.abs());

            // Record post-fader output for the sidechain tap.
            if write_tap && i * 2 + 1 < self.tap_scratch.len() {
                self.tap_scratch[i * 2] = out_l;
                self.tap_scratch[i * 2 + 1] = out_r;
            }
        }

        self.peak_l.store(peak_l, Ordering::Relaxed);
        self.peak_r.store(peak_r, Ordering::Relaxed);

        // Flush post-fader buffer to sidechain tap.
        if let Some(tap) = &self.sidechain_tap {
            let n = (frame_count * 2).min(self.tap_scratch.len());
            // SAFETY: single-threaded audio callback; source channel processed
            // before any destination compressor in the same callback.
            unsafe { tap.write(&self.tap_scratch[..n]); }
        }

        // Route to send buses
        for (bus_idx, send_buf) in send_bufs.iter_mut().enumerate() {
            let send_level = self.sends[bus_idx].load(Ordering::Relaxed);
            if send_level > 0.0 && send_buf.len() >= output.len() {
                for i in 0..frame_count {
                    let src_l = if source.len() > i * 2 { source[i * 2] } else { 0.0 };
                    let src_r = if source.len() > i * 2 + 1 { source[i * 2 + 1] } else { 0.0 };
                    send_buf[i * 2] += src_l * fader * send_level;
                    send_buf[i * 2 + 1] += src_r * fader * send_level;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_stereo_buf(n_frames: usize, val: f32) -> Vec<f32> {
        vec![val; n_frames * 2]
    }

    #[test]
    fn test_pan_law_center() {
        let mut ch = MixerChannel::new("1", "Test");
        ch.pan.store(0.0, Ordering::Relaxed);
        let src = make_stereo_buf(8, 1.0);
        let mut out = vec![0.0f32; 16];
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, false);
        let gain = std::f32::consts::FRAC_PI_4.cos();
        for i in 0..8 {
            assert!((out[i * 2] - gain).abs() < 1e-4, "L at center");
            assert!((out[i * 2 + 1] - gain).abs() < 1e-4, "R at center");
        }
    }

    #[test]
    fn test_pan_law_hard_left() {
        let mut ch = MixerChannel::new("1", "Test");
        ch.pan.store(-1.0, Ordering::Relaxed);
        let src = make_stereo_buf(8, 1.0);
        let mut out = vec![0.0f32; 16];
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, false);
        for i in 0..8 {
            assert!(out[i * 2] > 0.99, "L should be ~1.0 hard left");
            assert!(out[i * 2 + 1].abs() < 1e-4, "R should be ~0.0 hard left");
        }
    }

    #[test]
    fn test_pan_law_hard_right() {
        let mut ch = MixerChannel::new("1", "Test");
        ch.pan.store(1.0, Ordering::Relaxed);
        let src = make_stereo_buf(8, 1.0);
        let mut out = vec![0.0f32; 16];
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, false);
        for i in 0..8 {
            assert!(out[i * 2].abs() < 1e-4, "L should be ~0.0 hard right");
            assert!(out[i * 2 + 1] > 0.99, "R should be ~1.0 hard right");
        }
    }

    #[test]
    fn test_fader_zero_silences() {
        let mut ch = MixerChannel::new("1", "Test");
        ch.fader.store(0.0, Ordering::Relaxed);
        let src = make_stereo_buf(8, 1.0);
        let mut out = vec![0.0f32; 16];
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, false);
        assert!(out.iter().all(|&s| s.abs() < 1e-6));
    }

    #[test]
    fn test_mute_silences() {
        let mut ch = MixerChannel::new("1", "Test");
        ch.mute.store(true, Ordering::Relaxed);
        let src = make_stereo_buf(8, 1.0);
        let mut out = vec![0.0f32; 16];
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, false);
        assert!(out.iter().all(|&s| s.abs() < 1e-6));
    }

    #[test]
    fn test_solo_any_silences_non_soloed() {
        let mut ch = MixerChannel::new("1", "Test");
        // solo_any = true but this channel is NOT soloed
        let src = make_stereo_buf(8, 1.0);
        let mut out = vec![0.0f32; 16];
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, true);
        assert!(out.iter().all(|&s| s.abs() < 1e-6));
    }

    #[test]
    fn test_solo_passes_soloed_channel() {
        let mut ch = MixerChannel::new("1", "Test");
        ch.solo.store(true, Ordering::Relaxed);
        let src = make_stereo_buf(8, 1.0);
        let mut out = vec![0.0f32; 16];
        let mut send_bufs = vec![vec![0.0f32; 16]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, true);
        // Should NOT be silent
        assert!(out.iter().any(|&s| s.abs() > 0.1));
    }

    #[test]
    fn test_send_accumulates() {
        let mut ch = MixerChannel::new("1", "Test");
        ch.sends[0].store(0.5, Ordering::Relaxed);
        let src = make_stereo_buf(4, 1.0);
        let mut out = vec![0.0f32; 8];
        let mut send_bufs = vec![vec![0.0f32; 8]; 4];
        ch.process_into(&src, &mut out, &mut send_bufs, false);
        // Bus 0 should have ~0.5 signal
        assert!(send_bufs[0][0] > 0.4 && send_bufs[0][0] < 0.6);
        // Bus 1 should be silent (send[1] = 0.0)
        assert!(send_bufs[1][0].abs() < 1e-6);
    }
}
