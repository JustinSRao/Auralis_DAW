//! Arrangement playback scheduler for Sprint 31.
//!
//! [`ArrangementScheduler`] sits on the audio thread alongside [`TransportClock`].
//! On every audio callback it fires sample-accurate MIDI NoteOn/NoteOff events for
//! all arrangement clips that fall within the current buffer window.
//!
//! # Design
//!
//! The scheduler stores a sorted `Vec<ScheduledNote>` produced by the main thread
//! from the arrangement clip list and the pattern MIDI notes. A monotonic
//! `note_cursor` scans forward through this list each tick. Active (sounding) notes
//! are tracked in a pre-allocated `Vec<ActiveNote>` so NoteOff can be fired at the
//! correct sample without any heap allocation in the hot path.
//!
//! Main-thread updates (clip list changes, new track senders) arrive via a
//! `crossbeam_channel` and are drained at the top of each callback.
//!
//! Loop boundary crossing is detected by comparing `position` to the previous
//! call's position: if `position < prev_position`, a loop wrap has occurred and
//! the cursor is repositioned.

use crossbeam_channel::{Receiver, Sender};

use crate::midi::types::{MidiEvent, TimestampedMidiEvent};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// A single MIDI note to be fired during arrangement playback.
///
/// All positions are absolute song-sample offsets from the start of the
/// timeline. Notes are created by the Tauri command layer (or by tests) from
/// the arrangement clip list and the pattern MIDI data.
///
/// The slice of notes provided to [`SchedulerCommand::SetNotes`] must be
/// sorted ascending by `on_sample`.
#[derive(Clone)]
pub struct ScheduledNote {
    /// Absolute sample position where the NoteOn fires.
    pub on_sample: u64,
    /// Absolute sample position where the NoteOff fires.
    pub off_sample: u64,
    /// MIDI pitch `[0, 127]`.
    pub pitch: u8,
    /// MIDI velocity `[1, 127]`.
    pub velocity: u8,
    /// MIDI channel `[0, 15]`.
    pub channel: u8,
    /// Track ID used to look up the instrument MIDI sender.
    pub track_id: String,
}

/// An active (currently sounding) note pending a NoteOff.
struct ActiveNote {
    /// Absolute sample position when the NoteOff must fire.
    off_sample: u64,
    /// Index into [`ArrangementScheduler::senders`]. Using an index avoids
    /// any `String` clone or lookup in the scheduling hot path.
    sender_idx: usize,
    pitch: u8,
    channel: u8,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Commands sent from the main thread to [`ArrangementScheduler`] via a
/// bounded `crossbeam_channel`. Drained at the top of each audio callback.
pub enum SchedulerCommand {
    /// Replace the entire scheduled note list.
    ///
    /// Notes **must** be sorted ascending by `on_sample`. Called whenever the
    /// arrangement changes or on project load.
    SetNotes(Vec<ScheduledNote>),

