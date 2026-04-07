// Audio engine — implemented in Sprint 2
// Handles: ASIO/WASAPI device management, real-time audio thread, audio graph
pub mod clip_player;
pub mod export;
/// Track Freeze and Bounce in Place — offline MIDI→audio renderer (Sprint 40).
pub mod freeze;
/// Tauri IPC commands for track freeze and bounce (Sprint 40).
pub mod freeze_commands;
pub mod commands;
pub mod fade;
pub mod fade_commands;
pub mod devices;
pub mod effect_chain;
pub mod mixer;
pub mod engine;
pub mod graph;
pub mod loop_recorder;
pub mod metronome;
pub mod punch;
pub mod punch_commands;
pub mod recorder;
pub mod scheduler;
pub mod scheduler_commands;
pub mod take_commands;
pub mod take_lane;
pub mod tempo_commands;
pub mod tempo_map;
pub mod transport;
pub mod types;
