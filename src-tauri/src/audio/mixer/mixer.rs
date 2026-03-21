use std::sync::atomic::Ordering;
use crossbeam_channel::Sender;

use super::{AuxBus, MasterBus, MixerChannel};
use super::master::MasterLevelEvent;

/// Payload for per-channel level events.
#[derive(Debug, Clone)]
pub struct ChannelLevelEvent {
    pub channel_id: String,
    pub peak_l: f32,
    pub peak_r: f32,
}

/// The mixer node.
///
/// Aggregates all channel strips and aux buses. Evaluated once per audio
/// callback. All parameter mutation happens through the atomic fields on
/// each channel/bus — the audio callback never takes a mutex.
pub struct Mixer {
    pub channels: Vec<MixerChannel>,
    /// 4 aux send buses.
    pub buses: Vec<AuxBus>,
    pub master: MasterBus,
    /// Pre-allocated stereo mix accumulator (no allocation on audio thread).
    mix_buf: Vec<f32>,
    /// Pre-allocated send buffers, one per bus.
    send_bufs: Vec<Vec<f32>>,
    /// Pre-allocated silence source buffer passed to each channel's process_into.
    silence_buf: Vec<f32>,
    /// Sender for per-channel level events to the 30 Hz poller.
    channel_level_tx: Sender<ChannelLevelEvent>,
    /// Scratch buffer for channel level events — reused each callback to avoid allocation.
    channel_level_scratch: Vec<ChannelLevelEvent>,
    buffer_size: usize,
}

impl Mixer {
    pub fn new(
        buffer_size: usize,
        master_level_tx: Sender<MasterLevelEvent>,
        channel_level_tx: Sender<ChannelLevelEvent>,
    ) -> Self {
        let buses = vec![
            AuxBus::new("bus-0", "Reverb Bus", buffer_size),
            AuxBus::new("bus-1", "Delay Bus", buffer_size),
            AuxBus::new("bus-2", "Bus 3", buffer_size),
            AuxBus::new("bus-3", "Bus 4", buffer_size),
        ];

        Self {
            channels: Vec::new(),
            buses,
            master: MasterBus::new(master_level_tx),
            mix_buf: vec![0.0; buffer_size * 2],
            send_bufs: vec![vec![0.0; buffer_size * 2]; 4],
            silence_buf: vec![0.0; buffer_size * 2],
            channel_level_tx,
            channel_level_scratch: Vec::new(),
            buffer_size,
        }
    }

    /// Add a channel strip for a track.
    pub fn add_channel(&mut self, id: impl Into<String>, name: impl Into<String>) {
        let id_str: String = id.into();
        // Pre-allocate the level-event slot so process() never allocates a new String.
        self.channel_level_scratch.push(ChannelLevelEvent {
            channel_id: id_str.clone(),
            peak_l: 0.0,
            peak_r: 0.0,
        });
        self.channels.push(MixerChannel::new(id_str, name));
    }

    /// Remove a channel strip by ID.
    pub fn remove_channel(&mut self, id: &str) {
        self.channels.retain(|c| c.id != id);
        self.channel_level_scratch.retain(|e| e.channel_id != id);
    }

    /// Find a channel by ID.
    pub fn channel(&self, id: &str) -> Option<&MixerChannel> {
        self.channels.iter().find(|c| c.id == id)
    }

    /// Process one audio buffer.
    ///
    /// In Sprint 17 all channel sources are silent (instrument audio routes in
    /// Sprint 31). The full signal path — fader, pan, mute/solo, sends, buses,
    /// master — is exercised with silence to validate correctness.
    pub fn process(&mut self, output: &mut [f32]) {
        // Zero accumulators (no heap allocation)
        for s in self.mix_buf.iter_mut() { *s = 0.0; }
        for buf in self.send_bufs.iter_mut() {
            for s in buf.iter_mut() { *s = 0.0; }
        }
        for bus in self.buses.iter_mut() { bus.clear(); }

        // Determine solo state
        let solo_any = self.channels.iter().any(|c| c.solo.load(Ordering::Relaxed));

        // Process each channel into the mix buffer.
        // silence_buf and channel_level_scratch are pre-allocated — no heap allocation here.
        for (channel, evt) in self.channels.iter().zip(self.channel_level_scratch.iter_mut()) {
            channel.process_into(&self.silence_buf, &mut self.mix_buf, &mut self.send_bufs, solo_any);

            // Update the pre-allocated event in-place, then send a clone.
            evt.peak_l = channel.peak_l.load(Ordering::Relaxed);
            evt.peak_r = channel.peak_r.load(Ordering::Relaxed);
            let _ = self.channel_level_tx.try_send(evt.clone());
        }

        // Flush each bus's accumulated send signal back into the mix buffer
        for (bus_idx, bus) in self.buses.iter_mut().enumerate() {
            // Copy send accumulator into bus
            if self.send_bufs[bus_idx].len() == bus.accumulator.len() {
                bus.accumulator.copy_from_slice(&self.send_bufs[bus_idx]);
            }
            bus.flush_into(&mut self.mix_buf);
        }

        // Apply master fader and compute master peak
        self.master.process(&mut self.mix_buf);

        // Copy mix result to output
        let copy_len = output.len().min(self.mix_buf.len());
        output[..copy_len].copy_from_slice(&self.mix_buf[..copy_len]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_mixer() -> Mixer {
        let (master_tx, _master_rx) = crossbeam_channel::bounded(64);
        let (ch_tx, _ch_rx) = crossbeam_channel::bounded(64);
        Mixer::new(256, master_tx, ch_tx)
    }

    #[test]
    fn test_mixer_empty_channels_output_silence() {
        let mut mixer = make_test_mixer();
        let mut out = vec![0.0f32; 512];
        mixer.process(&mut out);
        assert!(out.iter().all(|&s| s.abs() < 1e-6));
    }

    #[test]
    fn test_mixer_solo_logic() {
        let mut mixer = make_test_mixer();
        mixer.add_channel("ch0", "Track 1");
        mixer.add_channel("ch1", "Track 2");
        mixer.add_channel("ch2", "Track 3");
        // Solo ch1 only
        mixer.channels[1].solo.store(true, std::sync::atomic::Ordering::Relaxed);
        let solo_any = mixer.channels.iter().any(|c| c.solo.load(std::sync::atomic::Ordering::Relaxed));
        assert!(solo_any);
        // ch0 and ch2 should be silent, ch1 passes
        let src = vec![0.0f32; 512]; // silence for Sprint 17
        let mut out = vec![0.0f32; 512];
        let mut send_bufs = vec![vec![0.0f32; 512]; 4];
        mixer.channels[0].process_into(&src, &mut out, &mut send_bufs, true);
        assert!(out.iter().all(|&s| s.abs() < 1e-6), "ch0 should be silent (not soloed)");
    }

    #[test]
    fn test_mixer_add_remove_channel() {
        let mut mixer = make_test_mixer();
        mixer.add_channel("ch0", "Track 1");
        assert_eq!(mixer.channels.len(), 1);
        mixer.remove_channel("ch0");
        assert_eq!(mixer.channels.len(), 0);
    }
}