    /// Register (or replace) the MIDI sender for a track.
    ///
    /// Called after an instrument is created for a track so the scheduler can
    /// route NoteOn/NoteOff events to the correct instrument channel.
    SetTrackSender {
        track_id: String,
        tx: Sender<TimestampedMidiEvent>,
    },
}

// ---------------------------------------------------------------------------
// ArrangementScheduler
// ---------------------------------------------------------------------------

/// Per-callback arrangement clip scheduler. Lives exclusively on the audio thread.
///
/// # Memory
///
/// All collections are pre-allocated in [`ArrangementScheduler::new`]. The hot
/// path (`tick`) does not allocate as long as:
/// - Fewer than 512 notes are simultaneously active (initial `active_notes` capacity).
/// - Fewer than 16 distinct track IDs are registered (initial `track_ids` capacity).
///
/// If either limit is exceeded, a single push will allocate. This is acceptable
/// for such extreme edge cases.
///
/// # Loop support
///
/// When the transport clock wraps at the loop boundary,
/// `clock.position_samples` will be less than it was on the previous buffer.
/// `tick` detects this and repositions `note_cursor` automatically, mirroring
/// the clock's loop behaviour.
pub struct ArrangementScheduler {
    /// Pre-expanded note events sorted ascending by `on_sample`.
    notes: Vec<ScheduledNote>,
    /// Index into `notes` of the next note not yet scheduled.
    note_cursor: usize,
    /// Currently-sounding notes awaiting a NoteOff.
    active_notes: Vec<ActiveNote>,
    /// Track IDs, parallel to `senders`.
    track_ids: Vec<String>,
    /// MIDI sender channels, parallel to `track_ids`.
    senders: Vec<Sender<TimestampedMidiEvent>>,
    /// Command channel from the main thread (non-blocking drain each callback).
    cmd_rx: Receiver<SchedulerCommand>,
    /// Position at the start of the previous buffer. Used to detect loop wraps.
    prev_position: u64,
}

impl ArrangementScheduler {
    /// Creates a new scheduler with pre-allocated collections.
    ///
    /// `cmd_rx` is the receiving end of the channel created in `lib.rs`.
    pub fn new(cmd_rx: Receiver<SchedulerCommand>) -> Self {
        Self {
            notes: Vec::with_capacity(8192),
            note_cursor: 0,
            active_notes: Vec::with_capacity(512),
            track_ids: Vec::with_capacity(16),
            senders: Vec::with_capacity(16),
            cmd_rx,
            prev_position: 0,
        }
    }

    // -----------------------------------------------------------------------
    // Hot path
    // -----------------------------------------------------------------------

    /// Process one audio buffer of arrangement scheduling.
    ///
    /// Must be called **before** [`TransportClock::advance`] so that `position`
    /// reflects the *start* of the current buffer window.
    ///
    /// # Arguments
    ///
    /// * `position`      — Absolute playhead sample at the start of this buffer.
    /// * `buffer_frames` — Number of audio frames in this buffer.
    /// * `is_playing`    — Whether the transport is in the Playing or Recording state.
    ///   Notes are not fired when the transport is stopped or paused.
    pub fn tick(&mut self, position: u64, buffer_frames: usize, is_playing: bool) {
        // 1. Drain main-thread commands (non-blocking).
        while let Ok(cmd) = self.cmd_rx.try_recv() {
            match cmd {
                SchedulerCommand::SetNotes(new_notes) => {
                    // Stop any currently sounding notes before replacing the list.
                    self.stop_all_active();
                    self.notes = new_notes;
                    // Reset cursor to first note at or after current position.
                    self.note_cursor =
                        self.notes.partition_point(|n| n.on_sample < position);
                }
                SchedulerCommand::SetTrackSender { track_id, tx } => {
                    if let Some(idx) = self.track_ids.iter().position(|id| *id == track_id) {
                        // Replace existing sender (e.g. instrument was recreated).
                        self.senders[idx] = tx;
                    } else if self.track_ids.len() < 16 {
                        self.track_ids.push(track_id);
                        self.senders.push(tx);
                    }
                }
            }
        }

        let buffer_end = position + buffer_frames as u64;

        // 2. Detect loop wrap: if the current buffer start is before the end of
        //    the previous buffer, the transport clock looped. Reset the note cursor
        //    and stop any notes that were still sounding.
        if is_playing && position < self.prev_position {
            self.stop_all_active();
            self.note_cursor = self.notes.partition_point(|n| n.on_sample < position);
        }
        // Track the end of this buffer so the next tick can detect a loop wrap.
        self.prev_position = buffer_end;

        if !is_playing {
            return;
        }

        // 3. Fire NoteOff for active notes whose end falls within this buffer.
        //
        // `swap_remove` is O(1) and safe because `active_notes` order does not
        // affect correctness. When we swap-remove at index `i`, the element
        // previously at the back is now at `i`, so we re-check index `i` without
        // incrementing it.
        let mut i = 0;
        while i < self.active_notes.len() {
            if self.active_notes[i].off_sample <= buffer_end {
                let sender_idx = self.active_notes[i].sender_idx;
                let pitch = self.active_notes[i].pitch;
                let channel = self.active_notes[i].channel;
                self.active_notes.swap_remove(i);
                self.send_note_off(sender_idx, pitch, channel);
                // Do not increment i — the element now at i came from the back.
            } else {
                i += 1;
            }
        }

        // 4. Fire NoteOn for notes that start within [position, buffer_end).
        while self.note_cursor < self.notes.len() {
            let on_sample = self.notes[self.note_cursor].on_sample;
            if on_sample >= buffer_end {
                break;
            }
            if on_sample >= position {
                // Copy fields before any mutable borrow below.
                let off_sample = self.notes[self.note_cursor].off_sample;
                let pitch = self.notes[self.note_cursor].pitch;
                let velocity = self.notes[self.note_cursor].velocity;
                let channel = self.notes[self.note_cursor].channel;

                // Find the sender index by comparing track IDs (at most 16 entries).
                let sender_idx = self
                    .track_ids
                    .iter()
                    .position(|id| *id == self.notes[self.note_cursor].track_id);

                if let Some(sidx) = sender_idx {
                    self.send_note_on(sidx, pitch, velocity, channel);
                    if off_sample <= buffer_end {
                        // Note ends within this same buffer — fire NoteOff immediately.
                        // No need to track in active_notes.
                        self.send_note_off(sidx, pitch, channel);
                    } else {
                        // Note extends into future buffers — track for later NoteOff.
                        self.active_notes.push(ActiveNote {
                            off_sample,
                            sender_idx: sidx,
                            pitch,
                            channel,
                        });
                    }
                }
            }
            self.note_cursor += 1;
        }
    }

