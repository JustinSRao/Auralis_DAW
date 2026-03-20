//! Transport clock and state management for the DAW.
//!
//! The [`TransportClock`] is the single authoritative timing source for all
//! sequencing, automation, and playback in the application. It lives
//! exclusively on the audio thread — all fields are plain values with no
//! interior mutability required on the hot path.
//!
//! Commands from the main thread arrive via the [`super::engine::AudioCommand`]
//! channel and are applied by the corresponding `apply_*` methods.
//!
//! The clock shares a [`TransportSnapshot`] (behind an `Arc<Mutex<>>`) with the
//! main thread. It is written on every `advance()` call via a non-blocking
//! `try_lock()` so the 60 fps event poller in `lib.rs` can read it without
//! ever blocking the audio thread.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::tempo_map::CumulativeTempoMap;

/// Number of ticks per beat (Pulses Per Quarter Note).
///
/// 480 PPQN is a standard DAW resolution, giving fine sub-beat precision.
pub const TICKS_PER_BEAT: u32 = 480;

/// Minimum allowed BPM (inclusive).
pub const BPM_MIN: f64 = 20.0;

/// Maximum allowed BPM (inclusive).
pub const BPM_MAX: f64 = 300.0;

/// Minimum allowed metronome pitch in Hz.
const METRONOME_PITCH_MIN: f32 = 200.0;

/// Maximum allowed metronome pitch in Hz.
const METRONOME_PITCH_MAX: f32 = 5000.0;

// ---------------------------------------------------------------------------
// Enums and positions
// ---------------------------------------------------------------------------

/// The transport playback state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportState {
    /// Engine is idle; playhead at rest.
    Stopped,
    /// Actively playing back audio.
    Playing,
    /// Paused mid-playback; playhead holds position.
    Paused,
    /// Playing back and writing audio to a record-armed track.
    Recording,
}

/// A bars:beats:ticks position within the song timeline.
///
/// `bar` and `beat` are **1-indexed** (bar 1, beat 1 = the very start).
/// `tick` is **0-indexed** within a beat, from `0` to [`TICKS_PER_BEAT`]` - 1`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct BbtPosition {
    /// 1-indexed bar number.
    pub bar: u32,
    /// 1-indexed beat within the bar.
    pub beat: u32,
    /// 0-indexed tick within the beat (0..TICKS_PER_BEAT-1).
    pub tick: u32,
}

