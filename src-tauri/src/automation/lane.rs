//! Automation lane data model.
//!
//! An [`AutomationLane`] stores a sorted sequence of [`ControlPoint`] breakpoints
//! for a single parameter within a single pattern.  Binary-search insert/delete
//! maintains the sorted invariant efficiently even at 1 000+ points.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// Interpolation mode applied from a control point to the **next** control point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Interp {
    /// Straight linear ramp between adjacent breakpoints.
    Linear,
    /// Exponential (geometric) curve.  Falls back to linear when either endpoint
    /// is zero or the endpoints have opposite signs.
    Exponential,
    /// Hold the value constant until the next breakpoint.
    Step,
}

/// A single breakpoint in an automation lane.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPoint {
    /// Song position in ticks (480 PPQN from song start).
    pub tick: u64,
    /// Parameter value at this breakpoint.
    pub value: f32,
    /// Interpolation applied from this point to the next.
    pub interp: Interp,
}

/// All automation breakpoints for a single parameter in a single pattern.
///
/// `points` is always sorted ascending by `tick`.  Use the provided mutating
/// methods to maintain this invariant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationLane {
    /// Owning pattern's UUID.
    pub pattern_id: String,
    /// Target parameter key (e.g. `"synth.cutoff"`).
    pub parameter_id: String,
    /// When `false` the lane is bypassed during playback without deleting data.
    pub enabled: bool,
    /// Breakpoints sorted ascending by `tick`.
    pub points: Vec<ControlPoint>,
}

// ---------------------------------------------------------------------------
// IPC snapshot types
// ---------------------------------------------------------------------------

/// Serialisable snapshot of a [`ControlPoint`] for IPC round-trips.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPointSnapshot {
    /// Tick position.
    pub tick: u64,
    /// Parameter value.
    pub value: f32,
    /// One of `"Linear"`, `"Exponential"`, or `"Step"`.
    pub interp: String,
}

/// Serialisable snapshot of an [`AutomationLane`] for IPC round-trips.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationLaneSnapshot {
    /// Target parameter key.
    pub parameter_id: String,
    /// Owning pattern UUID.
    pub pattern_id: String,
    /// Whether the lane is active.
    pub enabled: bool,
    /// Breakpoints in sorted tick order.
    pub points: Vec<ControlPointSnapshot>,
}

// ---------------------------------------------------------------------------
// AutomationLane implementation
// ---------------------------------------------------------------------------

impl AutomationLane {
    /// Creates an empty, enabled lane for the given pattern and parameter.
    pub fn new(pattern_id: impl Into<String>, parameter_id: impl Into<String>) -> Self {
        Self {
            pattern_id: pattern_id.into(),
            parameter_id: parameter_id.into(),
            enabled: true,
            points: Vec::new(),
        }
    }

    /// Inserts or replaces a control point at `tick`.
    ///
    /// If a point already exists at `tick` its value and interp are replaced.
    /// Otherwise the point is inserted in sorted position.
    pub fn insert_point(&mut self, tick: u64, value: f32, interp: Interp) {
        match self.points.binary_search_by_key(&tick, |p| p.tick) {
            Ok(idx) => {
                self.points[idx].value = value;
                self.points[idx].interp = interp;
            }
            Err(idx) => {
                self.points.insert(idx, ControlPoint { tick, value, interp });
            }
        }
    }

    /// Removes the control point at `tick`.
    ///
    /// Returns `true` if a point was found and removed, `false` otherwise.
    pub fn delete_point(&mut self, tick: u64) -> bool {
        match self.points.binary_search_by_key(&tick, |p| p.tick) {
            Ok(idx) => {
                self.points.remove(idx);
                true
            }
            Err(_) => false,
        }
    }

    /// Changes the interpolation mode for the point at `tick`.
    ///
    /// Returns `true` if the point was found, `false` otherwise.
    pub fn set_interp(&mut self, tick: u64, interp: Interp) -> bool {
        match self.points.binary_search_by_key(&tick, |p| p.tick) {
            Ok(idx) => {
                self.points[idx].interp = interp;
                true
            }
            Err(_) => false,
        }
    }