    // -----------------------------------------------------------------------
    // Transport event handlers
    // -----------------------------------------------------------------------

    /// Silences all active notes immediately. Call when transport stops.
    pub fn handle_stop(&mut self) {
        self.stop_all_active();
    }

    /// Repositions the note cursor to `new_position` and silences active notes.
    ///
    /// Call when the transport seeks to a new position.
    pub fn handle_seek(&mut self, new_position: u64) {
        self.stop_all_active();
        self.note_cursor = self
            .notes
            .partition_point(|n| n.on_sample < new_position);
        self.prev_position = new_position;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /// Sends NoteOff for all active notes and clears the active-notes list.
    fn stop_all_active(&mut self) {
        // Iterate by index to avoid borrowing `self` through two paths.
        let count = self.active_notes.len();
        for i in 0..count {
            let sender_idx = self.active_notes[i].sender_idx;
            let pitch = self.active_notes[i].pitch;
            let channel = self.active_notes[i].channel;
            self.send_note_off(sender_idx, pitch, channel);
        }
        self.active_notes.clear();
    }

    #[inline]
    fn send_note_on(&self, sender_idx: usize, pitch: u8, velocity: u8, channel: u8) {
        if let Some(tx) = self.senders.get(sender_idx) {
            let _ = tx.try_send(TimestampedMidiEvent {
                event: MidiEvent::NoteOn {
                    channel,
                    note: pitch,
                    velocity,
                },
                timestamp_us: 0,
            });
        }
    }

    #[inline]
    fn send_note_off(&self, sender_idx: usize, pitch: u8, channel: u8) {
        if let Some(tx) = self.senders.get(sender_idx) {
            let _ = tx.try_send(TimestampedMidiEvent {
                event: MidiEvent::NoteOff {
                    channel,
                    note: pitch,
                    velocity: 0,
                },
                timestamp_us: 0,
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_scheduler() -> (ArrangementScheduler, crossbeam_channel::Sender<SchedulerCommand>) {
        let (tx, rx) = crossbeam_channel::bounded(64);
        let sched = ArrangementScheduler::new(rx);
        (sched, tx)
    }

    fn make_midi_channel() -> (
        Sender<TimestampedMidiEvent>,
        crossbeam_channel::Receiver<TimestampedMidiEvent>,
    ) {
        crossbeam_channel::bounded(256)
    }

    fn make_note(on_sample: u64, off_sample: u64, pitch: u8, track_id: &str) -> ScheduledNote {
        ScheduledNote {
            on_sample,
            off_sample,
            pitch,
            velocity: 100,
            channel: 0,
            track_id: track_id.to_string(),
        }
    }

    fn register_track(
        cmd_tx: &crossbeam_channel::Sender<SchedulerCommand>,
        track_id: &str,
        midi_tx: Sender<TimestampedMidiEvent>,
    ) {
        cmd_tx
            .send(SchedulerCommand::SetTrackSender {
                track_id: track_id.to_string(),
                tx: midi_tx,
            })
            .unwrap();
    }

    // -----------------------------------------------------------------------
    // NoteOn / NoteOff basic firing
    // -----------------------------------------------------------------------

    #[test]
    fn tick_fires_note_on_at_correct_sample() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                100, 200, 60, "track-1",
            )]))
            .unwrap();

        // Buffer [0, 256) contains note at sample 100.
        sched.tick(0, 256, true);

        let ev = midi_rx.try_recv().expect("expected NoteOn");
        assert!(matches!(
            ev.event,
            MidiEvent::NoteOn {
                note: 60,
                velocity: 100,
                ..
            }
        ));
    }

