//! Automation record buffer.
//!
//! The main thread (Tauri command handler) pushes batched events via
//! [`AutomationRecordBuffer::push_events`].  The audio thread drains them
//! with [`AutomationRecordBuffer::drain`] using `try_lock` so the audio
//! callback **never blocks**.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// A single timestamped parameter event captured during automation recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRecordEvent {
    /// Target parameter identifier, e.g. `"synth.cutoff"`.
    pub parameter_id: String,
    /// Raw parameter value at the time of the event.
    pub value: f32,
    /// Song position in ticks (480 PPQN) at which the event was captured.
    pub tick: u64,
}

/// Shared buffer for automation record events.
///
/// Cloning produces a second handle to the **same** underlying buffer via `Arc`.
#[derive(Clone, Default)]
pub struct AutomationRecordBuffer {
    inner: Arc<Mutex<Vec<AutomationRecordEvent>>>,
}

impl AutomationRecordBuffer {
    /// Creates a new empty record buffer.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Appends events to the buffer.
    ///
    /// Called from the Tauri command thread — may block briefly to acquire the mutex.
    pub fn push_events(&self, events: Vec<AutomationRecordEvent>) {
        if let Ok(mut buf) = self.inner.lock() {
            buf.extend(events);
        }
    }

    /// Drains all pending events from the buffer.
    ///
    /// Uses `try_lock` — returns an empty `Vec` if the lock is contended so
    /// the audio thread **never blocks**.
    pub fn drain(&self) -> Vec<AutomationRecordEvent> {
        match self.inner.try_lock() {
            Ok(mut buf) => std::mem::take(&mut *buf),
            Err(_) => Vec::new(),
        }
    }
}
