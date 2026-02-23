use atomic_float::AtomicF32;
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// A single processing node in the audio graph.
///
/// Implementations must be real-time safe: no allocations, no blocking, no locks.
/// The `process` method is called from the audio thread on every buffer.
pub trait AudioNode: Send {
    /// Process audio into the output buffer. Called from the audio thread.
    ///
    /// `output` is a pre-allocated interleaved sample buffer.
    /// `sample_rate` and `channels` describe the current stream format.
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16);

    /// Human-readable name for debugging.
    fn name(&self) -> &str;
}

/// A test tone generator producing a 440 Hz sine wave.
///
/// Used to verify that the audio engine is working end-to-end.
/// Amplitude is controllable via `AtomicF32` from any thread.
pub struct SineTestNode {
    phase: f32,
    frequency: f32,
    /// Amplitude (0.0 to 1.0), safe to modify from any thread via the Arc.
    pub amplitude: Arc<AtomicF32>,
}

impl SineTestNode {
    /// Creates a new sine test node at 440 Hz with 0.3 amplitude.
    pub fn new() -> Self {
        Self {
            phase: 0.0,
            frequency: 440.0,
            amplitude: Arc::new(AtomicF32::new(0.3)),
        }
    }

    /// Creates a new sine test node with a shared amplitude control.
    ///
    /// The caller retains an `Arc<AtomicF32>` clone to control amplitude
    /// from the main thread while the node runs on the audio thread.
    pub fn with_shared_amplitude(amplitude: Arc<AtomicF32>) -> Self {
        Self {
            phase: 0.0,
            frequency: 440.0,
            amplitude,
        }
    }
}

impl Default for SineTestNode {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioNode for SineTestNode {
    fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        let phase_inc = self.frequency / sample_rate as f32;
        let amp = self.amplitude.load(Ordering::Relaxed);
        let ch_count = channels as usize;

        for frame in output.chunks_exact_mut(ch_count) {
            let sample = (self.phase * 2.0 * std::f32::consts::PI).sin() * amp;
            for ch in frame.iter_mut() {
                *ch = sample;
            }
            self.phase += phase_inc;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
        }
    }

    fn name(&self) -> &str {
        "SineTestNode"
    }
}

/// Container for audio processing nodes with pre-allocated buffers.
///
/// The graph is designed to be swapped atomically via the triple-buffer mechanism
/// in the audio engine. Each graph instance owns its nodes and mix buffer.
/// No allocations occur during `process()`.
pub struct AudioGraph {
    nodes: Vec<Box<dyn AudioNode>>,
    mix_buffer: Vec<f32>,
}

impl AudioGraph {
    /// Creates a new empty audio graph with a pre-allocated mix buffer.
    ///
    /// `max_buffer_size` is the maximum number of samples per buffer (e.g., 1024).
    /// `max_channels` is the maximum number of audio channels (e.g., 2 for stereo).
    pub fn new(max_buffer_size: usize, max_channels: usize) -> Self {
        Self {
            nodes: Vec::new(),
            mix_buffer: vec![0.0; max_buffer_size * max_channels],
        }
    }

    /// Adds a processing node to the graph.
    ///
    /// Must only be called before the graph is sent to the audio thread.
    pub fn add_node(&mut self, node: Box<dyn AudioNode>) {
        self.nodes.push(node);
    }

    /// Returns the number of nodes in this graph.
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Process all nodes, mixing their output into the provided buffer.
    ///
    /// Called from the audio thread. Zero allocations.
    pub fn process(&mut self, output: &mut [f32], sample_rate: u32, channels: u16) {
        // Zero the output buffer
        for s in output.iter_mut() {
            *s = 0.0;
        }

        if self.nodes.is_empty() {
            return;
        }

        let len = output.len();

        for node in &mut self.nodes {
            // Zero the mix buffer (only the portion we need)
            for s in self.mix_buffer[..len].iter_mut() {
                *s = 0.0;
            }

            node.process(&mut self.mix_buffer[..len], sample_rate, channels);

            // Sum into output
            for (out, mix) in output.iter_mut().zip(self.mix_buffer[..len].iter()) {
                *out += *mix;
            }
        }
    }
}

