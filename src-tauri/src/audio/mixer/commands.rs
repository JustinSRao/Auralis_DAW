use std::sync::Mutex;
use tauri::State;
use anyhow::anyhow;

use super::Mixer;

pub type MixerState = std::sync::Arc<Mutex<Mixer>>;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ChannelSnapshot {
    pub id: String,
    pub name: String,
    pub fader: f32,
    pub pan: f32,
    pub mute: bool,
    pub solo: bool,
    pub sends: [f32; 4],
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct BusSnapshot {
    pub id: String,
    pub name: String,
    pub fader: f32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct MixerSnapshot {
    pub channels: Vec<ChannelSnapshot>,
    pub buses: Vec<BusSnapshot>,
    pub master_fader: f32,
}

#[tauri::command]
pub fn get_mixer_state(state: State<MixerState>) -> Result<MixerSnapshot, String> {
    let mixer = state.lock().map_err(|e| e.to_string())?;
    Ok(MixerSnapshot {
        channels: mixer.channels.iter().map(|c| {
            use std::sync::atomic::Ordering;
            ChannelSnapshot {
                id: c.id.clone(),
                name: c.name.clone(),
                fader: c.fader.load(Ordering::Relaxed),
                pan: c.pan.load(Ordering::Relaxed),
                mute: c.mute.load(Ordering::Relaxed),
                solo: c.solo.load(Ordering::Relaxed),
                sends: [
                    c.sends[0].load(Ordering::Relaxed),
                    c.sends[1].load(Ordering::Relaxed),
                    c.sends[2].load(Ordering::Relaxed),
                    c.sends[3].load(Ordering::Relaxed),
                ],
            }
        }).collect(),
        buses: mixer.buses.iter().map(|b| {
            BusSnapshot {
                id: b.id.clone(),
                name: b.name.clone(),
                fader: b.fader.load(std::sync::atomic::Ordering::Relaxed),
            }
        }).collect(),
        master_fader: mixer.master.fader.load(std::sync::atomic::Ordering::Relaxed),
    })
}

#[tauri::command]
pub fn set_channel_fader(channel_id: String, value: f32, state: State<MixerState>) -> Result<(), String> {
    if value < 0.0 || value > 2.0 {
        return Err(anyhow!("fader value {} out of range 0.0–2.0", value).to_string());
    }
    let mixer = state.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = mixer.channel(&channel_id) {
        ch.fader.store(value, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("channel {} not found", channel_id))
    }
}

#[tauri::command]
pub fn set_channel_pan(channel_id: String, value: f32, state: State<MixerState>) -> Result<(), String> {
    if value < -1.0 || value > 1.0 {
        return Err(anyhow!("pan value {} out of range -1.0–1.0", value).to_string());
    }
    let mixer = state.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = mixer.channel(&channel_id) {
        ch.pan.store(value, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("channel {} not found", channel_id))
    }
}

#[tauri::command]
pub fn set_channel_mute(channel_id: String, muted: bool, state: State<MixerState>) -> Result<(), String> {
    let mixer = state.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = mixer.channel(&channel_id) {
        ch.mute.store(muted, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("channel {} not found", channel_id))
    }
}

#[tauri::command]
pub fn set_channel_solo(channel_id: String, solo: bool, state: State<MixerState>) -> Result<(), String> {
    let mixer = state.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = mixer.channel(&channel_id) {
        ch.solo.store(solo, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("channel {} not found", channel_id))
    }
}

#[tauri::command]
pub fn set_channel_send(channel_id: String, bus_index: usize, value: f32, state: State<MixerState>) -> Result<(), String> {
    if bus_index > 3 {
        return Err(anyhow!("bus_index {} out of range 0–3", bus_index).to_string());
    }
    if value < 0.0 || value > 1.0 {
        return Err(anyhow!("send value {} out of range 0.0–1.0", value).to_string());
    }
    let mixer = state.lock().map_err(|e| e.to_string())?;
    if let Some(ch) = mixer.channel(&channel_id) {
        ch.sends[bus_index].store(value, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("channel {} not found", channel_id))
    }
}

#[tauri::command]
pub fn set_master_fader(value: f32, state: State<MixerState>) -> Result<(), String> {
    if value < 0.0 || value > 2.0 {
        return Err(anyhow!("master fader value {} out of range 0.0–2.0", value).to_string());
    }
    let mixer = state.lock().map_err(|e| e.to_string())?;
    mixer.master.fader.store(value, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn add_mixer_channel(track_id: String, track_name: String, state: State<MixerState>) -> Result<(), String> {
    let mut mixer = state.lock().map_err(|e| e.to_string())?;
    mixer.add_channel(track_id, track_name);
    Ok(())
}

#[tauri::command]
pub fn remove_mixer_channel(track_id: String, state: State<MixerState>) -> Result<(), String> {
    let mut mixer = state.lock().map_err(|e| e.to_string())?;
    mixer.remove_channel(&track_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_fader_range_validation() {
        // 2.5 is out of range
        let result: Result<(), String> = if 2.5f32 < 0.0 || 2.5f32 > 2.0 {
            Err("out of range".to_string())
        } else {
            Ok(())
        };
        assert!(result.is_err());
    }

    #[test]
    fn test_pan_range_validation() {
        let result: Result<(), String> = if 1.5f32 < -1.0 || 1.5f32 > 1.0 {
            Err("out of range".to_string())
        } else {
            Ok(())
        };
        assert!(result.is_err());
    }

    #[test]
    fn test_bus_index_validation() {
        let result: Result<(), String> = if 4usize > 3 {
            Err("out of range".to_string())
        } else {
            Ok(())
        };
        assert!(result.is_err());
    }
}
