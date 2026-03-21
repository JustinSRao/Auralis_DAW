use std::sync::Arc;
use atomic_float::AtomicF32;

/// An auxiliary send bus.
///
/// Channels route a post-fader copy of their signal here at their configured
/// send level. The bus applies its own fader and feeds into the master mix.
pub struct AuxBus {
    pub id: String,
    pub name: String,
    /// Bus output fader, range 0.0–2.0.
    pub fader: Arc<AtomicF32>,
    /// Peak levels updated each buffer.
    pub peak_l: Arc<AtomicF32>,
    pub peak_r: Arc<AtomicF32>,
    /// Pre-allocated accumulation buffer (stereo interleaved). Zeroed before each callback.
    pub accumulator: Vec<f32>,
}

impl AuxBus {
    pub fn new(id: impl Into<String>, name: impl Into<String>, buffer_size: usize) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            fader: Arc::new(AtomicF32::new(1.0)),
            peak_l: Arc::new(AtomicF32::new(0.0)),
            peak_r: Arc::new(AtomicF32::new(0.0)),
            accumulator: vec![0.0; buffer_size * 2],
        }
    }

    /// Zero the accumulator at the start of each audio callback.
    pub fn clear(&mut self) {
        for s in self.accumulator.iter_mut() {
            *s = 0.0;
        }
    }

    /// Apply fader to accumulated signal and mix into `output` (stereo interleaved).
    pub fn flush_into(&mut self, output: &mut [f32]) {
        let fader = self.fader.load(std::sync::atomic::Ordering::Relaxed);
        let frame_count = output.len() / 2;
        let mut peak_l = 0.0f32;
        let mut peak_r = 0.0f32;

        for i in 0..frame_count {
            let l = self.accumulator.get(i * 2).copied().unwrap_or(0.0) * fader;
            let r = self.accumulator.get(i * 2 + 1).copied().unwrap_or(0.0) * fader;
            output[i * 2] += l;
            output[i * 2 + 1] += r;
            peak_l = peak_l.max(l.abs());
            peak_r = peak_r.max(r.abs());
        }

        self.peak_l.store(peak_l, std::sync::atomic::Ordering::Relaxed);
        self.peak_r.store(peak_r, std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bus_fader_half() {
        let mut bus = AuxBus::new("b0", "Test Bus", 4);
        bus.fader.store(0.5, std::sync::atomic::Ordering::Relaxed);
        for s in bus.accumulator.iter_mut() { *s = 1.0; }
        let mut out = vec![0.0f32; 8];
        bus.flush_into(&mut out);
        for s in out.iter() {
            assert!((s - 0.5).abs() < 1e-4);
        }
    }

    #[test]
    fn test_bus_clear() {
        let mut bus = AuxBus::new("b0", "Test Bus", 4);
        for s in bus.accumulator.iter_mut() { *s = 1.0; }
        bus.clear();
        assert!(bus.accumulator.iter().all(|&s| s == 0.0));
    }
}
