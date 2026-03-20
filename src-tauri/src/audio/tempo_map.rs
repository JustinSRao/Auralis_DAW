//! Tempo map: converts between sample positions and musical time (ticks/beats)
//! using a variable-BPM piecewise function.
//!
//! The [`CumulativeTempoMap`] is the authoritative source of truth for all
//! sample↔tick conversions when tempo automation is active.  It is built once
//! (from a sorted list of [`TempoPoint`]s) and then queried lock-free on the
//! audio thread.

use serde::{Deserialize, Serialize};

/// Pulses (ticks) per quarter-note.  Must match `transport::TICKS_PER_BEAT` (480 PPQN).
pub const TICKS_PER_BEAT: u64 = 480;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Interpolation mode between two adjacent [`TempoPoint`]s.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum TempoInterp {
    /// Hold the BPM at the start-of-segment value until the next point.
    Step,
    /// Linearly ramp the BPM from this point's value to the next point's value.
    Linear,
}

/// A single automation point on the tempo track.
///
/// Stored in ascending `tick` order inside [`CumulativeTempoMap`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoPoint {
    /// Musical position of this point in ticks (480 PPQ).
    pub tick: u64,
    /// Tempo at this point in beats-per-minute.
    pub bpm: f64,
    /// How to interpolate BPM between this point and the next.
    pub interp: TempoInterp,
}

// ---------------------------------------------------------------------------
// CumulativeTempoMap
// ---------------------------------------------------------------------------

/// Pre-computed tempo map with O(log n) sample↔tick conversions.
///
/// Build once with [`CumulativeTempoMap::build`], then query repeatedly on
/// the audio thread.  Rebuilding is cheap for typical maps (< 1 000 points).
pub struct CumulativeTempoMap {
    /// Sorted tempo points (tick 0 is always present after `build`).
    points: Vec<TempoPoint>,
    /// `cumulative_samples[i]` = absolute sample position at `points[i].tick`.
    cumulative_samples: Vec<f64>,
    /// Audio sample rate used when building this map.
    sample_rate: u32,
}

