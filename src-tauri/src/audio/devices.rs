use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::Host;

use super::types::{AudioDeviceInfo, AudioHostType, ALLOWED_BUFFER_SIZES, ALLOWED_SAMPLE_RATES};

/// Attempts to create an ASIO host. Returns `None` if ASIO is unavailable.
///
/// This uses runtime detection — checks `cpal::available_hosts()` for an ASIO host ID.
/// Returns `None` if no ASIO driver is installed (e.g., no ASIO4ALL).
pub fn try_asio_host() -> Option<Host> {
    cpal::available_hosts()
        .into_iter()
        .find(|id| id.name().to_lowercase().contains("asio"))
        .and_then(|id| cpal::host_from_id(id).ok())
}

/// Returns the WASAPI host (always available on Windows).
pub fn wasapi_host() -> Result<Host> {
    // On Windows, the default host is WASAPI
    Ok(cpal::default_host())
}

/// Gets the best available host, preferring ASIO for lowest latency.
///
/// Returns the host and its type. Falls back to WASAPI if ASIO is unavailable.
pub fn get_preferred_host() -> Result<(Host, AudioHostType)> {
    if let Some(asio) = try_asio_host() {
        log::info!("Using ASIO audio host");
        Ok((asio, AudioHostType::Asio))
    } else {
        log::info!("ASIO not available, falling back to WASAPI");
        let wasapi = wasapi_host()?;
        Ok((wasapi, AudioHostType::Wasapi))
    }
}

/// Enumerates all audio devices from both ASIO and WASAPI hosts.
///
/// Returns a combined list of all discovered devices with their capabilities.
pub fn enumerate_devices() -> Result<Vec<AudioDeviceInfo>> {
    let mut devices = Vec::new();

    // Try ASIO devices first
    if let Some(host) = try_asio_host() {
        collect_devices_from_host(&host, AudioHostType::Asio, &mut devices);
    }

    // Always enumerate WASAPI devices
    let wasapi = wasapi_host()?;
    collect_devices_from_host(&wasapi, AudioHostType::Wasapi, &mut devices);

    Ok(devices)
}

/// Finds a specific output device by name from the preferred host.
///
/// Falls back to WASAPI if the device is not found on the preferred host.
pub fn find_output_device(
    host: &Host,
    device_name: &str,
) -> Result<cpal::Device> {
    let devices = host
        .output_devices()
        .context("Failed to enumerate output devices")?;

    for device in devices {
        if let Ok(name) = device.name() {
            if name == device_name {
                return Ok(device);
            }
        }
    }

    anyhow::bail!("Output device '{}' not found", device_name)
}

/// Collects device information from a single host into the output vector.
fn collect_devices_from_host(
    host: &Host,
    host_type: AudioHostType,
    out: &mut Vec<AudioDeviceInfo>,
) {
    // Collect output devices
    if let Ok(devices) = host.output_devices() {
        for device in devices {
            if let Some(info) = probe_device(&device, &host_type, false, true) {
                out.push(info);
            }
        }
    }

    // Collect input devices
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            // Check if we already have this device as output (to merge flags)
            let name = match device.name() {
                Ok(n) => n,
                Err(_) => continue,
            };

            if let Some(existing) = out.iter_mut().find(|d| d.name == name && d.host_type == host_type) {
                existing.is_input = true;
            } else if let Some(info) = probe_device(&device, &host_type, true, false) {
                out.push(info);
            }
        }
    }
}

/// Extracts supported sample rates and buffer sizes from a config iterator.
fn extract_supported_configs(
    configs: impl Iterator<Item = cpal::SupportedStreamConfigRange>,
    supported_sample_rates: &mut Vec<u32>,
    supported_buffer_sizes: &mut Vec<u32>,
) {
    for config in configs {
        let min_rate = config.min_sample_rate().0;
        let max_rate = config.max_sample_rate().0;

        for &rate in &ALLOWED_SAMPLE_RATES {
            if rate >= min_rate && rate <= max_rate && !supported_sample_rates.contains(&rate) {
                supported_sample_rates.push(rate);
            }
        }

        match config.buffer_size() {
            cpal::SupportedBufferSize::Range { min, max } => {
                for &size in &ALLOWED_BUFFER_SIZES {
                    if size >= *min && size <= *max && !supported_buffer_sizes.contains(&size) {
                        supported_buffer_sizes.push(size);
                    }
                }
            }
            cpal::SupportedBufferSize::Unknown => {
                for &size in &ALLOWED_BUFFER_SIZES {
                    if !supported_buffer_sizes.contains(&size) {
                        supported_buffer_sizes.push(size);
                    }
                }
            }
        }
    }
}

/// Probes a single device for supported configurations.
fn probe_device(
    device: &cpal::Device,
    host_type: &AudioHostType,
    is_input: bool,
    is_output: bool,
) -> Option<AudioDeviceInfo> {
    let name = device.name().ok()?;

    let mut supported_sample_rates = Vec::new();
    let mut supported_buffer_sizes = Vec::new();

    if is_output {
        if let Ok(configs) = device.supported_output_configs() {
            extract_supported_configs(configs, &mut supported_sample_rates, &mut supported_buffer_sizes);
        }
    } else if let Ok(configs) = device.supported_input_configs() {
        extract_supported_configs(configs, &mut supported_sample_rates, &mut supported_buffer_sizes);
    }

    // Only include devices that support at least one of our sample rates
    if supported_sample_rates.is_empty() {
        return None;
    }

    // If no buffer size info, assume standard sizes work
    if supported_buffer_sizes.is_empty() {
        supported_buffer_sizes = ALLOWED_BUFFER_SIZES.to_vec();
    }

    supported_sample_rates.sort_unstable();
    supported_buffer_sizes.sort_unstable();

    Some(AudioDeviceInfo {
        name,
        host_type: host_type.clone(),
        is_input,
        is_output,
        supported_sample_rates,
        supported_buffer_sizes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // Touches ASIO DLL which can segfault on cleanup in test harness
    fn test_wasapi_host_available() {
        // WASAPI should always be available on Windows
        let result = wasapi_host();
        assert!(result.is_ok(), "WASAPI host should be available on Windows");
    }

    #[test]
    #[ignore] // Touches ASIO DLL which can segfault on cleanup in test harness
    fn test_preferred_host_returns_something() {
        let result = get_preferred_host();
        assert!(result.is_ok(), "Should get at least WASAPI host");
    }

    #[test]
    #[ignore] // Touches ASIO DLL which can segfault on cleanup in test harness
    fn test_enumerate_devices_returns_devices() {
        let result = enumerate_devices();
        assert!(result.is_ok(), "Device enumeration should not fail");
        let devices = result.unwrap();
        // On a system with audio, there should be at least one output device
        assert!(
            !devices.is_empty(),
            "Should find at least one audio device"
        );

        // Verify device info is populated
        for device in &devices {
            assert!(!device.name.is_empty(), "Device name should not be empty");
            assert!(
                device.is_input || device.is_output,
                "Device should be input or output"
            );
        }
    }

    #[test]
    #[ignore] // Touches ASIO DLL which can segfault on cleanup in test harness
    fn test_find_output_device_nonexistent() {
        let (host, _) = get_preferred_host().unwrap();
        let result = find_output_device(&host, "NonExistentDevice12345");
        assert!(result.is_err(), "Should fail for non-existent device");
    }
}
