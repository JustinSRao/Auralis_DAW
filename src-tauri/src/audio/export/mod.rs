//! Offline audio export engine — Sprint 22.
//!
//! ## Architecture
//!
//! ```text
//! Tauri command thread
//!   └─ start_export
//!        ├─ build RenderConfig from ClipStore + TransportSnapshot
//!        ├─ spawn_blocking → RenderSession::render_block loop
//!        │     └─ FileWriter::write_block  (WAV / FLAC / MP3)
//!        └─ emit export_progress_changed events
//! ```
//!
//! `RenderSession` drives a private `ClipPlaybackNode` offline — it sends
//! `ClipCmd::StartClip` messages synchronously into a crossbeam channel and
//! then calls `ClipPlaybackNode::process()` on the same thread, so no real
//! audio device is involved.

pub mod commands;
pub mod file_writer;
pub mod render_session;
pub mod stem_splitter;

pub use commands::{cancel_export, get_export_progress, start_export, ExportJobStateArc};
pub use file_writer::{FileWriter, OutputFormat, WavBitDepth};
pub use render_session::{ExportClipInfo, RenderConfig, RenderSession};