// Safety: AudioGraph is Send because all AudioNode impls must be Send.
// The graph is transferred between threads via the triple-buffer swap,
// never shared concurrently.
unsafe impl Send for AudioGraph {}

/// Triple buffer for lock-free graph swapping between main and audio threads.
///
/// The main thread writes new graphs to the "write" slot and publishes them.
/// The audio thread reads from the "read" slot, picking up new graphs
/// at the start of each buffer without blocking.
///
/// This allows hot-swapping the audio graph (adding/removing nodes)
/// without stopping the audio stream or blocking the audio thread.
pub struct TripleBuffer {
    buffers: [Option<AudioGraph>; 3],
    /// Index the audio thread reads from.
    read_idx: usize,
    /// Index the main thread writes to.
    write_idx: usize,
    /// Index of the most recently published graph (the "swap" slot).
    swap_idx: usize,
    /// Flag indicating the main thread has published a new graph.
    new_data: std::sync::atomic::AtomicBool,
}

impl TripleBuffer {
    /// Creates a new triple buffer with an initial graph in the read slot.
    pub fn new(initial_graph: AudioGraph) -> Self {
        Self {
            buffers: [Some(initial_graph), None, None],
            read_idx: 0,
            write_idx: 1,
            swap_idx: 2,
            new_data: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Publishes a new graph from the main thread.
    ///
    /// The graph will be picked up by the audio thread on the next buffer.
    pub fn publish(&mut self, graph: AudioGraph) {
        self.buffers[self.write_idx] = Some(graph);
        // Swap write and swap indices
        std::mem::swap(&mut self.write_idx, &mut self.swap_idx);
        self.new_data.store(true, Ordering::Release);
    }

    /// Called by the audio thread at the start of each buffer.
    ///
    /// If the main thread has published a new graph, swaps it in and returns
    /// a mutable reference to the current graph. Otherwise returns the existing graph.
    /// This is lock-free: just an atomic load and index swap.
    pub fn read(&mut self) -> Option<&mut AudioGraph> {
        if self.new_data.load(Ordering::Acquire) {
            // Swap read and swap indices to pick up the new graph
            std::mem::swap(&mut self.read_idx, &mut self.swap_idx);
            self.new_data.store(false, Ordering::Release);
        }
        self.buffers[self.read_idx].as_mut()
    }
}

// Safety: TripleBuffer is designed to be split across two threads.
// In practice, we wrap it in a structure where the audio thread
// exclusively calls `read()` and the main thread exclusively calls `publish()`.
unsafe impl Send for TripleBuffer {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sine_node_produces_nonzero_output() {
        let mut node = SineTestNode::new();
        let mut buffer = vec![0.0f32; 256];
        node.process(&mut buffer, 44100, 1);

        // Should have non-zero samples (440 Hz sine)
        let has_nonzero = buffer.iter().any(|&s| s.abs() > 0.001);
        assert!(has_nonzero, "SineTestNode should produce non-zero output");
    }

    #[test]
    fn test_sine_node_amplitude() {
        let mut node = SineTestNode::new();
        node.amplitude.store(0.5, Ordering::Relaxed);
        let mut buffer = vec![0.0f32; 1024];
        node.process(&mut buffer, 44100, 1);

        let max_sample = buffer.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        // Amplitude should be close to 0.5 (sine peak)
        assert!(
            max_sample <= 0.51 && max_sample >= 0.49,
            "Peak amplitude should be ~0.5, got {}",
            max_sample
        );
    }

    #[test]
    fn test_sine_node_zero_amplitude() {
        let mut node = SineTestNode::new();
        node.amplitude.store(0.0, Ordering::Relaxed);
        let mut buffer = vec![0.0f32; 256];
        node.process(&mut buffer, 44100, 1);

        let max_sample = buffer.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(
            max_sample < 0.0001,
            "Zero amplitude should produce silence, got {}",
            max_sample
        );
    }

    #[test]
    fn test_sine_node_stereo() {
        let mut node = SineTestNode::new();
        let mut buffer = vec![0.0f32; 512]; // 256 frames * 2 channels
        node.process(&mut buffer, 44100, 2);

        // Left and right channels should be identical (mono sine)
        for frame in buffer.chunks_exact(2) {
            assert!(
                (frame[0] - frame[1]).abs() < f32::EPSILON,
                "Stereo channels should be identical"
            );
        }
    }

    #[test]
    fn test_sine_node_frequency() {
        let mut node = SineTestNode::new();
        node.amplitude.store(1.0, Ordering::Relaxed);
        let sample_rate = 44100u32;
        let num_samples = 44100usize; // 1 second
        let mut buffer = vec![0.0f32; num_samples];
        node.process(&mut buffer, sample_rate, 1);

        // Count zero crossings to verify frequency
        let mut crossings = 0;
        for i in 1..num_samples {
            if (buffer[i - 1] >= 0.0 && buffer[i] < 0.0)
                || (buffer[i - 1] < 0.0 && buffer[i] >= 0.0)
            {
                crossings += 1;
            }
        }

        // 440 Hz = 880 zero crossings per second (2 per cycle)
        // Allow some tolerance for discrete sampling
        assert!(
            crossings >= 870 && crossings <= 890,
            "Expected ~880 zero crossings for 440 Hz, got {}",
            crossings
        );
    }

    #[test]
    fn test_audio_graph_empty_produces_silence() {
        let mut graph = AudioGraph::new(1024, 2);
        let mut buffer = vec![1.0f32; 512]; // Pre-fill with 1.0
        graph.process(&mut buffer, 44100, 2);

        // Empty graph should zero the buffer
        assert!(
            buffer.iter().all(|&s| s == 0.0),
            "Empty graph should produce silence"
        );
    }

    #[test]
    fn test_audio_graph_single_node() {
        let mut graph = AudioGraph::new(1024, 2);
        graph.add_node(Box::new(SineTestNode::new()));
        assert_eq!(graph.node_count(), 1);

        let mut buffer = vec![0.0f32; 256];
        graph.process(&mut buffer, 44100, 1);

        let has_nonzero = buffer.iter().any(|&s| s.abs() > 0.001);
        assert!(has_nonzero, "Graph with SineTestNode should produce audio");
    }

    #[test]
    fn test_audio_graph_mixes_multiple_nodes() {
        // Two sine nodes at 0.3 amplitude should sum to ~0.6 peak
        let mut graph = AudioGraph::new(1024, 2);
        graph.add_node(Box::new(SineTestNode::new()));
        graph.add_node(Box::new(SineTestNode::new()));
        assert_eq!(graph.node_count(), 2);

        let mut buffer = vec![0.0f32; 1024];
        graph.process(&mut buffer, 44100, 1);

        let max_sample = buffer.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        // Two identical sine waves sum constructively: peak ~0.6
        assert!(
            max_sample > 0.55 && max_sample < 0.65,
            "Two sine nodes should mix to ~0.6 peak, got {}",
            max_sample
        );
    }

    #[test]
    fn test_triple_buffer_initial_read() {
        let graph = AudioGraph::new(256, 2);
        let mut tb = TripleBuffer::new(graph);
        let read = tb.read();
        assert!(read.is_some(), "Initial read should return the graph");
    }

    #[test]
    fn test_triple_buffer_publish_and_read() {
        let initial = AudioGraph::new(256, 2);
        let mut tb = TripleBuffer::new(initial);

        // Publish a new graph with a node
        let mut new_graph = AudioGraph::new(256, 2);
        new_graph.add_node(Box::new(SineTestNode::new()));
        tb.publish(new_graph);

        // Read should pick up the new graph
        let read = tb.read().expect("Should have a graph");
        assert_eq!(read.node_count(), 1, "Should have picked up the new graph");
    }

    #[test]
    fn test_triple_buffer_no_new_data() {
        let initial = AudioGraph::new(256, 2);
        let mut tb = TripleBuffer::new(initial);

        // First read clears new_data flag
        let _ = tb.read();
        // Second read without publish should still return the same graph
        let read = tb.read();
        assert!(read.is_some(), "Read without publish should still return graph");
    }

    #[test]
    fn test_sine_node_name() {
        let node = SineTestNode::new();
        assert_eq!(node.name(), "SineTestNode");
    }

    #[test]
    fn test_sine_node_default() {
        let node = SineTestNode::default();
        assert_eq!(node.name(), "SineTestNode");
    }
}
