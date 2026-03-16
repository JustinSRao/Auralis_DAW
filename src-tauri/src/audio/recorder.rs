use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use atomic_float::AtomicF32;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Stream;
use crossbeam_channel::{bounded, Receiver, Sender};
use ringbuf::{HeapConsumer, HeapProducer, HeapRb};

/// Audio recorder state constant: not recording.
pub const REC_IDLE: u8 = 0;
/// Audio recorder state constant: actively capturing from input device.
pub const REC_RECORDING: u8 = 1;
/// Audio recorder state constant: input stopped, disk write in progress.
pub const REC_FINALIZING: u8 = 2;

/// Type alias for the `AudioRecorder` wrapped in `Arc<Mutex<>>` for Tauri managed state.
pub type AudioRecorderState = std::sync::Arc<std::sync::Mutex<AudioRecorder>>;

/// Atomics exposed to the audio thread for lock-free reads.
///
/// All fields are `Arc`-wrapped so both the main thread and input callback
/// can share them without crossing the `Mutex` boundary.
pub struct RecorderAtomics {
    /// Current recorder state (REC_IDLE / REC_RECORDING / REC_FINALIZING).
    pub state: Arc<AtomicU8>,
    /// Latest computed RMS level of the input signal (0.0–1.0).
    pub rms_level: Arc<AtomicF32>,
    /// Whether input monitoring pass-through is active.
    pub monitoring_enabled: Arc<AtomicBool>,
    /// Monitoring output gain (0.0–1.0).
    pub monitoring_gain: Arc<AtomicF32>,
}

/// Snapshot of recorder state returned to the frontend via IPC.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct RecorderStatus {
    /// Human-readable state: "idle", "recording", or "finalizing".
    pub state: String,
    /// Name of the selected input device, or `None` for the system default.
    pub input_device: Option<String>,
    /// Path of the WAV file being written, or `None` when idle.
    pub output_path: Option<String>,
    /// Whether input monitoring pass-through is active.
    pub monitoring_enabled: bool,
    /// Current monitoring gain (0.0–1.0).
    pub monitoring_gain: f32,
}

/// Live audio recorder.
///
/// Captures audio from a WASAPI input device and writes it to a temporary WAV
/// file on a background Tokio task. Optionally routes input audio to the output
/// mix for zero-latency monitoring.
///
/// # State machine
/// `Idle → Recording → Finalizing → Idle`
///
/// `start_recording` transitions Idle → Recording.
/// `stop_recording` transitions Recording → Finalizing.
/// The disk write task transitions Finalizing → Idle when the WAV is complete.
pub struct AudioRecorder {
    /// Name of the preferred input device. `None` = system default.
    input_device: Option<String>,
    /// Sample rate used for both the input stream and the WAV file header.
    sample_rate: u32,
    /// Active cpal input stream. `None` when idle.
    stream: Option<Stream>,
    /// One-shot sender: sending signals the disk write task to flush and finalize.
    stop_tx: Option<Sender<()>>,
    /// Path of the WAV file currently being written.
    output_path: Option<std::path::PathBuf>,
    /// Shared atomics for lock-free reads from the audio thread.
    pub atomics: Arc<RecorderAtomics>,
    /// Sender side of the RMS channel. Sent from the input callback.
    rms_tx: Sender<f32>,
    /// One-shot channel: after `start_recording()`, the monitoring `HeapConsumer` is
    /// available here for `AudioEngine` to pick up via `try_recv()`.
    pub monitoring_cons_rx: Receiver<HeapConsumer<f32>>,
    /// Paired sender — used once inside `start_recording` to ship the consumer.
    monitoring_cons_tx: Sender<HeapConsumer<f32>>,
}

impl AudioRecorder {
    /// Creates a new `AudioRecorder` in the idle state.
    ///
    /// Returns `(recorder, rms_rx)` where `rms_rx` is the receive end of the
    /// RMS channel.  The caller should poll this at ~30 Hz and emit
    /// `"input-level-changed"` Tauri events.
    pub fn new(sample_rate: u32) -> (Self, Receiver<f32>) {
        let (rms_tx, rms_rx) = bounded::<f32>(64);
        let (monitoring_cons_tx, monitoring_cons_rx) = bounded::<HeapConsumer<f32>>(1);

        let atomics = Arc::new(RecorderAtomics {
            state: Arc::new(AtomicU8::new(REC_IDLE)),
            rms_level: Arc::new(AtomicF32::new(0.0)),
            monitoring_enabled: Arc::new(AtomicBool::new(false)),
            monitoring_gain: Arc::new(AtomicF32::new(1.0)),
        });

        let recorder = Self {
            input_device: None,
            sample_rate,
            stream: None,
            stop_tx: None,
            output_path: None,
            atomics,
            rms_tx,
            monitoring_cons_rx,
            monitoring_cons_tx,
        };

        (recorder, rms_rx)
    }

