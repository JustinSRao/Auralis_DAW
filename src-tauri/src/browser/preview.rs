//! Audio file preview player (Sprint 28).
//!
//! Decodes the first ~3 seconds of a file via symphonia and plays it back
//! through a dedicated WASAPI stream (separate from the main audio engine to
//! avoid ASIO device contention).
//!
//! # Note on testing
//! This module requires a real audio output device and therefore has no
//! automated unit tests. Validate manually: click an audio file in the browser
//! and confirm playback starts within 200 ms.

use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::State;

use crate::instruments::sampler::decoder::decode_audio_file;

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

/// Stop-signal sender for the currently running preview, if any.
/// `Send + Sync` so it can live in Tauri managed state.
pub struct PreviewHandle {
    pub stop_tx: crossbeam_channel::Sender<()>,
}

/// Tauri managed state for the preview player.
pub type PreviewPlayerState = Arc<Mutex<Option<PreviewHandle>>>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Decodes `path` (first 3 s) and starts a preview playback stream.
/// Any currently-playing preview is stopped first.
#[tauri::command]
pub async fn start_preview(
    path: String,
    state: State<'_, PreviewPlayerState>,
) -> Result<(), String> {
    // Stop any existing preview
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = guard.take() {
            let _ = handle.stop_tx.send(());
        }
    }

    // Decode the file off the async executor thread
    let path_clone = path.clone();
    let buffer = tokio::task::spawn_blocking(move || {
        let p = std::path::Path::new(&path_clone);
        decode_audio_file(p)
    })
    .await
    .map_err(|e| format!("spawn_blocking error: {e}"))?
    .map_err(|e| format!("decode error: {e}"))?;

    // Truncate to 3 seconds
    let frames_3s = (buffer.sample_rate as usize) * 3;
    let samples_3s = (frames_3s * 2).min(buffer.samples.len());
    let preview_samples: Arc<Vec<f32>> = Arc::new(buffer.samples[..samples_3s].to_vec());
    let sample_rate = buffer.sample_rate;

    let (stop_tx, stop_rx) = crossbeam_channel::bounded::<()>(1);

    // Spawn playback on a dedicated OS thread (cpal::Stream is !Send)
    std::thread::spawn(move || {
        // Use WASAPI explicitly on Windows to avoid ASIO device contention
        #[cfg(target_os = "windows")]
        let host = {
            cpal::platform::host_from_id(cpal::HostId::Wasapi)
                .unwrap_or_else(|_| cpal::default_host())
        };
        #[cfg(not(target_os = "windows"))]
        let host = cpal::default_host();

        let device = match host.default_output_device() {
            Some(d) => d,
            None => {
                log::warn!("preview: no output device available");
                return;
            }
        };

        let config = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("preview: failed to get output config: {e}");
                return;
            }
        };

        // Use the device's native channel count (1 or 2)
        let device_channels = config.channels() as usize;
        let stream_config = cpal::StreamConfig {
            channels: config.channels(),
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let position = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let position_clone = position.clone();
        let samples_clone = preview_samples.clone();
        let stop_rx_clone = stop_rx.clone();

        let stream = device.build_output_stream(
            &stream_config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                if stop_rx_clone.try_recv().is_ok() {
                    // Fill silence on stop
                    for s in data.iter_mut() {
                        *s = 0.0;
                    }
                    return;
                }

                let pos = position_clone.load(std::sync::atomic::Ordering::Relaxed);
                // preview_samples is always stereo interleaved (2 channels)
                let src_frames = samples_clone.len() / 2;
                let out_frames = data.len() / device_channels;

                for i in 0..out_frames {
                    let frame_idx = pos + i;
                    if frame_idx >= src_frames {
                        // Silence once preview has finished
                        for ch in 0..device_channels {
                            data[i * device_channels + ch] = 0.0;
                        }
                        continue;
                    }
                    // Fill output channels from stereo source
                    let l = samples_clone[frame_idx * 2];
                    let r = samples_clone[frame_idx * 2 + 1];
                    for ch in 0..device_channels {
                        data[i * device_channels + ch] = if ch == 0 { l } else { r };
                    }
                }
                position_clone.fetch_add(out_frames, std::sync::atomic::Ordering::Relaxed);
            },
            |err| log::warn!("preview stream error: {err}"),
            None,
        );

        match stream {
            Ok(s) => {
                if let Err(e) = s.play() {
                    log::warn!("preview: failed to start stream: {e}");
                    return;
                }
                // Park until stop signal or playback exhausts the buffer
                let total_frames = preview_samples.len() / 2;
                loop {
                    if stop_rx.try_recv().is_ok() {
                        break;
                    }
                    let pos = position.load(std::sync::atomic::Ordering::Relaxed);
                    if pos >= total_frames {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                // Drop stream here to stop playback
                drop(s);
            }
            Err(e) => {
                log::warn!("preview: failed to build output stream: {e}");
            }
        }
    });

    // Store the handle
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        *guard = Some(PreviewHandle { stop_tx });
    }

    Ok(())
}

/// Stops the currently-playing preview, if any.
#[tauri::command]
pub async fn stop_preview(state: State<'_, PreviewPlayerState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.take() {
        let _ = handle.stop_tx.send(());
    }
    Ok(())
}
