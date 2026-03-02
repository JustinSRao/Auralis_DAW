use std::f32::consts::TAU;

/// The four waveform shapes available to the oscillator.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Waveform {
    /// Sawtooth wave: linearly ramps from -1 to +1 each cycle.
    Saw,
    /// Square / pulse wave: width controlled by `pulse_width`.
    Square,
    /// Sinusoidal wave.
    Sine,
    /// Triangle wave: linearly ramps up then down each cycle.
    Triangle,
}

impl Waveform {
    /// Converts a floating-point waveform index (0.0–3.0) to the nearest `Waveform`.
    ///
    /// Values are truncated: 0→Saw, 1→Square, 2→Sine, 3→Triangle.
    /// Any value outside the range saturates to the nearest enum variant.
    pub fn from_f32(v: f32) -> Self {
        match v as u32 {
            0 => Self::Saw,
            1 => Self::Square,
            2 => Self::Sine,
            _ => Self::Triangle,
        }
    }
}

/// Phase-accumulator oscillator producing naive (alias-rich) waveforms.
///
/// Phase is stored normalised to [0.0, 1.0). No band-limiting is applied.
/// Real-time safe: no allocations or locks.
pub struct Oscillator {
    /// Current phase in [0.0, 1.0).
    phase: f32,
}

impl Oscillator {
    /// Creates a new oscillator with phase reset to 0.
    pub fn new() -> Self {
        Self { phase: 0.0 }
    }

    /// Resets the oscillator phase to 0.0.
    pub fn reset(&mut self) {
        self.phase = 0.0;
    }

    /// Advances the phase by one sample and returns the output sample.
    ///
    /// `frequency` is the desired frequency in Hz.
    /// `sample_rate` is the current stream sample rate in Hz.
    /// `waveform` selects the synthesis algorithm.
    /// `pulse_width` controls the square-wave duty cycle (0.05–0.95).
    pub fn tick(
        &mut self,
        frequency: f32,
        sample_rate: f32,
        waveform: Waveform,
        pulse_width: f32,
    ) -> f32 {
        let phase_inc = frequency / sample_rate;
        let sample = match waveform {
            Waveform::Saw => 2.0 * self.phase - 1.0,
            Waveform::Square => {
                if self.phase < pulse_width {
                    1.0
                } else {
                    -1.0
                }
            }
            Waveform::Sine => (TAU * self.phase).sin(),
            Waveform::Triangle => {
                if self.phase < 0.5 {
                    4.0 * self.phase - 1.0
                } else {
                    -4.0 * self.phase + 3.0
                }
            }
        };

        self.phase += phase_inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        sample
    }
}

impl Default for Oscillator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;
    const FREQ: f32 = 440.0;
    const FRAMES: usize = 1024;

    fn collect(waveform: Waveform, pulse_width: f32) -> Vec<f32> {
        let mut osc = Oscillator::new();
        (0..FRAMES)
            .map(|_| osc.tick(FREQ, SR, waveform, pulse_width))
            .collect()
    }

    #[test]
    fn test_saw_range() {
        let samples = collect(Waveform::Saw, 0.5);
        for &s in &samples {
            assert!(
                s >= -1.0 && s <= 1.0,
                "Saw sample out of range: {}",
                s
            );
        }
    }

    #[test]
    fn test_square_range() {
        let samples = collect(Waveform::Square, 0.5);
        for &s in &samples {
            // Square wave should only ever be exactly +1 or -1
            assert!(
                (s - 1.0).abs() < f32::EPSILON || (s + 1.0).abs() < f32::EPSILON,
                "Square sample must be ±1, got: {}",
                s
            );
        }
    }

    #[test]
    fn test_sine_range() {
        let samples = collect(Waveform::Sine, 0.5);
        for &s in &samples {
            assert!(
                s >= -1.0001 && s <= 1.0001,
                "Sine sample out of range: {}",
                s
            );
        }
        let max = samples.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        assert!(max > 0.99, "Sine peak should reach ~1.0, got {}", max);
    }

    #[test]
    fn test_triangle_range() {
        let samples = collect(Waveform::Triangle, 0.5);
        for &s in &samples {
            assert!(
                s >= -1.0001 && s <= 1.0001,
                "Triangle sample out of range: {}",
                s
            );
        }
    }

    #[test]
    fn test_phase_wraps() {
        let mut osc = Oscillator::new();
        // Run many cycles — phase should never exceed 1.0 or go negative
        for _ in 0..100_000 {
            osc.tick(440.0, SR, Waveform::Saw, 0.5);
            assert!(osc.phase >= 0.0 && osc.phase < 1.0);
        }
    }
}