    /// Sets the preferred input device by name.
    ///
    /// Takes effect the next time `start_recording` is called.
    pub fn set_input_device(&mut self, name: &str) {
        self.input_device = Some(name.to_string());
    }

    /// Returns a status snapshot suitable for IPC serialization.
    pub fn status(&self) -> RecorderStatus {
        let state_u8 = self.atomics.state.load(Ordering::Relaxed);
        let state_str = match state_u8 {
            REC_IDLE => "idle",
            REC_RECORDING => "recording",
            REC_FINALIZING => "finalizing",
            _ => "idle",
        };
        RecorderStatus {
            state: state_str.to_string(),
            input_device: self.input_device.clone(),
            output_path: self
                .output_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            monitoring_enabled: self
                .atomics
                .monitoring_enabled
                .load(Ordering::Relaxed),
            monitoring_gain: self.atomics.monitoring_gain.load(Ordering::Relaxed),
        }
    }

    /// Enables or disables input monitoring pass-through.
    ///
    /// Lock-free — writes to a shared `AtomicBool`.
    pub fn set_monitoring_enabled(&self, enabled: bool) {
        self.atomics
            .monitoring_enabled
            .store(enabled, Ordering::Relaxed);
    }

    /// Sets monitoring gain. Clamped to `[0.0, 1.0]`.
    ///
    /// Lock-free — writes to a shared `AtomicF32`.
    pub fn set_monitoring_gain(&self, gain: f32) {
        let clamped = gain.clamp(0.0, 1.0);
        self.atomics
            .monitoring_gain
            .store(clamped, Ordering::Relaxed);
    }

    /// Opens the input stream and starts writing audio to a temporary WAV file.
    ///
    /// Returns the output path. Transitions state from `Idle` → `Recording`.
    ///
    /// Always uses the WASAPI host for input. ASIO does not support simultaneous
    /// separate input and output streams via cpal.
    pub fn start_recording(
        &mut self,
        app_handle: tauri::AppHandle,
    ) -> Result<std::path::PathBuf> {
        let current = self.atomics.state.load(Ordering::Relaxed);
        if current != REC_IDLE {
            bail!(
                "Cannot start recording: current state is '{}'",
                match current {
                    REC_RECORDING => "recording",
                    REC_FINALIZING => "finalizing",
                    _ => "unknown",
                }
            );
        }

        // Generate a unique temp file path
        let path = std::env::temp_dir()
            .join(format!("rec_{}.wav", uuid::Uuid::new_v4()));

        // Always use WASAPI for input (ASIO single-stream limitation)
        let host = cpal::default_host();

        // Resolve input device
        let device = if let Some(ref name) = self.input_device {
            super::devices::find_input_device(name)
                .with_context(|| format!("Could not find input device '{}'", name))?
        } else {
            host.default_input_device()
                .context("No default input device available")?
        };

        let config = cpal::StreamConfig {
            channels: 2,
            sample_rate: cpal::SampleRate(self.sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        // Recording ring: large buffer — up to ~370 ms at 44100 Hz stereo
        let (mut rec_prod, rec_cons) = HeapRb::<f32>::new(65536 * 2).split();

        // Monitoring ring: small latency buffer
        let (mut mon_prod, mon_cons) = HeapRb::<f32>::new(4096).split();

        // Drain any stale consumer from a previous session before sending the new
        // one — the channel is bounded(1) so a leftover consumer would silently
        // drop the new one, breaking monitoring for this session.
        let _ = self.monitoring_cons_rx.try_recv();
        let _ = self.monitoring_cons_tx.try_send(mon_cons);

        // Clone atomics for the input closure
        let rms_tx = self.rms_tx.clone();
        let monitoring_enabled = self.atomics.monitoring_enabled.clone();
        let monitoring_gain = self.atomics.monitoring_gain.clone();
        let rms_level = self.atomics.rms_level.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    input_callback(
                        data,
                        &mut rec_prod,
                        &mut mon_prod,
                        &rms_tx,
                        &monitoring_enabled,
                        &monitoring_gain,
                        &rms_level,
                    );
                },
                move |err| {
                    log::error!("Audio input stream error: {}", err);
                },
                None,
            )
            .context("Failed to build input stream")?;

        stream.play().context("Failed to start input stream")?;

        // Signal channel for disk write task
        let (stop_tx, stop_rx) = bounded::<()>(1);

        // Spawn disk write task
        tokio::task::spawn(disk_write_task(
            rec_cons,
            stop_rx,
            path.clone(),
            self.sample_rate,
            self.atomics.state.clone(),
            app_handle,
        ));

        self.stream = Some(stream);
        self.stop_tx = Some(stop_tx);
        self.output_path = Some(path.clone());
        self.atomics.state.store(REC_RECORDING, Ordering::Release);

        log::info!("Recording started: {:?}", path);
        Ok(path)
    }