    #[test]
    fn tick_fires_note_off_within_same_buffer() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                0, 100, 60, "track-1",
            )]))
            .unwrap();

        // Both on_sample=0 and off_sample=100 fall in buffer [0, 256).
        sched.tick(0, 256, true);

        let ev1 = midi_rx.try_recv().expect("expected event 1");
        let ev2 = midi_rx.try_recv().expect("expected event 2");
        let events = [ev1.event, ev2.event];
        assert!(
            events.iter().any(|e| matches!(e, MidiEvent::NoteOn { .. })),
            "expected NoteOn"
        );
        assert!(
            events.iter().any(|e| matches!(e, MidiEvent::NoteOff { .. })),
            "expected NoteOff"
        );
    }

    #[test]
    fn tick_not_playing_fires_no_notes() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                0, 100, 60, "track-1",
            )]))
            .unwrap();

        sched.tick(0, 256, false); // is_playing = false

        assert!(
            midi_rx.try_recv().is_err(),
            "expected no events when not playing"
        );
    }

    #[test]
    fn tick_note_before_buffer_not_fired() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);
        // Note ends at sample 50 — already past when buffer starts at 256
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                0, 50, 60, "track-1",
            )]))
            .unwrap();

        sched.tick(256, 256, true); // buffer [256, 512)

        assert!(midi_rx.try_recv().is_err(), "note before buffer should not fire");
    }

    // -----------------------------------------------------------------------
    // Seek
    // -----------------------------------------------------------------------

    #[test]
    fn handle_seek_repositions_cursor_skipping_past_notes() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![
                make_note(0, 100, 60, "track-1"),
                make_note(1000, 1100, 62, "track-1"),
                make_note(2000, 2100, 64, "track-1"),
            ]))
            .unwrap();

        // Drain SetNotes command without playing.
        sched.tick(0, 1, false);

        // Seek past the first two notes.
        sched.handle_seek(1500);

        // Buffer [1500, 1756): no notes in this range.
        sched.tick(1500, 256, true);
        assert!(midi_rx.try_recv().is_err(), "notes before seek should not fire");

        // Buffer [2000, 2256): note at 2000 should fire.
        sched.tick(2000, 256, true);
        let ev = midi_rx.try_recv().expect("expected NoteOn at 2000");
        assert!(matches!(ev.event, MidiEvent::NoteOn { note: 64, .. }));
    }

    #[test]
    fn handle_seek_silences_active_notes() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                0, 100_000, 60, "track-1",
            )]))
            .unwrap();

        // Start the note.
        sched.tick(0, 256, true);
        let _ = midi_rx.try_recv(); // consume NoteOn

        // Seek should emit NoteOff for the active note.
        sched.handle_seek(5000);
        let ev = midi_rx.try_recv().expect("expected NoteOff on seek");
        assert!(matches!(ev.event, MidiEvent::NoteOff { note: 60, .. }));
    }

    // -----------------------------------------------------------------------
    // Stop
    // -----------------------------------------------------------------------

    #[test]
    fn handle_stop_silences_active_notes() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                0, 100_000, 60, "track-1",
            )]))
            .unwrap();

        sched.tick(0, 256, true);
        let _ = midi_rx.try_recv(); // consume NoteOn

        sched.handle_stop();
        let ev = midi_rx.try_recv().expect("expected NoteOff on stop");
        assert!(matches!(ev.event, MidiEvent::NoteOff { note: 60, .. }));
    }

    // -----------------------------------------------------------------------
    // SetNotes replaces list
    // -----------------------------------------------------------------------

    #[test]
    fn set_notes_stops_active_notes_and_resets_cursor() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);

        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                0, 100_000, 60, "track-1",
            )]))
            .unwrap();
        sched.tick(0, 256, true);
        let _ = midi_rx.try_recv(); // consume NoteOn

        // Replace with a new note list.
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![make_note(
                500, 600, 62, "track-1",
            )]))
            .unwrap();
        sched.tick(256, 256, true); // drains SetNotes, emits NoteOff for note 60

        let ev = midi_rx.try_recv().expect("expected NoteOff from SetNotes");
        assert!(matches!(ev.event, MidiEvent::NoteOff { note: 60, .. }));
    }

    // -----------------------------------------------------------------------
    // Loop boundary detection
    // -----------------------------------------------------------------------

    #[test]
    fn loop_wrap_detected_and_cursor_reset() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx, midi_rx) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx);

        // Two notes: one at start (bar 0) and one at sample 1000.
        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![
                make_note(0, 100, 60, "track-1"),
                make_note(1000, 1100, 62, "track-1"),
            ]))
            .unwrap();

        // Play buffer [0, 256) — fires note at 0.
        sched.tick(0, 256, true);
        let _ = midi_rx.try_recv(); // NoteOn
        // NoteOff for off_sample=100 fires in same buffer.
        let _ = midi_rx.try_recv().ok(); // NoteOff (may or may not be present)

        // Simulate loop wrap: position moves back to 0 (lower than prev_position=256).
        sched.tick(0, 256, true);
        let ev = midi_rx.try_recv().expect("note at 0 should replay after loop wrap");
        assert!(matches!(ev.event, MidiEvent::NoteOn { note: 60, .. }));
    }

    // -----------------------------------------------------------------------
    // Multi-track routing
    // -----------------------------------------------------------------------

    #[test]
    fn notes_routed_to_correct_track() {
        let (mut sched, cmd_tx) = make_scheduler();
        let (midi_tx1, midi_rx1) = make_midi_channel();
        let (midi_tx2, midi_rx2) = make_midi_channel();
        register_track(&cmd_tx, "track-1", midi_tx1);
        register_track(&cmd_tx, "track-2", midi_tx2);

        cmd_tx
            .send(SchedulerCommand::SetNotes(vec![
                make_note(0, 100, 60, "track-1"),
                make_note(0, 100, 62, "track-2"),
            ]))
            .unwrap();

        sched.tick(0, 256, true);

        let ev1 = midi_rx1.try_recv().expect("track-1 should receive event");
        let ev2 = midi_rx2.try_recv().expect("track-2 should receive event");
        assert!(matches!(ev1.event, MidiEvent::NoteOn { note: 60, .. }));
        assert!(matches!(ev2.event, MidiEvent::NoteOn { note: 62, .. }));
    }

    // -----------------------------------------------------------------------
    // Bar-to-sample math reference test
    // -----------------------------------------------------------------------

    #[test]
    fn bar_to_sample_math_at_120bpm_4_4() {
        // At 120 BPM, 4/4, 44100 Hz:
        //   samples_per_beat = (44100 * 60) / 120 = 22050
        //   samples_per_bar  = 22050 * 4           = 88200
        let bpm: f64 = 120.0;
        let beats_per_bar: f64 = 4.0;
        let sample_rate: f64 = 44100.0;
        let spb = (sample_rate * 60.0) / bpm;
        let bar_samples = (1.0 * beats_per_bar * spb) as u64;
        assert_eq!(bar_samples, 88200);
    }
}
