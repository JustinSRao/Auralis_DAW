// Built-in audio effects — implemented in Sprints 18-21
// EQ, Reverb, Delay, Compression, Modular routing

/// Common interface for all insertable audio effects.
///
/// Sprint 21 (Effect Chain) iterates over a `Vec<Box<dyn AudioEffect>>` per
/// channel and calls `process_stereo` in the audio callback.
pub trait AudioEffect: Send + Sync {
    /// Processes one buffer of stereo audio in-place.
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Resets all internal state (call only when silence is guaranteed).
    fn reset(&mut self);
    /// Returns the effect's current parameters as a JSON value (for preset save).
    fn get_params(&self) -> serde_json::Value;
    /// Applies a parameter map previously returned by `get_params` (for preset load).
    fn set_params(&mut self, params: &serde_json::Value);

    /// Wires a sidechain tap buffer into this effect (Sprint 39).
    ///
    /// Only `Compressor` overrides this; all other effects silently ignore it.
    fn set_sidechain(&mut self, _tap: Option<std::sync::Arc<sidechain::SidechainTap>>) {}

    /// Configures the sidechain high-pass filter (Sprint 39).
    ///
    /// Only `Compressor` overrides this; all other effects silently ignore it.
    fn set_sidechain_hpf(&mut self, _cutoff_hz: f32, _enabled: bool) {}
}

pub mod delay;
pub mod dynamics;
pub mod eq;
pub mod reverb;
pub mod sidechain;
