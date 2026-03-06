import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import {
  createSequencer,
  getSequencerState,
  setSequencerStep,
  setSequencerLength,
  setSequencerTimeDiv,
  setSequencerTranspose,
  sequencerPlay,
  sequencerStop,
  sequencerReset,
  type SequencerSnapshot,
} from "../lib/ipc";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SequencerStep {
  enabled: boolean;
  /** MIDI note number 0–127. */
  note: number;
  /** Velocity 1–127. */
  velocity: number;
  /** Gate time 0.1–1.0. */
  gate: number;
  /** Trigger probability 0–100. */
  probability: number;
}

export interface SequencerState {
  playing: boolean;
  current_step: number;
  pattern_length: 16 | 32 | 64;
  time_div: 4 | 8 | 16 | 32;
  /** Semitone transpose offset -24..+24. */
  transpose: number;
  steps: SequencerStep[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function makeDefaultStep(): SequencerStep {
  return { enabled: false, note: 60, velocity: 100, gate: 0.8, probability: 100 };
}

function makeDefaultState(): SequencerState {
  return {
    playing: false,
    current_step: 0,
    pattern_length: 16,
    time_div: 16,
    transpose: 0,
    steps: Array.from({ length: 64 }, makeDefaultStep),
  };
}

// ── Store interface ───────────────────────────────────────────────────────────

interface SequencerStore {
  state: SequencerState;
  initialized: boolean;
  error: string | null;

  /** Creates the sequencer instrument in the audio graph. */
  initialize(): Promise<void>;
  /** Fetches the full state snapshot from the backend. */
  fetchState(): Promise<void>;
  /** Updates a step's properties (optimistic). */
  setStep(idx: number, step: Partial<SequencerStep>): Promise<void>;
  /** Sets the pattern length (16, 32, or 64). */
  setLength(length: 16 | 32 | 64): Promise<void>;
  /** Sets the time division (4, 8, 16, or 32). */
  setTimeDiv(div: 4 | 8 | 16 | 32): Promise<void>;
  /** Sets the transpose amount in semitones (-24..+24). */
  setTranspose(semitones: number): Promise<void>;
  /** Starts playback. */
  play(): Promise<void>;
  /** Stops playback. */
  stop(): Promise<void>;
  /** Stops and resets to step 0. */
  reset(): Promise<void>;
  /** Updates the highlighted step index (called from Tauri event listener). */
  setCurrentStep(step: number): void;
  /** Clears the error field. */
  clearError(): void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useSequencerStore = create<SequencerStore>()(
  immer((set, get) => ({
    state: makeDefaultState(),
    initialized: false,
    error: null,

    async initialize() {
      if (get().initialized) return;
      try {
        await createSequencer();
        const snap = await getSequencerState();
        set((s) => {
          s.state = snapToState(snap);
          s.initialized = true;
          s.error = null;
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async fetchState() {
      try {
        const snap = await getSequencerState();
        set((s) => {
          s.state = snapToState(snap);
          s.error = null;
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setStep(idx, partial) {
      const current = get().state.steps[idx];
      if (!current) return;

      const merged: SequencerStep = { ...current, ...partial };

      set((s) => {
        const step = s.state.steps[idx];
        if (step) {
          Object.assign(step, partial);
        }
      });

      try {
        await setSequencerStep(
          idx,
          merged.enabled,
          merged.note,
          merged.velocity,
          merged.gate,
          merged.probability,
        );
      } catch (err) {
        // Roll back
        set((s) => {
          const step = s.state.steps[idx];
          if (step) {
            Object.assign(step, current);
          }
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setLength(length) {
      set((s) => {
        s.state.pattern_length = length;
      });
      try {
        await setSequencerLength(length);
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setTimeDiv(div) {
      set((s) => {
        s.state.time_div = div;
      });
      try {
        await setSequencerTimeDiv(div);
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async setTranspose(semitones) {
      set((s) => {
        s.state.transpose = semitones;
      });
      try {
        await setSequencerTranspose(semitones);
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async play() {
      set((s) => {
        s.state.playing = true;
      });
      try {
        await sequencerPlay();
      } catch (err) {
        set((s) => {
          s.state.playing = false;
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async stop() {
      set((s) => {
        s.state.playing = false;
      });
      try {
        await sequencerStop();
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    async reset() {
      set((s) => {
        s.state.playing = false;
        s.state.current_step = 0;
      });
      try {
        await sequencerReset();
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    setCurrentStep(step) {
      set((s) => {
        s.state.current_step = step;
      });
    },

    clearError() {
      set((s) => {
        s.error = null;
      });
    },
  })),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts a backend SequencerSnapshot into SequencerState. */
function snapToState(snap: SequencerSnapshot): SequencerState {
  const steps: SequencerStep[] = Array.from({ length: 64 }, (_, i) => {
    const s = snap.steps[i];
    if (!s) return makeDefaultStep();
    return {
      enabled: s.enabled,
      note: s.note,
      velocity: s.velocity,
      gate: s.gate,
      probability: s.probability,
    };
  });
  return {
    playing: snap.playing,
    current_step: snap.current_step,
    pattern_length: snap.pattern_length as 16 | 32 | 64,
    time_div: snap.time_div as 4 | 8 | 16 | 32,
    transpose: snap.transpose,
    steps,
  };
}
