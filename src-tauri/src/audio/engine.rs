// Audio engine placeholder — Sprint 2
// Will use cpal with ASIO feature for Windows low-latency audio

/// Placeholder audio engine — full implementation in Sprint 2.
/// Manages ASIO/WASAPI device lifecycle and the real-time audio graph.
pub struct AudioEngine;

impl AudioEngine {
    /// Creates a new idle `AudioEngine` instance.
    pub fn new() -> Self {
        AudioEngine
    }
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_engine_new() {
        let _engine = AudioEngine::new();
        let _engine2 = AudioEngine::default();
    }
}
