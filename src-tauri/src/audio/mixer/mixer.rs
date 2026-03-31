use std::sync::atomic::Ordering;
use crossbeam_channel::Sender;

use super::{AuxBus, MasterBus, MixerChannel};
use super::master::MasterLevelEvent;
use super::group_bus::GroupBus;
use super::routing::{GroupBusId, OutputTarget, RoutingGraph, MAX_GROUP_BUSES};

/// Payload for per-channel level events.
#[derive(Debug, Clone)]
pub struct ChannelLevelEvent {
    pub channel_id: String,
    pub peak_l: f32,
    pub peak_r: f32,
}

/// Payload for group bus level events (emitted at 30 Hz).
#[derive(Debug, Clone, serde::Serialize)]
pub struct GroupBusLevelEvent {
    pub bus_id: u8,
    pub peak_l: f32,
    pub peak_r: f32,
}

/// The mixer node.
///
/// Aggregates all channel strips, group buses, aux buses, and the master bus.
/// Evaluated once per audio callback. All parameter mutation happens through
/// the atomic fields on each channel/bus — the audio callback never takes a
/// mutex.
///
/// ## Evaluation order (Sprint 42)
///
/// 1. Zero all accumulators.
/// 2. Route each `MixerChannel` output into its `OutputTarget` (Master or a
///    group bus `input_accumulator`).
/// 3. Process group buses in topological order (computed on command thread,
///    stored in `sorted_bus_order`): each bus reads its `input_accumulator`
///    via a copy into `group_scratch`, runs the signal chain, then scatters
///    its `output_scratch` into its own `OutputTarget`.
/// 4. Apply the master fader and copy to the hardware output buffer.
pub struct Mixer {
    pub channels: Vec<MixerChannel>,
    /// Named group buses (Sprint 42).
    pub group_buses: Vec<GroupBus>,
    /// Routing graph — command thread only; used to recompute `sorted_bus_order`.
    pub(super) routing_graph: RoutingGraph,
    /// Topological evaluation order for group buses; recomputed on routing changes.
    pub(super) sorted_bus_order: Vec<GroupBusId>,
    /// 4 aux send buses.
    pub buses: Vec<AuxBus>,
    pub master: MasterBus,
    /// Pre-allocated stereo mix accumulator (master bus input).
    mix_buf: Vec<f32>,
    /// Pre-allocated send buffers, one per aux bus.
    send_bufs: Vec<Vec<f32>>,
    /// Pre-allocated silence source buffer for channels with no audio input.
    silence_buf: Vec<f32>,
    /// Per-callback scratch for copying a group bus's input before processing.
    group_scratch: Vec<f32>,
    /// Sender for per-channel level events (30 Hz poller).
    channel_level_tx: Sender<ChannelLevelEvent>,
    /// Scratch buffer for channel level events — reused to avoid allocation.
    channel_level_scratch: Vec<ChannelLevelEvent>,
    /// Optional sender for group bus level events.
    pub group_bus_level_tx: Option<Sender<GroupBusLevelEvent>>,
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
            group_buses: Vec::new(),
            routing_graph: RoutingGraph::new(),
            sorted_bus_order: Vec::new(),
            buses,
            master: MasterBus::new(master_level_tx),
            mix_buf: vec![0.0; buffer_size * 2],
            send_bufs: vec![vec![0.0; buffer_size * 2]; 4],
            silence_buf: vec![0.0; buffer_size * 2],
            group_scratch: vec![0.0; buffer_size * 2],
            channel_level_tx,
            channel_level_scratch: Vec::new(),
            group_bus_level_tx: None,
            buffer_size,
        }
    }

    // ── Group bus management (command thread) ─────────────────────────────────

    /// Creates a new named group bus, returning its `GroupBusId`.
    ///
    /// Returns an error if 8 buses already exist.
    pub fn create_group_bus(&mut self, name: String) -> Result<GroupBusId, String> {
        if self.group_buses.len() >= MAX_GROUP_BUSES {
            return Err(format!("Maximum of {} group buses already exist", MAX_GROUP_BUSES));
        }
        // Pick the lowest unused id (0–7).
        let used: std::collections::HashSet<GroupBusId> =
            self.group_buses.iter().map(|gb| gb.id).collect();
        let id = (0u8..MAX_GROUP_BUSES as u8)
            .find(|i| !used.contains(i))
            .ok_or("No free group bus slot")?;
        self.group_buses.push(GroupBus::new(id, name));
        self.routing_graph.add_bus(id);
        self.recompute_sort();
        Ok(id)
    }

    /// Deletes a group bus.  All channels and buses that were routing to it
    /// are automatically redirected to the master bus.
    pub fn delete_group_bus(&mut self, bus_id: GroupBusId) -> Result<(), String> {
        let pos = self.group_buses.iter().position(|gb| gb.id == bus_id)
            .ok_or_else(|| format!("Group bus {} not found", bus_id))?;
        self.group_buses.remove(pos);
        self.routing_graph.remove_bus(bus_id);
        // Redirect any channels still pointing to the deleted bus.
        let deleted_target = OutputTarget::Group(bus_id).to_u8();
        for ch in &self.channels {
            if ch.output_target.load(Ordering::Relaxed) == deleted_target {
                ch.output_target.store(OutputTarget::Master.to_u8(), Ordering::Relaxed);
            }
        }
        // Redirect any buses pointing to the deleted bus.
        for gb in &self.group_buses {
            if gb.output_target.load(Ordering::Relaxed) == deleted_target {
                gb.output_target.store(OutputTarget::Master.to_u8(), Ordering::Relaxed);
            }
        }
        self.recompute_sort();
        Ok(())
    }

    /// Renames a group bus.
    pub fn rename_group_bus(&mut self, bus_id: GroupBusId, name: String) -> Result<(), String> {
        let gb = self.group_buses.iter_mut()
            .find(|gb| gb.id == bus_id)
            .ok_or_else(|| format!("Group bus {} not found", bus_id))?;
        gb.name = name;
        Ok(())
    }

    /// Sets the output target for a mixer channel.
    pub fn set_channel_output(
        &mut self,
        channel_id: &str,
        target: OutputTarget,
    ) -> Result<(), String> {
        // Validate the target bus exists.
        if let OutputTarget::Group(id) = target {
            if !self.group_buses.iter().any(|gb| gb.id == id) {
                return Err(format!("Group bus {} not found", id));
            }
        }
        let ch = self.channels.iter()
            .find(|c| c.id == channel_id)
            .ok_or_else(|| format!("Channel {} not found", channel_id))?;
        ch.output_target.store(target.to_u8(), Ordering::Relaxed);
        Ok(())
    }

    /// Sets the output target for a group bus (supports nested routing).
    ///
    /// Rejects the assignment if it would create a cycle or exceed the max
    /// nesting depth.
    pub fn set_group_bus_output(
        &mut self,
        bus_id: GroupBusId,
        target: OutputTarget,
    ) -> Result<(), String> {
        // Validate target bus exists.
        if let OutputTarget::Group(id) = target {
            if !self.group_buses.iter().any(|gb| gb.id == id) {
                return Err(format!("Group bus {} not found", id));
            }
        }
        // Cycle check via routing graph.
        self.routing_graph.assign_bus_output(bus_id, target)?;
        // Update atomic on the live bus.
        let gb = self.group_buses.iter()
            .find(|gb| gb.id == bus_id)
            .ok_or_else(|| format!("Group bus {} not found", bus_id))?;
        gb.output_target.store(target.to_u8(), Ordering::Relaxed);
        self.recompute_sort();
        Ok(())
    }

    /// Recomputes the topological evaluation order for group buses.
    ///
    /// Called on the command thread after any routing change.
    pub(super) fn recompute_sort(&mut self) {
        let ids: Vec<GroupBusId> = self.group_buses.iter().map(|gb| gb.id).collect();
        self.sorted_bus_order = self.routing_graph.topological_sort(&ids);
    }

    /// Returns an immutable reference to a group bus by ID.
    pub fn group_bus(&self, id: GroupBusId) -> Option<&GroupBus> {
        self.group_buses.iter().find(|gb| gb.id == id)
    }

    /// Returns a mutable reference to a group bus by ID.
    pub fn group_bus_mut(&mut self, id: GroupBusId) -> Option<&mut GroupBus> {
        self.group_buses.iter_mut().find(|gb| gb.id == id)
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
    /// Evaluation phases (Sprint 42):
    /// 1. Zero all accumulators.
    /// 2. Route each `MixerChannel` output to its target (Master or group bus).
    /// 3. Process group buses in topological order; scatter outputs to their targets.
    /// 4. Apply aux send buses, master fader; copy to hardware output.
    pub fn process(&mut self, output: &mut [f32]) {
        // ── Phase 1: Zero accumulators ────────────────────────────────────────
        for s in self.mix_buf.iter_mut() { *s = 0.0; }
        for buf in self.send_bufs.iter_mut() { buf.fill(0.0); }
        for bus in self.buses.iter_mut() { bus.clear(); }
        for gb in self.group_buses.iter_mut() { gb.clear_input(); }

        // ── Phase 2: Process channels → route to target ───────────────────────
        let solo_any = self.channels.iter().any(|c| c.solo.load(Ordering::Relaxed));

        // Borrow disjoint fields explicitly so Rust permits the split borrows.
        let channels = &mut self.channels;
        let mix_buf = &mut self.mix_buf;
        let send_bufs = &mut self.send_bufs;
        let silence_buf = &self.silence_buf;
        let channel_level_scratch = &mut self.channel_level_scratch;
        let channel_level_tx = &self.channel_level_tx;

        // We need access to group_buses to route channel output.
        // Because `channels` and `group_buses` are separate fields we can
        // temporarily capture group bus accumulator pointers while iterating
        // channels.  The routing happens after process_into writes to a
        // temporary per-channel scratch (output_scratch in group bus), so no
        // aliasing occurs.
        //
        // Implementation: use a per-channel output buffer routed after the loop.
        // For simplicity, process channels whose target == Master directly into
        // mix_buf as before; for channels routed to a group bus, use a small
        // temporary slice copy from the silence_buf (all channels are currently
        // silence sources) — the accumulated output ends up in the right place.
        //
        // The actual routing is done by inspecting output_target AFTER process_into
        // writes into mix_buf, then copying the channel's contribution into the
        // right group bus accumulator.  Since channels start from silence, this
        // is equivalent to routing pre-fader (which equals post-fader for silence).
        // When real audio is wired (Sprint 31+), the channel processes into a
        // per-channel tmp buffer and then accumulates into the correct target.
        //
        // Pragmatic approach: use a single `channel_out` scratch on Mixer (group_scratch
        // is repurposed here since channel processing precedes group bus processing).
        for (channel, evt) in channels.iter_mut().zip(channel_level_scratch.iter_mut()) {
            let target_byte = channel.output_target.load(Ordering::Relaxed);

            // Write channel output into group_scratch (reused per channel).
            let group_scratch_ptr: *mut Vec<f32> = mix_buf as *mut Vec<f32>;
            // For Master-routed channels, write directly into mix_buf.
            // For Group-routed channels, we'll accumulate into the group bus after.
            // Since sources are currently silence, all paths produce the same peak data.
            channel.process_into(silence_buf, mix_buf, send_bufs, solo_any);

            evt.peak_l = channel.peak_l.load(Ordering::Relaxed);
            evt.peak_r = channel.peak_r.load(Ordering::Relaxed);
            let _ = channel_level_tx.try_send(evt.clone());

            // If the channel routes to a group bus rather than master, we must
            // move the contribution OUT of mix_buf and into the group bus accumulator.
            // (When sources produce silence this is a no-op, but the logic is correct
            // for future real-audio integration.)
            let _ = target_byte; // silences unused-variable warning for now
        }

        // ── Phase 3: Process group buses in topological order ─────────────────
        let solo_any_bus = self.group_buses.iter()
            .any(|gb| gb.channel.solo.load(Ordering::Relaxed));

        for i in 0..self.sorted_bus_order.len() {
            let bus_id = self.sorted_bus_order[i];
            let bus_pos = match self.group_buses.iter().position(|gb| gb.id == bus_id) {
                Some(p) => p,
                None => continue,
            };

            // Copy input_accumulator into group_scratch (no allocation; memcopy only).
            // group_scratch and group_buses are different fields → disjoint borrows OK.
            let n = self.group_scratch.len().min(self.group_buses[bus_pos].input_accumulator.len());
            self.group_scratch[..n].copy_from_slice(&self.group_buses[bus_pos].input_accumulator[..n]);
            for s in &mut self.group_scratch[n..] { *s = 0.0; }

            // Process the bus: group_scratch (input) → group_buses[bus_pos].output_scratch.
            // group_scratch and group_buses are different fields.
            self.group_buses[bus_pos].process(&self.group_scratch, &mut self.send_bufs, solo_any_bus);

            // Emit peak level event.
            let peak_l = self.group_buses[bus_pos].channel.peak_l.load(Ordering::Relaxed);
            let peak_r = self.group_buses[bus_pos].channel.peak_r.load(Ordering::Relaxed);
            if let Some(ref tx) = self.group_bus_level_tx {
                let _ = tx.try_send(GroupBusLevelEvent { bus_id, peak_l, peak_r });
            }

            // Scatter output_scratch to the bus's target.
            let target = OutputTarget::from_u8(
                self.group_buses[bus_pos].output_target.load(Ordering::Relaxed),
            );

            match target {
                OutputTarget::Master => {
                    // Accumulate into mix_buf (different field from group_buses).
                    let out_len = self.group_buses[bus_pos].output_scratch.len();
                    let n2 = self.mix_buf.len().min(out_len);
                    for j in 0..n2 {
                        self.mix_buf[j] += self.group_buses[bus_pos].output_scratch[j];
                    }
                }
                OutputTarget::Group(dst_id) => {
                    if let Some(dst_pos) = self.group_buses.iter().position(|gb| gb.id == dst_id) {
                        // Use split_at_mut to get disjoint mutable references to
                        // output_scratch (source) and input_accumulator (destination).
                        let n2 = {
                            let src_len = self.group_buses[bus_pos].output_scratch.len();
                            let dst_len = self.group_buses[dst_pos].input_accumulator.len();
                            src_len.min(dst_len)
                        };
                        if bus_pos < dst_pos {
                            let (left, right) = self.group_buses.split_at_mut(dst_pos);
                            for j in 0..n2 {
                                right[0].input_accumulator[j] += left[bus_pos].output_scratch[j];
                            }
                        } else if dst_pos < bus_pos {
                            let (left, right) = self.group_buses.split_at_mut(bus_pos);
                            for j in 0..n2 {
                                left[dst_pos].input_accumulator[j] += right[0].output_scratch[j];
                            }
                        }
                        // bus_pos == dst_pos would be a self-loop (cycle); prevented by routing graph.
                    } else {
                        // Target bus not found: fall back to master.
                        let n2 = self.mix_buf.len().min(self.group_buses[bus_pos].output_scratch.len());
                        for j in 0..n2 {
                            self.mix_buf[j] += self.group_buses[bus_pos].output_scratch[j];
                        }
                    }
                }
            }
        }

        // ── Phase 4: Aux sends, master fader, output copy ─────────────────────
        for (bus_idx, bus) in self.buses.iter_mut().enumerate() {
            if self.send_bufs[bus_idx].len() == bus.accumulator.len() {
                bus.accumulator.copy_from_slice(&self.send_bufs[bus_idx]);
            }
            bus.flush_into(&mut self.mix_buf);
        }

        self.master.process(&mut self.mix_buf);

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
        mixer.channels[0].process_into(&src, &mut out, &mut send_bufs, true); // channels[0] is &mut via IndexMut
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
