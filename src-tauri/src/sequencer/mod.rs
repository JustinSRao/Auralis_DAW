/// Step Sequencer — Sprint 10.
///
/// A polyphonic step sequencer that drives any instrument registered in
/// the audio graph via a `crossbeam_channel` MIDI sender. Up to
/// [`step::MAX_SEQ_STEPS`] steps per pattern, with per-step note, velocity,
/// gate length, and probability controls.
pub mod clock;
pub mod commands;
pub mod step;
pub mod step_sequencer;

pub use step::{SequencerSnapshot, SequencerStepSnapshot};
pub use step_sequencer::SequencerAtomics;
