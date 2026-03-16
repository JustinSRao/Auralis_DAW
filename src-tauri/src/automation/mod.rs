//! Automation system: lane data, playback engine, record capture, and Tauri commands.
//!
//! # Architecture
//!
//! - [`lane`]     — `AutomationLane` data model with sorted breakpoints and interpolation.
//! - [`engine`]   — `AutomationEngine` AudioNode that applies automation during playback.
//! - [`record`]   — `AutomationRecordBuffer` for capturing parameter changes.
//! - [`commands`] — Tauri IPC commands for lane CRUD and record batch ingestion.

pub mod commands;
pub mod engine;
pub mod lane;
pub mod record;
