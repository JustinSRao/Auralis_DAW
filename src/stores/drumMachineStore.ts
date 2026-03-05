import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import {
  createDrumMachine,
  getDrumState,
  setDrumStep,
  loadDrumPadSample,
  setDrumSwing,
  setDrumBpm,
  setDrumPatternLength,
  drumPlay,
  drumStop,
  drumReset,
  type DrumMachineSnapshot,
} from "../lib/ipc";

// ── Default snapshot ──────────────────────────────────────────────────────────

function makeDefaultSnapshot(): DrumMachineSnapshot {
  return {
    bpm: 120,
    swing: 0,
    pattern_length: 16,
    playing: false,
    current_step: 0,
    pads: Array.from({ length: 16 }, (_, i) => ({
      idx: i,
      name: `Pad ${i + 1}`,
      has_sample: false,
      steps: Array.from({ length: 16 }, () => ({ active: false, velocity: 100 })),
    })),
  };
}

// ── Store interface ───────────────────────────────────────────────────────────

interface DrumMachineStoreState {
  snapshot: DrumMachineSnapshot;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  /** Creates the drum machine instrument in the audio graph. */
  initialize(): Promise<void>;
  /** Fetches the full state snapshot from the backend. */
  fetchState(): Promise<void>;
  /** Toggles a step's active state and sets its velocity. */
  toggleStep(padIdx: number, stepIdx: number, velocity?: number): Promise<void>;
  /** Sets a specific step's velocity without changing its active state. */
  setStepVelocity(padIdx: number, stepIdx: number, velocity: number): Promise<void>;
  /** Loads an audio file into a drum pad. */
  loadPadSample(padIdx: number, filePath: string): Promise<void>;
  /** Sets the swing amount (0.0–0.5). */
  setSwing(swing: number): Promise<void>;
  /** Sets the BPM (1–300). */
  setBpm(bpm: number): Promise<void>;
  /** Sets the pattern length (16 or 32). */
  setPatternLength(length: 16 | 32): Promise<void>;
  /** Starts playback. */
  play(): Promise<void>;
  /** Pauses playback. */
  stop(): Promise<void>;
  /** Stops and resets to step 0. */
  reset(): Promise<void>;
  /** Updates the highlighted step index (called from Tauri event listener). */
  setCurrentStep(step: number): void;
  /** Clears the error field. */
  clearError(): void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useDrumMachineStore = create<DrumMachineStoreState>()(
  immer((set, get) => ({
    snapshot: makeDefaultSnapshot(),
    isInitialized: false,
    isLoading: false,
    error: null,

    async initialize() {
      if (get().isInitialized || get().isLoading) return;
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        await createDrumMachine();
        const snap = await getDrumState();
        set((s) => {
          s.snapshot = snap;
          s.isInitialized = true;
          s.isLoading = false;
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
          s.isLoading = false;
        });
      }
    },

    async fetchState() {
      try {
        const snap = await getDrumState();
        set((s) => {
          s.snapshot = snap;
          s.error = null;
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async toggleStep(padIdx, stepIdx, velocity = 100) {
      const current = get().snapshot.pads[padIdx]?.steps[stepIdx];
      if (!current) return;
      const newActive = !current.active;

      // Optimistic update
      set((s) => {
        const step = s.snapshot.pads[padIdx]?.steps[stepIdx];
        if (step) {
          step.active = newActive;
          step.velocity = velocity;
        }
      });

      try {
        await setDrumStep(padIdx, stepIdx, newActive, velocity);
      } catch (err) {
        // Roll back
        set((s) => {
          const step = s.snapshot.pads[padIdx]?.steps[stepIdx];
          if (step) step.active = !newActive;
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setStepVelocity(padIdx, stepIdx, velocity) {
      const current = get().snapshot.pads[padIdx]?.steps[stepIdx];
      if (!current) return;
      const prevVelocity = current.velocity;

      set((s) => {
        const step = s.snapshot.pads[padIdx]?.steps[stepIdx];
        if (step) step.velocity = velocity;
      });

      try {
        await setDrumStep(padIdx, stepIdx, current.active, velocity);
      } catch (err) {
        // Roll back velocity to previous value
        set((s) => {
          const step = s.snapshot.pads[padIdx]?.steps[stepIdx];
          if (step) step.velocity = prevVelocity;
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async loadPadSample(padIdx, filePath) {
      try {
        await loadDrumPadSample(padIdx, filePath);
        const name = filePath.split(/[/\\]/).pop() ?? filePath;
        set((s) => {
          const pad = s.snapshot.pads[padIdx];
          if (pad) {
            pad.name = name;
            pad.has_sample = true;
          }
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setSwing(swing) {
      set((s) => {
        s.snapshot.swing = swing;
      });
      try {
        await setDrumSwing(swing);
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setBpm(bpm) {
      set((s) => {
        s.snapshot.bpm = bpm;
      });
      try {
        await setDrumBpm(bpm);
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setPatternLength(length) {
      set((s) => {
        s.snapshot.pattern_length = length;
        // Extend or trim steps in the snapshot
        for (const pad of s.snapshot.pads) {
          while (pad.steps.length < length) {
            pad.steps.push({ active: false, velocity: 100 });
          }
          if (pad.steps.length > length) {
            pad.steps.length = length;
          }
        }
      });
      try {
        await setDrumPatternLength(length);
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async play() {
      set((s) => {
        s.snapshot.playing = true;
      });
      try {
        await drumPlay();
      } catch (err) {
        set((s) => {
          s.snapshot.playing = false;
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async stop() {
      set((s) => {
        s.snapshot.playing = false;
      });
      try {
        await drumStop();
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async reset() {
      set((s) => {
        s.snapshot.playing = false;
        s.snapshot.current_step = 0;
      });
      try {
        await drumReset();
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    setCurrentStep(step) {
      set((s) => {
        s.snapshot.current_step = step;
      });
    },

    clearError() {
      set((s) => {
        s.error = null;
      });
    },
  })),
);