    /// Evaluates the lane at `tick`, returning the interpolated parameter value.
    ///
    /// Returns `None` if the lane has no control points.
    /// Clamps to the first/last value when `tick` is outside the defined range.
    pub fn evaluate(&self, tick: u64) -> Option<f32> {
        if self.points.is_empty() {
            return None;
        }

        // Clamp before first point
        if tick <= self.points[0].tick {
            return Some(self.points[0].value);
        }

        // Clamp after last point
        let last = &self.points[self.points.len() - 1];
        if tick >= last.tick {
            return Some(last.value);
        }

        // Binary search for the preceding breakpoint
        let idx = match self.points.binary_search_by_key(&tick, |p| p.tick) {
            Ok(i) => return Some(self.points[i].value),
            Err(i) => i - 1,
        };

        let a = &self.points[idx];
        let b = &self.points[idx + 1];
        let span = (b.tick - a.tick) as f64;
        let t = (tick - a.tick) as f64 / span;

        let result = match a.interp {
            Interp::Linear => a.value + (b.value - a.value) * t as f32,
            Interp::Exponential => interpolate_exp(a.value, b.value, t as f32),
            Interp::Step => a.value,
        };

        Some(result)
    }

    /// Returns an IPC-friendly snapshot of this lane.
    pub fn to_snapshot(&self) -> AutomationLaneSnapshot {
        AutomationLaneSnapshot {
            parameter_id: self.parameter_id.clone(),
            pattern_id: self.pattern_id.clone(),
            enabled: self.enabled,
            points: self
                .points
                .iter()
                .map(|p| ControlPointSnapshot {
                    tick: p.tick,
                    value: p.value,
                    interp: match p.interp {
                        Interp::Linear => "Linear".to_string(),
                        Interp::Exponential => "Exponential".to_string(),
                        Interp::Step => "Step".to_string(),
                    },
                })
                .collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parses an interp string from IPC into an [`Interp`] enum.
///
/// Accepts `"Linear"`, `"Exponential"`, or `"Step"`.
pub fn parse_interp(s: &str) -> Result<Interp, String> {
    match s {
        "Linear" => Ok(Interp::Linear),
        "Exponential" => Ok(Interp::Exponential),
        "Step" => Ok(Interp::Step),
        other => Err(format!("Unknown interpolation mode: '{}'", other)),
    }
}

/// Exponential interpolation from `a` to `b` at fraction `t ∈ [0, 1]`.
///
/// Falls back to linear when `a == 0` or `a` and `b` have opposite signs,
/// since `a * (b/a)^t` is undefined in those cases.
#[inline]
fn interpolate_exp(a: f32, b: f32, t: f32) -> f32 {
    if a == 0.0 || (a < 0.0) != (b < 0.0) {
        return a + (b - a) * t;
    }
    a * (b / a).powf(t)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn lane() -> AutomationLane {
        AutomationLane::new("pattern-1", "synth.cutoff")
    }

    // --- Empty lane ---

    #[test]
    fn empty_lane_returns_none() {
        let l = lane();
        assert!(l.evaluate(0).is_none());
        assert!(l.evaluate(1000).is_none());
    }

    // --- Single point ---

    #[test]
    fn single_point_returns_value_at_tick() {
        let mut l = lane();
        l.insert_point(480, 0.5, Interp::Linear);
        assert_eq!(l.evaluate(480), Some(0.5));
    }

    #[test]
    fn single_point_clamps_before_tick() {
        let mut l = lane();
        l.insert_point(480, 0.5, Interp::Linear);
        assert_eq!(l.evaluate(0), Some(0.5));
    }

    #[test]
    fn single_point_clamps_after_tick() {
        let mut l = lane();
        l.insert_point(480, 0.5, Interp::Linear);
        assert_eq!(l.evaluate(9999), Some(0.5));
    }

    // --- Linear interpolation ---

    #[test]
    fn linear_interp_midpoint() {
        let mut l = lane();
        l.insert_point(0, 0.0, Interp::Linear);
        l.insert_point(480, 1.0, Interp::Linear);
        let mid = l.evaluate(240).unwrap();
        assert!((mid - 0.5).abs() < 0.001, "expected ~0.5, got {}", mid);
    }

    #[test]
    fn linear_interp_quarter_point() {
        let mut l = lane();
        l.insert_point(0, 0.0, Interp::Linear);
        l.insert_point(480, 1.0, Interp::Linear);
        let q = l.evaluate(120).unwrap();
        assert!((q - 0.25).abs() < 0.001, "expected ~0.25, got {}", q);
    }

    // --- Step interpolation ---

    #[test]
    fn step_interp_holds_value_before_next_point() {
        let mut l = lane();
        l.insert_point(0, 0.1, Interp::Step);
        l.insert_point(480, 0.9, Interp::Step);
        // Tick 240 is between the two; step returns the FIRST point's value
        assert!((l.evaluate(240).unwrap() - 0.1).abs() < f32::EPSILON);
    }

    #[test]
    fn step_interp_at_second_point() {
        let mut l = lane();
        l.insert_point(0, 0.1, Interp::Step);
        l.insert_point(480, 0.9, Interp::Step);
        assert!((l.evaluate(480).unwrap() - 0.9).abs() < f32::EPSILON);
    }

    // --- Exponential interpolation ---

    #[test]
    fn exponential_midpoint_is_geometric_mean() {
        let mut l = lane();
        l.insert_point(0, 100.0, Interp::Exponential);
        l.insert_point(480, 10_000.0, Interp::Exponential);
        // Geometric mean of 100 and 10 000 is 1 000
        let mid = l.evaluate(240).unwrap();
        assert!((mid - 1_000.0).abs() < 1.0, "expected ~1000, got {}", mid);
    }

    #[test]
    fn exponential_falls_back_to_linear_when_a_is_zero() {
        let mut l = lane();
        l.insert_point(0, 0.0, Interp::Exponential);
        l.insert_point(480, 1.0, Interp::Exponential);
        let mid = l.evaluate(240).unwrap();
        assert!((mid - 0.5).abs() < 0.001, "expected linear fallback ~0.5, got {}", mid);
    }

    #[test]
    fn exponential_falls_back_to_linear_for_opposite_signs() {
        let mut l = lane();
        l.insert_point(0, -1.0, Interp::Exponential);
        l.insert_point(480, 1.0, Interp::Exponential);
        let mid = l.evaluate(240).unwrap();
        assert!((mid - 0.0).abs() < 0.001, "expected linear fallback ~0.0, got {}", mid);
    }

    // --- Insert ordering ---

    #[test]
    fn insert_out_of_order_maintains_sorted_ticks() {
        let mut l = lane();
        l.insert_point(480, 0.5, Interp::Linear);
        l.insert_point(0, 0.0, Interp::Linear);
        l.insert_point(240, 0.25, Interp::Linear);
        assert_eq!(l.points[0].tick, 0);
        assert_eq!(l.points[1].tick, 240);
        assert_eq!(l.points[2].tick, 480);
    }

    #[test]
    fn duplicate_tick_replaces_existing_point() {
        let mut l = lane();
        l.insert_point(100, 0.1, Interp::Linear);
        l.insert_point(100, 0.9, Interp::Step);
        assert_eq!(l.points.len(), 1);
        assert!((l.points[0].value - 0.9).abs() < f32::EPSILON);
        assert_eq!(l.points[0].interp, Interp::Step);
    }

    // --- Delete ---

    #[test]
    fn delete_existing_point_returns_true() {
        let mut l = lane();
        l.insert_point(100, 0.5, Interp::Linear);
        assert!(l.delete_point(100));
        assert!(l.points.is_empty());
    }

    #[test]
    fn delete_missing_point_returns_false() {
        let mut l = lane();
        l.insert_point(100, 0.5, Interp::Linear);
        assert!(!l.delete_point(200));
    }

    // --- Clamping outside range ---

    #[test]
    fn evaluate_before_first_point_clamps_to_first_value() {
        let mut l = lane();
        l.insert_point(100, 0.7, Interp::Linear);
        l.insert_point(200, 0.3, Interp::Linear);
        assert!((l.evaluate(50).unwrap() - 0.7).abs() < f32::EPSILON);
    }

    #[test]
    fn evaluate_after_last_point_clamps_to_last_value() {
        let mut l = lane();
        l.insert_point(100, 0.7, Interp::Linear);
        l.insert_point(200, 0.3, Interp::Linear);
        assert!((l.evaluate(9999).unwrap() - 0.3).abs() < f32::EPSILON);
    }

    // --- set_interp ---

    #[test]
    fn set_interp_on_existing_point() {
        let mut l = lane();
        l.insert_point(100, 0.5, Interp::Linear);
        assert!(l.set_interp(100, Interp::Step));
        assert_eq!(l.points[0].interp, Interp::Step);
    }

    #[test]
    fn set_interp_on_missing_point_returns_false() {
        let mut l = lane();
        assert!(!l.set_interp(100, Interp::Step));
    }

    // --- parse_interp ---

    #[test]
    fn parse_interp_valid_variants() {
        assert_eq!(parse_interp("Linear").unwrap(), Interp::Linear);
        assert_eq!(parse_interp("Exponential").unwrap(), Interp::Exponential);
        assert_eq!(parse_interp("Step").unwrap(), Interp::Step);
    }

    #[test]
    fn parse_interp_invalid_returns_error() {
        assert!(parse_interp("linear").is_err());
        assert!(parse_interp("").is_err());
        assert!(parse_interp("ramp").is_err());
    }
}
