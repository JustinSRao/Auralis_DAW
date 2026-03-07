//! Project file system — save, load, and manage `.mapp` project archives.
//!
//! # Module layout
//!
//! | Module | Responsibility |
//! |--------|---------------|
//! | [`format`] | All on-disk data structures (`ProjectFile`, tracks, clips, …) |
//! | [`version`] | Schema versioning and forward migrations |
//! | [`io`] | ZIP-based save/load and sample extraction |
//! | [`recent`] | Persisted recent-projects list |
//! | [`commands`] | Tauri IPC commands and `ProjectManagerState` |

pub mod commands;
pub mod format;
pub mod io;
pub mod pattern;
pub mod pattern_commands;
pub mod recent;
pub mod track;
pub mod track_commands;
pub mod version;