impl BbtPosition {
    /// Returns the position at the very start of the timeline (bar 1, beat 1, tick 0).
    pub fn origin() -> Self {
        Self {
            bar: 1,
            beat: 1,
            tick: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Snapshot (main-thread-readable clone of transport state)
// ---------------------------------------------------------------------------

/// Serializable snapshot of all transport state.
///
/// This is the payload sent over the `transport-state` Tauri event and
/// returned by the `get_transport_state` IPC command. It is updated by the
/// audio thread (via `try_lock`) and read by the main thread.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransportSnapshot {
    /// Human-readable state string: `"stopped"`, `"playing"`, `"paused"`, or `"recording"`.
    pub state: String,
    /// Absolute playhead position in samples from the start of the song.
    pub position_samples: u64,
    /// Playhead position as bars:beats:ticks.
    pub bbt: BbtPosition,
    /// Current BPM (beats per minute).
    pub bpm: f64,
    /// Beats per bar (time signature numerator).
    pub time_sig_numerator: u8,
    /// Beat unit (time signature denominator; 4 = quarter note).
    pub time_sig_denominator: u8,
    /// Whether loop playback is active.
    pub loop_enabled: bool,
    /// Loop region start in absolute samples.
    pub loop_start_samples: u64,
    /// Loop region end in absolute samples.
    pub loop_end_samples: u64,
    /// Whether the metronome click track is audible.
    pub metronome_enabled: bool,
    /// Metronome click volume (0.0–1.0).
    pub metronome_volume: f32,
    /// Metronome click pitch in Hz.
    pub metronome_pitch_hz: f32,
    /// Whether a track is armed for recording.
    pub record_armed: bool,
    /// Whether punch recording mode is active.
    #[serde(default)]
    pub punch_enabled: bool,
    /// Punch-in point in samples (where recording starts automatically).
    #[serde(default)]
    pub punch_in_samples: u64,
    /// Punch-out point in samples (where recording stops automatically).
    #[serde(default)]
    pub punch_out_samples: u64,
}

impl Default for TransportSnapshot {
    fn default() -> Self {
        Self {
            state: "stopped".to_string(),
            position_samples: 0,
            bbt: BbtPosition::origin(),
            bpm: 120.0,
            time_sig_numerator: 4,
            time_sig_denominator: 4,
            loop_enabled: false,
            loop_start_samples: 0,
            loop_end_samples: 0,
            metronome_enabled: false,
            metronome_volume: 0.5,
            metronome_pitch_hz: 1000.0,
            record_armed: false,
            punch_enabled: false,
            punch_in_samples: 0,
            punch_out_samples: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Shared atomics (for MetronomeNode and future audio nodes)
// ---------------------------------------------------------------------------

/// Lock-free atomics written by [`TransportClock`] and read by audio nodes.
///
/// All fields are `Arc<Atomic*>`, allowing cheap cloning so multiple audio
/// nodes (e.g. [`super::metronome::MetronomeNode`], future step sequencer) can
/// each hold their own `Arc` and read position/tempo data with zero contention.
///
/// Float values are encoded as their bit representation in `u64` (using
/// `f64::to_bits` / `f64::from_bits`), since there is no stable `AtomicF64`.
#[derive(Clone)]
pub struct TransportAtomics {
    /// Current playhead position in samples. Written every audio buffer.
    pub playhead_samples: Arc<AtomicU64>,
    /// Samples per beat at current BPM, encoded as `f64::to_bits`.
    ///
    /// Decode with `f64::from_bits(val)`.
    pub samples_per_beat_bits: Arc<AtomicU64>,
    /// `true` while transport state is `Playing` or `Recording`.
    pub is_playing: Arc<AtomicBool>,
    /// Beats per bar (time signature numerator).
    pub time_sig_numerator: Arc<AtomicU8>,
    /// `true` while the metronome click track is active.
    pub metronome_enabled: Arc<AtomicBool>,
    /// Metronome volume (0.0–1.0), encoded as `f64::to_bits`.
    pub metronome_volume_bits: Arc<AtomicU64>,
    /// Metronome pitch in Hz, encoded as `f64::to_bits`.
    pub metronome_pitch_bits: Arc<AtomicU64>,
}

impl TransportAtomics {
    /// Creates a new set of atomics with defaults (120 BPM, 4/4, metronome off).
    pub fn new(initial_bpm: f64, sample_rate: u32) -> Self {
        let spb = samples_per_beat(initial_bpm, sample_rate);
        Self {
            playhead_samples: Arc::new(AtomicU64::new(0)),
            samples_per_beat_bits: Arc::new(AtomicU64::new(spb.to_bits())),
            is_playing: Arc::new(AtomicBool::new(false)),
            time_sig_numerator: Arc::new(AtomicU8::new(4)),
            metronome_enabled: Arc::new(AtomicBool::new(false)),
            metronome_volume_bits: Arc::new(AtomicU64::new(0.5_f64.to_bits())),
            metronome_pitch_bits: Arc::new(AtomicU64::new(1000.0_f64.to_bits())),
        }
    }
}

// ---------------------------------------------------------------------------
// TransportClock
// ---------------------------------------------------------------------------

/// The authoritative transport clock. Lives exclusively on the audio thread.
///
/// All timing state is stored as plain values (no `Arc`, no `Mutex` on the hot
/// path). Each audio callback:
///
/// 1. Drains `AudioCommand` transport variants and calls the corresponding
///    `apply_*` method.
/// 2. Calls [`TransportClock::advance`] to tick the playhead forward by
///    `buffer_size` samples and update shared atomics.
///
/// # Thread safety
///
/// This struct is `!Send + !Sync` by default (no sharing possible). It is
/// moved into the `cpal` output stream closure and stays there until the
/// stream is dropped. Access from the main thread goes exclusively through
/// the command channel and the shared [`TransportSnapshot`] mutex.
pub struct TransportClock {
    /// Current transport state.
    pub state: TransportState,
    /// Absolute playhead position in samples from the song start.
    pub position_samples: u64,
    /// Current BPM (20–300).
    pub bpm: f64,
    /// Audio stream sample rate (Hz).
    pub sample_rate: u32,
    /// Beats per bar.
    pub time_sig_numerator: u8,
    /// Beat unit (4 = quarter note).
    pub time_sig_denominator: u8,
    /// Whether loop playback is active.
    pub loop_enabled: bool,
    /// Loop start position in beats (authoritative; drives `loop_start_samples`).
    pub loop_start_beats: f64,
    /// Loop end position in beats (authoritative; drives `loop_end_samples`).
    pub loop_end_beats: f64,
    /// Loop start in absolute samples (derived; recomputed on BPM change).
    pub loop_start_samples: u64,
    /// Loop end in absolute samples (derived; recomputed on BPM change).
    pub loop_end_samples: u64,
    /// Whether the metronome is audible.
    pub metronome_enabled: bool,
    /// Metronome click volume (0.0–1.0).
    pub metronome_volume: f32,
    /// Metronome click pitch in Hz.
    pub metronome_pitch_hz: f32,
    /// Whether a track is armed for recording.
    pub record_armed: bool,
    /// Whether punch recording mode is enabled.
    pub punch_enabled: bool,
    /// Punch-in point in beats (authoritative).
    pub punch_in_beats: f64,
    /// Punch-out point in beats (authoritative).
    pub punch_out_beats: f64,
    /// Punch-in in samples (derived from beats + BPM).
    pub punch_in_samples: u64,
    /// Punch-out in samples (derived from beats + BPM).
    pub punch_out_samples: u64,
    /// Derived: samples per beat at current BPM. Recomputed on BPM change.
    samples_per_beat: f64,
    /// Lock-free atomics shared with MetronomeNode and future audio nodes.
    pub atomics: TransportAtomics,
    /// Shared snapshot updated on every `advance()`. Read by the 60 fps poller.
    snapshot: Arc<Mutex<TransportSnapshot>>,
}

impl TransportClock {
    /// Creates a new clock at 120 BPM, 4/4 time, in the `Stopped` state.
    pub fn new(
        sample_rate: u32,
        atomics: TransportAtomics,
        snapshot: Arc<Mutex<TransportSnapshot>>,
    ) -> Self {
        let bpm = 120.0_f64;
        let spb = samples_per_beat(bpm, sample_rate);
        Self {
            state: TransportState::Stopped,
            position_samples: 0,
            bpm,
            sample_rate,
            time_sig_numerator: 4,
            time_sig_denominator: 4,
            loop_enabled: false,
            loop_start_beats: 0.0,
            loop_end_beats: 16.0,
            loop_start_samples: 0,
            loop_end_samples: (16.0 * spb) as u64,
            metronome_enabled: false,
            metronome_volume: 0.5,
            metronome_pitch_hz: 1000.0,
            record_armed: false,
            punch_enabled: false,
            punch_in_beats: 0.0,
            punch_out_beats: 0.0,
            punch_in_samples: 0,
            punch_out_samples: 0,
            samples_per_beat: spb,
            atomics,
            snapshot,
        }
    }

    // -----------------------------------------------------------------------
    // Hot path — called every audio buffer
    // -----------------------------------------------------------------------

    /// Advances the playhead by `buffer_frames` samples.
    ///
    /// Called from the audio callback on every buffer. This method MUST NOT
    /// allocate, block, or take any long-held lock.
    pub fn advance(&mut self, buffer_frames: usize) {
        if self.state != TransportState::Playing && self.state != TransportState::Recording {
            return;
        }

        self.position_samples += buffer_frames as u64;

        // Loop wrap
        if self.loop_enabled
            && self.loop_end_samples > self.loop_start_samples
            && self.position_samples >= self.loop_end_samples
        {
            let loop_length = self.loop_end_samples - self.loop_start_samples;
            let overshoot = self.position_samples - self.loop_end_samples;
            self.position_samples = self.loop_start_samples + (overshoot % loop_length);
        }

        // Update shared atomic for MetronomeNode
        self.atomics
            .playhead_samples
            .store(self.position_samples, Ordering::Release);

        // Write snapshot non-blockingly (skip if poller has the lock)
        self.try_write_snapshot();
    }

    // -----------------------------------------------------------------------
    // Command handlers (called from audio_callback after channel drain)
    // -----------------------------------------------------------------------

    /// Starts playback from the current position.
    pub fn apply_play(&mut self) {
        if self.state == TransportState::Stopped || self.state == TransportState::Paused {
            self.state = TransportState::Playing;
            self.atomics.is_playing.store(true, Ordering::Release);
            self.try_write_snapshot();
        }
    }

    /// Stops playback and resets the playhead to 0 (or loop start if looping).
    pub fn apply_stop(&mut self) {
        self.state = TransportState::Stopped;
        self.position_samples = if self.loop_enabled {
            self.loop_start_samples
        } else {
            0
        };
        self.atomics.is_playing.store(false, Ordering::Release);
        self.atomics
            .playhead_samples
            .store(self.position_samples, Ordering::Release);
        self.try_write_snapshot();
    }

    /// Pauses playback, holding the current position.
    pub fn apply_pause(&mut self) {
        if self.state == TransportState::Playing || self.state == TransportState::Recording {
            self.state = TransportState::Paused;
            self.atomics.is_playing.store(false, Ordering::Release);
            self.try_write_snapshot();
        }
    }

    /// Arms for recording and starts recording (requires `record_armed = true`).
    pub fn apply_record(&mut self) {
        if self.record_armed
            && (self.state == TransportState::Stopped || self.state == TransportState::Paused)
        {
            self.state = TransportState::Recording;
            self.atomics.is_playing.store(true, Ordering::Release);
            self.try_write_snapshot();
        }
    }

    /// Changes BPM while **preserving the current musical (beat) position**.
    ///
    /// The sample position is recalculated so the playhead stays on the same
    /// bar/beat. Loop region start/end are also recalculated from their
    /// beat-authoritative values.
    pub fn apply_set_bpm(&mut self, new_bpm: f64) {
        let new_bpm = new_bpm.clamp(BPM_MIN, BPM_MAX);
        if (new_bpm - self.bpm).abs() < f64::EPSILON {
            return;
        }

        // Preserve beat position
        let old_spb = self.samples_per_beat;
        let beat_position = self.position_samples as f64 / old_spb;
        let new_spb = samples_per_beat(new_bpm, self.sample_rate);
        self.position_samples = (beat_position * new_spb) as u64;

        self.bpm = new_bpm;
        self.samples_per_beat = new_spb;

        // Recalculate loop region from beat-authoritative values
        self.loop_start_samples = (self.loop_start_beats * new_spb) as u64;
        self.loop_end_samples = (self.loop_end_beats * new_spb) as u64;

        // Recalculate punch region from beat-authoritative values
        self.punch_in_samples = (self.punch_in_beats * new_spb) as u64;
        self.punch_out_samples = (self.punch_out_beats * new_spb) as u64;

        self.atomics
            .samples_per_beat_bits
            .store(new_spb.to_bits(), Ordering::Release);
        self.atomics
            .playhead_samples
            .store(self.position_samples, Ordering::Release);

        self.try_write_snapshot();
    }

    /// Applies a new variable-tempo map, updating `bpm` and all derived
    /// sample positions from their beat-authoritative values.
    ///
    /// Called from the audio callback when a new [`CumulativeTempoMap`] arrives
    /// via the bounded channel.  This method is allocation-free; all fields are
    /// plain values on the stack.
    pub fn apply_new_tempo_map(&mut self, map: CumulativeTempoMap) {
        // Read new instantaneous BPM and SPB at the current sample position
        let new_bpm = map.current_bpm_at_sample(self.position_samples);
        let new_spb = map.current_spb_at_sample(self.position_samples);

        self.bpm = new_bpm;
        self.samples_per_beat = new_spb;

        // Recompute all beat→sample derived positions using the new map
        self.loop_start_samples = (self.loop_start_beats * new_spb) as u64;
        self.loop_end_samples = (self.loop_end_beats * new_spb) as u64;
        self.punch_in_samples = (self.punch_in_beats * new_spb) as u64;
        self.punch_out_samples = (self.punch_out_beats * new_spb) as u64;

        // Update shared atomics so MetronomeNode, LFO, step sequencer etc. see
        // the new tempo immediately within this same buffer.
        self.atomics
            .samples_per_beat_bits
            .store(new_spb.to_bits(), Ordering::Release);
        self.atomics
            .playhead_samples
            .store(self.position_samples, Ordering::Release);

        self.try_write_snapshot();
    }

    /// Sets the time signature.
    pub fn apply_set_time_signature(&mut self, numerator: u8, denominator: u8) {
        self.time_sig_numerator = numerator;
        self.time_sig_denominator = denominator;
        self.atomics
            .time_sig_numerator
            .store(numerator, Ordering::Release);
        self.try_write_snapshot();
    }

    /// Sets the loop region in beats (authoritative) and derives sample positions.
    ///
    /// Negative values are clamped to 0. `start_beats` must be ≤ `end_beats`.
    pub fn apply_set_loop_region(&mut self, start_beats: f64, end_beats: f64) {
        let start = start_beats.max(0.0);
        let end = end_beats.max(0.0);
        // Enforce the invariant: start must be strictly less than end.
        if start >= end {
            return;
        }
        self.loop_start_beats = start;
        self.loop_end_beats = end;
        self.loop_start_samples = (self.loop_start_beats * self.samples_per_beat) as u64;
        self.loop_end_samples = (self.loop_end_beats * self.samples_per_beat) as u64;
        self.try_write_snapshot();
    }

    /// Enables or disables loop playback.
    pub fn apply_toggle_loop(&mut self, enabled: bool) {
        self.loop_enabled = enabled;
        self.try_write_snapshot();
    }

    /// Enables or disables the metronome click track.
    pub fn apply_toggle_metronome(&mut self, enabled: bool) {
        self.metronome_enabled = enabled;
        self.atomics
            .metronome_enabled
            .store(enabled, Ordering::Release);
        self.try_write_snapshot();
    }

    /// Sets the metronome click volume (clamped to 0.0–1.0).
    pub fn apply_set_metronome_volume(&mut self, volume: f32) {
        let volume = volume.clamp(0.0, 1.0);
        self.metronome_volume = volume;
        self.atomics
            .metronome_volume_bits
            .store((volume as f64).to_bits(), Ordering::Release);
        self.try_write_snapshot();
    }

    /// Sets the metronome click pitch in Hz (clamped to 200–5000 Hz).
    pub fn apply_set_metronome_pitch(&mut self, pitch_hz: f32) {
        let pitch_hz = pitch_hz.clamp(METRONOME_PITCH_MIN, METRONOME_PITCH_MAX);
        self.metronome_pitch_hz = pitch_hz;
        self.atomics
            .metronome_pitch_bits
            .store((pitch_hz as f64).to_bits(), Ordering::Release);
        self.try_write_snapshot();
    }

    /// Arms or disarms a track for recording.
    pub fn apply_set_record_armed(&mut self, armed: bool) {
        self.record_armed = armed;
        self.try_write_snapshot();
    }

    /// Sets the punch in/out region in beats and derives the sample positions.
    ///
    /// Both values are clamped to `>= 0.0`. If `in_beats >= out_beats` the
    /// call is silently ignored (a degenerate region is meaningless).
    pub fn apply_set_punch_region(&mut self, in_beats: f64, out_beats: f64) {
        let in_b = in_beats.max(0.0);
        let out_b = out_beats.max(0.0);
        if in_b >= out_b {
            return;
        }
        self.punch_in_beats = in_b;
        self.punch_out_beats = out_b;
        self.punch_in_samples = (in_b * self.samples_per_beat) as u64;
        self.punch_out_samples = (out_b * self.samples_per_beat) as u64;
        self.try_write_snapshot();
    }

    /// Enables or disables punch recording mode.
    pub fn apply_toggle_punch(&mut self, enabled: bool) {
        self.punch_enabled = enabled;
        self.try_write_snapshot();
    }

    /// Seeks to an absolute sample position. Only effective when stopped or paused.
    pub fn apply_seek(&mut self, position_samples: u64) {
        if self.state == TransportState::Stopped || self.state == TransportState::Paused {
            self.position_samples = position_samples;
            self.atomics
                .playhead_samples
                .store(position_samples, Ordering::Release);
            self.try_write_snapshot();
        }
    }

    // -----------------------------------------------------------------------
    // Position math
    // -----------------------------------------------------------------------

    /// Converts an absolute sample position to a [`BbtPosition`].
    ///
    /// Uses the current BPM and time signature. The returned position changes
    /// immediately when [`apply_set_bpm`] is called — no accumulated error.
    ///
    /// [`apply_set_bpm`]: Self::apply_set_bpm
    pub fn samples_to_bbt(&self, samples: u64) -> BbtPosition {
        let total_beats_f = samples as f64 / self.samples_per_beat;
        let total_beats = total_beats_f as u64;
        let tick =
            ((total_beats_f - total_beats as f64) * TICKS_PER_BEAT as f64) as u32;
        let beats_per_bar = self.time_sig_numerator as u64;
        let bar = (total_beats / beats_per_bar) as u32 + 1;
        let beat = (total_beats % beats_per_bar) as u32 + 1;
        BbtPosition { bar, beat, tick }
    }

    // -----------------------------------------------------------------------
    // Snapshot write
    // -----------------------------------------------------------------------

    /// Tries to write the current state to the shared snapshot.
    ///
    /// Uses `try_lock` — if the mutex is contended (main thread is reading),
    /// this call is silently skipped. The next `advance()` will try again.
    /// This ensures the audio thread **never blocks**.
    pub fn try_write_snapshot(&self) {
        if let Ok(mut snap) = self.snapshot.try_lock() {
            snap.state = match self.state {
                TransportState::Stopped => "stopped",
                TransportState::Playing => "playing",
                TransportState::Paused => "paused",
                TransportState::Recording => "recording",
            }
            .to_string();
            snap.position_samples = self.position_samples;
            snap.bbt = self.samples_to_bbt(self.position_samples);
            snap.bpm = self.bpm;
            snap.time_sig_numerator = self.time_sig_numerator;
            snap.time_sig_denominator = self.time_sig_denominator;
            snap.loop_enabled = self.loop_enabled;
            snap.loop_start_samples = self.loop_start_samples;
            snap.loop_end_samples = self.loop_end_samples;
            snap.metronome_enabled = self.metronome_enabled;
            snap.metronome_volume = self.metronome_volume;
            snap.metronome_pitch_hz = self.metronome_pitch_hz;
            snap.record_armed = self.record_armed;
            snap.punch_enabled = self.punch_enabled;
            snap.punch_in_samples = self.punch_in_samples;
            snap.punch_out_samples = self.punch_out_samples;
        }
        // If try_lock fails, silently skip — audio thread must never block.
    }
}

// ---------------------------------------------------------------------------
// Pure math helper
// ---------------------------------------------------------------------------

/// Calculates samples per beat for a given BPM and sample rate.
///
/// `samples_per_beat = (sample_rate_hz × 60) / bpm`
#[inline]
pub fn samples_per_beat(bpm: f64, sample_rate: u32) -> f64 {
    (sample_rate as f64 * 60.0) / bpm
}

// ---------------------------------------------------------------------------
// Unit tests (no audio hardware required)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_clock(bpm: f64, numerator: u8) -> TransportClock {
        let sr = 44100u32;
        let atomics = TransportAtomics::new(bpm, sr);
        let snap = Arc::new(Mutex::new(TransportSnapshot::default()));
        let mut clock = TransportClock::new(sr, atomics, snap);
        clock.bpm = bpm;
        clock.samples_per_beat = samples_per_beat(bpm, sr);
        clock.time_sig_numerator = numerator;
        clock
    }

    // --- BBT calculation ---

    #[test]
    fn test_bbt_at_zero() {
        let clock = make_clock(120.0, 4);
        let bbt = clock.samples_to_bbt(0);
        assert_eq!(bbt, BbtPosition::origin());
    }

    #[test]
    fn test_bbt_advances_one_beat_at_120bpm() {
        let clock = make_clock(120.0, 4);
        let spb = clock.samples_per_beat as u64;
        let bbt = clock.samples_to_bbt(spb);
        assert_eq!(bbt.bar, 1);
        assert_eq!(bbt.beat, 2);
        assert_eq!(bbt.tick, 0);
    }

    #[test]
    fn test_bbt_advances_one_bar_at_120bpm_four_four() {
        let clock = make_clock(120.0, 4);
        let spb = clock.samples_per_beat;
        let four_beats = (4.0 * spb) as u64;
        let bbt = clock.samples_to_bbt(four_beats);
        assert_eq!(bbt.bar, 2);
        assert_eq!(bbt.beat, 1);
        assert_eq!(bbt.tick, 0);
    }

    #[test]
    fn test_bbt_three_four_time() {
        let clock = make_clock(120.0, 3);
        let spb = clock.samples_per_beat;
        // 3 beats = bar 2 in 3/4
        let three_beats = (3.0 * spb) as u64;
        let bbt = clock.samples_to_bbt(three_beats);
        assert_eq!(bbt.bar, 2);
        assert_eq!(bbt.beat, 1);
    }

    #[test]
    fn test_bbt_at_80bpm() {
        let clock = make_clock(80.0, 4);
        let spb = clock.samples_per_beat;
        // Expected: (44100 * 60) / 80 = 33075 samples per beat
        let expected_spb = (44100.0 * 60.0) / 80.0;
        assert!((spb - expected_spb).abs() < 0.001);
        let bbt = clock.samples_to_bbt((expected_spb * 2.0) as u64);
        assert_eq!(bbt.beat, 3);
    }

    #[test]
    fn test_bbt_tick_sub_beat() {
        let clock = make_clock(120.0, 4);
        let half_beat = (clock.samples_per_beat * 0.5) as u64;
        let bbt = clock.samples_to_bbt(half_beat);
        assert_eq!(bbt.beat, 1);
        // Tick should be TICKS_PER_BEAT/2 = 240
        assert!((bbt.tick as i32 - 240).abs() <= 1);
    }

    // --- Loop wrap ---

    #[test]
    fn test_loop_wraps_at_end() {
        let mut clock = make_clock(120.0, 4);
        let spb = clock.samples_per_beat;
        clock.loop_enabled = true;
        clock.loop_start_samples = 0;
        clock.loop_end_samples = (4.0 * spb) as u64;
        clock.state = TransportState::Playing;
        clock.position_samples = clock.loop_end_samples - 10;

        clock.advance(20); // cross the loop boundary

        assert!(clock.position_samples < clock.loop_end_samples);
        assert!(clock.position_samples >= clock.loop_start_samples);
    }

    #[test]
    fn test_loop_wrap_with_nonzero_start() {
        let mut clock = make_clock(120.0, 4);
        let spb = clock.samples_per_beat;
        let start = (2.0 * spb) as u64;
        let end = (6.0 * spb) as u64;
        clock.loop_enabled = true;
        clock.loop_start_samples = start;
        clock.loop_end_samples = end;
        clock.state = TransportState::Playing;
        clock.position_samples = end - 5;

        clock.advance(20);

        // Overshoot = 20 - 5 = 15 samples past end
        // loop_length = end - start
        let loop_length = end - start;
        let expected = start + (15 % loop_length);
        assert_eq!(clock.position_samples, expected);
    }

    #[test]
    fn test_loop_disabled_does_not_wrap() {
        let mut clock = make_clock(120.0, 4);
        let spb = clock.samples_per_beat;
        clock.loop_enabled = false;
        clock.loop_start_samples = 0;
        clock.loop_end_samples = (4.0 * spb) as u64;
        clock.state = TransportState::Playing;
        clock.position_samples = clock.loop_end_samples - 10;

        clock.advance(100);

        assert!(clock.position_samples > clock.loop_end_samples);
    }

    // --- BPM change preserves musical position ---

    #[test]
    fn test_bpm_change_preserves_beat_position() {
        let mut clock = make_clock(120.0, 4);
        let spb_120 = clock.samples_per_beat;
        // Position at beat 2.0 exactly (at 120 BPM)
        clock.state = TransportState::Playing;
        clock.position_samples = (2.0 * spb_120) as u64;

        clock.apply_set_bpm(60.0);

        let spb_60 = samples_per_beat(60.0, 44100);
        // At 60 BPM, beat 2.0 should be at 2 * spb_60 samples
        let expected = (2.0 * spb_60) as u64;
        // Allow ±1 sample for integer rounding
        assert!((clock.position_samples as i64 - expected as i64).abs() <= 1);
    }

    #[test]
    fn test_bpm_change_recalculates_loop_samples() {
        let mut clock = make_clock(120.0, 4);
        clock.loop_start_beats = 0.0;
        clock.loop_end_beats = 4.0; // 4 beats
        let spb = clock.samples_per_beat;
        clock.loop_start_samples = 0;
        clock.loop_end_samples = (4.0 * spb) as u64;
        clock.state = TransportState::Stopped;

        clock.apply_set_bpm(60.0);

        let spb_60 = samples_per_beat(60.0, 44100);
        let expected_end = (4.0 * spb_60) as u64;
        assert!((clock.loop_end_samples as i64 - expected_end as i64).abs() <= 1);
    }

    // --- State transitions ---

    #[test]
    fn test_advance_does_nothing_when_stopped() {
        let mut clock = make_clock(120.0, 4);
        assert_eq!(clock.state, TransportState::Stopped);
        clock.advance(256);
        assert_eq!(clock.position_samples, 0);
    }

    #[test]
    fn test_advance_does_nothing_when_paused() {
        let mut clock = make_clock(120.0, 4);
        clock.state = TransportState::Paused;
        clock.position_samples = 1000;
        clock.advance(256);
        assert_eq!(clock.position_samples, 1000);
    }

    #[test]
    fn test_play_transitions_from_stopped() {
        let mut clock = make_clock(120.0, 4);
        clock.apply_play();
        assert_eq!(clock.state, TransportState::Playing);
    }

    #[test]
    fn test_stop_resets_position_to_zero() {
        let mut clock = make_clock(120.0, 4);
        clock.state = TransportState::Playing;
        clock.position_samples = 10000;
        clock.apply_stop();
        assert_eq!(clock.state, TransportState::Stopped);
        assert_eq!(clock.position_samples, 0);
    }

    #[test]
    fn test_stop_with_loop_resets_to_loop_start() {
        let mut clock = make_clock(120.0, 4);
        clock.loop_enabled = true;
        clock.loop_start_samples = 5000;
        clock.state = TransportState::Playing;
        clock.position_samples = 10000;
        clock.apply_stop();
        assert_eq!(clock.position_samples, 5000);
    }

    #[test]
    fn test_pause_from_playing() {
        let mut clock = make_clock(120.0, 4);
        clock.state = TransportState::Playing;
        clock.position_samples = 9999;
        clock.apply_pause();
        assert_eq!(clock.state, TransportState::Paused);
        assert_eq!(clock.position_samples, 9999);
    }

    #[test]
    fn test_play_from_paused_resumes() {
        let mut clock = make_clock(120.0, 4);
        clock.state = TransportState::Paused;
        clock.position_samples = 9999;
        clock.apply_play();
        assert_eq!(clock.state, TransportState::Playing);
        assert_eq!(clock.position_samples, 9999);
    }

    // --- Snapshot serialization ---

    #[test]
    fn test_snapshot_default_serializes() {
        let snap = TransportSnapshot::default();
        let json = serde_json::to_string(&snap).expect("serialization failed");
        let decoded: TransportSnapshot =
            serde_json::from_str(&json).expect("deserialization failed");
        assert_eq!(snap, decoded);
    }

    #[test]
    fn test_bbt_position_serializes() {
        let bbt = BbtPosition {
            bar: 3,
            beat: 2,
            tick: 120,
        };
        let json = serde_json::to_string(&bbt).unwrap();
        let decoded: BbtPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(bbt, decoded);
    }

    // --- Metronome volume/pitch clamping ---

    #[test]
    fn test_metronome_volume_clamped() {
        let mut clock = make_clock(120.0, 4);
        clock.apply_set_metronome_volume(2.0);
        assert!((clock.metronome_volume - 1.0).abs() < f32::EPSILON);
        clock.apply_set_metronome_volume(-0.5);
        assert!(clock.metronome_volume.abs() < f32::EPSILON);
    }

    #[test]
    fn test_metronome_pitch_clamped() {
        let mut clock = make_clock(120.0, 4);
        clock.apply_set_metronome_pitch(99.0); // below min
        assert!((clock.metronome_pitch_hz - METRONOME_PITCH_MIN).abs() < f32::EPSILON);
        clock.apply_set_metronome_pitch(9999.0); // above max
        assert!((clock.metronome_pitch_hz - METRONOME_PITCH_MAX).abs() < f32::EPSILON);
    }

    // --- samples_per_beat helper ---

    #[test]
    fn test_samples_per_beat_120bpm() {
        let spb = samples_per_beat(120.0, 44100);
        // 44100 * 60 / 120 = 22050
        assert!((spb - 22050.0).abs() < 0.001);
    }

    #[test]
    fn test_samples_per_beat_60bpm() {
        let spb = samples_per_beat(60.0, 44100);
        // 44100 * 60 / 60 = 44100
        assert!((spb - 44100.0).abs() < 0.001);
    }
}