    /// Stops the input stream and signals the disk task to flush and finalize the WAV.
    ///
    /// Transitions state from `Recording` → `Finalizing`. The state returns to
    /// `Idle` when the disk task completes.
    pub fn stop_recording(&mut self) -> Result<std::path::PathBuf> {
        let current = self.atomics.state.load(Ordering::Relaxed);
        if current != REC_RECORDING {
            bail!(
                "Cannot stop recording: current state is '{}'",
                match current {
                    REC_IDLE => "idle",
                    REC_FINALIZING => "finalizing",
                    _ => "unknown",
                }
            );
        }

        // Signal the disk task to flush remaining samples and finalize
        let _ = self.stop_tx.take().map(|tx| tx.try_send(()));

        // Drop the input stream — stops the callback
        self.stream = None;

        self.atomics.state.store(REC_FINALIZING, Ordering::Release);

        let path = self
            .output_path
            .clone()
            .context("output_path not set during recording — internal error")?;

        log::info!("Recording stopped, finalizing: {:?}", path);
        Ok(path)
    }
}

// Safety: On Windows, cpal::Stream is safe to move between threads.
// AudioRecorder is only ever accessed through a Mutex.
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

/// Input callback: runs on cpal's audio thread.
///
/// Pushes raw samples into the recording ring and, when monitoring is active,
/// into the monitoring ring as well. Computes and broadcasts the RMS level.
///
/// Must NEVER allocate, block, or use mutexes.
fn input_callback(
    data: &[f32],
    rec_prod: &mut HeapProducer<f32>,
    mon_prod: &mut HeapProducer<f32>,
    rms_tx: &Sender<f32>,
    monitoring_enabled: &Arc<AtomicBool>,
    monitoring_gain: &Arc<AtomicF32>,
    rms_level: &Arc<AtomicF32>,
) {
    // Push to recording ring — overflow dropped silently
    let _ = rec_prod.push_slice(data);

    // Compute and broadcast RMS
    let rms = compute_rms(data);
    rms_level.store(rms, Ordering::Relaxed);
    let _ = rms_tx.try_send(rms);

    // Push to monitoring ring if enabled — bulk push via stack buffer to
    // avoid per-sample function call overhead on the audio thread.
    if monitoring_enabled.load(Ordering::Relaxed) {
        let gain = monitoring_gain.load(Ordering::Relaxed);
        // Stack buffer large enough for any typical buffer size (256–1024 stereo frames).
        let mut tmp = [0.0f32; 2048];
        let len = data.len().min(tmp.len());
        for (dst, &src) in tmp[..len].iter_mut().zip(data.iter()) {
            *dst = src * gain;
        }
        let _ = mon_prod.push_slice(&tmp[..len]);
    }
}