impl CumulativeTempoMap {
    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    /// Builds a [`CumulativeTempoMap`] from an arbitrary (possibly unsorted,
    /// possibly empty) list of tempo points.
    ///
    /// # Guarantees after build
    ///
    /// * Points are sorted by tick ascending.
    /// * A default 120 BPM `Step` point at tick 0 is inserted if none exists.
    /// * All BPM values are clamped to [20.0, 300.0].
    pub fn build(mut points: Vec<TempoPoint>, sample_rate: u32) -> Self {
        // Sort ascending by tick
        points.sort_by_key(|p| p.tick);

        // Ensure a point at tick 0 always exists
        if points.is_empty() || points[0].tick > 0 {
            points.insert(
                0,
                TempoPoint {
                    tick: 0,
                    bpm: 120.0,
                    interp: TempoInterp::Step,
                },
            );
        }

        // Clamp BPM to valid range
        for p in &mut points {
            p.bpm = p.bpm.clamp(20.0, 300.0);
        }

        // Build cumulative sample table
        let n = points.len();
        let mut cumulative_samples = vec![0.0_f64; n];

        for i in 0..n - 1 {
            let delta_ticks = (points[i + 1].tick - points[i].tick) as f64;
            let spt_a = samples_per_tick(points[i].bpm, sample_rate);
            let segment_samples = match points[i].interp {
                TempoInterp::Step => delta_ticks * spt_a,
                TempoInterp::Linear => {
                    // Use the exact logarithmic integral (same formula as tick_to_sample)
                    // so the cumulative table is consistent with per-segment queries.
                    linear_tick_to_sample_offset(
                        delta_ticks,
                        delta_ticks,
                        points[i].bpm,
                        points[i + 1].bpm,
                        sample_rate,
                    )
                }
            };
            cumulative_samples[i + 1] = cumulative_samples[i] + segment_samples;
        }

        Self {
            points,
            cumulative_samples,
            sample_rate,
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /// Returns the instantaneous BPM at a given tick position.
    ///
    /// * For a `Step` segment, returns the BPM of the segment start point.
    /// * For a `Linear` segment, linearly interpolates.
    /// * Beyond the last point, returns the last point's BPM.
    pub fn bpm_at_tick(&self, tick: u64) -> f64 {
        let points = &self.points;
        if points.len() == 1 {
            return points[0].bpm;
        }
        // Safety: build() guarantees points is non-empty.
        let last = &points[points.len() - 1];
        if tick >= last.tick {
            return last.bpm;
        }
        // Binary search for the segment: points[i].tick <= tick < points[i+1].tick
        let i = self.segment_index_for_tick(tick);
        let p_a = &points[i];
        let p_b = &points[i + 1];
        match p_a.interp {
            TempoInterp::Step => p_a.bpm,
            TempoInterp::Linear => {
                let t = (tick - p_a.tick) as f64 / (p_b.tick - p_a.tick) as f64;
                p_a.bpm + (p_b.bpm - p_a.bpm) * t
            }
        }
    }

    /// Converts an absolute tick position to an absolute sample position.
    ///
    /// Uses the exact logarithmic integral for linear BPM ramps.
    pub fn tick_to_sample(&self, tick: u64) -> u64 {
        if self.points.len() == 1 {
            let spt = samples_per_tick(self.points[0].bpm, self.sample_rate);
            return (tick as f64 * spt) as u64;
        }
        // Find the segment that contains this tick.
        // Safety: build() guarantees points is non-empty.
        let last_tick = self.points[self.points.len() - 1].tick;
        let i = if tick >= last_tick {
            self.points.len() - 1
        } else {
            self.segment_index_for_tick(tick)
        };

        let p_a = &self.points[i];
        let local_ticks = (tick - p_a.tick) as f64;

        let offset = if i + 1 >= self.points.len() {
            // Past the last point — constant BPM
            local_ticks * samples_per_tick(p_a.bpm, self.sample_rate)
        } else {
            let p_b = &self.points[i + 1];
            match p_a.interp {
                TempoInterp::Step => local_ticks * samples_per_tick(p_a.bpm, self.sample_rate),
                TempoInterp::Linear => {
                    let delta_ticks = (p_b.tick - p_a.tick) as f64;
                    linear_tick_to_sample_offset(
                        local_ticks,
                        delta_ticks,
                        p_a.bpm,
                        p_b.bpm,
                        self.sample_rate,
                    )
                }
            }
        };

        (self.cumulative_samples[i] + offset) as u64
    }

    /// Converts an absolute sample position to an absolute tick position.
    ///
    /// Inverse of [`tick_to_sample`], using the exact inverse of the
    /// logarithmic integral for linear BPM ramps.
    pub fn sample_to_tick(&self, sample: u64) -> u64 {
        let sample_f = sample as f64;
        if self.points.len() == 1 {
            let spt = samples_per_tick(self.points[0].bpm, self.sample_rate);
            return (sample_f / spt) as u64;
        }

        // Find segment i where cumulative_samples[i] <= sample_f
        let i = self.segment_index_for_sample(sample_f);
        let p_a = &self.points[i];
        let local_samples = sample_f - self.cumulative_samples[i];

        let local_ticks = if i + 1 >= self.points.len() {
            // Past the last point — constant BPM
            local_samples / samples_per_tick(p_a.bpm, self.sample_rate)
        } else {
            let p_b = &self.points[i + 1];
            match p_a.interp {
                TempoInterp::Step => local_samples / samples_per_tick(p_a.bpm, self.sample_rate),
                TempoInterp::Linear => {
                    let delta_ticks = (p_b.tick - p_a.tick) as f64;
                    linear_sample_to_tick_offset(
                        local_samples,
                        delta_ticks,
                        p_a.bpm,
                        p_b.bpm,
                        self.sample_rate,
                    )
                }
            }
        };

        (p_a.tick as f64 + local_ticks) as u64
    }

    /// Returns the instantaneous samples-per-tick at a given tick position.
    pub fn samples_per_tick_at(&self, tick: u64) -> f64 {
        samples_per_tick(self.bpm_at_tick(tick), self.sample_rate)
    }

    /// Returns the instantaneous BPM at a given absolute sample position.
    pub fn current_bpm_at_sample(&self, sample: u64) -> f64 {
        self.bpm_at_tick(self.sample_to_tick(sample))
    }

    /// Returns samples-per-beat (= samples-per-quarter-note) at a given
    /// absolute sample position.  This is the value consumed by MetronomeNode,
    /// LFO, step sequencer etc.
    pub fn current_spb_at_sample(&self, sample: u64) -> f64 {
        let bpm = self.current_bpm_at_sample(sample);
        self.sample_rate as f64 * 60.0 / bpm
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Binary searches `points` for the segment index `i` such that
    /// `points[i].tick <= tick < points[i+1].tick`.
    ///
    /// Panics in debug if `tick >= points.last().tick` (caller must guard).
    fn segment_index_for_tick(&self, tick: u64) -> usize {
        let points = &self.points;
        // Upper bound search: find first point whose tick > tick
        let ub = points.partition_point(|p| p.tick <= tick);
        // ub is the index of the first point strictly greater than tick,
        // so the segment starts at ub - 1.
        ub.saturating_sub(1).min(points.len() - 1)
    }

    /// Binary searches `cumulative_samples` for the segment index `i` such
    /// that `cumulative_samples[i] <= sample_f < cumulative_samples[i+1]`.
    fn segment_index_for_sample(&self, sample_f: f64) -> usize {
        let cs = &self.cumulative_samples;
        let ub = cs.partition_point(|&s| s <= sample_f);
        ub.saturating_sub(1).min(cs.len() - 1)
    }
}

// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------

/// Samples per tick at a constant BPM.
#[inline]
fn samples_per_tick(bpm: f64, sample_rate: u32) -> f64 {
    sample_rate as f64 * 60.0 / (bpm * TICKS_PER_BEAT as f64)
}

/// Exact sample offset for `local_ticks` ticks into a linear BPM ramp from
/// `bpm_a` to `bpm_b` spanning `delta_ticks` ticks.
///
/// Derivation: spt(x) = sr*60/(bpm(x)*TPB) where bpm(x) = bpm_a + (bpm_b-bpm_a)*x/delta_ticks.
/// Integral: (sr*60/TPB) * integral[0..local_ticks] 1/bpm(x) dx
///
/// If bpm_a == bpm_b → trivial constant case.
/// Otherwise → (sr*60/TPB) * (delta_ticks/(bpm_b-bpm_a)) * ln(bpm(local_ticks)/bpm_a)
fn linear_tick_to_sample_offset(
    local_ticks: f64,
    delta_ticks: f64,
    bpm_a: f64,
    bpm_b: f64,
    sample_rate: u32,
) -> f64 {
    let scale = sample_rate as f64 * 60.0 / TICKS_PER_BEAT as f64;
    if (bpm_b - bpm_a).abs() < f64::EPSILON {
        // Degenerate: constant BPM in this segment
        return local_ticks * scale / bpm_a;
    }
    let bpm_at_local = bpm_a + (bpm_b - bpm_a) * local_ticks / delta_ticks;
    scale * (delta_ticks / (bpm_b - bpm_a)) * (bpm_at_local / bpm_a).ln()
}

/// Inverse of [`linear_tick_to_sample_offset`]: given `local_samples` in a
/// linear ramp from `bpm_a` to `bpm_b` spanning `delta_ticks` ticks, return
/// the number of ticks elapsed.
fn linear_sample_to_tick_offset(
    local_samples: f64,
    delta_ticks: f64,
    bpm_a: f64,
    bpm_b: f64,
    sample_rate: u32,
) -> f64 {
    let scale = sample_rate as f64 * 60.0 / TICKS_PER_BEAT as f64;
    if (bpm_b - bpm_a).abs() < f64::EPSILON {
        return local_samples * bpm_a / scale;
    }
    // Invert: local_samples = scale * delta_ticks/(bpm_b-bpm_a) * ln(bpm(t)/bpm_a)
    // => bpm(t)/bpm_a = exp(local_samples * (bpm_b-bpm_a) / (scale * delta_ticks))
    // => t = delta_ticks * (bpm(t)/bpm_a - 1) * bpm_a / (bpm_b - bpm_a)
    let exponent = local_samples * (bpm_b - bpm_a) / (scale * delta_ticks);
    let bpm_ratio = exponent.exp(); // bpm(t)/bpm_a
    delta_ticks * (bpm_ratio - 1.0) * bpm_a / (bpm_b - bpm_a)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 44100;

    fn make_map(points: Vec<TempoPoint>) -> CumulativeTempoMap {
        CumulativeTempoMap::build(points, SR)
    }

    fn single_point(bpm: f64) -> CumulativeTempoMap {
        make_map(vec![TempoPoint {
            tick: 0,
            bpm,
            interp: TempoInterp::Step,
        }])
    }

    // 1. At 120 BPM, 480 PPQ, 44100 Hz, tick 480 (one beat) == 22050 samples
    #[test]
    fn test_single_point_120bpm_tick_to_sample() {
        let map = single_point(120.0);
        // samples per beat = 44100 * 60 / 120 = 22050
        assert_eq!(map.tick_to_sample(480), 22050);
    }

    // 2. sample_to_tick(tick_to_sample(480)) == 480
    #[test]
    fn test_single_point_sample_to_tick_roundtrip() {
        let map = single_point(120.0);
        let s = map.tick_to_sample(480);
        assert_eq!(map.sample_to_tick(s), 480);
    }

    // 3. Roundtrip for many ticks within 1 tick
    #[test]
    fn test_roundtrip_many_ticks() {
        let map = make_map(vec![
            TempoPoint { tick: 0, bpm: 120.0, interp: TempoInterp::Step },
            TempoPoint { tick: 1920, bpm: 90.0, interp: TempoInterp::Step },
        ]);
        for &tick in &[0u64, 480, 960, 3840, 9600] {
            let s = map.tick_to_sample(tick);
            let back = map.sample_to_tick(s);
            let diff = (back as i64 - tick as i64).unsigned_abs();
            assert!(diff <= 1, "tick {} roundtrip failed: got {}, diff {}", tick, back, diff);
        }
    }

    // 4. Step boundary: tick 1919 => 120 BPM, tick 1920 => 80 BPM
    #[test]
    fn test_bpm_at_tick_step_boundary() {
        let map = make_map(vec![
            TempoPoint { tick: 0, bpm: 120.0, interp: TempoInterp::Step },
            TempoPoint { tick: 1920, bpm: 80.0, interp: TempoInterp::Step },
        ]);
        assert_eq!(map.bpm_at_tick(1919), 120.0);
        assert_eq!(map.bpm_at_tick(1920), 80.0);
    }

    // 5. Linear midpoint: 60 BPM Linear -> 180 BPM, at midpoint tick 960 => ~120 BPM
    #[test]
    fn test_bpm_at_tick_linear_midpoint() {
        let map = make_map(vec![
            TempoPoint { tick: 0, bpm: 60.0, interp: TempoInterp::Linear },
            TempoPoint { tick: 1920, bpm: 180.0, interp: TempoInterp::Linear },
        ]);
        let mid = map.bpm_at_tick(960);
        assert!((mid - 120.0).abs() < 0.01, "expected ~120, got {}", mid);
    }

    // 6. Build with no points inserts default at tick 0
    #[test]
    fn test_build_inserts_default_at_tick0() {
        let map = make_map(vec![]);
        assert_eq!(map.points.len(), 1);
        assert_eq!(map.points[0].tick, 0);
        assert_eq!(map.points[0].bpm, 120.0);
    }

    // 7. Build sorts unsorted input
    #[test]
    fn test_build_sorts_unsorted_input() {
        let map = make_map(vec![
            TempoPoint { tick: 1920, bpm: 80.0, interp: TempoInterp::Step },
            TempoPoint { tick: 0, bpm: 120.0, interp: TempoInterp::Step },
            TempoPoint { tick: 960, bpm: 100.0, interp: TempoInterp::Step },
        ]);
        assert_eq!(map.points[0].tick, 0);
        assert_eq!(map.points[1].tick, 960);
        assert_eq!(map.points[2].tick, 1920);
    }

    // 8. Two Step points: verify segment boundary sample
    #[test]
    fn test_cumulative_samples_two_step_points() {
        // 120 BPM for first 480 ticks (1 beat at 480 PPQ), then 80 BPM
        let map = make_map(vec![
            TempoPoint { tick: 0, bpm: 120.0, interp: TempoInterp::Step },
            TempoPoint { tick: 480, bpm: 80.0, interp: TempoInterp::Step },
        ]);
        // At tick 480 (boundary), sample = 22050 (1 beat at 120 BPM, 44100 Hz)
        let s = map.tick_to_sample(480);
        assert_eq!(s, 22050);
    }

    // 9. Build 1000 points without panic
    #[test]
    fn test_1000_points_build_perf() {
        let points: Vec<TempoPoint> = (0..1000)
            .map(|i| TempoPoint {
                tick: i as u64 * 1000,
                bpm: 80.0 + (i % 100) as f64,
                interp: TempoInterp::Step,
            })
            .collect();
        let map = make_map(points);
        assert_eq!(map.points.len(), 1000);
    }

    // 10. Linear ramp 60->180 BPM: sample count at tick_end is between
    //     what constant 60 BPM and constant 180 BPM would give
    #[test]
    fn test_tick_to_sample_linear_ramp() {
        let end_tick = 3840u64;
        let map = make_map(vec![
            TempoPoint { tick: 0, bpm: 60.0, interp: TempoInterp::Linear },
            TempoPoint { tick: end_tick, bpm: 180.0, interp: TempoInterp::Step },
        ]);

        let samples_at_end = map.tick_to_sample(end_tick) as f64;

        // Constant 60 BPM baseline: slow => more samples
        let slow_map = single_point(60.0);
        let samples_slow = slow_map.tick_to_sample(end_tick) as f64;

        // Constant 180 BPM baseline: fast => fewer samples
        let fast_map = single_point(180.0);
        let samples_fast = fast_map.tick_to_sample(end_tick) as f64;

        assert!(
            samples_fast < samples_at_end && samples_at_end < samples_slow,
            "linear ramp samples {} should be between {} (fast) and {} (slow)",
            samples_at_end,
            samples_fast,
            samples_slow
        );
    }
}
