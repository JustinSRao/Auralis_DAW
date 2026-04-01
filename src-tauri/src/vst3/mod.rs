/// VST3 plugin host — Sprint 23 + 24.
///
/// Handles plugin discovery, loading, parameter control, audio processing
/// nodes, native GUI hosting, and preset management.
pub mod com;
pub mod commands;
pub mod effect;
pub mod gui_bridge;
pub mod host;
pub mod instrument;
pub mod loader;
pub mod params;
pub mod preset_manager;
pub mod scanner;
pub mod state;

// Re-export managed state types so `lib.rs` can refer to them without the full path.
pub use commands::{Vst3CmdTxState, Vst3RegistryState};
pub use gui_bridge::Vst3GuiState;
