// Built-in audio effects — implemented in Sprints 18-21
// EQ, Reverb, Delay, Compression, Modular routing

/// Common interface for all insertable audio effects.
///
/// Sprint 21 (Effect Chain) will iterate over a `Vec<Box<dyn AudioEffect>>` per
/// channel and call `process_stereo` in the audio callback.
pub trait AudioEffect: Send + Sync {
    /// Processes one buffer of stereo audio in-place.
    fn process_stereo(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Resets all internal state (call only when silence is guaranteed).
    fn reset(&mut self);
}

pub mod delay;
pub mod dynamics;
pub mod eq;
pub mod reverb;
