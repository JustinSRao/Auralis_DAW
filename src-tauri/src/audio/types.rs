use serde::{Deserialize, Serialize};

/// Identifies an audio host API available on the system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AudioHostType {
    /// ASIO host — lowest latency, requires ASIO4ALL or native ASIO driver.
    Asio,
    /// WASAPI host — built into Windows, always available.
    Wasapi,
}

/// Information about a single audio device, serializable for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    /// Human-readable device name.
    pub name: String,
    /// Which audio host API this device belongs to.
    pub host_type: AudioHostType,
    /// Whether this device supports audio input.
    pub is_input: bool,
    /// Whether this device supports audio output.
    pub is_output: bool,
    /// Sample rates this device supports (from our allowed set).
    pub supported_sample_rates: Vec<u32>,
    /// Buffer sizes this device supports (from our allowed set).
    pub supported_buffer_sizes: Vec<u32>,
}

/// Configuration for the audio engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    /// Sample rate in Hz (44100 or 48000).
    pub sample_rate: u32,
    /// Buffer size in samples (128, 256, 512, or 1024).
    pub buffer_size: u32,
    /// Selected output device name, or None for system default.
    pub output_device: Option<String>,
    /// Selected input device name, or None for system default.
    pub input_device: Option<String>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            sample_rate: 44100,
            buffer_size: 256,
            output_device: None,
            input_device: None,
        }
    }
}

/// Current engine status, serializable for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    /// Engine state: "stopped", "starting", "running", or "stopping".
    pub state: String,
    /// Current engine configuration.
    pub config: EngineConfig,
    /// Which audio host is currently active, if any.
    pub active_host: Option<AudioHostType>,
    /// Whether the 440 Hz test tone is currently enabled.
    pub test_tone_active: bool,
}

/// Allowed sample rates for the audio engine.
pub const ALLOWED_SAMPLE_RATES: [u32; 2] = [44100, 48000];

/// Allowed buffer sizes for the audio engine.
pub const ALLOWED_BUFFER_SIZES: [u32; 4] = [128, 256, 512, 1024];

/// Audio engine state constants for AtomicU8.
pub const STATE_STOPPED: u8 = 0;
/// Engine is in the process of starting.
pub const STATE_STARTING: u8 = 1;
/// Engine is running and producing audio.
pub const STATE_RUNNING: u8 = 2;
/// Engine is in the process of stopping.
pub const STATE_STOPPING: u8 = 3;

/// Returns the string label for an engine state constant.
pub fn state_label(state: u8) -> &'static str {
    match state {
        STATE_STOPPED => "stopped",
        STATE_STARTING => "starting",
        STATE_RUNNING => "running",
        STATE_STOPPING => "stopping",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_config_default() {
        let config = EngineConfig::default();
        assert_eq!(config.sample_rate, 44100);
        assert_eq!(config.buffer_size, 256);
        assert!(config.output_device.is_none());
        assert!(config.input_device.is_none());
    }

    #[test]
    fn test_allowed_constants() {
        assert!(ALLOWED_SAMPLE_RATES.contains(&44100));
        assert!(ALLOWED_SAMPLE_RATES.contains(&48000));
        assert!(ALLOWED_BUFFER_SIZES.contains(&128));
        assert!(ALLOWED_BUFFER_SIZES.contains(&256));
        assert!(ALLOWED_BUFFER_SIZES.contains(&512));
        assert!(ALLOWED_BUFFER_SIZES.contains(&1024));
    }

    #[test]
    fn test_state_labels() {
        assert_eq!(state_label(STATE_STOPPED), "stopped");
        assert_eq!(state_label(STATE_STARTING), "starting");
        assert_eq!(state_label(STATE_RUNNING), "running");
        assert_eq!(state_label(STATE_STOPPING), "stopping");
        assert_eq!(state_label(255), "unknown");
    }

    #[test]
    fn test_host_type_serialization() {
        let asio = AudioHostType::Asio;
        let json = serde_json::to_string(&asio).unwrap();
        assert_eq!(json, "\"Asio\"");

        let wasapi = AudioHostType::Wasapi;
        let json = serde_json::to_string(&wasapi).unwrap();
        assert_eq!(json, "\"Wasapi\"");
    }

    #[test]
    fn test_engine_status_serialization() {
        let status = EngineStatus {
            state: "stopped".to_string(),
            config: EngineConfig::default(),
            active_host: None,
            test_tone_active: false,
        };
        let json = serde_json::to_string(&status).unwrap();
        let deser: EngineStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deser.state, "stopped");
        assert!(!deser.test_tone_active);
    }

    #[test]
    fn test_device_info_serialization() {
        let device = AudioDeviceInfo {
            name: "Test Device".to_string(),
            host_type: AudioHostType::Wasapi,
            is_input: false,
            is_output: true,
            supported_sample_rates: vec![44100, 48000],
            supported_buffer_sizes: vec![256, 512],
        };
        let json = serde_json::to_string(&device).unwrap();
        let deser: AudioDeviceInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deser.name, "Test Device");
        assert!(deser.is_output);
        assert!(!deser.is_input);
    }
}
