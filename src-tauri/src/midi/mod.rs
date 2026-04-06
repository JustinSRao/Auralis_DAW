/// Tauri IPC command handlers for MIDI device management.
pub mod commands;
/// MIDI file export: serialize patterns/arrangements to Standard MIDI Files.
pub mod export;
/// Tauri IPC commands for MIDI file export.
pub mod export_commands;
/// MIDI file import: parse .mid files into ImportedTrack / ImportedNote structs.
pub mod import;
/// Tauri IPC commands for MIDI file import.
pub mod import_commands;
/// MIDI device manager: enumeration, connections, hot-plug scanning.
pub mod manager;
/// MIDI CC → parameter mapping registry and MIDI Learn (Sprint 29).
pub mod mapping;
/// MIDI recording session: beat-timestamped capture of NoteOn/NoteOff pairs.
pub mod recording;
/// Tauri IPC commands for MIDI recording.
pub mod recording_commands;
/// MIDI event types, byte parser, and IPC-serializable structs.
pub mod types;