/// Computes the root-mean-square level of a slice of audio samples.
///
/// Returns `0.0` for an empty slice.
pub fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Async task that drains the recording ring buffer and writes samples to disk.
///
/// Runs on Tokio's thread pool. Finalizes the WAV header when a stop
/// signal is received, then transitions the recorder state back to idle.
async fn disk_write_task(
    mut rec_cons: HeapConsumer<f32>,
    stop_rx: Receiver<()>,
    path: std::path::PathBuf,
    sample_rate: u32,
    state: Arc<AtomicU8>,
    app_handle: tauri::AppHandle,
) {
    use hound::{SampleFormat, WavSpec, WavWriter};

    let spec = WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    };

    let mut writer = match WavWriter::create(&path, spec) {
        Ok(w) => w,
        Err(e) => {
            log::error!("Failed to create WavWriter: {}", e);
            state.store(REC_IDLE, Ordering::Release);
            return;
        }
    };

    // Pre-allocated scratch buffer reused every iteration — no alloc in loop
    let mut scratch = vec![0.0f32; 4096];

    loop {
        // Drain ring buffer into writer
        loop {
            let n = rec_cons.pop_slice(&mut scratch);
            if n == 0 {
                break;
            }
            for &s in &scratch[..n] {
                if let Err(e) = writer.write_sample(s) {
                    log::error!("WavWriter write error: {}", e);
                    state.store(REC_IDLE, Ordering::Release);
                    return;
                }
            }
        }

        // Check for stop signal
        if stop_rx.try_recv().is_ok() {
            // Final drain: capture samples produced while stream was still running.
            // Log and abort on write error so finalize() also fails, giving the
            // user a clear indication that the WAV file may be truncated.
            'drain: loop {
                let n = rec_cons.pop_slice(&mut scratch);
                if n == 0 {
                    break;
                }
                for &s in &scratch[..n] {
                    if let Err(e) = writer.write_sample(s) {
                        log::error!("WavWriter write error during final drain: {}", e);
                        break 'drain;
                    }
                }
            }
            break;
        }

        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    // Finalize WAV header
    let path_str = path.to_string_lossy().to_string();
    match writer.finalize() {
        Ok(()) => {
            log::info!("Recording finalized: {}", path_str);
            let _ = tauri::Emitter::emit(&app_handle, "recording-finalized", path_str);
        }
        Err(e) => {
            log::error!("WavWriter finalize error: {}", e);
        }
    }

    state.store(REC_IDLE, Ordering::Release);
}

/// Applies a linear fade-in ramp to the first `fade_frames` samples.
///
/// Each sample is scaled from `0.0` (at index 0) up to `1.0` (at index
/// `fade_frames - 1`). If `fade_frames` is `0` or larger than
/// `samples.len()`, the entire slice is faded.
pub fn apply_fade_in(samples: &mut [f32], fade_frames: usize) {
    let len = samples.len();
    if len == 0 {
        return;
    }
    let frames = if fade_frames == 0 || fade_frames > len {
        len
    } else {
        fade_frames
    };
    for (i, s) in samples[..frames].iter_mut().enumerate() {
        *s *= i as f32 / frames as f32;
    }
}

