/// VST3 plugin host — Sprint 23.
///
/// Handles plugin discovery, loading, parameter control, and audio processing
/// nodes for both instruments and effects.
pub mod com;
pub mod commands;
pub mod effect;
pub mod host;
pub mod instrument;
pub mod loader;
pub mod params;
pub mod scanner;
pub mod state;

// Re-export managed state types so `lib.rs` can refer to them without the full path.
pub use commands::{Vst3CmdTxState, Vst3RegistryState};
