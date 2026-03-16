/// Tauri IPC command handlers for MIDI device management.
pub mod commands;
/// MIDI file import: parse .mid files into ImportedTrack / ImportedNote structs.
pub mod import;
/// Tauri IPC commands for MIDI file import.
pub mod import_commands;
/// MIDI device manager: enumeration, connections, hot-plug scanning.
pub mod manager;
/// MIDI event types, byte parser, and IPC-serializable structs.
pub mod types;