/// Applies a linear fade-out ramp to the last `fade_frames` samples.
///
/// The last sample in the fade region is scaled to `0.0`. If `fade_frames`
/// is `0` or larger than `samples.len()`, the entire slice is faded.
pub fn apply_fade_out(samples: &mut [f32], fade_frames: usize) {
    let len = samples.len();
    if len == 0 {
        return;
    }
    let frames = if fade_frames == 0 || fade_frames > len {
        len
    } else {
        fade_frames
    };
    let start = len - frames;
    for (i, s) in samples[start..].iter_mut().enumerate() {
        *s *= 1.0 - ((i + 1) as f32 / frames as f32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_rms_silence() {
        assert_eq!(compute_rms(&[0.0; 256]), 0.0);
    }

    #[test]
    fn test_compute_rms_empty() {
        assert_eq!(compute_rms(&[]), 0.0);
    }

    #[test]
    fn test_compute_rms_full_scale() {
        let rms = compute_rms(&[1.0f32; 256]);
        assert!(
            (rms - 1.0).abs() < 1e-6,
            "Full scale should give RMS=1.0, got {}",
            rms
        );
    }

    #[test]
    fn test_compute_rms_sine() {
        // 440 Hz sine at unit amplitude — RMS should be 1/sqrt(2) ≈ 0.7071
        let samples: Vec<f32> = (0..4096)
            .map(|n| (2.0 * std::f32::consts::PI * 440.0 * n as f32 / 44100.0).sin())
            .collect();
        let rms = compute_rms(&samples);
        let expected = 1.0_f32 / 2.0_f32.sqrt();
        assert!(
            (rms - expected).abs() < 0.01,
            "Sine RMS should be ~0.707, got {}",
            rms
        );
    }

    #[test]
    fn test_recorder_new_starts_idle() {
        let (recorder, _rms_rx) = AudioRecorder::new(44100);
        assert_eq!(recorder.atomics.state.load(Ordering::Relaxed), REC_IDLE);
        assert!(recorder.input_device.is_none());
        assert!(recorder.output_path.is_none());
    }

    #[test]
    fn test_set_input_device() {
        let (mut recorder, _) = AudioRecorder::new(44100);
        recorder.set_input_device("Microphone (USB)");
        assert_eq!(
            recorder.input_device.as_deref(),
            Some("Microphone (USB)")
        );
    }

    #[test]
    fn test_stop_when_idle_returns_error() {
        let (mut recorder, _) = AudioRecorder::new(44100);
        let result = recorder.stop_recording();
        assert!(result.is_err(), "stop_recording on idle should return Err");
    }

    #[test]
    fn test_monitoring_enabled_toggle() {
        let (recorder, _) = AudioRecorder::new(44100);
        recorder.set_monitoring_enabled(true);
        assert!(recorder.atomics.monitoring_enabled.load(Ordering::Relaxed));
        recorder.set_monitoring_enabled(false);
        assert!(!recorder.atomics.monitoring_enabled.load(Ordering::Relaxed));
    }

    #[test]
    fn test_monitoring_gain_clamped() {
        let (recorder, _) = AudioRecorder::new(44100);
        recorder.set_monitoring_gain(2.0); // above 1.0 — should clamp
        let stored = recorder.atomics.monitoring_gain.load(Ordering::Relaxed);
        assert!(
            stored <= 1.0,
            "Gain should be clamped to 1.0, got {}",
            stored
        );
        recorder.set_monitoring_gain(-0.5); // below 0.0 — should clamp
        let stored = recorder.atomics.monitoring_gain.load(Ordering::Relaxed);
        assert!(
            stored >= 0.0,
            "Gain should be clamped to 0.0, got {}",
            stored
        );
    }

    #[test]
    fn test_ringbuf_push_pop_roundtrip() {
        let (mut prod, mut cons) = HeapRb::<f32>::new(64).split();
        let input = vec![1.0f32, 2.0, 3.0, 4.0];
        prod.push_slice(&input);
        let mut output = vec![0.0f32; 4];
        let n = cons.pop_slice(&mut output);
        assert_eq!(n, 4);
        assert_eq!(output, input);
    }

    #[test]
    fn test_ringbuf_overflow_no_panic() {
        let (mut prod, _cons) = HeapRb::<f32>::new(4).split();
        // Push 8 items into a capacity-4 ring — should not panic
        let large = vec![1.0f32; 8];
        let pushed = prod.push_slice(&large);
        assert!(pushed <= 4, "Should push at most capacity items");
    }

    #[test]
    fn test_status_idle() {
        let (recorder, _) = AudioRecorder::new(44100);
        let status = recorder.status();
        assert_eq!(status.state, "idle");
        assert!(status.input_device.is_none());
        assert!(status.output_path.is_none());
    }

    // --- Crossfade helpers ---

    #[test]
    fn test_fade_in_first_sample_is_zero() {
        let mut buf = vec![1.0f32; 8];
        apply_fade_in(&mut buf, 8);
        assert!(buf[0].abs() < 1e-6, "first sample after fade-in should be ~0");
    }

    #[test]
    fn test_fade_in_last_faded_sample_approaches_one() {
        let mut buf = vec![1.0f32; 8];
        apply_fade_in(&mut buf, 8);
        // Last sample in the fade region: scale = (7/8) = 0.875
        assert!((buf[7] - 0.875).abs() < 1e-5);
    }

    #[test]
    fn test_fade_in_partial_leaves_tail_unchanged() {
        let mut buf = vec![1.0f32; 8];
        apply_fade_in(&mut buf, 4);
        // Samples after the fade region should be untouched
        for &s in &buf[4..] {
            assert!((s - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn test_fade_out_last_sample_is_zero() {
        let mut buf = vec![1.0f32; 8];
        apply_fade_out(&mut buf, 8);
        assert!(buf[7].abs() < 1e-6, "last sample after fade-out should be ~0");
    }

    #[test]
    fn test_fade_out_partial_leaves_head_unchanged() {
        let mut buf = vec![1.0f32; 8];
        apply_fade_out(&mut buf, 4);
        // Samples before the fade region should be untouched
        for &s in &buf[..4] {
            assert!((s - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn test_fade_in_empty_slice_no_panic() {
        let mut buf: Vec<f32> = Vec::new();
        apply_fade_in(&mut buf, 4); // should not panic
    }

    #[test]
    fn test_fade_out_empty_slice_no_panic() {
        let mut buf: Vec<f32> = Vec::new();
        apply_fade_out(&mut buf, 4); // should not panic
    }

    #[test]
    fn test_fade_in_zero_fade_frames_fades_whole_slice() {
        let mut buf = vec![1.0f32; 4];
        apply_fade_in(&mut buf, 0);
        // With fade_frames=0, entire slice is faded: scale = i/len
        assert!(buf[0].abs() < 1e-6);
    }

    #[test]
    fn test_fade_out_zero_fade_frames_fades_whole_slice() {
        let mut buf = vec![1.0f32; 4];
        apply_fade_out(&mut buf, 0);
        assert!(buf[3].abs() < 1e-6);
    }
}
