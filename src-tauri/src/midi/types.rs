use serde::{Deserialize, Serialize};

/// A parsed MIDI event with channel, note, velocity, etc.
///
/// Covers the standard MIDI 1.0 channel voice messages. System messages
/// (sysex, clock, etc.) are captured as `Unknown`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MidiEvent {
    /// Note On: key pressed with velocity > 0.
    NoteOn {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    /// Note Off: key released.
    NoteOff {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    /// Control Change (CC): knob/slider/pedal movement.
    ControlChange {
        channel: u8,
        controller: u8,
        value: u8,
    },
    /// Program Change: patch/preset selection.
    ProgramChange { channel: u8, program: u8 },
    /// Channel Aftertouch (mono pressure).
    ChannelAftertouch { channel: u8, pressure: u8 },
    /// Polyphonic Aftertouch (per-note pressure).
    PolyAftertouch {
        channel: u8,
        note: u8,
        pressure: u8,
    },
    /// Pitch Bend: -8192..+8191, center = 0.
    PitchBend { channel: u8, value: i16 },
    /// Unrecognized or system message (sysex, clock, etc.).
    Unknown(Vec<u8>),
}

impl MidiEvent {
    /// Parses raw MIDI bytes into a `MidiEvent`.
    ///
    /// Returns `None` if the data is too short or the status byte is missing.
    /// NoteOn with velocity 0 is treated as NoteOff per MIDI convention.
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.is_empty() {
            return None;
        }

        let status = data[0];
        let msg_type = status & 0xF0;
        let channel = status & 0x0F;

        match msg_type {
            0x80 => {
                // Note Off
                if data.len() < 3 {
                    return None;
                }
                Some(MidiEvent::NoteOff {
                    channel,
                    note: data[1],
                    velocity: data[2],
                })
            }
            0x90 => {
                // Note On — velocity 0 means Note Off
                if data.len() < 3 {
                    return None;
                }
                if data[2] == 0 {
                    Some(MidiEvent::NoteOff {
                        channel,
                        note: data[1],
                        velocity: 0,
                    })
                } else {
                    Some(MidiEvent::NoteOn {
                        channel,
                        note: data[1],
                        velocity: data[2],
                    })
                }
            }
            0xA0 => {
                // Polyphonic Aftertouch
                if data.len() < 3 {
                    return None;
                }
                Some(MidiEvent::PolyAftertouch {
                    channel,
                    note: data[1],
                    pressure: data[2],
                })
            }
            0xB0 => {
                // Control Change
                if data.len() < 3 {
                    return None;
                }
                Some(MidiEvent::ControlChange {
                    channel,
                    controller: data[1],
                    value: data[2],
                })
            }
            0xC0 => {
                // Program Change
                if data.len() < 2 {
                    return None;
                }
                Some(MidiEvent::ProgramChange {
                    channel,
                    program: data[1],
                })
            }
            0xD0 => {
                // Channel Aftertouch
                if data.len() < 2 {
                    return None;
                }
                Some(MidiEvent::ChannelAftertouch {
                    channel,
                    pressure: data[1],
                })
            }
            0xE0 => {
                // Pitch Bend — 14-bit value, center = 8192
                if data.len() < 3 {
                    return None;
                }
                let raw = ((data[2] as u16) << 7) | (data[1] as u16);
                let value = raw as i16 - 8192;
                Some(MidiEvent::PitchBend { channel, value })
            }
            _ => {
                // System messages or unknown
                Some(MidiEvent::Unknown(data.to_vec()))
            }
        }
    }

    /// Serializes the event back to raw MIDI bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            MidiEvent::NoteOn {
                channel,
                note,
                velocity,
            } => vec![0x90 | channel, *note, *velocity],
            MidiEvent::NoteOff {
                channel,
                note,
                velocity,
            } => vec![0x80 | channel, *note, *velocity],
            MidiEvent::ControlChange {
                channel,
                controller,
                value,
            } => vec![0xB0 | channel, *controller, *value],
            MidiEvent::ProgramChange { channel, program } => vec![0xC0 | channel, *program],
            MidiEvent::ChannelAftertouch { channel, pressure } => vec![0xD0 | channel, *pressure],
            MidiEvent::PolyAftertouch {
                channel,
                note,
                pressure,
            } => vec![0xA0 | channel, *note, *pressure],
            MidiEvent::PitchBend { channel, value } => {
                let raw = (*value + 8192) as u16;
                let lsb = (raw & 0x7F) as u8;
                let msb = ((raw >> 7) & 0x7F) as u8;
                vec![0xE0 | channel, lsb, msb]
            }
            MidiEvent::Unknown(data) => data.clone(),
        }
    }
}

