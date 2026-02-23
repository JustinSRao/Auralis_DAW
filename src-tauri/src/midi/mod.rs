/// Tauri IPC command handlers for MIDI device management.
pub mod commands;
/// MIDI device manager: enumeration, connections, hot-plug scanning.
pub mod manager;
/// MIDI event types, byte parser, and IPC-serializable structs.
pub mod types;
