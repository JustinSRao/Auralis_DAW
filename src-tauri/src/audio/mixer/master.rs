use std::sync::Arc;
use atomic_float::AtomicF32;
use crossbeam_channel::Sender;

/// Payload emitted to the 30 Hz level poller.
#[derive(Debug, Clone, Copy)]
pub struct MasterLevelEvent {
    pub peak_l: f32,
    pub peak_r: f32,
}

/// The master output bus.
///
/// Applies a final fader to the mixed signal, computes peak levels, and
/// sends them to the 30 Hz Tauri event poller via a crossbeam channel.
pub struct MasterBus {
    /// Master fader, range 0.0–2.0.
    pub fader: Arc<AtomicF32>,
    /// Latest peak levels (also sent via level_tx).
    pub peak_l: Arc<AtomicF32>,
    pub peak_r: Arc<AtomicF32>,
    /// Non-blocking sender to the tokio level-event poller.
    pub level_tx: Sender<MasterLevelEvent>,
}

impl MasterBus {
    pub fn new(level_tx: Sender<MasterLevelEvent>) -> Self {
        Self {
            fader: Arc::new(AtomicF32::new(1.0)),
            peak_l: Arc::new(AtomicF32::new(0.0)),
            peak_r: Arc::new(AtomicF32::new(0.0)),
            level_tx,
        }
    }

    /// Apply master fader and update peak levels. Call after all channels and
    /// buses have been summed into `buffer`.
    pub fn process(&self, buffer: &mut [f32]) {
        let fader = self.fader.load(std::sync::atomic::Ordering::Relaxed);
        let frame_count = buffer.len() / 2;
        let mut peak_l = 0.0f32;
        let mut peak_r = 0.0f32;

        for i in 0..frame_count {
            buffer[i * 2] *= fader;
            buffer[i * 2 + 1] *= fader;
            peak_l = peak_l.max(buffer[i * 2].abs());
            peak_r = peak_r.max(buffer[i * 2 + 1].abs());
        }

        self.peak_l.store(peak_l, std::sync::atomic::Ordering::Relaxed);
        self.peak_r.store(peak_r, std::sync::atomic::Ordering::Relaxed);

        let _ = self.level_tx.try_send(MasterLevelEvent { peak_l, peak_r });
    }
}