/// A MIDI event with a microsecond timestamp from the OS driver.
///
/// The timestamp is provided by midir and represents microseconds since
/// the MIDI input connection was opened.
#[derive(Debug, Clone)]
pub struct TimestampedMidiEvent {
    /// The parsed MIDI event.
    pub event: MidiEvent,
    /// Microsecond timestamp from midir (time since connection opened).
    pub timestamp_us: u64,
}

/// Information about a single MIDI device, serializable for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiDeviceInfo {
    /// Port name as reported by the OS.
    pub name: String,
    /// Whether this is an input port.
    pub is_input: bool,
    /// Whether this is an output port.
    pub is_output: bool,
}

/// Current MIDI connection status, serializable for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiStatus {
    /// Name of the currently connected input port, if any.
    pub active_input: Option<String>,
    /// Name of the currently connected output port, if any.
    pub active_output: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── NoteOn ─────────────────────────────────────────

    #[test]
    fn test_parse_note_on() {
        let event = MidiEvent::from_bytes(&[0x90, 60, 100]).unwrap();
        assert_eq!(
            event,
            MidiEvent::NoteOn {
                channel: 0,
                note: 60,
                velocity: 100
            }
        );
    }

    #[test]
    fn test_parse_note_on_channel_15() {
        let event = MidiEvent::from_bytes(&[0x9F, 60, 100]).unwrap();
        assert_eq!(
            event,
            MidiEvent::NoteOn {
                channel: 15,
                note: 60,
                velocity: 100
            }
        );
    }

    #[test]
    fn test_parse_note_on_velocity_zero_is_note_off() {
        let event = MidiEvent::from_bytes(&[0x90, 60, 0]).unwrap();
        assert_eq!(
            event,
            MidiEvent::NoteOff {
                channel: 0,
                note: 60,
                velocity: 0
            }
        );
    }

    // ─── NoteOff ────────────────────────────────────────

    #[test]
    fn test_parse_note_off() {
        let event = MidiEvent::from_bytes(&[0x80, 60, 64]).unwrap();
        assert_eq!(
            event,
            MidiEvent::NoteOff {
                channel: 0,
                note: 60,
                velocity: 64
            }
        );
    }

    // ─── Control Change ─────────────────────────────────

    #[test]
    fn test_parse_control_change() {
        let event = MidiEvent::from_bytes(&[0xB0, 1, 64]).unwrap();
        assert_eq!(
            event,
            MidiEvent::ControlChange {
                channel: 0,
                controller: 1,
                value: 64
            }
        );
    }

    #[test]
    fn test_parse_control_change_channel_5() {
        let event = MidiEvent::from_bytes(&[0xB5, 7, 127]).unwrap();
        assert_eq!(
            event,
            MidiEvent::ControlChange {
                channel: 5,
                controller: 7,
                value: 127
            }
        );
    }

    // ─── Program Change ─────────────────────────────────

    #[test]
    fn test_parse_program_change() {
        let event = MidiEvent::from_bytes(&[0xC0, 5]).unwrap();
        assert_eq!(
            event,
            MidiEvent::ProgramChange {
                channel: 0,
                program: 5
            }
        );
    }

    // ─── Aftertouch ─────────────────────────────────────

    #[test]
    fn test_parse_channel_aftertouch() {
        let event = MidiEvent::from_bytes(&[0xD0, 100]).unwrap();
        assert_eq!(
            event,
            MidiEvent::ChannelAftertouch {
                channel: 0,
                pressure: 100
            }
        );
    }

    #[test]
    fn test_parse_poly_aftertouch() {
        let event = MidiEvent::from_bytes(&[0xA0, 60, 100]).unwrap();
        assert_eq!(
            event,
            MidiEvent::PolyAftertouch {
                channel: 0,
                note: 60,
                pressure: 100
            }
        );
    }

    // ─── Pitch Bend ─────────────────────────────────────

    #[test]
    fn test_parse_pitch_bend_center() {
        let event = MidiEvent::from_bytes(&[0xE0, 0x00, 0x40]).unwrap();
        assert_eq!(event, MidiEvent::PitchBend { channel: 0, value: 0 });
    }

    #[test]
    fn test_parse_pitch_bend_min() {
        let event = MidiEvent::from_bytes(&[0xE0, 0x00, 0x00]).unwrap();
        assert_eq!(
            event,
            MidiEvent::PitchBend {
                channel: 0,
                value: -8192
            }
        );
    }

    #[test]
    fn test_parse_pitch_bend_max() {
        let event = MidiEvent::from_bytes(&[0xE0, 0x7F, 0x7F]).unwrap();
        assert_eq!(
            event,
            MidiEvent::PitchBend {
                channel: 0,
                value: 8191
            }
        );
    }

    // ─── Channel encoding ───────────────────────────────

    #[test]
    fn test_parse_all_channels() {
        for ch in 0u8..16 {
            let event = MidiEvent::from_bytes(&[0x90 | ch, 60, 100]).unwrap();
            assert_eq!(
                event,
                MidiEvent::NoteOn {
                    channel: ch,
                    note: 60,
                    velocity: 100
                }
            );
        }
    }

    // ─── Edge cases ─────────────────────────────────────

    #[test]
    fn test_parse_empty_data() {
        assert!(MidiEvent::from_bytes(&[]).is_none());
    }

    #[test]
    fn test_parse_single_byte_note_on() {
        assert!(MidiEvent::from_bytes(&[0x90]).is_none());
    }

    #[test]
    fn test_parse_two_bytes_note_on() {
        assert!(MidiEvent::from_bytes(&[0x90, 60]).is_none());
    }

    #[test]
    fn test_parse_single_byte_program_change() {
        assert!(MidiEvent::from_bytes(&[0xC0]).is_none());
    }

    #[test]
    fn test_parse_unknown_system_message() {
        let event = MidiEvent::from_bytes(&[0xF0, 0x7E, 0x7F, 0xF7]).unwrap();
        assert_eq!(
            event,
            MidiEvent::Unknown(vec![0xF0, 0x7E, 0x7F, 0xF7])
        );
    }

    // ─── Roundtrip ──────────────────────────────────────

    #[test]
    fn test_roundtrip_note_on() {
        let bytes = [0x93, 60, 100];
        let event = MidiEvent::from_bytes(&bytes).unwrap();
        assert_eq!(event.to_bytes(), bytes);
    }

    #[test]
    fn test_roundtrip_note_off() {
        let bytes = [0x82, 60, 64];
        let event = MidiEvent::from_bytes(&bytes).unwrap();
        assert_eq!(event.to_bytes(), bytes);
    }

    #[test]
    fn test_roundtrip_control_change() {
        let bytes = [0xB5, 7, 127];
        let event = MidiEvent::from_bytes(&bytes).unwrap();
        assert_eq!(event.to_bytes(), bytes);
    }

    #[test]
    fn test_roundtrip_program_change() {
        let bytes = [0xC4, 42];
        let event = MidiEvent::from_bytes(&bytes).unwrap();
        assert_eq!(event.to_bytes(), bytes);
    }

    #[test]
    fn test_roundtrip_channel_aftertouch() {
        let bytes = [0xD1, 80];
        let event = MidiEvent::from_bytes(&bytes).unwrap();
        assert_eq!(event.to_bytes(), bytes);
    }

    #[test]
    fn test_roundtrip_poly_aftertouch() {
        let bytes = [0xA3, 60, 100];
        let event = MidiEvent::from_bytes(&bytes).unwrap();
        assert_eq!(event.to_bytes(), bytes);
    }

    #[test]
    fn test_roundtrip_pitch_bend() {
        let bytes = [0xE0, 0x00, 0x40]; // center
        let event = MidiEvent::from_bytes(&bytes).unwrap();
        assert_eq!(event.to_bytes(), bytes);
    }

    #[test]
    fn test_roundtrip_pitch_bend_extremes() {
        // Min
        let bytes_min = [0xE0, 0x00, 0x00];
        let event_min = MidiEvent::from_bytes(&bytes_min).unwrap();
        assert_eq!(event_min.to_bytes(), bytes_min);

        // Max
        let bytes_max = [0xE0, 0x7F, 0x7F];
        let event_max = MidiEvent::from_bytes(&bytes_max).unwrap();
        assert_eq!(event_max.to_bytes(), bytes_max);
    }

    // ─── Serialization ──────────────────────────────────

    #[test]
    fn test_midi_device_info_serialization() {
        let info = MidiDeviceInfo {
            name: "loopMIDI Port".to_string(),
            is_input: true,
            is_output: false,
        };
        let json = serde_json::to_string(&info).unwrap();
        let deser: MidiDeviceInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deser.name, "loopMIDI Port");
        assert!(deser.is_input);
        assert!(!deser.is_output);
    }

    #[test]
    fn test_midi_status_serialization() {
        let status = MidiStatus {
            active_input: Some("loopMIDI Port".to_string()),
            active_output: None,
        };
        let json = serde_json::to_string(&status).unwrap();
        let deser: MidiStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deser.active_input.unwrap(), "loopMIDI Port");
        assert!(deser.active_output.is_none());
    }
}
